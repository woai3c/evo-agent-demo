import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { generateObject } from 'ai'

import { z } from 'zod'

import type { ProviderName } from '@evo/shared'

import { db } from '../db/index.js'
import { getModel } from '../providers/registry.js'

const PROJECT_ROOT = resolve(import.meta.dirname, '../../../../')

// ── Schemas ──

const FileLocatorSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string().describe('Relative path from project root, e.g. "packages/server/src/agent/loop.ts"'),
        reason: z.string().describe('Why this file is relevant to the bug fix'),
      }),
    )
    .describe('Files that need to be modified to fix this bug'),
})

const CodeFixSchema = z.object({
  changes: z.array(
    z.object({
      filePath: z.string().describe('Relative path from project root'),
      searchBlock: z.string().describe('Exact existing code block to find (must match file content exactly)'),
      replaceBlock: z.string().describe('New code to replace the search block with'),
      explanation: z.string().describe('What this change does'),
    }),
  ),
  commitMessage: z.string().describe('Git commit message (English, conventional commits format)'),
  prTitle: z.string().describe('PR title (English, under 70 chars)'),
  prBody: z.string().describe('PR body (English, markdown)'),
})

// ── Helpers ──

function git(cmd: string): string {
  return execSync(`git ${cmd}`, { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30_000 }).trim()
}

function gitSafe(cmd: string): string | null {
  try {
    return git(cmd)
  } catch {
    return null
  }
}

function hasGhCli(): boolean {
  try {
    execSync('gh --version', { encoding: 'utf-8', timeout: 5_000 })
    return true
  } catch {
    return false
  }
}

function hasRemote(): boolean {
  return gitSafe('remote get-url origin') !== null
}

// ── Fix Target ──

interface FixTarget {
  source: 'pattern' | 'behavior'
  sourceId: string
  name: string
  description: string
  locatorPromptExtra: string
  fixPromptExtra: string
}

function getUnfixedBugs(): FixTarget[] {
  const patterns = db
    .prepare(
      `SELECT pattern_id, name, resolution, match_rule, error_type
       FROM patterns
       WHERE category = 'harness_bug' AND fix_status = 'unfixed' AND resolution != ''`,
    )
    .all() as { pattern_id: string; name: string; resolution: string; match_rule: string; error_type: string }[]

  return patterns.map((p) => ({
    source: 'pattern' as const,
    sourceId: p.pattern_id,
    name: p.name,
    description: `Error type: ${p.error_type}\nResolution/Root cause: ${p.resolution}\nMatch rule: ${p.match_rule}`,
    locatorPromptExtra: `## Bug to fix:\nName: ${p.name}\nError type: ${p.error_type}\nResolution/Root cause: ${p.resolution}\nMatch rule: ${p.match_rule}`,
    fixPromptExtra: `## Bug:\nName: ${p.name}\nError type: ${p.error_type}\nResolution: ${p.resolution}\n\nIn the PR body, reference: "Fixes harness bug pattern: ${p.pattern_id} (${p.name})".`,
  }))
}

function getUnfixedBehaviors(): FixTarget[] {
  const behaviors = db
    .prepare(
      `SELECT behavior_id, name, suggestion, tool_sequence, health_flags
       FROM behaviors
       WHERE suggestion_severity = 'critical' AND fix_status = 'unfixed' AND suggestion != ''`,
    )
    .all() as { behavior_id: string; name: string; suggestion: string; tool_sequence: string; health_flags: string }[]

  return behaviors.map((b) => ({
    source: 'behavior' as const,
    sourceId: b.behavior_id,
    name: b.name,
    description: `Suggestion: ${b.suggestion}\nTool sequence: ${b.tool_sequence}\nHealth flags: ${b.health_flags}`,
    locatorPromptExtra: `## Behavior to optimize:\nName: ${b.name}\nTool sequence: ${b.tool_sequence}\nHealth flags: ${b.health_flags}\nSuggestion: ${b.suggestion}`,
    fixPromptExtra: `## Behavior optimization:\nName: ${b.name}\nSuggestion: ${b.suggestion}\n\nIn the PR body, reference: "Optimizes behavior: ${b.behavior_id} (${b.name})".`,
  }))
}

// ── Main ──

export interface AutoFixResult {
  source: 'pattern' | 'behavior'
  sourceId: string
  sourceName: string
  branch: string
  prUrl: string | null
  status: 'pr_created' | 'branch_created' | 'failed'
  error?: string
}

const PROJECT_STRUCTURE = `## Project structure:
- packages/server/src/agent/ — Agent loop, dispatch
- packages/server/src/tools/ — 6 tools (webSearch, webFetch, readFile, codeRunner, dbQuery, sendEmail)
- packages/server/src/tracing/ — Tracer, store, sanitizer
- packages/server/src/evolution/ — Error bucketer, pattern matcher, inspector, auto-fix, context tuner
- packages/server/src/context/ — Compression, truncation
- packages/server/src/providers/ — LLM provider registry
- packages/server/src/api/ — Hono API routes
- packages/web/src/ — React frontend`

export async function runAutoFix(): Promise<AutoFixResult[]> {
  const targets = [...getUnfixedBugs(), ...getUnfixedBehaviors()]
  if (targets.length === 0) return []

  const provider = (process.env.INSPECTOR_PROVIDER ?? process.env.DEFAULT_PROVIDER ?? 'deepseek') as ProviderName
  const modelId = process.env.INSPECTOR_MODEL ?? process.env.DEFAULT_MODEL ?? 'deepseek-v4-flash'
  const model = getModel(provider, modelId)

  const mainBranch = gitSafe('symbolic-ref refs/remotes/origin/HEAD --short')?.replace('origin/', '') ?? 'main'
  const canPush = hasRemote()
  const canPR = canPush && hasGhCli()

  const results: AutoFixResult[] = []
  const updateTable = (t: FixTarget) => (t.source === 'pattern' ? 'patterns' : 'behaviors')
  const updateIdCol = (t: FixTarget) => (t.source === 'pattern' ? 'pattern_id' : 'behavior_id')
  const branchPrefix = (t: FixTarget) => (t.source === 'pattern' ? 'fix' : 'improve')

  for (const target of targets) {
    const slug = target.name
      .replace(/[^a-zA-Z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 50)
    const branchName = `${branchPrefix(target)}/${slug}`

    try {
      // Step 1: Ask LLM which files to read
      const locatorResult = await generateObject({
        model,
        schema: FileLocatorSchema,
        prompt: `You are improving an AI Agent demo project (TypeScript, Hono server, React frontend).

${PROJECT_STRUCTURE}

${target.locatorPromptExtra}

Which source files need to be modified? List 1-5 files.`,
      })

      const filePaths = locatorResult.object.files.map((f) => f.path)
      const fileContents: { path: string; content: string }[] = []

      for (const fp of filePaths) {
        try {
          const abs = resolve(PROJECT_ROOT, fp)
          const content = readFileSync(abs, 'utf-8')
          fileContents.push({ path: fp, content })
        } catch {
          /* file doesn't exist, skip */
        }
      }

      if (fileContents.length === 0) {
        results.push({
          source: target.source,
          sourceId: target.sourceId,
          sourceName: target.name,
          branch: branchName,
          prUrl: null,
          status: 'failed',
          error: 'No relevant source files found',
        })
        continue
      }

      // Step 2: Ask LLM to generate code changes
      const fileContext = fileContents.map((f) => `### ${f.path}\n\`\`\`typescript\n${f.content}\n\`\`\``).join('\n\n')

      const fixResult = await generateObject({
        model,
        schema: CodeFixSchema,
        prompt: `You are improving an AI Agent demo project. Generate precise code changes.

${target.fixPromptExtra}

## Source files:

${fileContext}

## Instructions:
1. Generate search-and-replace blocks. The searchBlock must be an EXACT substring of the current file content.
2. Make minimal, focused changes — fix only the issue described, don't refactor unrelated code.
3. Write commit message in conventional commits format.
4. Write PR title and body in English.`,
      })

      // Step 3: Apply changes on a new branch
      git(`checkout -b ${branchName} ${mainBranch}`)

      let applied = false
      for (const change of fixResult.object.changes) {
        try {
          const abs = resolve(PROJECT_ROOT, change.filePath)
          const original = readFileSync(abs, 'utf-8')
          if (!original.includes(change.searchBlock)) {
            console.warn(`[auto-pr] Search block not found in ${change.filePath}, skipping change`)
            continue
          }
          const modified = original.replace(change.searchBlock, change.replaceBlock)
          writeFileSync(abs, modified, 'utf-8')
          applied = true
        } catch (e) {
          console.warn(`[auto-pr] Failed to apply change to ${change.filePath}:`, e)
        }
      }

      if (!applied) {
        git(`checkout ${mainBranch}`)
        gitSafe(`branch -D ${branchName}`)
        results.push({
          source: target.source,
          sourceId: target.sourceId,
          sourceName: target.name,
          branch: branchName,
          prUrl: null,
          status: 'failed',
          error: 'No code changes could be applied',
        })
        continue
      }

      // Step 4: Commit
      git('add -A')
      const commitMsg = fixResult.object.commitMessage.replace(/'/g, "'\\''")
      git(`commit -m '${commitMsg}'`)

      // Step 5: Push + PR (if possible)
      let prUrl: string | null = null

      if (canPush) {
        gitSafe(`push -u origin ${branchName}`)

        if (canPR) {
          const prBody = fixResult.object.prBody.replace(/'/g, "'\\''")
          const prTitle = fixResult.object.prTitle.replace(/'/g, "'\\''")
          const ghOutput = execSync(
            `gh pr create --base ${mainBranch} --head ${branchName} --title '${prTitle}' --body '${prBody}'`,
            { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30_000 },
          ).trim()
          prUrl = ghOutput.split('\n').pop() ?? null
        }
      }

      // Step 6: Go back to main
      git(`checkout ${mainBranch}`)

      // Step 7: Update status
      const table = updateTable(target)
      const idCol = updateIdCol(target)
      db.prepare(`UPDATE ${table} SET fix_status = ?, fix_pr_url = ? WHERE ${idCol} = ?`).run(
        prUrl ? 'pr_created' : 'branch_created',
        prUrl,
        target.sourceId,
      )

      results.push({
        source: target.source,
        sourceId: target.sourceId,
        sourceName: target.name,
        branch: branchName,
        prUrl,
        status: prUrl ? 'pr_created' : 'branch_created',
      })
    } catch (err) {
      // Ensure we're back on main
      gitSafe(`checkout ${mainBranch}`)
      gitSafe(`branch -D ${branchName}`)

      const message = err instanceof Error ? err.message : String(err)
      const table = updateTable(target)
      const idCol = updateIdCol(target)
      const resetStatus = target.source === 'pattern' ? 'unfixed' : 'unfixed'
      db.prepare(`UPDATE ${table} SET fix_status = ? WHERE ${idCol} = ?`).run(resetStatus, target.sourceId)

      results.push({
        source: target.source,
        sourceId: target.sourceId,
        sourceName: target.name,
        branch: branchName,
        prUrl: null,
        status: 'failed',
        error: message,
      })
    }
  }

  return results
}
