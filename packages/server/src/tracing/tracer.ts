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
  private model: string
  private stepIndex = 0
  private operationStart: number
  private stepStart = 0
  private toolCallStart = 0
  private totalTokens: TokenUsage = { input: 0, output: 0, cached: 0 }
  private lastError: string | null = null

  constructor(params: TracerParams) {
    this.operationId = `op_${nanoid()}`
    this.provider = params.provider
    this.model = params.model
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

  onToolResult(
    toolName: string,
    input: Record<string, unknown>,
    success: boolean,
    outputSize: number,
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
    usage: { promptTokens: number; completionTokens: number },
    contextSnapshot?: { totalTokens: number; windowUsagePct: number; compressionTriggered: boolean },
  ): void {
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
    const cost = estimateCost(this.totalTokens, this.provider, this.model)

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

// Per-model pricing in RMB (¥) per million tokens.
// DeepSeek: native CNY pricing — https://api-docs.deepseek.com/quick_start/pricing-details-cny
// OpenAI:   USD pricing × 7.2  — https://developers.openai.com/api/docs/pricing
// Anthropic: USD pricing × 7.2 — https://docs.anthropic.com/en/docs/about-claude/pricing
// Last updated: 2026-06-15
const USD_TO_CNY = 7.2

const MODEL_RATES: Record<string, { input: number; output: number }> = {
  // DeepSeek (¥/M tokens, cache-miss price)
  'deepseek-chat': { input: 2, output: 8 },
  'deepseek-reasoner': { input: 4, output: 16 },
  'deepseek-v4-flash': { input: 2, output: 8 },
  'deepseek-v4-pro': { input: 4, output: 16 },
  // OpenAI (USD × 7.2 → ¥/M tokens)
  'gpt-5.5': { input: 5 * USD_TO_CNY, output: 30 * USD_TO_CNY },
  'gpt-5.4': { input: 2.5 * USD_TO_CNY, output: 15 * USD_TO_CNY },
  'gpt-5.4-mini': { input: 0.75 * USD_TO_CNY, output: 4.5 * USD_TO_CNY },
  'gpt-5.4-nano': { input: 0.2 * USD_TO_CNY, output: 1.25 * USD_TO_CNY },
  'gpt-4o': { input: 2.5 * USD_TO_CNY, output: 10 * USD_TO_CNY },
  'gpt-4o-mini': { input: 0.15 * USD_TO_CNY, output: 0.6 * USD_TO_CNY },
  // Anthropic (USD × 7.2 → ¥/M tokens)
  'claude-sonnet-4-6': { input: 3 * USD_TO_CNY, output: 15 * USD_TO_CNY },
  'claude-sonnet-4-20250514': { input: 3 * USD_TO_CNY, output: 15 * USD_TO_CNY },
  'claude-haiku-4-5': { input: 1 * USD_TO_CNY, output: 5 * USD_TO_CNY },
  'claude-opus-4-5': { input: 5 * USD_TO_CNY, output: 25 * USD_TO_CNY },
  'claude-opus-4-6': { input: 5 * USD_TO_CNY, output: 25 * USD_TO_CNY },
  // Alibaba Qwen (¥/M tokens) — https://help.aliyun.com/zh/model-studio/billing
  'qwen-max': { input: 2, output: 6 },
  'qwen-plus': { input: 0.8, output: 2 },
  'qwen-turbo': { input: 0.3, output: 0.6 },
  'qwen3-max': { input: 2, output: 6 },
  'qwen3-coder-plus': { input: 0.8, output: 2 },
  'qwq-plus': { input: 0.8, output: 2 },
  // Zhipu GLM (¥/M tokens) — https://open.bigmodel.cn/pricing
  'glm-4-plus': { input: 50, output: 50 },
  'glm-4-flash': { input: 0.1, output: 0.1 },
  'glm-4-air': { input: 1, output: 1 },
  // Moonshot Kimi (¥/M tokens) — https://platform.moonshot.cn/docs/pricing
  'kimi-k2.5': { input: 2, output: 8 },
  'moonshot-v1-8k': { input: 12, output: 12 },
  'moonshot-v1-32k': { input: 24, output: 24 },
}

const PROVIDER_FALLBACK: Record<string, { input: number; output: number }> = {
  deepseek: { input: 2, output: 8 },
  openai: { input: 2.5 * USD_TO_CNY, output: 15 * USD_TO_CNY },
  anthropic: { input: 3 * USD_TO_CNY, output: 15 * USD_TO_CNY },
  alibaba: { input: 2, output: 6 },
  zhipu: { input: 1, output: 1 },
  moonshotai: { input: 2, output: 8 },
}

export function estimateCost(tokens: TokenUsage, provider: ProviderName, model: string): number {
  const rate = MODEL_RATES[model] ?? PROVIDER_FALLBACK[provider] ?? PROVIDER_FALLBACK.deepseek
  return (tokens.input * rate.input + tokens.output * rate.output) / 1e6
}
