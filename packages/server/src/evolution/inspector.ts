import { nanoid } from 'nanoid'

import { generateObject } from 'ai'

import { z } from 'zod'

import type { ProviderName } from '@evo/shared'

import { db } from '../db/index.js'
import { getModel } from '../providers/registry.js'
import { estimateCost } from '../tracing/tracer.js'
import { applyFixes } from './auto-fix.js'
import { analyzeBehaviors } from './behavior-analyzer.js'
import { tuneContextStrategy } from './context-tuner.js'
import { bucketErrors } from './error-bucketer.js'

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
      userMessage: z.string().describe('Friendly message to show the user when this error occurs'),
      resolution: z.string().describe('How to fix or work around this error'),
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

export async function runInspection(): Promise<string> {
  const inspectionId = `insp_${nanoid()}`
  const round =
    ((db.prepare('SELECT MAX(round) as max FROM inspections').get() as { max: number | null })?.max ?? 0) + 1

  db.prepare('INSERT INTO inspections (inspection_id, round, traces_analyzed) VALUES (?, ?, 0)').run(
    inspectionId,
    round,
  )

  const unmatchedBuckets = bucketErrors({ unmatched: true })

  if (unmatchedBuckets.length === 0) {
    db.prepare(
      "UPDATE inspections SET finished_at = datetime('now'), summary = ?, details = '{}' WHERE inspection_id = ?",
    ).run('No unmatched errors found. All errors are covered by existing patterns.', inspectionId)
    return inspectionId
  }

  const totalTraces = unmatchedBuckets.reduce((sum, b) => sum + b.count, 0)
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

3. For harness_bug patterns, also add an entry to the bugs array with root cause analysis.

4. Write user_message in Chinese (this is a Chinese-facing product).`

  const provider = (process.env.INSPECTOR_PROVIDER ?? process.env.DEFAULT_PROVIDER ?? 'deepseek') as ProviderName
  const modelId = process.env.INSPECTOR_MODEL ?? process.env.DEFAULT_MODEL ?? 'deepseek-v4-flash'

  let result
  try {
    const model = getModel(provider, modelId)

    result = await generateObject({
      model,
      schema: PatternSuggestionSchema,
      prompt,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    db.prepare("UPDATE inspections SET finished_at = datetime('now'), summary = ? WHERE inspection_id = ?").run(
      `Inspection failed: ${message}`,
      inspectionId,
    )
    return inspectionId
  }

  const { patterns, bugs, summary } = result.object
  const fixResult = applyFixes(patterns, inspectionId, round)

  let tokensUsed = JSON.stringify(
    result.usage ? { input: result.usage.promptTokens, output: result.usage.completionTokens, cached: 0 } : {},
  )
  let cost = result.usage
    ? estimateCost(
        { input: result.usage.promptTokens, output: result.usage.completionTokens, cached: 0 },
        provider,
        modelId,
      )
    : 0

  const tuning = tuneContextStrategy()

  // Phase 2: behavior clustering + health evaluation
  let behaviorAnalysis = null
  try {
    behaviorAnalysis = await analyzeBehaviors()
    if (behaviorAnalysis.tokensUsed.input > 0) {
      const phase1Tokens = result.usage
        ? { input: result.usage.promptTokens, output: result.usage.completionTokens }
        : { input: 0, output: 0 }
      const combinedTokens = {
        input: phase1Tokens.input + behaviorAnalysis.tokensUsed.input,
        output: phase1Tokens.output + behaviorAnalysis.tokensUsed.output,
        cached: 0,
      }
      tokensUsed = JSON.stringify(combinedTokens)
      cost += behaviorAnalysis.cost
    }
  } catch {
    /* behavior analysis is best-effort */
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
    fixResult.newPatterns,
    bugs.length,
    tokensUsed,
    cost,
    summary,
    JSON.stringify({ newPatterns: patterns, bugs, tuning, behaviorAnalysis }),
    inspectionId,
  )

  return inspectionId
}
