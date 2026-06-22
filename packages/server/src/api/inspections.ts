import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

import { db } from '../db/index.js'
import { runAutoFix } from '../evolution/auto-pr.js'
import { runInspection } from '../evolution/inspector.js'

export const inspectionsRoutes = new Hono()

inspectionsRoutes.get('/', async (c) => {
  const rows = db.prepare('SELECT * FROM inspections ORDER BY started_at DESC').all() as Record<string, unknown>[]

  const inspections = rows.map((r) => ({
    ...r,
    tokens_used: r.tokens_used ? JSON.parse(r.tokens_used as string) : null,
    details: r.details ? JSON.parse(r.details as string) : null,
  }))

  return c.json({ inspections })
})

inspectionsRoutes.post('/run', async (c) => {
  return streamSSE(c, async (stream) => {
    try {
      const inspectionId = await runInspection((msg) => {
        stream.writeSSE({ event: 'log', data: msg })
      })
      const inspection = db.prepare('SELECT * FROM inspections WHERE inspection_id = ?').get(inspectionId)
      await stream.writeSSE({ event: 'done', data: JSON.stringify({ inspectionId, inspection }) })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: `Inspection failed: ${message}` }) })
    }
  })
})

inspectionsRoutes.post('/autofix', async (c) => {
  if (process.argv.some((a) => a.includes('watch'))) {
    return c.json(
      {
        error:
          '自动修复会修改源码文件，在 dev 模式（tsx watch）下会触发服务重启导致修复中断。请使用 pnpm autofix 命令单独运行。',
      },
      400,
    )
  }

  return streamSSE(c, async (stream) => {
    try {
      const results = await runAutoFix((msg) => {
        stream.writeSSE({ event: 'log', data: msg })
      })
      await stream.writeSSE({ event: 'done', data: JSON.stringify({ results }) })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: `Auto-fix failed: ${message}` }) })
    }
  })
})
