import { streamText } from 'ai'
import type { CoreMessage } from 'ai'

import type { ProviderName, StreamEvent, ToolName } from '@evo/shared'

import { db } from '../db/index.js'
import { getModel } from '../providers/registry.js'
import { Tracer } from '../tracing/tracer.js'
import { makeTools } from './dispatch.js'

const SYSTEM_PROMPT = `You are Evo, a helpful multi-tool AI work assistant. You can:
- Search the web for information (webSearch)
- Fetch and read web pages (webFetch)
- Read user-uploaded documents (readFile)
- Execute JavaScript code snippets (codeRunner)
- Query the Chinook music database with SQL (dbQuery)
- Send simulated emails (sendEmail)

Use these tools when they would help answer the user's question. Be concise and helpful.
When using dbQuery, write standard SQL SELECT statements for the Chinook database.`

interface AgentLoopParams {
  userId: string
  conversationId: string
  userMessage: string
  provider: ProviderName
  model: string
}

export async function* agentLoop(params: AgentLoopParams): AsyncGenerator<StreamEvent> {
  const { userId, conversationId, userMessage, provider, model: modelId } = params

  const tracer = new Tracer({ userId, provider, model: modelId })

  const row = db.prepare('SELECT messages FROM conversations WHERE conversation_id = ?').get(conversationId) as
    | { messages: string }
    | undefined
  const messages: CoreMessage[] = row ? JSON.parse(row.messages) : []
  messages.push({ role: 'user', content: userMessage })

  const llmModel = getModel(provider, modelId)
  const tools = makeTools(userId)

  let status: 'success' | 'error' = 'success'
  let pendingToolArgs: Record<string, unknown> = {}

  try {
    const result = streamText({
      model: llmModel,
      system: SYSTEM_PROMPT,
      messages,
      tools,
      maxSteps: 15,
    })

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'step-start':
          tracer.onStepStart()
          break

        case 'text-delta':
          yield { type: 'text-delta', text: part.textDelta }
          break

        case 'tool-call':
          tracer.onToolCallStart()
          pendingToolArgs = part.args as Record<string, unknown>
          yield {
            type: 'tool-call',
            toolName: part.toolName as ToolName,
            input: part.args as Record<string, unknown>,
          }
          break

        case 'tool-result': {
          const outputSize = JSON.stringify(part.result).length
          const success = !part.result?.error
          tracer.onToolResult(part.toolName, pendingToolArgs, success, outputSize)
          yield {
            type: 'tool-result',
            toolName: part.toolName as ToolName,
            success,
            outputSize,
          }
          break
        }

        case 'step-finish':
          if (part.usage) {
            tracer.onStepFinish({
              promptTokens: part.usage.promptTokens,
              completionTokens: part.usage.completionTokens,
            })
          }
          break

        case 'error':
          status = 'error'
          tracer.onError(String(part.error))
          yield { type: 'error', message: String(part.error) }
          break
      }
    }

    const response = await result.response
    const allMessages = [...messages, ...response.messages]

    db.prepare('UPDATE conversations SET messages = ?, updated_at = datetime(?) WHERE conversation_id = ?').run(
      JSON.stringify(allMessages),
      new Date().toISOString(),
      conversationId,
    )
  } catch (err) {
    status = 'error'
    const message = err instanceof Error ? err.message : String(err)
    tracer.onError(message)
    yield { type: 'error', message }
  }

  const operationId = tracer.finish(status)
  yield { type: 'done', operationId }
}
