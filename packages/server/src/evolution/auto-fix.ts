import { nanoid } from 'nanoid'

import { db } from '../db/index.js'
import { backfillErrors, invalidatePatternCache } from './pattern-matcher.js'

interface PatternSuggestion {
  name: string
  category: 'user_error' | 'provider_error' | 'harness_bug'
  errorType: string
  matchRule: {
    statusCode?: number | null
    provider?: string
    toolName?: string | null
    messageRegex?: string
    errorType?: string
  }
}

export function applyFixes(
  patterns: PatternSuggestion[],
  inspectionId: string,
  round: number,
): { newPatterns: number; backfilled: number } {
  let newPatterns = 0
  let totalBackfilled = 0

  const insertPattern = db.prepare(
    `INSERT INTO patterns (pattern_id, name, category, provider, error_type, match_rule, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )

  db.transaction(() => {
    for (const p of patterns) {
      const existing = db.prepare('SELECT pattern_id FROM patterns WHERE name = ?').get(p.name) as
        | { pattern_id: string }
        | undefined

      if (existing) continue

      const patternId = `pat_${nanoid()}`
      const provider = p.matchRule.provider ?? '*'

      insertPattern.run(
        patternId,
        p.name,
        p.category,
        provider,
        p.errorType,
        JSON.stringify(p.matchRule),
        `inspector_round_${round}`,
      )

      const rule = {
        ...p.matchRule,
        statusCode: p.matchRule.statusCode ?? undefined,
        toolName: p.matchRule.toolName ?? undefined,
      }
      const backfilled = backfillErrors(patternId, rule)
      totalBackfilled += backfilled
      newPatterns++
    }
  })()

  invalidatePatternCache()

  console.log(`Inspection ${inspectionId}: ${newPatterns} new patterns, ${totalBackfilled} errors backfilled`)

  return { newPatterns, backfilled: totalBackfilled }
}
