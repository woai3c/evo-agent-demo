import { execSync } from 'node:child_process'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

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

function gitCommitWithFile(message: string): void {
  const msgFile = join(tmpdir(), `evo-commit-${Date.now()}.txt`)
  writeFileSync(msgFile, message, 'utf-8')
  try {
    git(`commit -F "${msgFile}" --no-verify`)
  } finally {
    try {
      unlinkSync(msgFile)
    } catch {
      /* ignore */
    }
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

export type ProgressCallback = (message: string) => void

const PROJECT_STRUCTURE = `## Project structure:
- packages/server/src/agent/ — Agent loop, dispatch
- packages/server/src/tools/ — 6 tools (webSearch, webFetch, readFile, codeRunner, dbQuery, sendEmail)
- packages/server/src/tracing/ — Tracer, store, sanitizer
- packages/server/src/evolution/ — Error bucketer, pattern matcher, inspector, auto-fix, context tuner
- packages/server/src/context/ — Compression, truncation
- packages/server/src/providers/ — LLM provider registry
- packages/server/src/api/ — Hono API routes
- packages/web/src/ — React frontend`

export async function runAutoFix(onProgress?: ProgressCallback): Promise<AutoFixResult[]> {
  const log = onProgress ?? (() => {})

  const targets = [...getUnfixedBugs(), ...getUnfixedBehaviors()]
  if (targets.length === 0) {
    log('没有待修复的目标')
    return []
  }

  const provider = (process.env.INSPECTOR_PROVIDER ?? process.env.DEFAULT_PROVIDER ?? 'deepseek') as ProviderName
  const modelId = process.env.INSPECTOR_MODEL ?? process.env.DEFAULT_MODEL ?? 'deepseek-v4-flash'
  const model = getModel(provider, modelId)

  const mainBranch = gitSafe('symbolic-ref refs/remotes/origin/HEAD --short')?.replace('origin/', '') ?? 'main'
  const canPush = hasRemote()
  const canPR = canPush && hasGhCli()

  log(`发现 ${targets.length} 个修复目标（provider: ${provider}, model: ${modelId}）`)
  log(`主分支: ${mainBranch}, 可推送: ${canPush ? '是' : '否'}, 可创建 PR: ${canPR ? '是' : '否'}`)

  const results: AutoFixResult[] = []
  const updateTable = (t: FixTarget) => (t.source === 'pattern' ? 'patterns' : 'behaviors')
  const updateIdCol = (t: FixTarget) => (t.source === 'pattern' ? 'pattern_id' : 'behavior_id')
  const branchPrefix = (t: FixTarget) => (t.source === 'pattern' ? 'fix' : 'improve')

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]
    const tag = `[${i + 1}/${targets.length}]`
    const slug = target.name
      .replace(/[^a-zA-Z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 50)
    const branchName = `${branchPrefix(target)}/${slug}`

    log(`${tag} 开始处理: ${target.name}（${target.source === 'pattern' ? 'Bug 修复' : '行为优化'}）`)

    try {
      // Step 1: Ask LLM which files to read
      log(`${tag} LLM 定位相关源码文件...`)
      const locatorResult = await generateObject({
        model,
        schema: FileLocatorSchema,
        prompt: `You are improving an AI Agent demo project (TypeScript, Hono server, React frontend).

${PROJECT_STRUCTURE}

${target.locatorPromptExtra}

Which source files need to be modified? List 1-5 files.`,
        abortSignal: AbortSignal.timeout(300_000),
      })

      const filePaths = locatorResult.object.files.map((f) => f.path)
      const fileContents: { path: string; content: string }[] = []

      for (const fp of filePaths) {
        try {
          const abs = resolve(PROJECT_ROOT, fp)
          const content = readFileSync(abs, 'utf-8')
          fileContents.push({ path: fp, content })
        } catch {
          log(`${tag} 文件不存在，跳过: ${fp}`)
        }
      }

      log(`${tag} 定位到 ${fileContents.length} 个文件: ${fileContents.map((f) => f.path).join(', ')}`)

      if (fileContents.length === 0) {
        log(`${tag} ✗ 没有找到相关源码文件`)
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
      log(`${tag} LLM 生成代码修改方案...`)
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
        abortSignal: AbortSignal.timeout(300_000),
      })

      log(`${tag} LLM 生成 ${fixResult.object.changes.length} 个代码变更`)

      // Step 3: Apply changes on a new branch
      log(`${tag} 创建分支: ${branchName}`)
      git(`checkout -b ${branchName} ${mainBranch}`)

      let applied = 0
      for (const change of fixResult.object.changes) {
        try {
          const abs = resolve(PROJECT_ROOT, change.filePath)
          const original = readFileSync(abs, 'utf-8')
          if (!original.includes(change.searchBlock)) {
            log(`${tag} 代码块未匹配，跳过: ${change.filePath}`)
            continue
          }
          const modified = original.replace(change.searchBlock, change.replaceBlock)
          writeFileSync(abs, modified, 'utf-8')
          applied++
          log(`${tag} 已修改: ${change.filePath} — ${change.explanation}`)
        } catch (e) {
          log(`${tag} 修改失败: ${change.filePath} — ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      if (applied === 0) {
        log(`${tag} ✗ 没有代码变更被成功应用，回滚分支`)
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
      log(`${tag} 提交代码（${applied} 个文件变更）...`)
      git('add -A')
      gitCommitWithFile(fixResult.object.commitMessage)
      log(`${tag} ✓ 已提交: ${fixResult.object.commitMessage}`)

      // Step 5: Push + PR (if possible)
      let prUrl: string | null = null

      if (canPush) {
        log(`${tag} 推送分支到远程...`)
        const pushResult = gitSafe(`push -u origin ${branchName}`)
        if (pushResult !== null) {
          log(`${tag} ✓ 已推送`)

          if (canPR) {
            log(`${tag} 创建 Pull Request...`)
            const msgFile = join(tmpdir(), `evo-pr-body-${Date.now()}.txt`)
            writeFileSync(msgFile, fixResult.object.prBody, 'utf-8')
            try {
              const ghOutput = execSync(
                `gh pr create --base ${mainBranch} --head ${branchName} --title "${fixResult.object.prTitle.replace(/"/g, '\\"')}" --body-file "${msgFile}"`,
                { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 30_000 },
              ).trim()
              prUrl = ghOutput.split('\n').pop() ?? null
              log(`${tag} ✓ PR 已创建: ${prUrl}`)
            } catch (e) {
              log(`${tag} ✗ PR 创建失败: ${e instanceof Error ? e.message : String(e)}`)
            } finally {
              try {
                unlinkSync(msgFile)
              } catch {
                /* ignore */
              }
            }
          }
        } else {
          log(`${tag} ✗ 推送失败（可能没有远程仓库的写入权限）`)
        }
      } else {
        log(`${tag} 跳过推送（没有配置远程仓库）`)
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

      const finalStatus = prUrl ? '已创建 PR' : '已创建分支'
      log(`${tag} ✓ 完成: ${target.name} → ${finalStatus}`)

      results.push({
        source: target.source,
        sourceId: target.sourceId,
        sourceName: target.name,
        branch: branchName,
        prUrl,
        status: prUrl ? 'pr_created' : 'branch_created',
      })
    } catch (err) {
      gitSafe(`checkout ${mainBranch}`)
      gitSafe(`branch -D ${branchName}`)

      const message = err instanceof Error ? err.message : String(err)
      const table = updateTable(target)
      const idCol = updateIdCol(target)
      db.prepare(`UPDATE ${table} SET fix_status = 'unfixed' WHERE ${idCol} = ?`).run(target.sourceId)

      log(`${tag} ✗ 失败: ${message}`)

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

  log(`全部完成，共处理 ${targets.length} 个目标`)
  return results
}
