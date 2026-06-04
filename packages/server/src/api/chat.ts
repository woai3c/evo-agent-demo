import { nanoid } from 'nanoid'

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '@evo/shared'
import type { ProviderName } from '@evo/shared'

import { agentLoop } from '../agent/loop.js'
import { db } from '../db/index.js'

export const chatRoutes = new Hono()

chatRoutes.post('/message', async (c) => {
  const body = await c.req.json()
  const { userId, message, provider, model } = body
  let { conversationId } = body

  if (!userId || !message) {
    return c.json({ error: 'userId and message are required' }, 400)
  }

  const resolvedProvider = (provider || DEFAULT_PROVIDER) as ProviderName
  const resolvedModel = model || DEFAULT_MODEL

  const existingUser = db.prepare('SELECT user_id FROM users WHERE user_id = ?').get(userId)
  if (!existingUser) {
    db.prepare('INSERT INTO users (user_id, username) VALUES (?, ?)').run(userId, userId)
  }

  if (!conversationId) {
    conversationId = nanoid()
    db.prepare(
      'INSERT INTO conversations (conversation_id, user_id, title, model, provider) VALUES (?, ?, ?, ?, ?)',
    ).run(conversationId, userId, message.slice(0, 50), resolvedModel, resolvedProvider)
  }

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ data: JSON.stringify({ conversationId }), event: 'conversation' })

    const events = agentLoop({
      userId,
      conversationId,
      userMessage: message,
      provider: resolvedProvider,
      model: resolvedModel,
    })

    for await (const event of events) {
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      })
    }
  })
})

chatRoutes.get('/conversations', async (c) => {
  const userId = c.req.query('userId')
  if (!userId) return c.json({ error: 'userId query parameter is required' }, 400)

  const conversations = db
    .prepare(
      `SELECT conversation_id, user_id, title, model, provider, created_at, updated_at
       FROM conversations WHERE user_id = ? ORDER BY updated_at DESC`,
    )
    .all(userId)

  return c.json({ conversations })
})

chatRoutes.get('/conversations/:conversationId/messages', async (c) => {
  const { conversationId } = c.req.param()
  const row = db.prepare('SELECT messages FROM conversations WHERE conversation_id = ?').get(conversationId) as
    | { messages: string }
    | undefined

  if (!row) return c.json({ error: 'Conversation not found' }, 404)

  return c.json({ messages: JSON.parse(row.messages) })
})
