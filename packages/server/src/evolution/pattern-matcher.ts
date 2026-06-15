import type { MatchRule, Pattern } from '@evo/shared'

import { db } from '../db/index.js'

let patternCache: Pattern[] | null = null

export function invalidatePatternCache(): void {
  patternCache = null
}

function loadPatterns(): Pattern[] {
  if (patternCache) return patternCache

  const rows = db.prepare("SELECT * FROM patterns WHERE status = 'active'").all() as Record<string, unknown>[]

  patternCache = rows.map((r) => ({
    patternId: r.pattern_id as string,
    name: r.name as string,
    category: r.category as Pattern['category'],
    provider: r.provider as string,
    errorType: r.error_type as string,
    matchRule: JSON.parse((r.match_rule as string) || '{}') as MatchRule,
    userMessage: r.user_message as string,
    resolution: r.resolution as string,
    hitCount: r.hit_count as number,
    firstSeen: r.first_seen as string,
    lastSeen: r.last_seen as string,
    status: r.status as Pattern['status'],
    createdBy: r.created_by as string,
  }))

  return patternCache
}

interface ErrorToMatch {
  provider: string
  errorType: string
  statusCode?: number | null
  message: string
  toolName?: string | null
}

export function matchError(error: ErrorToMatch): Pattern | null {
  const patterns = loadPatterns()

  for (const pattern of patterns) {
    const rule = pattern.matchRule

    if (rule.provider && rule.provider !== '*' && rule.provider !== error.provider) continue
    if (rule.errorType && rule.errorType !== error.errorType) continue
    if (rule.statusCode != null && rule.statusCode !== error.statusCode) continue
    if (rule.toolName && rule.toolName !== error.toolName) continue
    if (rule.messageRegex) {
      try {
        if (!new RegExp(rule.messageRegex, 'i').test(error.message)) continue
      } catch {
        continue
      }
    }

    db.prepare("UPDATE patterns SET hit_count = hit_count + 1, last_seen = datetime('now') WHERE pattern_id = ?").run(
      pattern.patternId,
    )

    return pattern
  }

  return null
}

export function backfillErrors(patternId: string, matchRule: MatchRule): number {
  let where = 'WHERE pattern_id IS NULL'
  const params: unknown[] = []

  if (matchRule.provider && matchRule.provider !== '*') {
    where += ' AND provider = ?'
    params.push(matchRule.provider)
  }
  if (matchRule.errorType) {
    where += ' AND error_type = ?'
    params.push(matchRule.errorType)
  }
  if (matchRule.statusCode != null) {
    where += ' AND status_code = ?'
    params.push(matchRule.statusCode)
  }
  if (matchRule.toolName) {
    where += ' AND tool_name = ?'
    params.push(matchRule.toolName)
  }

  const result = db.prepare(`UPDATE errors SET pattern_id = ? ${where}`).run(patternId, ...params)

  if (result.changes > 0) {
    db.prepare("UPDATE patterns SET hit_count = hit_count + ?, last_seen = datetime('now') WHERE pattern_id = ?").run(
      result.changes,
      patternId,
    )
  }

  return result.changes
}
