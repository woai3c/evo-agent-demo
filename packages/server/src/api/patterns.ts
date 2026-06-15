import { nanoid } from 'nanoid'

import { Hono } from 'hono'

import { db } from '../db/index.js'
import { backfillErrors, invalidatePatternCache } from '../evolution/pattern-matcher.js'

export const patternsRoutes = new Hono()

patternsRoutes.get('/', async (c) => {
  const status = c.req.query('status')
  let query = 'SELECT * FROM patterns'
  const params: unknown[] = []

  if (status) {
    query += ' WHERE status = ?'
    params.push(status)
  }

  query += ' ORDER BY hit_count DESC'

  const patterns = db.prepare(query).all(...params) as Record<string, unknown>[]

  return c.json({
    patterns: patterns.map((p) => ({
      ...p,
      match_rule: JSON.parse((p.match_rule as string) || '{}'),
      pattern_id: p.pattern_id,
    })),
  })
})

patternsRoutes.post('/', async (c) => {
  const body = await c.req.json()
  const { name, category, provider, errorType, matchRule, userMessage, resolution } = body

  if (!name || !category || !errorType || !matchRule) {
    return c.json({ error: 'name, category, errorType, and matchRule are required' }, 400)
  }

  const patternId = `pat_${nanoid()}`

  db.prepare(
    `INSERT INTO patterns (pattern_id, name, category, provider, error_type, match_rule, user_message, resolution, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')`,
  ).run(
    patternId,
    name,
    category,
    provider || '*',
    errorType,
    JSON.stringify(matchRule),
    userMessage || '',
    resolution || '',
  )

  invalidatePatternCache()

  const backfilled = backfillErrors(patternId, matchRule)

  return c.json({ patternId, backfilled })
})

patternsRoutes.patch('/:patternId', async (c) => {
  const { patternId } = c.req.param()
  const body = await c.req.json()

  const fields: string[] = []
  const params: unknown[] = []

  for (const key of ['status', 'user_message', 'resolution', 'name', 'category', 'provider', 'error_type'] as const) {
    if (body[key] !== undefined) {
      fields.push(`${key} = ?`)
      params.push(body[key])
    }
  }

  if (body.match_rule !== undefined) {
    fields.push('match_rule = ?')
    params.push(JSON.stringify(body.match_rule))
  }

  if (fields.length === 0) {
    return c.json({ error: 'No fields to update' }, 400)
  }

  params.push(patternId)
  db.prepare(`UPDATE patterns SET ${fields.join(', ')} WHERE pattern_id = ?`).run(...params)
  invalidatePatternCache()

  return c.json({ success: true })
})
