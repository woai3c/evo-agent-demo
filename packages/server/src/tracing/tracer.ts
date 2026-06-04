import { nanoid } from 'nanoid'

import type { ProviderName, TokenUsage } from '@evo/shared'

import { sanitizeToolInput } from './sanitizer.js'
import { traceStore } from './store.js'

interface TracerParams {
  userId: string
  provider: ProviderName
  model: string
}

export class Tracer {
  readonly operationId: string
  private provider: ProviderName
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

  onToolResult(toolName: string, input: Record<string, unknown>, success: boolean, outputSize: number): void {
    const durationMs = Date.now() - this.toolCallStart
    const sanitizedInput = sanitizeToolInput(input)

    const error = success ? undefined : { code: 'tool_error', message: `${toolName} failed`, providerStatus: null }

    const stepId = traceStore.insertStep({
      operationId: this.operationId,
      stepIndex: this.stepIndex++,
      type: 'call_tool',
      durationMs,
      toolName,
      toolInput: sanitizedInput,
      toolOutputSize: outputSize,
      toolSuccess: success,
      error,
    })

    if (!success) {
      this.lastError = `Tool ${toolName} failed`
      traceStore.insertError({
        operationId: this.operationId,
        stepId,
        provider: this.provider,
        errorType: 'tool_error',
        message: `${toolName} execution failed`,
        toolName,
      })
    }
  }

  onStepFinish(usage: { promptTokens: number; completionTokens: number }): void {
    const durationMs = Date.now() - this.stepStart
    const tokens: TokenUsage = { input: usage.promptTokens, output: usage.completionTokens, cached: 0 }

    this.totalTokens.input += tokens.input
    this.totalTokens.output += tokens.output

    traceStore.insertStep({
      operationId: this.operationId,
      stepIndex: this.stepIndex++,
      type: 'call_llm',
      durationMs,
      tokens,
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
    const cost = estimateCost(this.totalTokens, this.provider)

    traceStore.finishOperation(
      this.operationId,
      status,
      this.stepIndex,
      totalDuration,
      this.totalTokens,
      cost,
      status === 'error' ? this.lastError : null,
    )

    return this.operationId
  }
}

function estimateCost(tokens: TokenUsage, provider: ProviderName): number {
  const rates: Record<string, { input: number; output: number }> = {
    deepseek: { input: 0.14 / 1e6, output: 0.28 / 1e6 },
    openai: { input: 2.5 / 1e6, output: 15 / 1e6 },
    anthropic: { input: 3 / 1e6, output: 15 / 1e6 },
  }
  const rate = rates[provider] ?? rates.deepseek
  return tokens.input * rate.input + tokens.output * rate.output
}
