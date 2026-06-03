import { Hono } from 'hono'

export const patternsRoutes = new Hono()

patternsRoutes.get('/', async (c) => {
  // TODO: list all patterns
  return c.json({ patterns: [] })
})

patternsRoutes.post('/', async (c) => {
  // TODO: create a new pattern (manual)
  return c.json({ message: 'pattern created' })
})

patternsRoutes.patch('/:patternId', async (c) => {
  // TODO: update pattern status
  return c.json({ message: 'pattern updated' })
})
