import { streamText } from 'ai'
import type { CoreMessage } from 'ai'

import type { ProviderName, StreamEvent, ToolName } from '@evo/shared'

import { compressMessages } from '../context/compression.js'
import { db } from '../db/index.js'
import { getModel } from '../providers/registry.js'
import { Tracer } from '../tracing/tracer.js'
import { makeTools } from './dispatch.js'

const CURRENT_YEAR = new Date().getFullYear()

const SYSTEM_PROMPT = `You are Evo, a multi-tool AI work assistant. The current year is ${CURRENT_YEAR}.

## Tools

You have access to these tools — use them proactively when they can help answer the user's question:

- **webSearch**: Search the web for real-time information. When searching for recent/latest/current topics, include the year "${CURRENT_YEAR}" in your query for better results.
- **webFetch**: Fetch a web page and extract its text content. Use this after webSearch to read full articles or documentation. When summarizing fetched content, preserve key details, concrete examples, and structure — don't over-compress.
- **readFile**: Read a user-uploaded document from the uploads directory.
- **codeRunner**: Execute JavaScript code in a restricted VM context (node:vm). Use for calculations, data transformations, formatting, and quick prototyping. No filesystem or network access.
- **dbQuery**: Run read-only SQL SELECT queries against the Chinook demo database (a digital music store with artists, albums, tracks, genres, customers, invoices, etc.). Always use standard SQL. If the user asks about data without specifying a table, explore the schema first.
- **sendEmail**: Send a simulated email (recorded but not actually delivered). Only use when the user explicitly asks to send an email.

## Guidelines

- Be concise and helpful. Reply in the same language the user uses.
- When a question can be answered with tools, use them instead of relying on your training data — especially for real-time information, specific data queries, and calculations.
- For multi-step tasks, think about which tools to combine. For example: webSearch to find URLs, then webFetch to read content; or dbQuery to get data, then codeRunner to process it.
- If a tool call fails, explain the error to the user and suggest alternatives rather than silently retrying.`

interface AgentLoopParams {
  userId: string
  conversationId: string
  userMessage: string
  provider: ProviderName
  model: string
}

export async function* agentLoop(params: AgentLoopParams): AsyncGenerator<StreamEvent> {
  const { userId, conversationId, userMessage, provider, model: modelId } = params

  const tracer = new Tracer({ userId, conversationId, provider, model: modelId })

  const row = db.prepare('SELECT messages FROM conversations WHERE conversation_id = ?').get(conversationId) as
    | { messages: string }
    | undefined
  const rawMessages: CoreMessage[] = row ? JSON.parse(row.messages) : []
  rawMessages.push({ role: 'user', content: userMessage })

  const llmModel = getModel(provider, modelId)
  const tools = makeTools(userId)

  let status: 'success' | 'error' = 'success'
  let pendingToolArgs: Record<string, unknown> = {}

  const MAX_RETRIES = 1
  const RETRY_MAX_TOKENS = 50_000
  let retryCount = 0
  let responseMessages: CoreMessage[] = []

  while (retryCount <= MAX_RETRIES) {
    const budgetTokens = retryCount === 0 ? undefined : RETRY_MAX_TOKENS
    const messages = compressMessages(rawMessages, budgetTokens ? { maxTokens: budgetTokens } : undefined)
    const compressionTriggered = messages.length < rawMessages.length

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
            pendingToolArgs = (part.args as Record<string, unknown>) || {}
            yield {
              type: 'tool-call',
              toolName: part.toolName as ToolName,
              input: part.args as Record<string, unknown>,
            }
            break

          case 'tool-result': {
            const resultObj = (part.result as Record<string, unknown> | undefined) ?? {}
            const resultStr = JSON.stringify(resultObj)
            const outputSize = resultStr.length
            const errorMsg = typeof resultObj.error === 'string' ? resultObj.error : undefined
            const success = !errorMsg
            // Rate limit check for search tools
            if (
              !success &&
              (part.toolName === 'webSearch' || part.toolName === 'webFetch') &&
              errorMsg &&
              /rate limit/i.test(errorMsg)
            ) {
              throw new Error(`Search API rate limited: ${errorMsg}`)
            }
            tracer.onToolResult(part.toolName, pendingToolArgs, success, outputSize, errorMsg)
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
              const promptTokens = part.usage.promptTokens ?? 0
              const completionTokens = part.usage.completionTokens ?? 0
              const totalUsed = promptTokens + completionTokens
              const maxWindow = 128_000

              const meta = part.providerMetadata
              let cachedTokens = 0
              if (meta?.deepseek) {
                cachedTokens = (meta.deepseek.promptCacheHitTokens as number) ?? 0
              } else if (meta?.anthropic) {
                cachedTokens = (meta.anthropic.cacheReadInputTokens as number) ?? 0
              } else if (meta?.openai) {
                cachedTokens = (meta.openai.cachedPromptTokens as number) ?? 0
              }

              tracer.onStepFinish(
                {
                  promptTokens: part.usage.promptTokens,
                  completionTokens: part.usage.completionTokens,
                  cachedTokens,
                },
                {
                  totalTokens: totalUsed,
                  windowUsagePct: totalUsed / maxWindow,
                  compressionTriggered,
                },
              )
            }
            break

          case 'error':
            status = 'error'
            tracer.onError(String(part.error))
            yield { type: 'error', message: String(part.error) }
            break
        }
      }

      responseMessages = await result.response.messages
      break
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Retry with more aggressive compression on context overflow
      if (/context.*(length|exceed|overflow|limit)/i.test(message) || /maximum.*context/i.test(message)) {
        if (retryCount < MAX_RETRIES) {
          retryCount++
          continue
        }
      }
      status = 'error'
      tracer.onError(message)
      yield { type: 'error', message }
      break
    }
  }

  if (status === 'success') {
    const allMessages = [...rawMessages, ...responseMessages]
    db.prepare('UPDATE conversations SET messages = ?, updated_at = datetime(?) WHERE conversation_id = ?').run(
      JSON.stringify(allMessages),
      new Date().toISOString(),
      conversationId,
    )
  }

  const operationId = tracer.finish(status)
  yield { type: 'done', operationId }
}
