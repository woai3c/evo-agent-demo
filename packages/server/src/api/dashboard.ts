import { Hono } from 'hono'

import { db } from '../db/index.js'

export const dashboardRoutes = new Hono()

dashboardRoutes.get('/overview', async (c) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM operations').get() as { count: number }
  const success = db.prepare("SELECT COUNT(*) as count FROM operations WHERE status = 'success'").get() as {
    count: number
  }

  const todayOps = db.prepare("SELECT COUNT(*) as count FROM operations WHERE created_at >= date('now')").get() as {
    count: number
  }
  const weekOps = db
    .prepare("SELECT COUNT(*) as count FROM operations WHERE created_at >= date('now', '-7 days')")
    .get() as { count: number }
  const monthOps = db
    .prepare("SELECT COUNT(*) as count FROM operations WHERE created_at >= date('now', '-30 days')")
    .get() as { count: number }

  const avgRow = db
    .prepare(
      `SELECT AVG(total_steps) as avgSteps, AVG(total_duration) as avgDuration,
              AVG(json_extract(total_tokens, '$.input') + json_extract(total_tokens, '$.output')) as avgTokens
       FROM operations`,
    )
    .get() as { avgSteps: number | null; avgDuration: number | null; avgTokens: number | null }

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

  const recentDailyRates = db
    .prepare(
      `SELECT DATE(created_at) as date,
              CAST(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) as rate
       FROM operations
       WHERE created_at >= datetime('now', '-14 days')
       GROUP BY DATE(created_at) ORDER BY date`,
    )
    .all() as { date: string; rate: number }[]

  return c.json({
    totalOperations: total.count,
    todayOperations: todayOps.count,
    weekOperations: weekOps.count,
    monthOperations: monthOps.count,
    successRate: total.count > 0 ? success.count / total.count : 0,
    avgSteps: avgRow.avgSteps ?? 0,
    avgDuration: avgRow.avgDuration ?? 0,
    avgTokens: avgRow.avgTokens ?? 0,
    p95Latency: p95Row?.total_duration ?? 0,
    totalErrors: errorCount.count,
    unmatchedErrors: unmatchedCount.count,
    totalPatterns: patternCount.count,
    providerDistribution: providerDist,
    successRateSparkline: recentDailyRates.map((r) => r.rate),
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

  const dailyErrorTrend = db
    .prepare(
      `SELECT DATE(created_at) as date, error_type, COUNT(*) as count
       FROM errors
       WHERE created_at >= datetime('now', '-30 days')
       GROUP BY DATE(created_at), error_type ORDER BY date`,
    )
    .all() as { date: string; error_type: string; count: number }[]

  const recentErrors = db
    .prepare(
      `SELECT e.error_id, e.operation_id, e.provider, e.error_type, e.status_code,
              e.message, e.tool_name, e.pattern_id, e.created_at,
              p.name as pattern_name, p.category as pattern_category
       FROM errors e
       LEFT JOIN patterns p ON e.pattern_id = p.pattern_id
       ORDER BY e.created_at DESC LIMIT 100`,
    )
    .all()

  return c.json({ buckets, topUnmatched, byTool, dailyErrorTrend, recentErrors })
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

  const dailyTokens = db
    .prepare(
      `SELECT DATE(created_at) as date,
              AVG(json_extract(total_tokens, '$.input') + json_extract(total_tokens, '$.output')) as avg_tokens
       FROM operations
       WHERE created_at >= datetime('now', '-' || ? || ' days')
       GROUP BY DATE(created_at) ORDER BY date`,
    )
    .all(days) as { date: string; avg_tokens: number }[]

  const inspectionSnapshots = db
    .prepare(
      `SELECT round, started_at, traces_analyzed, new_patterns, harness_bugs, cost,
              (SELECT CAST(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS REAL) / MAX(COUNT(*), 1)
               FROM operations WHERE created_at < i.started_at) as success_rate_before,
              (SELECT CAST(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS REAL) / MAX(COUNT(*), 1)
               FROM operations WHERE created_at <= COALESCE(i.finished_at, i.started_at)) as success_rate_after,
              (SELECT COUNT(*) FROM errors WHERE pattern_id IS NULL AND created_at < i.started_at) as unmatched_before,
              (SELECT COUNT(*) FROM errors WHERE pattern_id IS NULL AND created_at <= COALESCE(i.finished_at, i.started_at)) as unmatched_after,
              (SELECT COUNT(*) FROM patterns WHERE first_seen < i.started_at) as patterns_before,
              (SELECT COUNT(*) FROM patterns WHERE first_seen <= COALESCE(i.finished_at, i.started_at)) as patterns_after
       FROM inspections i ORDER BY round`,
    )
    .all()

  return c.json({
    dailyOperations: dailyOps,
    dailyErrors,
    patternGrowth,
    dailyTokens,
    inspectionSnapshots,
  })
})
