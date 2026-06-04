import { Hono } from 'hono'

import { db } from '../db/index.js'

export const dashboardRoutes = new Hono()

dashboardRoutes.get('/overview', async (c) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM operations').get() as { count: number }
  const success = db.prepare("SELECT COUNT(*) as count FROM operations WHERE status = 'success'").get() as {
    count: number
  }

  const avgRow = db
    .prepare('SELECT AVG(total_steps) as avgSteps, AVG(total_duration) as avgDuration FROM operations')
    .get() as { avgSteps: number | null; avgDuration: number | null }

  const p95Row = db
    .prepare(
      `SELECT total_duration FROM operations ORDER BY total_duration DESC
       LIMIT 1 OFFSET (SELECT MAX(0, CAST(COUNT(*) * 0.05 AS INTEGER)) FROM operations)`,
    )
    .get() as { total_duration: number } | undefined

  const errorCount = db.prepare('SELECT COUNT(*) as count FROM errors').get() as { count: number }
  const unmatchedCount = db.prepare('SELECT COUNT(*) as count FROM errors WHERE pattern_id IS NULL').get() as {
    count: number
  }
  const patternCount = db.prepare('SELECT COUNT(*) as count FROM patterns').get() as { count: number }

  const providerDist = db
    .prepare('SELECT provider, COUNT(*) as count FROM operations GROUP BY provider ORDER BY count DESC')
    .all()

  return c.json({
    totalOperations: total.count,
    successRate: total.count > 0 ? success.count / total.count : 0,
    avgSteps: avgRow.avgSteps ?? 0,
    avgDuration: avgRow.avgDuration ?? 0,
    p95Latency: p95Row?.total_duration ?? 0,
    totalErrors: errorCount.count,
    unmatchedErrors: unmatchedCount.count,
    totalPatterns: patternCount.count,
    providerDistribution: providerDist,
  })
})

dashboardRoutes.get('/errors', async (c) => {
  const buckets = db
    .prepare(
      `SELECT provider, error_type, COUNT(*) as count
       FROM errors GROUP BY provider, error_type ORDER BY count DESC`,
    )
    .all()

  const topUnmatched = db
    .prepare(
      `SELECT message, provider, error_type, tool_name, COUNT(*) as count
       FROM errors WHERE pattern_id IS NULL
       GROUP BY message, provider, error_type ORDER BY count DESC LIMIT 20`,
    )
    .all()

  const byTool = db
    .prepare(
      `SELECT tool_name, COUNT(*) as count FROM errors
       WHERE tool_name IS NOT NULL GROUP BY tool_name ORDER BY count DESC`,
    )
    .all()

  return c.json({ buckets, topUnmatched, byTool })
})

dashboardRoutes.get('/trends', async (c) => {
  const days = Number(c.req.query('days')) || 30

  const dailyOps = db
    .prepare(
      `SELECT DATE(created_at) as date,
              COUNT(*) as total,
              SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success
       FROM operations
       WHERE created_at >= datetime('now', '-' || ? || ' days')
       GROUP BY DATE(created_at) ORDER BY date`,
    )
    .all(days)

  const dailyErrors = db
    .prepare(
      `SELECT DATE(created_at) as date,
              COUNT(*) as total,
              SUM(CASE WHEN pattern_id IS NOT NULL THEN 1 ELSE 0 END) as matched
       FROM errors
       WHERE created_at >= datetime('now', '-' || ? || ' days')
       GROUP BY DATE(created_at) ORDER BY date`,
    )
    .all(days)

  const patternGrowth = db
    .prepare(
      `SELECT DATE(first_seen) as date, COUNT(*) as new_patterns
       FROM patterns GROUP BY DATE(first_seen) ORDER BY date`,
    )
    .all()

  return c.json({
    dailyOperations: dailyOps,
    dailyErrors,
    patternGrowth,
  })
})
