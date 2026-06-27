import { streamText } from 'ai'
import type { CoreMessage } from 'ai'

import type { ProviderName, StreamEvent, ToolName } from '@evo/shared'

import { compressMessages } from '../context/compression.js'
import { db } from '../db/index.js'
import { applySchemaCompat } from '../evolution/schema-compat.js'
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

  let messages = compressMessages(rawMessages)
  let compressionTriggered = messages.length < rawMessages.length

  let status: 'success' | 'error' = 'success'
  let pendingToolArgs: Record<string, unknown> = {}
  let stepText = ''

  // Retry loop for context overflow errors — each retry applies more
  // aggressive compression to fit the conversation within the model's
  // context window.
  const MAX_CONTEXT_RETRIES = 3
  let contextRetryCount = 0

  while (contextRetryCount <= MAX_CONTEXT_RETRIES) {
    let contextOverflow = false

    try {
      const llmModel = getModel(provider, modelId)
      const tools = makeTools(userId)

      const result = streamText({
        model: llmModel,
        system: SYSTEM_PROMPT,
        messages,
        tools,
        maxSteps: 15,
      })

      streamLoop: for await (const part of result.fullStream) {
        switch (part.type) {
          case 'step-start':
            tracer.onStepStart()
            stepText = ''
            break

          case 'text-delta':
            stepText += part.textDelta
            yield { type: 'text-delta', text: part.textDelta }
            break

          case 'tool-call':
            tracer.onToolCallStart()
            pendingToolArgs = applySchemaCompat(part.toolName, (part.args as Record<string, unknown>) || {})
            yield {
              type: 'tool-call',
              toolName: part.toolName as ToolName,
              input: pendingToolArgs,
            }
            break

          case 'tool-result': {
            const resultObj = (part.result as Record<string, unknown> | undefined) ?? {}
            const resultStr = JSON.stringify(resultObj)
            const outputSize = resultStr.length
            const errorMsg = typeof resultObj.error === 'string' ? resultObj.error : undefined
            const success = !errorMsg
            // Use the args carried by this result, not the shared pendingToolArgs —
            // otherwise parallel tool calls in one step trace each other's input.
            const toolInput = ((part as { args?: Record<string, unknown> }).args ?? {}) as Record<string, unknown>
            // Rate limit check for search tools
            if (
              !success &&
              (part.toolName === 'webSearch' || part.toolName === 'webFetch') &&
              errorMsg &&
              /rate limit/i.test(errorMsg)
            ) {
              throw new Error(`Search API rate limited: ${errorMsg}`)
            }
            tracer.onToolResult(part.toolName, toolInput, success, outputSize, resultObj, errorMsg)
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

              // Provider cache-hit token fields are sometimes NaN/undefined (e.g.
              // DeepSeek omits prompt_cache_hit_tokens). `NaN ?? 0` is still NaN, so
              // coerce to a finite number — otherwise cached totals become NaN.
              const toFinite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
              const meta = part.providerMetadata
              let cachedTokens = 0
              if (meta?.deepseek) {
                cachedTokens = toFinite(meta.deepseek.promptCacheHitTokens)
              } else if (meta?.anthropic) {
                cachedTokens = toFinite(meta.anthropic.cacheReadInputTokens)
              } else if (meta?.openai) {
                cachedTokens = toFinite(meta.openai.cachedPromptTokens)
              }

              tracer.onStepFinish(
                {
                  promptTokens,
                  completionTokens,
                  cachedTokens,
                },
                {
                  totalTokens: totalUsed,
                  windowUsagePct: totalUsed / maxWindow,
                  compressionTriggered,
                },
                stepText || undefined,
              )
            }
            break

          case 'error': {
            const errObj = part.error
            const errMessage =
              typeof errObj === 'object' && errObj !== null
                ? String((errObj as Error).message ?? errObj)
                : String(errObj)
            const errStatusCode =
              typeof errObj === 'object' && errObj !== null
                ? (errObj as { statusCode?: number }).statusCode
                : undefined

            // Context overflow: retry with more aggressive compression
            if (
              errStatusCode === 400 &&
              contextRetryCount < MAX_CONTEXT_RETRIES &&
              /maximum context length exceeded/i.test(errMessage)
            ) {
              contextOverflow = true
              break streamLoop
            }

            // Non-recoverable error — report it
            status = 'error'
            tracer.onError(errMessage, errStatusCode)
            yield { type: 'error', message: errMessage }
            break
          }
        }
      }

      if (contextOverflow) {
        // Apply progressively more aggressive compression
        contextRetryCount++
        const shrinkFactor = Math.max(0.2, 0.6 - (contextRetryCount - 1) * 0.15)
        messages = compressMessages(rawMessages, { maxTokens: Math.floor(128_000 * shrinkFactor) })
        compressionTriggered = true
        continue // retry the while loop with compressed messages
      }

      // Success — persist messages and break out of retry loop
      const response = await result.response
      const allMessages = [...rawMessages, ...response.messages]

      db.prepare('UPDATE conversations SET messages = ?, updated_at = datetime(?) WHERE conversation_id = ?').run(
        JSON.stringify(allMessages),
        new Date().toISOString(),
        conversationId,
      )
      break
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      // Check if this is a context overflow (may be thrown rather than streamed)
      if (
        contextRetryCount < MAX_CONTEXT_RETRIES &&
        /maximum context length exceeded/i.test(message)
      ) {
        contextRetryCount++
        const shrinkFactor = Math.max(0.2, 0.6 - (contextRetryCount - 1) * 0.15)
        messages = compressMessages(rawMessages, { maxTokens: Math.floor(128_000 * shrinkFactor) })
        compressionTriggered = true
        continue // retry the while loop with compressed messages
      }

      status = 'error'
      tracer.onError(message)
      yield { type: 'error', message }
      break
    }
  }

  const operationId = tracer.finish(status)
  yield { type: 'done', operationId }
}
