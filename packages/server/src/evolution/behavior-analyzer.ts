import { nanoid } from 'nanoid'

import type { CoreMessage } from 'ai'
import { generateObject } from 'ai'

import { z } from 'zod'

import type { ProviderName } from '@evo/shared'

import { db } from '../db/index.js'
import { getModel } from '../providers/registry.js'

// ── Schemas ──

const BehaviorClusterSchema = z.object({
  behaviors: z.array(
    z.object({
      name: z.string().describe('Short behavior pattern name, e.g. "Web Search + Summarize"'),
      description: z.string().describe('What this behavior pattern does, 1-2 sentences'),
      toolSequence: z.string().describe('Representative tool call sequence, e.g. "webSearch→webFetch→(answer)"'),
      operationIndexes: z
        .array(z.number())
        .describe('The bracketed [N] index numbers (from the operation list above) that belong to this behavior'),
    }),
  ),
})

const BehaviorSuggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      behaviorIndex: z.number().describe('The 0-based index of the behavior from the numbered list above'),
      severity: z
        .enum(['critical', 'suggestion'])
        .describe(
          'critical = strongly recommended fix with a clear, concrete code change (e.g. add retry, fix error handling); suggestion = advisory improvement, nice-to-have',
        ),
      suggestion: z.string().describe('Harness-level optimization suggestion in Chinese'),
    }),
  ),
})

// ── Health Evaluator ──

interface HealthEvaluation {
  score: number
  flags: string[]
}

interface GlobalStats {
  p90Duration: number
  p90Steps: number
  p90Tokens: number
}

function evaluateHealth(
  successRate: number,
  avgDuration: number,
  avgSteps: number,
  avgTokens: number,
  toolErrorRate: number,
  global: GlobalStats,
): HealthEvaluation {
  const flags: string[] = []
  let score = 0

  if (successRate >= 0.8) score += 0.2
  else flags.push('low_success_rate')

  if (avgDuration <= global.p90Duration) score += 0.2
  else flags.push('high_latency')

  if (avgSteps <= global.p90Steps) score += 0.2
  else flags.push('high_step_count')

  if (avgTokens <= global.p90Tokens) score += 0.2
  else flags.push('high_tokens')

  if (toolErrorRate <= 0.2) score += 0.2
  else flags.push('high_tool_error_rate')

  return { score, flags }
}

// A behavior is "unhealthy" if it fails >=2 of the 5 health dimensions (score < 0.8)
// OR trips a correctness-critical flag. The latter catches behaviors the agent
// "recovered" from — e.g. 100% tool-error but the operation still succeeded —
// which score exactly 0.8 yet clearly warrant a suggestion.
export const CRITICAL_HEALTH_FLAGS: string[] = ['low_success_rate', 'high_tool_error_rate']

export function isUnhealthy(healthScore: number, healthFlags: string[]): boolean {
  return healthScore < 0.8 || healthFlags.some((f) => CRITICAL_HEALTH_FLAGS.includes(f))
}

// ── Data Loading ──

interface OperationSummary {
  operationId: string
  status: string
  totalSteps: number
  totalDuration: number
  totalTokens: number
  toolSequence: string
  toolErrors: number
  toolCalls: number
  userMessage: string
}

function loadOperationSummaries(limit: number): OperationSummary[] {
  const ops = db
    .prepare(
      `SELECT o.operation_id, o.conversation_id, o.status, o.total_steps,
              o.total_duration, o.total_tokens
       FROM operations o
       WHERE o.conversation_id IS NOT NULL
       ORDER BY o.created_at DESC
       LIMIT ?`,
    )
    .all(limit) as Record<string, unknown>[]

  return ops
    .map((op) => {
      const steps = db
        .prepare(
          `SELECT tool_name, tool_success FROM steps
         WHERE operation_id = ? AND type = 'call_tool'
         ORDER BY step_index`,
        )
        .all(op.operation_id as string) as { tool_name: string; tool_success: number | null }[]

      const toolSequence = steps.map((s) => s.tool_name).join('→') || '(direct answer)'
      const toolCalls = steps.length
      const toolErrors = steps.filter((s) => s.tool_success === 0).length

      const conv = db
        .prepare('SELECT messages FROM conversations WHERE conversation_id = ?')
        .get(op.conversation_id as string) as { messages: string } | undefined

      let userMessage = ''
      if (conv) {
        try {
          const msgs: CoreMessage[] = JSON.parse(conv.messages)
          const lastUserMsg = [...msgs].reverse().find((m) => m.role === 'user')
          if (lastUserMsg && typeof lastUserMsg.content === 'string') {
            userMessage = lastUserMsg.content.slice(0, 200)
          }
        } catch {
          /* ignore parse errors */
        }
      }

      if (!userMessage) return null

      // Guard the parse: one malformed total_tokens row shouldn't abort the whole analysis.
      let tokens: { input?: number; output?: number } = {}
      try {
        tokens = JSON.parse((op.total_tokens as string) || '{}')
      } catch {
        /* keep zero tokens */
      }

      return {
        operationId: op.operation_id as string,
        status: op.status as string,
        totalSteps: op.total_steps as number,
        totalDuration: op.total_duration as number,
        totalTokens: (tokens.input ?? 0) + (tokens.output ?? 0),
        toolSequence,
        toolErrors,
        toolCalls,
        userMessage,
      }
    })
    .filter((s): s is OperationSummary => s !== null)
}

function computeGlobalStats(summaries: OperationSummary[]): GlobalStats {
  if (summaries.length === 0) {
    return { p90Duration: Infinity, p90Steps: Infinity, p90Tokens: Infinity }
  }

  const sorted = <T>(arr: T[], fn: (v: T) => number) => [...arr].sort((a, b) => fn(a) - fn(b))
  const p90 = <T>(arr: T[], fn: (v: T) => number) => {
    const s = sorted(arr, fn)
    return fn(s[Math.floor(s.length * 0.9)] ?? s[s.length - 1])
  }

  return {
    p90Duration: p90(summaries, (s) => s.totalDuration),
    p90Steps: p90(summaries, (s) => s.totalSteps),
    p90Tokens: p90(summaries, (s) => s.totalTokens),
  }
}

// ── Main Entry ──

export interface BehaviorAnalysisResult {
  behaviorsFound: number
  unhealthyCount: number
  tokensUsed: { input: number; output: number }
}

export async function analyzeBehaviors(log: (msg: string) => void = () => {}): Promise<BehaviorAnalysisResult> {
  const summaries = loadOperationSummaries(100)

  if (summaries.length < 5) {
    return { behaviorsFound: 0, unhealthyCount: 0, tokensUsed: { input: 0, output: 0 } }
  }

  // Skip re-clustering when the operation set is unchanged since the last run.
  // Phase 2 wipes and rebuilds the whole behaviors table every round, so repeating
  // an inspection on identical data would re-run ~60-100s of LLM clustering for the
  // same result. Signature = count + max rowid of clusterable operations; any new
  // operation (exactly what we'd re-cluster for) changes it. rowid is used instead
  // of created_at because simulated rows carry backdated created_at.
  const inputSig = (() => {
    const r = db
      .prepare('SELECT COUNT(*) AS c, COALESCE(MAX(rowid), 0) AS m FROM operations WHERE conversation_id IS NOT NULL')
      .get() as { c: number; m: number }
    return `${r.c}:${r.m}`
  })()
  const prevSig = (
    db.prepare("SELECT value FROM kv_meta WHERE key = 'behavior_input_sig'").get() as { value: string } | undefined
  )?.value
  const existingBehaviors = db.prepare('SELECT health_score, health_flags FROM behaviors').all() as {
    health_score: number
    health_flags: string
  }[]

  if (existingBehaviors.length > 0 && prevSig === inputSig) {
    const unhealthyCount = existingBehaviors.filter((b) => {
      try {
        return isUnhealthy(b.health_score, JSON.parse(b.health_flags) as string[])
      } catch {
        return false
      }
    }).length
    log('Phase 2: operation 集合自上轮无变化，跳过聚类（复用已有行为分析结果）')
    return { behaviorsFound: existingBehaviors.length, unhealthyCount, tokensUsed: { input: 0, output: 0 } }
  }

  const provider = (process.env.INSPECTOR_PROVIDER ?? process.env.DEFAULT_PROVIDER ?? 'deepseek') as ProviderName
  const modelId = process.env.INSPECTOR_MODEL ?? process.env.DEFAULT_MODEL ?? 'deepseek-v4-flash'
  const model = getModel(provider, modelId)

  const globalStats = computeGlobalStats(summaries)

  // Phase 2a: LLM clustering
  const operationLines = summaries
    .map(
      (s, i) =>
        `[${i}] "${s.userMessage}" → tools: ${s.toolSequence} → ${s.status} (${s.totalSteps} steps, ${(s.totalDuration / 1000).toFixed(1)}s)`,
    )
    .join('\n')

  log(`Phase 2a: 正在用 LLM 对 ${summaries.length} 条 operation 进行语义聚类...`)
  const clusterResult = await generateObject({
    model,
    schema: BehaviorClusterSchema,
    prompt: `You are analyzing AI agent operation logs to identify recurring behavior patterns.

## Operation Logs (${summaries.length} operations):

${operationLines}

## Instructions:
1. Group these operations into 3-15 semantic behavior patterns based on user intent and tool usage
2. Each behavior should represent a recurring pattern (at least 2 operations)
3. Name each behavior concisely (e.g. "Web Research + Summary", "Database Query", "Code Execution")
4. For each behavior, list the [N] index numbers (the bracketed integers shown before each operation) that belong to it
5. Describe what the behavior pattern does in 1-2 sentences`,
    abortSignal: AbortSignal.timeout(120_000),
  })
  log(`Phase 2a 完成: 识别到 ${clusterResult.object.behaviors.length} 个行为模式`)

  const totalTokensUsed = {
    input: clusterResult.usage?.promptTokens ?? 0,
    output: clusterResult.usage?.completionTokens ?? 0,
  }

  // Phase 2b: Deterministic health evaluation + metrics computation
  const behaviorRows = clusterResult.object.behaviors
    .map((b) => {
      // Map model-returned indexes back to summaries. Defensive: round to int,
      // drop out-of-range, and dedupe — a repeated or garbage index must not
      // double-count or crash. operationId is then taken from our own summary,
      // never echoed by the model, so IDs stay exact.
      const seen = new Set<number>()
      const ops: OperationSummary[] = []
      for (const n of b.operationIndexes) {
        const i = Math.round(n)
        if (i >= 0 && i < summaries.length && !seen.has(i)) {
          seen.add(i)
          ops.push(summaries[i])
        }
      }
      if (ops.length === 0) return null

      const successRate = ops.filter((o) => o.status === 'success').length / ops.length
      const avgDuration = ops.reduce((sum, o) => sum + o.totalDuration, 0) / ops.length
      const avgSteps = ops.reduce((sum, o) => sum + o.totalSteps, 0) / ops.length
      const avgTokens = ops.reduce((sum, o) => sum + o.totalTokens, 0) / ops.length
      const totalToolCalls = ops.reduce((sum, o) => sum + o.toolCalls, 0)
      const totalToolErrors = ops.reduce((sum, o) => sum + o.toolErrors, 0)
      const toolErrorRate = totalToolCalls > 0 ? totalToolErrors / totalToolCalls : 0

      const health = evaluateHealth(successRate, avgDuration, avgSteps, avgTokens, toolErrorRate, globalStats)

      const timestamps = ops
        .map((o) => o.operationId)
        .map(
          (id) =>
            (db.prepare('SELECT created_at FROM operations WHERE operation_id = ?').get(id) as { created_at: string })
              ?.created_at,
        )
        .filter(Boolean)
        .sort()

      return {
        behaviorId: `beh_${nanoid()}`,
        name: b.name,
        description: b.description,
        toolSequence: b.toolSequence,
        operationCount: ops.length,
        successRate,
        avgDuration: Math.round(avgDuration),
        avgSteps,
        avgTokens: Math.round(avgTokens),
        toolErrorRate,
        healthScore: health.score,
        healthFlags: health.flags,
        suggestion: '',
        suggestionSeverity: 'none' as 'none' | 'critical' | 'suggestion',
        fixStatus: 'none' as string,
        fixPrUrl: null as string | null,
        sampleOperations: ops.slice(0, 5).map((o) => o.operationId),
        firstSeen: timestamps[0] ?? new Date().toISOString(),
        lastSeen: timestamps[timestamps.length - 1] ?? new Date().toISOString(),
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  // Phase 2c: LLM suggestions for unhealthy behaviors
  const unhealthy = behaviorRows.filter((b) => isUnhealthy(b.healthScore, b.healthFlags))

  if (unhealthy.length > 0) {
    const unhealthyDesc = unhealthy
      .map(
        (b, i) =>
          `[${i}] "${b.name}" (health=${b.healthScore.toFixed(1)}, flags=[${b.healthFlags.join(',')}])
    success_rate=${(b.successRate * 100).toFixed(0)}%, avg_duration=${(b.avgDuration / 1000).toFixed(1)}s, avg_steps=${b.avgSteps.toFixed(1)}, avg_tokens=${b.avgTokens}, tool_error_rate=${(b.toolErrorRate * 100).toFixed(0)}%
    tool_sequence: ${b.toolSequence}`,
      )
      .join('\n')

    try {
      log(`Phase 2c: 正在为 ${unhealthy.length} 个不健康行为生成改进建议...`)
      const suggestionResult = await generateObject({
        model,
        schema: BehaviorSuggestionSchema,
        prompt: `You are an AI Agent Harness optimizer. These behavior patterns have been flagged as unhealthy. Generate Harness-level optimization suggestions (NOT prompt changes).

## Unhealthy Behaviors:

${unhealthyDesc}

## Instructions:
1. For each behavior, suggest specific Harness improvements (tool parameter tuning, new tools, context strategy, error recovery, caching, etc.)
2. Write suggestions in Chinese (this is a Chinese-facing product)
3. Be specific and actionable — avoid vague advice like "optimize performance"
4. Focus on what the Harness code can do differently, NOT what the LLM prompt should say
5. Set severity to "critical" ONLY when the fix is concrete and clearly actionable as a code change (e.g. "add retry with backoff to webFetch tool", "add input validation to dbQuery"). Set to "suggestion" for advisory or less certain improvements.
6. Reference each behavior by its bracketed [index] number via behaviorIndex.`,
        abortSignal: AbortSignal.timeout(120_000),
      })
      log(`Phase 2c 完成: 生成了 ${suggestionResult.object.suggestions.length} 条改进建议`)

      totalTokensUsed.input += suggestionResult.usage?.promptTokens ?? 0
      totalTokensUsed.output += suggestionResult.usage?.completionTokens ?? 0

      for (const s of suggestionResult.object.suggestions) {
        // Map by index into the unhealthy list (stable) — names can collide.
        const match = unhealthy[s.behaviorIndex]
        if (match) {
          match.suggestion = s.suggestion
          match.suggestionSeverity = s.severity
          match.fixStatus = s.severity === 'critical' ? 'unfixed' : 'none'
        }
      }
    } catch {
      /* suggestion generation is best-effort */
    }
  }

  // Carry fix progress across re-clustering. Behaviors are wiped + recreated every
  // inspection, so without this a behavior whose fix PR already exists comes back as
  // unfixed and gets re-fixed (duplicate PR). Match by tool_sequence — more stable
  // than the LLM-generated name. Best-effort: if the LLM phrases the sequence
  // differently next round, that one can still slip through.
  const FIXED_STATUSES = new Set(['branch_created', 'pr_created', 'merged'])
  const priorFixes = new Map<string, { fixStatus: string; fixPrUrl: string | null }>()
  for (const r of db.prepare('SELECT tool_sequence, fix_status, fix_pr_url FROM behaviors').all() as {
    tool_sequence: string
    fix_status: string
    fix_pr_url: string | null
  }[]) {
    if (FIXED_STATUSES.has(r.fix_status)) {
      priorFixes.set(r.tool_sequence, { fixStatus: r.fix_status, fixPrUrl: r.fix_pr_url })
    }
  }
  for (const b of behaviorRows) {
    const prior = priorFixes.get(b.toolSequence)
    if (prior) {
      b.fixStatus = prior.fixStatus
      b.fixPrUrl = prior.fixPrUrl
    }
  }

  // Write to DB (clear old behaviors and insert new)
  const insertStmt = db.prepare(`
    INSERT INTO behaviors (behavior_id, name, description, tool_sequence, operation_count,
      success_rate, avg_duration, avg_steps, avg_tokens, tool_error_rate,
      health_score, health_flags, suggestion, suggestion_severity, fix_status, fix_pr_url,
      sample_operations, first_seen, last_seen, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const writeAll = db.transaction(() => {
    db.prepare('DELETE FROM behaviors').run()
    for (const b of behaviorRows) {
      insertStmt.run(
        b.behaviorId,
        b.name,
        b.description,
        b.toolSequence,
        b.operationCount,
        b.successRate,
        b.avgDuration,
        b.avgSteps,
        b.avgTokens,
        b.toolErrorRate,
        b.healthScore,
        JSON.stringify(b.healthFlags),
        b.suggestion,
        b.suggestionSeverity,
        b.fixStatus,
        b.fixPrUrl,
        JSON.stringify(b.sampleOperations),
        b.firstSeen,
        b.lastSeen,
        `inspector`,
      )
    }
  })
  writeAll()

  // Remember this input signature so an unchanged next round can skip clustering.
  db.prepare("INSERT OR REPLACE INTO kv_meta (key, value) VALUES ('behavior_input_sig', ?)").run(inputSig)

  return {
    behaviorsFound: behaviorRows.length,
    unhealthyCount: unhealthy.length,
    tokensUsed: totalTokensUsed,
  }
}
