import { nanoid } from 'nanoid'

import type { CoreMessage } from 'ai'
import { generateObject } from 'ai'

import { z } from 'zod'

import type { ProviderName } from '@evo/shared'

import { db } from '../db/index.js'
import { getModel } from '../providers/registry.js'
import { estimateCost } from '../tracing/tracer.js'

// ── Schemas ──

const BehaviorClusterSchema = z.object({
  behaviors: z.array(
    z.object({
      name: z.string().describe('Short behavior pattern name, e.g. "Web Search + Summarize"'),
      description: z.string().describe('What this behavior pattern does, 1-2 sentences'),
      toolSequence: z.string().describe('Representative tool call sequence, e.g. "webSearch→webFetch→(answer)"'),
      operationIds: z.array(z.string()).describe('List of operation_ids that belong to this behavior'),
    }),
  ),
})

const BehaviorSuggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      behaviorName: z.string(),
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
  p90Cost: number
  p90Tokens: number
}

function evaluateHealth(
  successRate: number,
  avgDuration: number,
  avgSteps: number,
  avgCost: number,
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

  if (avgCost <= global.p90Cost) score += 0.2
  else flags.push('high_cost')

  if (toolErrorRate <= 0.2) score += 0.2
  else flags.push('high_tool_error_rate')

  return { score, flags }
}

// ── Data Loading ──

interface OperationSummary {
  operationId: string
  status: string
  totalSteps: number
  totalDuration: number
  totalTokens: number
  cost: number
  toolSequence: string
  toolErrors: number
  toolCalls: number
  userMessage: string
}

function loadOperationSummaries(limit: number): OperationSummary[] {
  const ops = db
    .prepare(
      `SELECT o.operation_id, o.conversation_id, o.status, o.total_steps,
              o.total_duration, o.total_tokens, o.cost
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

      const tokens = JSON.parse((op.total_tokens as string) || '{"input":0,"output":0}')

      return {
        operationId: op.operation_id as string,
        status: op.status as string,
        totalSteps: op.total_steps as number,
        totalDuration: op.total_duration as number,
        totalTokens: (tokens.input ?? 0) + (tokens.output ?? 0),
        cost: op.cost as number,
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
    return { p90Duration: Infinity, p90Steps: Infinity, p90Cost: Infinity, p90Tokens: Infinity }
  }

  const sorted = <T>(arr: T[], fn: (v: T) => number) => [...arr].sort((a, b) => fn(a) - fn(b))
  const p90 = <T>(arr: T[], fn: (v: T) => number) => {
    const s = sorted(arr, fn)
    return fn(s[Math.floor(s.length * 0.9)] ?? s[s.length - 1])
  }

  return {
    p90Duration: p90(summaries, (s) => s.totalDuration),
    p90Steps: p90(summaries, (s) => s.totalSteps),
    p90Cost: p90(summaries, (s) => s.cost),
    p90Tokens: p90(summaries, (s) => s.totalTokens),
  }
}

// ── Main Entry ──

export interface BehaviorAnalysisResult {
  behaviorsFound: number
  unhealthyCount: number
  tokensUsed: { input: number; output: number }
  cost: number
}

export async function analyzeBehaviors(): Promise<BehaviorAnalysisResult> {
  const summaries = loadOperationSummaries(200)

  if (summaries.length < 5) {
    return { behaviorsFound: 0, unhealthyCount: 0, tokensUsed: { input: 0, output: 0 }, cost: 0 }
  }

  const provider = (process.env.INSPECTOR_PROVIDER ?? process.env.DEFAULT_PROVIDER ?? 'deepseek') as ProviderName
  const modelId = process.env.INSPECTOR_MODEL ?? process.env.DEFAULT_MODEL ?? 'deepseek-v4-flash'
  const model = getModel(provider, modelId)

  const globalStats = computeGlobalStats(summaries)

  // Phase 2a: LLM clustering
  const operationLines = summaries
    .map(
      (s) =>
        `[${s.operationId}] "${s.userMessage}" → tools: ${s.toolSequence} → ${s.status} (${s.totalSteps} steps, ${(s.totalDuration / 1000).toFixed(1)}s)`,
    )
    .join('\n')

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
4. Include the operation_ids that belong to each behavior
5. Describe what the behavior pattern does in 1-2 sentences`,
  })

  const totalTokensUsed = {
    input: clusterResult.usage?.promptTokens ?? 0,
    output: clusterResult.usage?.completionTokens ?? 0,
  }

  // Phase 2b: Deterministic health evaluation + metrics computation
  const behaviorRows = clusterResult.object.behaviors
    .map((b) => {
      const ops = summaries.filter((s) => b.operationIds.includes(s.operationId))
      if (ops.length === 0) return null

      const successRate = ops.filter((o) => o.status === 'success').length / ops.length
      const avgDuration = ops.reduce((sum, o) => sum + o.totalDuration, 0) / ops.length
      const avgSteps = ops.reduce((sum, o) => sum + o.totalSteps, 0) / ops.length
      const avgTokens = ops.reduce((sum, o) => sum + o.totalTokens, 0) / ops.length
      const avgCost = ops.reduce((sum, o) => sum + o.cost, 0) / ops.length
      const totalToolCalls = ops.reduce((sum, o) => sum + o.toolCalls, 0)
      const totalToolErrors = ops.reduce((sum, o) => sum + o.toolErrors, 0)
      const toolErrorRate = totalToolCalls > 0 ? totalToolErrors / totalToolCalls : 0

      const health = evaluateHealth(successRate, avgDuration, avgSteps, avgCost, toolErrorRate, globalStats)

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
        avgCost,
        toolErrorRate,
        healthScore: health.score,
        healthFlags: health.flags,
        suggestion: '',
        suggestionSeverity: 'none' as 'none' | 'critical' | 'suggestion',
        fixStatus: 'none' as string,
        sampleOperations: ops.slice(0, 5).map((o) => o.operationId),
        firstSeen: timestamps[0] ?? new Date().toISOString(),
        lastSeen: timestamps[timestamps.length - 1] ?? new Date().toISOString(),
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  // Phase 2c: LLM suggestions for unhealthy behaviors
  const unhealthy = behaviorRows.filter((b) => b.healthScore < 0.8)

  if (unhealthy.length > 0) {
    const unhealthyDesc = unhealthy
      .map(
        (b) =>
          `- "${b.name}" (health=${b.healthScore.toFixed(1)}, flags=[${b.healthFlags.join(',')}])
    success_rate=${(b.successRate * 100).toFixed(0)}%, avg_duration=${(b.avgDuration / 1000).toFixed(1)}s, avg_steps=${b.avgSteps.toFixed(1)}, avg_cost=¥${b.avgCost.toFixed(4)}, tool_error_rate=${(b.toolErrorRate * 100).toFixed(0)}%
    tool_sequence: ${b.toolSequence}`,
      )
      .join('\n')

    try {
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
5. Set severity to "critical" ONLY when the fix is concrete and clearly actionable as a code change (e.g. "add retry with backoff to webFetch tool", "add input validation to dbQuery"). Set to "suggestion" for advisory or less certain improvements.`,
      })

      totalTokensUsed.input += suggestionResult.usage?.promptTokens ?? 0
      totalTokensUsed.output += suggestionResult.usage?.completionTokens ?? 0

      for (const s of suggestionResult.object.suggestions) {
        const match = behaviorRows.find((b) => b.name === s.behaviorName)
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

  // Write to DB (clear old behaviors and insert new)
  const insertStmt = db.prepare(`
    INSERT INTO behaviors (behavior_id, name, description, tool_sequence, operation_count,
      success_rate, avg_duration, avg_steps, avg_tokens, avg_cost, tool_error_rate,
      health_score, health_flags, suggestion, suggestion_severity, fix_status,
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
        b.avgCost,
        b.toolErrorRate,
        b.healthScore,
        JSON.stringify(b.healthFlags),
        b.suggestion,
        b.suggestionSeverity,
        b.fixStatus,
        JSON.stringify(b.sampleOperations),
        b.firstSeen,
        b.lastSeen,
        `inspector`,
      )
    }
  })
  writeAll()

  const totalCost = estimateCost(
    { input: totalTokensUsed.input, output: totalTokensUsed.output, cached: 0 },
    provider,
    modelId,
  )

  return {
    behaviorsFound: behaviorRows.length,
    unhealthyCount: unhealthy.length,
    tokensUsed: totalTokensUsed,
    cost: totalCost,
  }
}
