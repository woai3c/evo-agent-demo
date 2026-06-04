import { db } from '../db/index.js'

export interface TuningResult {
  compressionThreshold: number
  reason: string
  metrics: {
    totalOps: number
    compressionTriggeredPct: number
    avgWindowUsage: number
    avgTokens: number
  }
}

let currentCompressionThreshold = 0.7

export function getCompressionThreshold(): number {
  return currentCompressionThreshold
}

export function tuneContextStrategy(): TuningResult {
  const stats = db
    .prepare(
      `SELECT
        COUNT(*) as total,
        AVG(json_extract(context_snapshot, '$.windowUsagePct')) as avgUsage,
        SUM(CASE WHEN json_extract(context_snapshot, '$.compressionTriggered') = 1 THEN 1 ELSE 0 END) as compressionCount
      FROM steps
      WHERE context_snapshot IS NOT NULL AND type = 'call_llm'`,
    )
    .get() as { total: number; avgUsage: number | null; compressionCount: number }

  const avgTokens =
    (
      db
        .prepare(
          "SELECT AVG(json_extract(total_tokens, '$.input') + json_extract(total_tokens, '$.output')) as avg FROM operations",
        )
        .get() as { avg: number | null }
    ).avg ?? 0

  const totalOps = stats.total
  const compressionPct = totalOps > 0 ? stats.compressionCount / totalOps : 0
  const avgUsage = stats.avgUsage ?? 0

  const prevThreshold = currentCompressionThreshold
  let reason: string

  if (compressionPct > 0.5) {
    currentCompressionThreshold = Math.max(0.5, currentCompressionThreshold - 0.05)
    reason = `Compression triggered too often (${(compressionPct * 100).toFixed(0)}%). Lowered threshold from ${prevThreshold} to ${currentCompressionThreshold}.`
  } else if (compressionPct < 0.1 && avgUsage > 0.6) {
    currentCompressionThreshold = Math.min(0.9, currentCompressionThreshold + 0.05)
    reason = `Compression rarely needed (${(compressionPct * 100).toFixed(0)}%) but usage high (${(avgUsage * 100).toFixed(0)}%). Raised threshold from ${prevThreshold} to ${currentCompressionThreshold}.`
  } else {
    reason = `Compression rate (${(compressionPct * 100).toFixed(0)}%) is within acceptable range. No adjustment needed.`
  }

  return {
    compressionThreshold: currentCompressionThreshold,
    reason,
    metrics: {
      totalOps,
      compressionTriggeredPct: compressionPct,
      avgWindowUsage: avgUsage,
      avgTokens,
    },
  }
}
