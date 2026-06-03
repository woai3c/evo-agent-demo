import { Hono } from 'hono'

export const chatRoutes = new Hono()

chatRoutes.post('/message', async (c) => {
  // TODO: accept user message, run agent loop, stream response via SSE
  return c.json({ message: 'chat endpoint stub' })
})

chatRoutes.get('/conversations', async (c) => {
  // TODO: list conversations for a user
  return c.json({ conversations: [] })
})
