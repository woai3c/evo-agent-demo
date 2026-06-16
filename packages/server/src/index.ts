import { serve } from '@hono/node-server'
import { config } from 'dotenv'

import { resolve } from 'node:path'

import { app } from './app.js'
import './db/index.js'

config({ path: resolve(import.meta.dirname, '../../../.env') })

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
