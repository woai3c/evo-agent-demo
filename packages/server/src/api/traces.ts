import { Hono } from 'hono'

import { db } from '../db/index.js'
import { buildSnapshot } from '../tracing/snapshot.js'

export const tracesRoutes = new Hono()

tracesRoutes.get('/', async (c) => {
  const status = c.req.query('status')
  const provider = c.req.query('provider')
  const userId = c.req.query('userId')
  const from = c.req.query('from')
  const to = c.req.query('to')
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
  if (from) {
    where += ' AND created_at >= ?'
    params.push(from)
  }
  if (to) {
    where += ' AND created_at <= ?'
    params.push(to + ' 23:59:59')
  }

  const operations = db
    .prepare(
      `SELECT o.operation_id, o.user_id, o.model, o.provider, o.status, o.total_steps, o.total_duration, o.total_tokens, o.error_summary, o.created_at,
              c.title as conversation_title
       FROM operations o
       LEFT JOIN conversations c ON o.conversation_id = c.conversation_id
       ${where.replace(/\b(status|provider|user_id|created_at)\b/g, 'o.$1')} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Record<string, unknown>[]

  const total = db
    .prepare(
      `SELECT COUNT(*) as count FROM operations o ${where.replace(/\b(status|provider|user_id|created_at)\b/g, 'o.$1')}`,
    )
    .get(...params) as { count: number }

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
