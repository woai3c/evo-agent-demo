import { serve } from '@hono/node-server'
import 'dotenv/config'

import { app } from './app.js'
import './db/index.js'

const port = Number(process.env.PORT) || 3000

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Evo server running at http://localhost:${info.port}`)
})
