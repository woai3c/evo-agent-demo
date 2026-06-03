import { Hono } from 'hono'

export const tracesRoutes = new Hono()

tracesRoutes.get('/', async (c) => {
  // TODO: list operations with filters (time / provider / status / user)
  return c.json({ operations: [] })
})

tracesRoutes.get('/:operationId', async (c) => {
  // TODO: get operation detail with all steps
  return c.json({ operation: null, steps: [] })
})
