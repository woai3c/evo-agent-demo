import { nanoid } from 'nanoid'

import { generateObject } from 'ai'

import { z } from 'zod'

import type { ProviderName } from '@evo/shared'

import { db } from '../db/index.js'
import { getModel } from '../providers/registry.js'
import { estimateCost } from '../tracing/tracer.js'
import { applyFixes } from './auto-fix.js'
import { analyzeBehaviors } from './behavior-analyzer.js'
import { bucketErrors } from './error-bucketer.js'
import { learnSchemaAliases } from './schema-compat.js'

const PatternSuggestionSchema = z.object({
  patterns: z.array(
    z.object({
      name: z.string().describe('Human-readable pattern name, e.g. deepseek-rate-limit-429'),
      category: z.enum(['user_error', 'provider_error', 'harness_bug']),
      errorType: z.string(),
      matchRule: z.object({
        statusCode: z.number().nullable().optional(),
        provider: z.string().optional(),
        toolName: z.string().nullable().optional(),
        messageRegex: z.string().optional(),
        errorType: z.string().optional(),
      }),
      reasoning: z.string().describe('Why you classified it this way'),
    }),
  ),
  bugs: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      rootCause: z.string(),
      suggestedFix: z.string(),
      severity: z.enum(['low', 'medium', 'high']),
    }),
  ),
  summary: z.string().describe('Brief summary of this inspection round'),
})

export type ProgressCallback = (message: string) => void

export async function runInspection(onProgress?: ProgressCallback): Promise<string> {
  const log = onProgress ?? (() => {})
  const inspectionId = `insp_${nanoid()}`
  const round =
    ((db.prepare('SELECT MAX(round) as max FROM inspections').get() as { max: number | null })?.max ?? 0) + 1

  log(`开始巡检第 ${round} 轮...`)

  db.prepare('INSERT INTO inspections (inspection_id, round, traces_analyzed) VALUES (?, ?, 0)').run(
    inspectionId,
    round,
  )

  let totalTraces = 0
  let newPatterns = 0
  let harnessBugs = 0
  let summary = ''
  let patterns: z.infer<typeof PatternSuggestionSchema>['patterns'] = []
  let bugs: z.infer<typeof PatternSuggestionSchema>['bugs'] = []
  let tokensUsed = '{}'
  let cost = 0
  // Phase 1: error pattern recognition (only if unmatched errors exist)
  const unmatchedBuckets = bucketErrors({ unmatched: true })

  if (unmatchedBuckets.length === 0) {
    log('Phase 1: 没有未匹配的错误，跳过错误模式识别')
    summary = 'No unmatched errors. Ran behavior analysis only.'
  } else {
    log(
      `发现 ${unmatchedBuckets.length} 个未匹配的错误桶（共 ${unmatchedBuckets.reduce((s, b) => s + b.count, 0)} 条错误）`,
    )

    totalTraces = unmatchedBuckets.reduce((sum, b) => sum + b.count, 0)
    const bucketSummary = unmatchedBuckets
      .slice(0, 30)
      .map(
        (b) =>
          `- [${b.count}x] provider=${b.provider} type=${b.errorType} status=${b.statusCode ?? 'N/A'} tool=${b.toolName ?? 'N/A'}\n  message: "${b.message}"`,
      )
      .join('\n')

    const prompt = `You are an AI Agent Harness inspector. Analyze these unmatched error buckets from agent operations and generate error patterns.

## Unmatched Error Buckets (${unmatchedBuckets.length} buckets, ${totalTraces} total errors):

${bucketSummary}

## Instructions:
1. For each error bucket, classify it as:
   - user_error: caused by the user (expired API key, insufficient balance, bad input)
   - provider_error: caused by the LLM provider (rate limits, timeouts, service outages)
   - harness_bug: caused by our harness code (schema incompatibility, context overflow, tool bugs)

2. Generate a pattern for each bucket with a matchRule that will catch similar errors in the future.
   - Use messageRegex for flexible message matching (escape special regex chars)
   - Set provider to the specific provider or "*" for cross-provider patterns

3. For harness_bug patterns, also add an entry to the bugs array with root cause analysis (this feeds the inspection summary; the actual fix is generated later from real error samples).`

    const provider = (process.env.INSPECTOR_PROVIDER ?? process.env.DEFAULT_PROVIDER ?? 'deepseek') as ProviderName
    const modelId = process.env.INSPECTOR_MODEL ?? process.env.DEFAULT_MODEL ?? 'deepseek-v4-flash'

    log(`Phase 1: LLM 分析错误模式（provider: ${provider}, model: ${modelId}）...`)

    try {
      const model = getModel(provider, modelId)

      const result = await generateObject({
        model,
        schema: PatternSuggestionSchema,
        prompt,
        abortSignal: AbortSignal.timeout(120_000),
      })

      patterns = result.object.patterns
      bugs = result.object.bugs
      summary = result.object.summary
      harnessBugs = bugs.length
      log(`Phase 1 完成: 识别到 ${patterns.length} 个 Pattern，${bugs.length} 个 Harness 缺陷`)

      const fixResult = applyFixes(patterns, inspectionId, round)
      newPatterns = fixResult.newPatterns
      log(`已写入 ${fixResult.newPatterns} 个新 Pattern，回扫标记 ${fixResult.backfilled} 条错误`)

      if (result.usage) {
        tokensUsed = JSON.stringify({
          input: result.usage.promptTokens,
          output: result.usage.completionTokens,
          cached: 0,
        })
        cost = estimateCost(
          { input: result.usage.promptTokens, output: result.usage.completionTokens, cached: 0 },
          provider,
          modelId,
        )
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log(`✗ Phase 1 LLM 分析失败: ${message}`)
      summary = `Phase 1 failed: ${message}`
    }
  }

  // Schema compat learning (always runs)
  const schemaResult = learnSchemaAliases()
  if (schemaResult.newAliases > 0) {
    log(`Schema 兼容层: 学习到 ${schemaResult.newAliases} 个新参数别名（总计 ${schemaResult.totalAliases} 个）`)
  } else {
    log(`Schema 兼容层: 无新别名（总计 ${schemaResult.totalAliases} 个）`)
  }

  // Phase 2: behavior clustering + health evaluation (always runs)
  log('Phase 2: 行为聚类分析...')
  let behaviorAnalysis = null
  try {
    behaviorAnalysis = await analyzeBehaviors(log)
    log(`Phase 2 完成: ${behaviorAnalysis.behaviorsFound} 个行为模式，${behaviorAnalysis.unhealthyCount} 个不健康`)
    if (behaviorAnalysis.tokensUsed.input > 0) {
      const prev = tokensUsed !== '{}' ? JSON.parse(tokensUsed) : { input: 0, output: 0, cached: 0 }
      const combinedTokens = {
        input: prev.input + behaviorAnalysis.tokensUsed.input,
        output: prev.output + behaviorAnalysis.tokensUsed.output,
        cached: prev.cached ?? 0,
      }
      tokensUsed = JSON.stringify(combinedTokens)
      cost += behaviorAnalysis.cost
    }
  } catch (e) {
    log(`Phase 2 失败（非关键）: ${e instanceof Error ? e.message : String(e)}`)
  }

  db.prepare(
    `UPDATE inspections SET
      finished_at = datetime('now'),
      traces_analyzed = ?,
      new_patterns = ?,
      harness_bugs = ?,
      tokens_used = ?,
      cost = ?,
      summary = ?,
      details = ?
    WHERE inspection_id = ?`,
  ).run(
    totalTraces,
    newPatterns,
    harnessBugs,
    tokensUsed,
    cost,
    summary,
    JSON.stringify({ newPatterns: patterns, bugs, behaviorAnalysis }),
    inspectionId,
  )

  log(`巡检完成（¥${cost.toFixed(4)}）: ${summary}`)
  return inspectionId
}
