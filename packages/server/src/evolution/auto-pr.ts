import { nanoid } from 'nanoid'

import { execFileSync, execSync } from 'node:child_process'
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { streamObject } from 'ai'

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
  prBody: z
    .string()
    .describe(
      'PR description in English markdown. Must include: ## Summary (what changed and why), ## Changes (bullet list of each file changed with explanation), ## Test plan (how to verify the fix).',
    ),
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

// Real source-file list so the locator LLM picks exact paths instead of guessing
// (tool files are kebab-case, e.g. read-file.ts — not readFile.ts).
function listSourceFiles(): string[] {
  const out: string[] = []
  const walk = (rel: string) => {
    try {
      for (const e of readdirSync(resolve(PROJECT_ROOT, rel), { withFileTypes: true })) {
        const child = `${rel}/${e.name}`
        if (e.isDirectory()) walk(child)
        else if (/\.(ts|tsx)$/.test(e.name)) out.push(child)
      }
    } catch {
      /* directory may not exist */
    }
  }
  for (const root of ['packages/server/src', 'packages/web/src', 'packages/shared/src']) walk(root)
  return out
}

// Resolve an LLM-proposed path to a real file: exact match, on-disk check, or a
// normalized-basename fuzzy match (handles camelCase vs kebab-case). Returns null
// when it can't be resolved unambiguously.
function resolveSourceFile(fp: string, sourceFiles: string[]): string | null {
  if (sourceFiles.includes(fp)) return fp
  try {
    readFileSync(resolve(PROJECT_ROOT, fp), 'utf-8')
    return fp
  } catch {
    /* not on disk as written */
  }
  const norm = (s: string) => (s.split('/').pop() ?? s).toLowerCase().replace(/[^a-z0-9.]/g, '')
  const target = norm(fp)
  const matches = sourceFiles.filter((f) => norm(f) === target)
  return matches.length === 1 ? matches[0] : null
}

// ── Streaming helper ──

async function streamGenerate<T extends z.ZodType>(opts: {
  model: ReturnType<typeof getModel>
  schema: T
  prompt: string
  log: ProgressCallback
  tag: string
  timeoutMs?: number
}): Promise<{ object: z.infer<T>; usage?: { promptTokens: number; completionTokens: number } }> {
  const { model, schema, prompt, log, tag, timeoutMs = 300_000 } = opts
  const maxAttempts = 2
  let lastErr: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const start = Date.now()
      const { partialObjectStream, object, usage } = streamObject({
        model,
        schema,
        prompt,
        abortSignal: AbortSignal.timeout(timeoutMs),
      })

      let lastLogTime = 0
      for await (const _partial of partialObjectStream) {
        const now = Date.now()
        if (now - lastLogTime > 10_000) {
          log(`${tag} LLM 生成中...（${Math.round((now - start) / 1000)}s）`)
          lastLogTime = now
        }
      }

      log(`${tag} LLM 响应完成（${Math.round((Date.now() - start) / 1000)}s）`)

      const finalObject = await object
      const finalUsage = await usage
      return {
        object: finalObject,
        usage: finalUsage
          ? { promptTokens: finalUsage.promptTokens, completionTokens: finalUsage.completionTokens }
          : undefined,
      }
    } catch (err) {
      // deepseek-v4-flash occasionally returns output that doesn't match the
      // schema; one retry usually fixes it.
      lastErr = err
      if (attempt < maxAttempts) log(`${tag} ⚠ LLM 输出不合规，重试中...`)
    }
  }

  throw lastErr
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
      `SELECT pattern_id, name, match_rule, error_type, hit_count
       FROM patterns
       WHERE category = 'harness_bug' AND fix_status = 'unfixed'`,
    )
    .all() as { pattern_id: string; name: string; match_rule: string; error_type: string; hit_count: number }[]

  // Resolution is no longer pre-generated. Instead, the fixer analyzes the root cause
  // at fix time from real error samples linked to this pattern, plus the trigger count.
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
      locatorPromptExtra: `## Bug to fix:\nName: ${p.name}\n${context}`,
      fixPromptExtra: `## Bug:\nName: ${p.name}\n${context}\n\nAnalyze the root cause from the real error samples above, then fix the harness code. In the PR body, reference: "Fixes harness bug pattern: ${p.pattern_id} (${p.name})".`,
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
- packages/server/src/evolution/ — Error bucketer, pattern matcher, inspector, auto-fix, schema compat
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
  const sourceFiles = listSourceFiles()
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
    // Include the unique sourceId so similar names — or names that collide after
    // the 50-char slug truncation — don't produce the same branch.
    const branchName = `${branchPrefix(target)}/${slug}-${target.sourceId}`

    log(`${tag} 开始处理: ${target.name}（${target.source === 'pattern' ? 'Bug 修复' : '行为优化'}）`)

    try {
      // Step 1: Ask LLM which files to read
      log(`${tag} LLM 定位相关源码文件...`)
      const locatorResult = await streamGenerate({
        model,
        schema: FileLocatorSchema,
        prompt: `You are improving an AI Agent demo project (TypeScript, Hono server, React frontend).

${PROJECT_STRUCTURE}

## Actual source files (use these EXACT paths — files are kebab-case, e.g. tools/web-fetch.ts, NOT webFetch.ts):
${sourceFiles.join('\n')}

${target.locatorPromptExtra}

Which source files need to be modified? List 1-5 files, using exact paths from the list above.`,
        log,
        tag,
      })

      const filePaths = locatorResult.object.files.map((f: { path: string }) => f.path)
      const fileContents: { path: string; content: string }[] = []

      for (const fp of filePaths) {
        const resolved = resolveSourceFile(fp, sourceFiles)
        if (!resolved) {
          log(`${tag} 文件不存在，跳过: ${fp}`)
          continue
        }
        if (resolved !== fp) log(`${tag} 已修正文件名: ${fp} → ${resolved}`)
        fileContents.push({ path: resolved, content: readFileSync(resolve(PROJECT_ROOT, resolved), 'utf-8') })
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
      const fileContext = fileContents.map((f) => `### ${f.path}\n\`\`\`typescript\n${f.content}\n\`\`\``).join('\n\n')
      const contextChars = fileContext.length
      log(`${tag} LLM 生成代码修改方案...（上下文约 ${Math.round(contextChars / 1000)}k 字符）`)

      const fixResult = await streamGenerate({
        model,
        schema: CodeFixSchema,
        prompt: `You are improving an AI Agent demo project. Generate precise code changes.

${target.fixPromptExtra}

## Source files:

${fileContext}

## Instructions:
1. Generate search-and-replace blocks. The searchBlock must be an EXACT substring of the current file content.
2. Make minimal, focused changes — fix only the issue described, don't refactor unrelated code.
3. Write commit message in conventional commits format (English).
4. Write PR title in English, under 70 characters.
5. Write a detailed PR body in English markdown with these sections:
   ## Summary
   1-3 sentences explaining what the problem was and how this fix addresses it.
   ## Changes
   Bullet list of each file modified and what the change does.
   ## Test plan
   Steps to verify the fix works (e.g. "Run pnpm simulate --mock && pnpm inspect, confirm no new errors of this type").`,
        log,
        tag,
      })

      const changes = fixResult.object.changes
      log(`${tag} LLM 方案: ${changes.length} 个变更, commit: "${fixResult.object.commitMessage}"`)
      for (const c of changes) {
        log(`${tag}   - ${c.filePath}: ${c.explanation}`)
      }

      // Step 3: Apply changes on a new branch
      log(`${tag} 创建分支: ${branchName}`)
      git(`checkout -b ${branchName} ${mainBranch}`)

      let applied = 0
      const appliedPaths: string[] = []
      for (const change of changes) {
        try {
          const abs = resolve(PROJECT_ROOT, change.filePath)
          const original = readFileSync(abs, 'utf-8')
          if (!original.includes(change.searchBlock)) {
            log(
              `${tag} ✗ 代码块未匹配: ${change.filePath}（searchBlock 前 80 字符: "${change.searchBlock.slice(0, 80)}..."）`,
            )
            continue
          }
          const modified = original.replace(change.searchBlock, change.replaceBlock)
          writeFileSync(abs, modified, 'utf-8')
          applied++
          appliedPaths.push(change.filePath)
          log(`${tag} ✓ 已修改: ${change.filePath}`)
        } catch (e) {
          log(`${tag} ✗ 修改失败: ${change.filePath} — ${e instanceof Error ? e.message : String(e)}`)
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
          error: 'No code changes could be applied (searchBlock mismatch)',
        })
        continue
      }

      // Step 4: Commit
      log(`${tag} 提交代码（${applied} 个文件变更）...`)
      // Stage only the files we actually modified — never `git add -A`, which would
      // sweep in unrelated/untracked files (e.g. local notes) and push them in the PR.
      execFileSync('git', ['add', '--', ...appliedPaths], { cwd: PROJECT_ROOT, timeout: 30_000 })
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
              // Pass args as an array (no shell) so an LLM-generated title containing
              // backticks/$()/;/| can't be interpreted as a shell command.
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
                  fixResult.object.prTitle,
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

  // Persist this auto-fix run so the dashboard can show its history, not just live logs.
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
