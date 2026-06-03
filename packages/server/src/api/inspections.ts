import { Hono } from 'hono'

export const inspectionsRoutes = new Hono()

inspectionsRoutes.get('/', async (c) => {
  // TODO: list inspection records
  return c.json({ inspections: [] })
})

inspectionsRoutes.post('/run', async (c) => {
  // TODO: trigger an inspection round
  return c.json({ message: 'inspection triggered' })
})
