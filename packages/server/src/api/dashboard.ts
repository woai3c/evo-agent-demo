import { Hono } from 'hono'

export const dashboardRoutes = new Hono()

dashboardRoutes.get('/overview', async (c) => {
  // TODO: aggregated stats (total ops, success rate, avg steps, avg tokens, p95 latency)
  return c.json({
    totalOperations: 0,
    successRate: 0,
    avgSteps: 0,
    avgTokens: 0,
    p95Latency: 0,
  })
})

dashboardRoutes.get('/errors', async (c) => {
  // TODO: error bucketing (provider × errorType heatmap, top unmatched)
  return c.json({ buckets: [], topUnmatched: [] })
})

dashboardRoutes.get('/trends', async (c) => {
  // TODO: time-series data (success rate, pattern growth, unmatched rate)
  return c.json({ series: [] })
})
