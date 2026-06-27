import { nanoid } from 'nanoid'

import { execFileSync, execSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'

import { streamText, tool } from 'ai'

import { z } from 'zod'

import type { ProviderName } from '@evo/shared'

import { db } from '../db/index.js'
import { getModel } from '../providers/registry.js'

const PROJECT_ROOT = resolve(import.meta.dirname, '../../../../')

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

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.turbo'])
const TEXT_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.html', '.md', '.yaml', '.yml'])

function walkDir(baseDir: string, relPrefix: string = ''): string[] {
  const result: string[] = []
  try {
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) result.push(...walkDir(resolve(baseDir, entry.name), rel))
      } else {
        result.push(rel)
      }
    }
  } catch {
    /* directory may not exist */
  }
  return result
}

function globMatch(filePath: string, pattern: string): boolean {
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\0')
    .replace(/\*/g, '[^/]*')
    .replace(/\0/g, '.*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${re}$`).test(filePath)
}

// ── Fixer Agent Tools ──

function makeFixerTools(log: ProgressCallback, tag: string) {
  const modifiedFiles = new Set<string>()
  let fixSubmission: { commitMessage: string; prTitle: string; prBody: string } | null = null
  const allFiles = walkDir(PROJECT_ROOT)

  const tools = {
    glob: tool({
      description: 'Find files matching a glob pattern. Returns paths relative to project root.',
      parameters: z.object({
        pattern: z.string().describe('Glob pattern (e.g. "**/*.ts", "packages/server/src/**/*.ts")'),
      }),
      execute: async ({ pattern }) => {
        const matches = allFiles.filter((f) => globMatch(f, pattern))
        log(`${tag} glob "${pattern}": ${matches.length} 个文件`)
        return { files: matches, count: matches.length }
      },
    }),

    grep: tool({
      description: 'Search file content by regex. Returns matching lines with file paths and line numbers.',
      parameters: z.object({
        pattern: z.string().describe('Regex pattern to search for'),
        glob: z.string().optional().describe('Filter files by glob pattern (e.g. "**/*.ts")'),
      }),
      execute: async ({ pattern, glob: fileGlob }) => {
        const files = fileGlob
          ? allFiles.filter((f) => globMatch(f, fileGlob))
          : allFiles.filter((f) => TEXT_EXTS.has(extname(f)))
        const regex = new RegExp(pattern)
        const matches: { file: string; line: number; text: string }[] = []

        for (const file of files) {
          if (matches.length >= 200) break
          try {
            const content = readFileSync(resolve(PROJECT_ROOT, file), 'utf-8')
            for (const [i, lineText] of content.split('\n').entries()) {
              if (regex.test(lineText)) {
                matches.push({ file, line: i + 1, text: lineText.trimEnd() })
                if (matches.length >= 200) break
              }
            }
          } catch {
            /* skip unreadable files */
          }
        }

        log(`${tag} grep "${pattern}": ${matches.length} 处匹配`)
        return { matches, count: matches.length, truncated: matches.length >= 200 }
      },
    }),

    readFile: tool({
      description: 'Read a file by relative path from project root.',
      parameters: z.object({
        filePath: z.string().describe('Relative path from project root'),
      }),
      execute: async ({ filePath }) => {
        const abs = resolve(PROJECT_ROOT, filePath)
        if (!abs.startsWith(PROJECT_ROOT)) return { error: 'Invalid path' }
        try {
          const content = readFileSync(abs, 'utf-8')
          log(`${tag} 读取: ${filePath}（${content.split('\n').length} 行）`)
          return { path: filePath, lines: content.split('\n').length, content }
        } catch {
          return { error: `File not found: ${filePath}` }
        }
      },
    }),

    editFile: tool({
      description:
        'Apply a search-replace edit to a file. The oldString must exactly match file content. ' +
        'Always read the file first before editing.',
      parameters: z.object({
        filePath: z.string().describe('Relative path from project root'),
        oldString: z.string().describe('Exact text to find (must match file content exactly)'),
        newString: z.string().describe('Replacement text'),
      }),
      execute: async ({ filePath, oldString, newString }) => {
        const abs = resolve(PROJECT_ROOT, filePath)
        if (!abs.startsWith(PROJECT_ROOT)) return { error: 'Invalid path' }
        try {
          const original = readFileSync(abs, 'utf-8')
          if (!original.includes(oldString)) {
            return { error: `oldString not found in ${filePath}. Read the file first to verify exact content.` }
          }
          writeFileSync(abs, original.replace(oldString, newString), 'utf-8')
          modifiedFiles.add(filePath)
          log(`${tag} ✓ 已修改: ${filePath}`)
          return { success: true, filePath }
        } catch (e) {
          return { error: `Failed: ${e instanceof Error ? e.message : String(e)}` }
        }
      },
    }),

    writeFile: tool({
      description: 'Create a new file or completely rewrite an existing file. Prefer editFile for modifications.',
      parameters: z.object({
        filePath: z.string().describe('Relative path from project root'),
        content: z.string().describe('Full file content'),
      }),
      execute: async ({ filePath, content }) => {
        const abs = resolve(PROJECT_ROOT, filePath)
        if (!abs.startsWith(PROJECT_ROOT)) return { error: 'Invalid path' }
        try {
          mkdirSync(dirname(abs), { recursive: true })
          writeFileSync(abs, content, 'utf-8')
          modifiedFiles.add(filePath)
          log(`${tag} ✓ 已写入: ${filePath}`)
          return { success: true, filePath }
        } catch (e) {
          return { error: `Failed: ${e instanceof Error ? e.message : String(e)}` }
        }
      },
    }),

    submitFix: tool({
      description: 'Submit the fix after all edits are done. Provide commit message and PR details.',
      parameters: z.object({
        commitMessage: z.string().describe('Git commit message (conventional commits, English)'),
        prTitle: z.string().describe('PR title (English, under 70 chars)'),
        prBody: z
          .string()
          .describe('PR body (English markdown: ## Summary, ## Changes, ## Test plan)'),
      }),
      execute: async ({ commitMessage, prTitle, prBody }) => {
        fixSubmission = { commitMessage, prTitle, prBody }
        log(`${tag} 修复方案已提交: ${commitMessage}`)
        return { submitted: true }
      },
    }),
  }

  return {
    tools,
    getModifiedFiles: () => [...modifiedFiles],
    getSubmission: () => fixSubmission,
  }
}

// ── System Prompt ──

const PROJECT_STRUCTURE = `## Project structure
- packages/server/src/agent/ — Agent loop, dispatch
- packages/server/src/tools/ — 6 tools (web-search, web-fetch, read-file, code-runner, db-query, send-email)
- packages/server/src/tracing/ — Tracer, store, sanitizer
- packages/server/src/evolution/ — Error bucketer, pattern matcher, inspector, auto-fix, schema compat
- packages/server/src/context/ — Compression, truncation
- packages/server/src/providers/ — LLM provider registry
- packages/server/src/api/ — Hono API routes
- packages/web/src/ — React frontend`

const FIXER_SYSTEM_PROMPT = `You are a code fixer for an AI Agent project (TypeScript, pnpm monorepo).

${PROJECT_STRUCTURE}

Fix only the described issue. Don't refactor unrelated code. Always read a file before editing it.
After all edits, call submitFix with commit message (conventional commits, English), PR title, and PR body.`

// ── Fix Target ──

interface FixTarget {
  source: 'pattern' | 'behavior'
  sourceId: string
  name: string
  description: string
  prompt: string
}

function getUnfixedBugs(): FixTarget[] {
  const patterns = db
    .prepare(
      `SELECT pattern_id, name, match_rule, error_type, hit_count
       FROM patterns
       WHERE category = 'harness_bug' AND fix_status = 'unfixed'`,
    )
    .all() as { pattern_id: string; name: string; match_rule: string; error_type: string; hit_count: number }[]

  const sampleStmt = db.prepare(
    `SELECT message, provider, status_code, tool_name
     FROM errors WHERE pattern_id = ? ORDER BY created_at DESC LIMIT 5`,
  )

  return patterns.map((p) => {
    const samples = sampleStmt.all(p.pattern_id) as {
      message: string
      provider: string
      status_code: number | null
      tool_name: string | null
    }[]

    const sampleText = samples.length
      ? samples
          .map(
            (s, i) =>
              `  ${i + 1}. [provider=${s.provider} status=${s.status_code ?? 'N/A'} tool=${s.tool_name ?? 'N/A'}] ${s.message}`,
          )
          .join('\n')
      : '  (no error samples recorded for this pattern)'

    const context = `Error type: ${p.error_type}\nMatch rule: ${p.match_rule}\nTrigger count: ${p.hit_count}\nReal error samples (most recent first):\n${sampleText}`

    return {
      source: 'pattern' as const,
      sourceId: p.pattern_id,
      name: p.name,
      description: context,
      prompt: `## Bug to fix\nName: ${p.name}\n${context}\n\nAnalyze the root cause from the error samples, find the relevant source files, and fix the harness code.\nIn the PR body, reference: "Fixes harness bug pattern: ${p.pattern_id} (${p.name})".`,
    }
  })
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
    prompt: `## Behavior to optimize\nName: ${b.name}\nTool sequence: ${b.tool_sequence}\nHealth flags: ${b.health_flags}\nSuggestion: ${b.suggestion}\n\nFind the relevant source files and implement the optimization.\nIn the PR body, reference: "Optimizes behavior: ${b.behavior_id} (${b.name})".`,
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
  const runStartedAt = (db.prepare("SELECT datetime('now') AS t").get() as { t: string }).t

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]
    const tag = `[${i + 1}/${targets.length}]`
    const slug = target.name
      .replace(/[^a-zA-Z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()
      .slice(0, 50)
    const branchName = `${branchPrefix(target)}/${slug}-${target.sourceId}`

    log(`${tag} 开始处理: ${target.name}（${target.source === 'pattern' ? 'Bug 修复' : '行为优化'}）`)

    try {
      git(`checkout -b ${branchName} ${mainBranch}`)

      log(`${tag} 启动修复 Agent...`)
      const { tools: fixerTools, getModifiedFiles, getSubmission } = makeFixerTools(log, tag)

      const agentResult = streamText({
        model,
        system: FIXER_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: target.prompt }],
        tools: fixerTools,
        maxSteps: 20,
        abortSignal: AbortSignal.timeout(300_000),
      })

      for await (const part of agentResult.fullStream) {
        if (part.type === 'error') {
          throw new Error(String(part.error))
        }
      }

      const submission = getSubmission()
      const modifiedFiles = getModifiedFiles()

      if (!submission || modifiedFiles.length === 0) {
        log(`${tag} ✗ Agent 没有生成有效修改`)
        gitSafe('checkout -- .')
        git(`checkout ${mainBranch}`)
        gitSafe(`branch -D ${branchName}`)
        results.push({
          source: target.source,
          sourceId: target.sourceId,
          sourceName: target.name,
          branch: branchName,
          prUrl: null,
          status: 'failed',
          error: 'Agent produced no valid changes',
        })
        continue
      }

      log(`${tag} 提交代码（${modifiedFiles.length} 个文件）...`)
      execFileSync('git', ['add', '--', ...modifiedFiles], { cwd: PROJECT_ROOT, timeout: 30_000 })
      gitCommitWithFile(submission.commitMessage)
      log(`${tag} ✓ 已提交: ${submission.commitMessage}`)

      let prUrl: string | null = null

      if (canPush) {
        log(`${tag} 推送分支到远程...`)
        const pushResult = gitSafe(`push -u origin ${branchName}`)
        if (pushResult !== null) {
          log(`${tag} ✓ 已推送`)

          if (canPR) {
            log(`${tag} 创建 Pull Request...`)
            const msgFile = join(tmpdir(), `evo-pr-body-${Date.now()}.txt`)
            writeFileSync(msgFile, submission.prBody, 'utf-8')
            try {
              const ghOutput = execFileSync(
                'gh',
                [
                  'pr',
                  'create',
                  '--base',
                  mainBranch,
                  '--head',
                  branchName,
                  '--title',
                  submission.prTitle,
                  '--body-file',
                  msgFile,
                ],
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

      git(`checkout ${mainBranch}`)

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
      gitSafe('checkout -- .')
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

  const prCreated = results.filter((r) => r.status === 'pr_created').length
  const branchCreated = results.filter((r) => r.status === 'branch_created').length
  const failed = results.filter((r) => r.status === 'failed').length
  db.prepare(
    `INSERT INTO autofix_runs (run_id, started_at, finished_at, total_targets, pr_created, branch_created, failed, results)
     VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?)`,
  ).run(`afr_${nanoid()}`, runStartedAt, targets.length, prCreated, branchCreated, failed, JSON.stringify(results))

  log(`全部完成，共处理 ${targets.length} 个目标`)
  return results
}
