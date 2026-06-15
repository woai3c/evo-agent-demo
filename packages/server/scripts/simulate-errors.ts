// Simulate multiple users hitting the agent with various requests,
// injecting errors to quickly accumulate trace data for demonstrating Self-Evolving.
// Run: pnpm simulate
import 'dotenv/config'
import { nanoid } from 'nanoid'

import { db } from '../src/db/index.js'

const PROVIDERS = ['deepseek', 'openai', 'anthropic', 'alibaba', 'zhipu', 'moonshotai'] as const
const USERS = ['demo-user-1', 'demo-user-2', 'demo-user-3']

interface SimulatedTrace {
  status: 'success' | 'error'
  provider: (typeof PROVIDERS)[number]
  model: string
  steps: number
  durationMs: number
  tokensIn: number
  tokensOut: number
  error?: { type: string; code: number | null; message: string; toolName?: string }
}

function randomChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function generateTraces(count: number): SimulatedTrace[] {
  const traces: SimulatedTrace[] = []

  for (let i = 0; i < count; i++) {
    const provider = randomChoice(PROVIDERS)
    const modelMap: Record<string, string[]> = {
      deepseek: ['deepseek-v4-flash'],
      openai: ['gpt-5.4-mini', 'gpt-5.4'],
      anthropic: ['claude-sonnet-4-6'],
      alibaba: ['qwen-max', 'qwen-plus'],
      zhipu: ['glm-4-plus', 'glm-4-flash'],
      moonshotai: ['kimi-k2.5'],
    }
    const model = randomChoice(modelMap[provider] ?? ['unknown'])

    const isError = Math.random() < 0.35

    if (isError) {
      const errorType = randomChoice([
        { type: 'rate_limit', code: 429, message: 'Rate limit exceeded. Please retry after 60s' },
        { type: 'rate_limit', code: 429, message: 'Too many requests, please slow down' },
        { type: 'auth', code: 401, message: 'Invalid API key provided' },
        { type: 'auth', code: 403, message: 'API key quota exceeded' },
        { type: 'timeout', code: null, message: 'Request timed out after 30000ms' },
        { type: 'timeout', code: 504, message: 'Gateway timeout' },
        { type: 'provider_error', code: 500, message: 'Internal server error' },
        { type: 'provider_error', code: 503, message: 'Service temporarily unavailable' },
        { type: 'context_overflow', code: 400, message: 'Maximum context length exceeded' },
        {
          type: 'schema',
          code: 400,
          message: `Invalid parameter: messages[0].content must be a string, got ${typeof undefined}`,
        },
        { type: 'tool_error', code: null, message: 'SQL error: no such table: nonexistent', toolName: 'dbQuery' },
        { type: 'tool_error', code: null, message: 'Execution timed out after 5000ms', toolName: 'codeRunner' },
        { type: 'tool_error', code: null, message: 'HTTP 403 Forbidden', toolName: 'webFetch' },
        { type: 'tool_error', code: null, message: 'File not found: report.pdf', toolName: 'readFile' },
        { type: 'tool_error', code: null, message: 'Search API error: 429 Rate limit', toolName: 'webSearch' },
      ])

      traces.push({
        status: 'error',
        provider,
        model,
        steps: randomInt(1, 4),
        durationMs: randomInt(500, 15000),
        tokensIn: randomInt(200, 5000),
        tokensOut: randomInt(10, 500),
        error: { ...errorType, toolName: errorType.toolName },
      })
    } else {
      traces.push({
        status: 'success',
        provider,
        model,
        steps: randomInt(2, 10),
        durationMs: randomInt(1000, 30000),
        tokensIn: randomInt(500, 15000),
        tokensOut: randomInt(50, 3000),
      })
    }
  }

  return traces
}

function insertTraces(traces: SimulatedTrace[]) {
  const insertOp = db.prepare(
    `INSERT INTO operations (operation_id, user_id, model, provider, status, total_steps, total_duration, total_tokens, cost, error_summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-' || ? || ' minutes'))`,
  )

  const insertStep = db.prepare(
    `INSERT INTO steps (step_id, operation_id, step_index, type, duration_ms, tokens, tool_name, tool_success, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-' || ? || ' minutes'))`,
  )

  const insertError = db.prepare(
    `INSERT INTO errors (error_id, operation_id, step_id, provider, error_type, status_code, message, tool_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-' || ? || ' minutes'))`,
  )

  db.transaction(() => {
    traces.forEach((trace, i) => {
      const opId = `op_sim_${nanoid()}`
      const userId = randomChoice(USERS)
      const minutesAgo = traces.length - i
      const tokens = JSON.stringify({ input: trace.tokensIn, output: trace.tokensOut, cached: 0 })
      const cost = trace.tokensIn * 0.000001 + trace.tokensOut * 0.000003

      insertOp.run(
        opId,
        userId,
        trace.model,
        trace.provider,
        trace.status,
        trace.steps,
        trace.durationMs,
        tokens,
        cost,
        trace.error?.message ?? null,
        minutesAgo,
      )

      for (let s = 0; s < trace.steps; s++) {
        const stepId = `step_sim_${nanoid()}`
        const isLastStep = s === trace.steps - 1
        const isToolStep = s % 2 === 1 && s < trace.steps - 1
        const stepType = isToolStep ? 'call_tool' : 'call_llm'
        const stepDuration = Math.floor(trace.durationMs / trace.steps)
        const stepTokens =
          stepType === 'call_llm'
            ? JSON.stringify({
                input: Math.floor(trace.tokensIn / Math.ceil(trace.steps / 2)),
                output: Math.floor(trace.tokensOut / Math.ceil(trace.steps / 2)),
                cached: 0,
              })
            : null

        const hasError = isLastStep && trace.error
        const toolName = isToolStep
          ? randomChoice(['webSearch', 'dbQuery', 'codeRunner', 'webFetch'])
          : (hasError?.toolName ?? null)
        const stepError = hasError
          ? JSON.stringify({
              code: trace.error!.type,
              message: trace.error!.message,
              providerStatus: trace.error!.code,
            })
          : null

        insertStep.run(
          stepId,
          opId,
          s,
          stepType,
          stepDuration,
          stepTokens,
          hasError?.toolName ?? (isToolStep ? toolName : null),
          isToolStep ? (hasError ? 0 : 1) : null,
          stepError,
          minutesAgo,
        )

        if (hasError) {
          insertError.run(
            `err_sim_${nanoid()}`,
            opId,
            stepId,
            trace.provider,
            trace.error!.type,
            trace.error!.code,
            trace.error!.message,
            trace.error!.toolName ?? null,
            minutesAgo,
          )
        }
      }
    })
  })()
}

const count = Number(process.argv[2]) || 100
console.log(`Simulating ${count} agent operations...`)

const traces = generateTraces(count)
insertTraces(traces)

const successCount = traces.filter((t) => t.status === 'success').length
const errorCount = traces.filter((t) => t.status === 'error').length

console.log(`Done: ${successCount} success, ${errorCount} errors`)
console.log(`Error types:`)
const errorTypes = new Map<string, number>()
traces
  .filter((t) => t.error)
  .forEach((t) => {
    const key = `${t.error!.type} (${t.provider})`
    errorTypes.set(key, (errorTypes.get(key) ?? 0) + 1)
  })
for (const [key, count] of [...errorTypes.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${key}: ${count}`)
}
