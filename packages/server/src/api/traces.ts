import { Hono } from 'hono'

import { db } from '../db/index.js'
import { buildSnapshot } from '../tracing/snapshot.js'

export const tracesRoutes = new Hono()

tracesRoutes.get('/', async (c) => {
  const status = c.req.query('status')
  const provider = c.req.query('provider')
  const userId = c.req.query('userId')
  const limit = Math.min(Number(c.req.query('limit')) || 50, 200)
  const offset = Number(c.req.query('offset')) || 0

  let where = 'WHERE 1=1'
  const params: unknown[] = []

  if (status) {
    where += ' AND status = ?'
    params.push(status)
  }
  if (provider) {
    where += ' AND provider = ?'
    params.push(provider)
  }
  if (userId) {
    where += ' AND user_id = ?'
    params.push(userId)
  }

  const operations = db
    .prepare(
      `SELECT operation_id, user_id, model, provider, status, total_steps, total_duration, total_tokens, cost, error_summary, created_at
       FROM operations ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Record<string, unknown>[]

  const total = db.prepare(`SELECT COUNT(*) as count FROM operations ${where}`).get(...params) as { count: number }

  return c.json({
    operations: operations.map((op) => ({
      ...op,
      total_tokens: JSON.parse((op.total_tokens as string) || '{}'),
    })),
    total: total.count,
    limit,
    offset,
  })
})

tracesRoutes.get('/:operationId', async (c) => {
  const { operationId } = c.req.param()
  const snapshot = buildSnapshot(operationId)

  if (!snapshot) {
    return c.json({ error: 'Operation not found' }, 404)
  }

  const errors = db.prepare('SELECT * FROM errors WHERE operation_id = ? ORDER BY created_at').all(operationId)

  return c.json({ ...snapshot, errors })
})
