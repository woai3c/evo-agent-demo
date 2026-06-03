import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { chatRoutes } from './api/chat.js'
import { dashboardRoutes } from './api/dashboard.js'
import { inspectionsRoutes } from './api/inspections.js'
import { patternsRoutes } from './api/patterns.js'
import { tracesRoutes } from './api/traces.js'

export const app = new Hono()

app.use('*', cors())

app.get('/health', (c) => c.json({ status: 'ok' }))

app.route('/api/chat', chatRoutes)
app.route('/api/traces', tracesRoutes)
app.route('/api/patterns', patternsRoutes)
app.route('/api/inspections', inspectionsRoutes)
app.route('/api/dashboard', dashboardRoutes)
