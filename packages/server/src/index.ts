import { serve } from '@hono/node-server'
import { config } from 'dotenv'

import { resolve } from 'node:path'

import { app } from './app.js'
import { db } from './db/index.js'

config({ path: resolve(import.meta.dirname, '../../../.env') })

// Any operation still marked 'running' at boot is a leftover from a previous
// server instance that crashed or was killed mid-run — reap it so it doesn't
// show as "处理中" forever. Safe here: only the server creates running
// operations, and standalone scripts (inspect/autofix/simulate) don't import
// this entrypoint, so a concurrently-running op is never clobbered.
const reaped = db.prepare("UPDATE operations SET status = 'interrupted' WHERE status = 'running'").run()
if (reaped.changes > 0) {
  console.log(`Reaped ${reaped.changes} interrupted operation(s) from a previous run`)
}

const port = Number(process.env.PORT) || 3000

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Evo server running at http://localhost:${info.port}`)
})

const shutdown = () => {
  server.close()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
