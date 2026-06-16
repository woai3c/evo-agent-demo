// Simulate multiple users chatting with the agent to accumulate real trace data.
// Requires the server to be running (pnpm dev:server).
// Run: pnpm simulate [count]        — send real conversations (calls LLM API, costs tokens)
//      pnpm simulate --mock [count] — insert mock trace data (no API calls, free)
import { config } from 'dotenv'
import { nanoid } from 'nanoid'

import { resolve } from 'node:path'

import { db } from '../src/db/index.js'

config({ path: resolve(import.meta.dirname, '../../../.env') })

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000'
const args = process.argv.slice(2)
const mockMode = args.includes('--mock')
const count = Number(args.find((a) => /^\d+$/.test(a))) || (mockMode ? 100 : 10)

// ── Prompt Pool ──

interface SimPrompt {
  userId: string
  message: string
  category: string
}

const USERS = ['sim-alice', 'sim-bob', 'sim-charlie']

const PROMPTS: { message: string; category: string }[] = [
  // dbQuery
  { message: '查一下 Chinook 数据库里哪个艺术家的专辑最多？列出前 10 名', category: 'db-query' },
  { message: '统计一下每个音乐流派的歌曲数量，按数量降序排列', category: 'db-query' },
  { message: '帮我查一下 2009 年的销售总额是多少', category: 'db-query' },
  { message: '哪个客户消费金额最高？显示姓名和总金额', category: 'db-query' },
  { message: '查一下 tracks 表里时长超过 10 分钟的歌曲有哪些', category: 'db-query' },
  // dbQuery — designed to trigger errors
  { message: '帮我从 orders 表查一下最近的订单', category: 'db-error' },
  { message: '查询 products 表里价格最高的商品', category: 'db-error' },
  // webSearch
  { message: '搜索一下 2026 年最新的 AI Agent 框架有哪些', category: 'web-search' },
  { message: '帮我搜索 TypeScript 5.6 有什么新特性', category: 'web-search' },
  { message: 'Hono 框架和 Express 的性能对比', category: 'web-search' },
  // codeRunner
  { message: '用 JavaScript 计算斐波那契数列前 20 项', category: 'code' },
  { message: '写一段代码生成一个 10x10 的乘法表', category: 'code' },
  { message: '帮我写个函数把驼峰命名转成蛇形命名，并测试几个例子', category: 'code' },
  // codeRunner — designed to trigger errors
  { message: '帮我跑一段代码：const fs = require("fs"); fs.readFileSync("/etc/passwd")', category: 'code-error' },
  // multi-step
  { message: '搜索一下 Vercel AI SDK 最新版本，然后总结它的主要功能', category: 'multi-step' },
  { message: '查一下 Chinook 里各流派的平均歌曲时长，然后用代码画一个简单的 ASCII 柱状图', category: 'multi-step' },
  // sendEmail
  { message: '帮我给 test@example.com 发一封邮件，主题是"会议提醒"，内容是明天下午 3 点开会', category: 'email' },
  // direct answer (no tools)
  { message: '你好，请介绍一下你自己', category: 'direct' },
  { message: '什么是 AI Agent 的 Harness？', category: 'direct' },
  { message: '解释一下 RAG 和 Fine-tuning 的区别', category: 'direct' },
]

function randomChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function pickPrompts(n: number): SimPrompt[] {
  const result: SimPrompt[] = []
  const shuffled = [...PROMPTS].sort(() => Math.random() - 0.5)
  for (let i = 0; i < n; i++) {
    const p = shuffled[i % shuffled.length]
    result.push({ userId: randomChoice(USERS), ...p })
  }
  return result
}

// ── Real Mode: call the chat API ──

async function consumeSSE(response: Response): Promise<{ conversationId: string; status: string; error?: string }> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let conversationId = ''
  let status = 'success'
  let error: string | undefined

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    let currentEvent = ''
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
      } else if (line.startsWith('data: ')) {
        const data = line.slice(6)
        try {
          const parsed = JSON.parse(data)
          if (currentEvent === 'conversation') conversationId = parsed.conversationId
          if (currentEvent === 'error' || parsed.type === 'error') {
            status = 'error'
            error = parsed.message ?? data
          }
        } catch {
          /* ignore non-JSON lines */
        }
        currentEvent = ''
      }
    }
  }

  return { conversationId, status, error }
}

async function runReal(prompts: SimPrompt[]) {
  // Check server is running
  try {
    await fetch(`${SERVER_URL}/api/dashboard/overview`)
  } catch {
    console.error(`Error: Server is not running at ${SERVER_URL}`)
    console.error('Start the server first: pnpm dev:server')
    process.exit(1)
  }

  console.log(`Sending ${prompts.length} real conversations to ${SERVER_URL} ...`)
  console.log('(This calls the LLM API and costs tokens)\n')

  let success = 0
  let errors = 0
  const categories = new Map<string, { total: number; ok: number }>()

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i]
    const tag = `[${i + 1}/${prompts.length}]`
    const cat = categories.get(p.category) ?? { total: 0, ok: 0 }
    cat.total++
    categories.set(p.category, cat)

    process.stdout.write(`${tag} ${p.userId} | ${p.category} | "${p.message.slice(0, 40)}..." `)

    try {
      const res = await fetch(`${SERVER_URL}/api/chat/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: p.userId, message: p.message }),
      })

      if (!res.ok || !res.body) {
        console.log(`✗ HTTP ${res.status}`)
        errors++
        continue
      }

      const result = await consumeSSE(res)

      if (result.status === 'error') {
        console.log(`✗ ${result.error?.slice(0, 60)}`)
        errors++
      } else {
        console.log(`✓`)
        success++
        cat.ok++
      }
    } catch (err) {
      console.log(`✗ ${err instanceof Error ? err.message : String(err)}`)
      errors++
    }
  }

  console.log(`\nDone: ${success} success, ${errors} errors`)
  console.log('\nBy category:')
  for (const [cat, stats] of [...categories.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${cat}: ${stats.ok}/${stats.total} success`)
  }
}

// ── Mock Mode: direct DB insert (legacy, no API calls) ──

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function runMock(n: number) {
  console.log(`Inserting ${n} mock traces (no API calls)...`)

  const PROVIDERS = ['deepseek', 'openai', 'anthropic'] as const
  const modelMap: Record<string, string> = {
    deepseek: 'deepseek-v4-flash',
    openai: 'gpt-5.4-mini',
    anthropic: 'claude-sonnet-4-6',
  }
  const ERROR_TYPES = [
    { type: 'rate_limit', code: 429, message: 'Rate limit exceeded. Please retry after 60s' },
    { type: 'rate_limit', code: 429, message: 'Too many requests, please slow down' },
    { type: 'auth', code: 401, message: 'Invalid API key provided' },
    { type: 'auth', code: 403, message: 'API key quota exceeded' },
    { type: 'timeout', code: null as number | null, message: 'Request timed out after 30000ms' },
    { type: 'provider_error', code: 500, message: 'Internal server error' },
    { type: 'provider_error', code: 503, message: 'Service temporarily unavailable' },
    { type: 'context_overflow', code: 400, message: 'Maximum context length exceeded' },
    {
      type: 'tool_error',
      code: null as number | null,
      message: 'SQL error: no such table: nonexistent',
      toolName: 'dbQuery',
    },
    {
      type: 'tool_error',
      code: null as number | null,
      message: 'Execution timed out after 5000ms',
      toolName: 'codeRunner',
    },
    { type: 'tool_error', code: null as number | null, message: 'HTTP 403 Forbidden', toolName: 'webFetch' },
  ]

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

  let successCount = 0
  let errorCount = 0

  db.transaction(() => {
    for (let i = 0; i < n; i++) {
      const provider = randomChoice(PROVIDERS)
      const model = modelMap[provider]
      const isError = Math.random() < 0.35
      const opId = `op_sim_${nanoid()}`
      const userId = randomChoice(USERS)
      const minutesAgo = n - i
      const steps = isError ? randomInt(1, 4) : randomInt(2, 10)
      const durationMs = randomInt(1000, 30000)
      const tokensIn = randomInt(500, 15000)
      const tokensOut = randomInt(50, 3000)
      const tokens = JSON.stringify({ input: tokensIn, output: tokensOut, cached: 0 })
      const cost = tokensIn * 0.000001 + tokensOut * 0.000003
      const error = isError ? randomChoice(ERROR_TYPES) : null

      insertOp.run(
        opId,
        userId,
        model,
        provider,
        isError ? 'error' : 'success',
        steps,
        durationMs,
        tokens,
        cost,
        error?.message ?? null,
        minutesAgo,
      )

      if (isError) errorCount++
      else successCount++

      for (let s = 0; s < steps; s++) {
        const stepId = `step_sim_${nanoid()}`
        const isLastStep = s === steps - 1
        const isToolStep = s % 2 === 1 && s < steps - 1
        const stepType = isToolStep ? 'call_tool' : 'call_llm'
        const stepDuration = Math.floor(durationMs / steps)
        const stepTokens =
          stepType === 'call_llm'
            ? JSON.stringify({
                input: Math.floor(tokensIn / Math.ceil(steps / 2)),
                output: Math.floor(tokensOut / Math.ceil(steps / 2)),
                cached: 0,
              })
            : null
        const hasError = isLastStep && error
        const toolName = isToolStep ? randomChoice(['webSearch', 'dbQuery', 'codeRunner', 'webFetch'] as const) : null
        const stepError = hasError
          ? JSON.stringify({ code: error.type, message: error.message, providerStatus: error.code })
          : null

        insertStep.run(
          stepId,
          opId,
          s,
          stepType,
          stepDuration,
          stepTokens,
          hasError ? ((error as { toolName?: string }).toolName ?? null) : toolName,
          isToolStep ? (hasError ? 0 : 1) : null,
          stepError,
          minutesAgo,
        )

        if (hasError) {
          insertError.run(
            `err_sim_${nanoid()}`,
            opId,
            stepId,
            provider,
            error.type,
            error.code,
            error.message,
            (error as { toolName?: string }).toolName ?? null,
            minutesAgo,
          )
        }
      }
    }
  })()

  console.log(`Done: ${successCount} success, ${errorCount} errors`)
}

// ── Main ──

if (mockMode) {
  runMock(count)
} else {
  const prompts = pickPrompts(count)
  runReal(prompts).catch((err) => {
    console.error('Fatal:', err)
    process.exit(1)
  })
}
