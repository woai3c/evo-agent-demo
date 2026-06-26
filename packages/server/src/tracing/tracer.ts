import { nanoid } from 'nanoid'

import type { ProviderName, TokenUsage } from '@evo/shared'

import { sanitizeText, sanitizeToolInput, sanitizeToolOutput } from './sanitizer.js'
import { traceStore } from './store.js'

interface TracerParams {
  userId: string
  conversationId?: string
  provider: ProviderName
  model: string
}

export class Tracer {
  readonly operationId: string
  private provider: string
  private stepIndex = 0
  private operationStart: number
  private stepStart = 0
  private toolCallStart = 0
  private totalTokens: TokenUsage = { input: 0, output: 0, cached: 0 }
  private lastError: string | null = null

  constructor(params: TracerParams) {
    this.operationId = `op_${nanoid()}`
    this.provider = params.provider
    this.operationStart = Date.now()

    traceStore.insertOperation({
      operationId: this.operationId,
      conversationId: params.conversationId,
      userId: params.userId,
      model: params.model,
      provider: params.provider,
    })
  }

  onStepStart(): void {
    this.stepStart = Date.now()
  }

  onToolCallStart(): void {
    this.toolCallStart = Date.now()
  }

  onToolResult(
    toolName: string,
    input: Record<string, unknown>,
    success: boolean,
    outputSize: number,
    toolOutput: Record<string, unknown>,
    errorMessage?: string,
  ): void {
    const durationMs = Date.now() - this.toolCallStart
    const sanitizedInput = sanitizeToolInput(input)

    const msg = errorMessage || `${toolName} failed`
    const error = success ? undefined : { code: 'tool_error', message: msg, providerStatus: null }

    const stepId = traceStore.insertStep({
      operationId: this.operationId,
      stepIndex: this.stepIndex++,
      type: 'call_tool',
      durationMs,
      toolName,
      toolInput: sanitizedInput,
      toolOutputSize: outputSize,
      toolOutput: sanitizeToolOutput(toolOutput),
      toolSuccess: success,
      error,
    })

    if (!success) {
      this.lastError = msg
      traceStore.insertError({
        operationId: this.operationId,
        stepId,
        provider: this.provider,
        errorType: 'tool_error',
        message: msg,
        toolName,
      })
    }
  }

  onStepFinish(
    usage: { promptTokens: number; completionTokens: number; cachedTokens?: number },
    contextSnapshot?: { totalTokens: number; windowUsagePct: number; compressionTriggered: boolean },
    llmResponse?: string,
  ): void {
    const durationMs = Date.now() - this.stepStart
    const cached = usage.cachedTokens ?? 0
    const tokens: TokenUsage = { input: usage.promptTokens, output: usage.completionTokens, cached }

    this.totalTokens.input += tokens.input
    this.totalTokens.output += tokens.output
    this.totalTokens.cached += cached

    traceStore.insertStep({
      operationId: this.operationId,
      stepIndex: this.stepIndex++,
      type: 'call_llm',
      durationMs,
      tokens,
      llmResponse: llmResponse ? sanitizeText(llmResponse) : undefined,
      contextSnapshot,
    })
  }

  onError(message: string, statusCode?: number): void {
    this.lastError = message
    const stepId = traceStore.insertStep({
      operationId: this.operationId,
      stepIndex: this.stepIndex++,
      type: 'call_llm',
      durationMs: Date.now() - this.stepStart,
      error: { code: 'llm_error', message, providerStatus: statusCode ?? null },
    })

    traceStore.insertError({
      operationId: this.operationId,
      stepId,
      provider: this.provider,
      errorType: statusCode === 429 ? 'rate_limit' : statusCode === 401 ? 'auth' : 'provider_error',
      statusCode,
      message,
    })
  }

  finish(status: 'success' | 'error'): string {
    const totalDuration = Date.now() - this.operationStart

    traceStore.finishOperation(
      this.operationId,
      status,
      this.stepIndex,
      totalDuration,
      this.totalTokens,
      status === 'error' ? this.lastError : null,
    )

    return this.operationId
  }
}
