// Simulate multiple users chatting with the agent to accumulate real trace data.
// Requires the server to be running (pnpm dev:server).
// Run: pnpm simulate [count]          — send real conversations (calls LLM API, costs tokens)
//      pnpm simulate --mock [count]   — insert mock trace data (no API calls, free)
//      pnpm simulate --errors [count] — send only error-triggering prompts (real mode)
import { config } from 'dotenv'
import { nanoid } from 'nanoid'

import { resolve } from 'node:path'

import { db } from '../src/db/index.js'

config({ path: resolve(import.meta.dirname, '../../../.env') })

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000'
const args = process.argv.slice(2)
const mockMode = args.includes('--mock')
const errorsMode = args.includes('--errors')
const count = Number(args.find((a) => /^\d+$/.test(a))) || (mockMode ? 100 : 10)

// ── Prompt Pool ──

interface SimPrompt {
  userId: string
  message: string
  category: string
}

const USERS = ['user']

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
  // reliably error-triggering — explicit instructions the agent executes verbatim, so the tool always fails
  { message: '执行这条 SQL 并把结果给我：SELECT * FROM nonexistent_table_xyz', category: 'db-error' },
  { message: '抓取一下 http://127.0.0.1:8080/internal 的页面内容', category: 'tool-error' },
  { message: '帮我抓取 https://no-such-domain-evo-demo-xyz.invalid 的内容并总结', category: 'tool-error' },
  { message: '读取 uploads 目录里的 nonexistent-report-xyz.txt 文件内容', category: 'tool-error' },
  { message: '运行这段 JS 并告诉我结果：const os = require("os"); os.platform()', category: 'code-error' },
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

const ERROR_CATEGORIES = new Set(['db-error', 'code-error', 'tool-error'])

function pickPrompts(n: number): SimPrompt[] {
  const pool = errorsMode ? PROMPTS.filter((p) => ERROR_CATEGORIES.has(p.category)) : PROMPTS
  const result: SimPrompt[] = []
  const shuffled = [...pool].sort(() => Math.random() - 0.5)
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

const MOCK_RESPONSE_MAP: Record<string, string> = {
  // db-query
  '查一下 Chinook 数据库里哪个艺术家的专辑最多？列出前 10 名':
    '根据 Chinook 数据库查询结果，专辑最多的前 10 位艺术家如下：\n\n| 排名 | 艺术家 | 专辑数 |\n|------|--------|--------|\n| 1 | Iron Maiden | 21 |\n| 2 | Led Zeppelin | 14 |\n| 3 | Deep Purple | 11 |\n| 4 | Metallica | 10 |\n| 5 | U2 | 10 |\n| 6 | Ozzy Osbourne | 6 |\n| 7 | Pearl Jam | 5 |\n| 8 | Faith No More | 4 |\n| 9 | Foo Fighters | 4 |\n| 10 | Various Artists | 4 |',
  '统计一下每个音乐流派的歌曲数量，按数量降序排列':
    '各流派歌曲数量统计如下：\n\n| 流派 | 歌曲数 |\n|------|--------|\n| Rock | 1297 |\n| Latin | 579 |\n| Metal | 374 |\n| Alternative & Punk | 332 |\n| Jazz | 130 |\n| Blues | 81 |\n| Classical | 74 |\n| R&B/Soul | 61 |\n| Reggae | 58 |\n| Pop | 48 |',
  '帮我查一下 2009 年的销售总额是多少':
    '查询结果显示，2009 年的销售总额为 **$449.46**。\n\n这是通过汇总 2009 年所有 invoice 的 total 字段得出的。如果需要按月或按客户细分，请告诉我。',
  '哪个客户消费金额最高？显示姓名和总金额':
    "消费金额最高的客户是 **Helena Holý**（捷克），总消费金额为 **$49.62**。\n\n紧随其后的是：\n- Richard Cunningham — $47.62\n- Luis Rojas — $46.62\n- Hugh O'Brien — $45.62\n- Ladislav Kovács — $45.62",
  '查一下 tracks 表里时长超过 10 分钟的歌曲有哪些':
    '时长超过 10 分钟（600,000 毫秒）的歌曲共有 **34 首**，以下是最长的几首：\n\n| 歌曲名 | 时长 |\n|--------|------|\n| Occupation / Precipice | 88:25 |\n| Through a Looking Glass | 51:26 |\n| The Duel | 45:09 |\n| Battlestar Galactica, Pt. 3 | 42:48 |\n| Hero | 40:06 |',

  // db-error
  '帮我从 orders 表查一下最近的订单':
    '抱歉，查询时遇到了错误：**no such table: orders**\n\nChinook 数据库中没有 `orders` 表。可用的表有：`invoices`（发票）、`invoice_items`（发票明细）、`customers`（客户）等。\n\n如果你想查订单信息，可以试试：「查一下最近的 invoices 记录」',
  '查询 products 表里价格最高的商品':
    '抱歉，查询时遇到了错误：**no such table: products**\n\nChinook 是一个音乐商店数据库，没有 `products` 表。相关的表是 `tracks`（曲目），其中有 `unit_price` 字段。\n\n你可以试试：「查一下 tracks 表里单价最高的曲目」',
  '执行这条 SQL 并把结果给我：SELECT * FROM nonexistent_table_xyz':
    '查询执行失败：**no such table: nonexistent_table_xyz**\n\n该表在数据库中不存在。可用的表包括：artists, albums, tracks, genres, media_types, playlists, playlist_track, employees, customers, invoices, invoice_items。',

  // web-search
  '搜索一下 2026 年最新的 AI Agent 框架有哪些':
    '根据搜索结果，2026 年主流的 AI Agent 框架包括：\n\n1. **LangGraph** — LangChain 团队推出的有状态多 Agent 编排框架，支持循环和分支\n2. **CrewAI** — 多 Agent 协作框架，角色扮演模式\n3. **AutoGen** — 微软的多 Agent 对话框架\n4. **Vercel AI SDK** — 轻量级，面向 Web 的 Agent 工具链\n5. **Claude Agent SDK** — Anthropic 推出的 Agent 构建套件\n\n趋势上看，多 Agent 协作和工具编排成为主流方向。',
  '帮我搜索 TypeScript 5.6 有什么新特性':
    '根据搜索结果，TypeScript 5.6 主要新特性包括：\n\n1. **Disallowed Nullish and Truthy Checks** — 禁止对总是 truthy 的表达式做空值检查\n2. **Iterator Helper Methods** — 迭代器增加 `.map()`、`.filter()` 等链式方法\n3. **Arbitrary Module Identifiers** — 支持任意模块标识符\n4. **--noUncheckedSideEffectImports** — 检查副作用导入是否存在\n5. **Region-Prioritized Diagnostics** — 编辑器优先报告当前可见区域的诊断信息',
  'Hono 框架和 Express 的性能对比':
    '根据搜索结果和基准测试数据：\n\n| 指标 | Hono | Express |\n|------|------|--------|\n| 请求/秒 (RPS) | ~120,000 | ~15,000 |\n| 延迟 (p99) | ~0.5ms | ~3ms |\n| 内存占用 | ~30MB | ~80MB |\n| 包体积 | ~14KB | ~200KB+ |\n\nHono 的性能优势主要来自基于 Trie 的路由器和零依赖设计。Express 胜在生态成熟、中间件丰富。Hono 还原生支持 Edge Runtime（Cloudflare Workers、Deno Deploy 等）。',

  // code
  '用 JavaScript 计算斐波那契数列前 20 项':
    '代码执行完成，前 20 项斐波那契数列如下：\n\n```\n1, 1, 2, 3, 5, 8, 13, 21, 34, 55,\n89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765\n```\n\n第 20 项是 **6765**。如果需要更多项或者要递归/迭代的实现代码，请告诉我。',
  '写一段代码生成一个 10x10 的乘法表':
    '代码执行完成，生成的 10×10 乘法表如下：\n\n```\n×  |  1   2   3   4   5   6   7   8   9  10\n---|----------------------------------------\n 1 |  1   2   3   4   5   6   7   8   9  10\n 2 |  2   4   6   8  10  12  14  16  18  20\n 3 |  3   6   9  12  15  18  21  24  27  30\n 4 |  4   8  12  16  20  24  28  32  36  40\n 5 |  5  10  15  20  25  30  35  40  45  50\n 6 |  6  12  18  24  30  36  42  48  54  60\n 7 |  7  14  21  28  35  42  49  56  63  70\n 8 |  8  16  24  32  40  48  56  64  72  80\n 9 |  9  18  27  36  45  54  63  72  81  90\n10 | 10  20  30  40  50  60  70  80  90 100\n```',
  '帮我写个函数把驼峰命名转成蛇形命名，并测试几个例子':
    '函数编写并测试完成：\n\n```js\nfunction camelToSnake(str) {\n  return str.replace(/[A-Z]/g, m => \'_\' + m.toLowerCase());\n}\n```\n\n测试结果：\n- `camelToSnake("helloWorld")` → `"hello_world"` ✓\n- `camelToSnake("getUserName")` → `"get_user_name"` ✓\n- `camelToSnake("XMLParser")` → `"_x_m_l_parser"` ✓\n- `camelToSnake("simple")` → `"simple"` ✓',

  // code-error
  '帮我跑一段代码：const fs = require("fs"); fs.readFileSync("/etc/passwd")':
    '代码执行失败：**require is not defined**\n\n代码运行在受限的沙箱环境（node:vm）中，无法使用 `require()` 导入 Node.js 核心模块。这是出于安全考虑，防止访问文件系统。\n\n沙箱支持纯 JavaScript 运算、数据处理和格式化等操作。',
  '运行这段 JS 并告诉我结果：const os = require("os"); os.platform()':
    '代码执行失败：**require is not defined**\n\n沙箱环境不支持 `require()` 和 Node.js 内置模块。`os.platform()` 等系统级 API 在沙箱中不可用。\n\n如果你想知道服务器的操作系统信息，我可以直接告诉你。',

  // tool-error
  '抓取一下 http://127.0.0.1:8080/internal 的页面内容':
    '抓取失败：**connect ECONNREFUSED 127.0.0.1:8080**\n\n无法连接到 `127.0.0.1:8080`，该地址没有运行中的服务。请确认：\n1. 目标服务是否已启动\n2. 端口号是否正确\n3. 是否需要使用其他地址',
  '帮我抓取 https://no-such-domain-evo-demo-xyz.invalid 的内容并总结':
    '抓取失败：**getaddrinfo ENOTFOUND no-such-domain-evo-demo-xyz.invalid**\n\n域名 `no-such-domain-evo-demo-xyz.invalid` 无法解析，该网站不存在。请检查 URL 是否正确。',
  '读取 uploads 目录里的 nonexistent-report-xyz.txt 文件内容':
    '读取失败：**File not found: nonexistent-report-xyz.txt**\n\n`uploads` 目录中没有名为 `nonexistent-report-xyz.txt` 的文件。请确认文件名是否正确，或先上传该文件。',

  // multi-step
  '搜索一下 Vercel AI SDK 最新版本，然后总结它的主要功能':
    '搜索并总结完成。\n\nVercel AI SDK 最新版本（v4.x）的主要功能：\n\n1. **统一 API** — 一套代码适配 OpenAI、Anthropic、Google 等多个模型提供商\n2. **streamText / generateText** — 流式和一次性文本生成\n3. **Tool Calling** — 内置工具调用支持，自动处理 JSON Schema 验证\n4. **Multi-step Agent Loop** — `maxSteps` 参数实现多轮工具调用循环\n5. **Structured Output** — `generateObject()` 生成符合 Zod schema 的结构化数据\n6. **AI SDK UI** — React hooks（`useChat`、`useCompletion`）快速构建聊天界面\n7. **Middleware** — 请求/响应中间件，支持日志、缓存、guardrails',
  '查一下 Chinook 里各流派的平均歌曲时长，然后用代码画一个简单的 ASCII 柱状图':
    '查询并绘图完成。\n\n各流派平均歌曲时长及 ASCII 柱状图：\n\n```\nScience Fiction █████████████████████████████████████ 46:39\nDrama          ██████████████████████████████████   43:26\nComedy         ████████████████████████████          35:53\nRock           ████                                   5:02\nMetal          ████                                   4:44\nJazz           ███                                    4:20\nBlues          ███                                    4:09\nClassical      ███                                    3:38\nPop            ██                                     3:11\nReggae         ██                                     3:07\n```\n\n注：Science Fiction/Drama/Comedy 时长特别长，因为它们是电视剧集而非音乐曲目。',

  // email
  '帮我给 test@example.com 发一封邮件，主题是"会议提醒"，内容是明天下午 3 点开会':
    '邮件已发送！\n\n- **收件人：** test@example.com\n- **主题：** 会议提醒\n- **内容：** 明天下午 3 点开会\n\n（注：这是模拟发送，邮件已记录但不会实际送达。）',

  // direct
  '你好，请介绍一下你自己':
    '你好！我是 **Evo**，一个多工具 AI 工作助手。\n\n我可以帮你完成以下任务：\n- 🔍 **搜索网页** — 获取实时信息\n- 🗄️ **查询数据库** — 对 Chinook 音乐数据库执行 SQL 查询\n- 💻 **执行代码** — 在安全沙箱中运行 JavaScript\n- 📧 **发送邮件** — 模拟邮件发送\n- 📄 **读取文件** — 读取上传的文档\n\n有什么我可以帮你的吗？',
  '什么是 AI Agent 的 Harness？':
    'AI Agent 的 **Harness**（运行框架）是指围绕 LLM 的整套系统基础设施，包括：\n\n1. **Agent Loop** — 控制 LLM 调用、工具执行的主循环\n2. **Tool Dispatch** — 路由和执行工具调用\n3. **Context Management** — 管理对话历史、上下文窗口压缩\n4. **Error Recovery** — 错误处理、重试、降级策略\n5. **Tracing & Observability** — 追踪每一步操作\n\n核心观点是：**需要自我进化的不是 Agent（LLM）本身，而是 Harness。** 通过分析生产环境的 trace 数据，自动发现错误模式并生成修复 PR，实现系统的持续自我改进。',
  '解释一下 RAG 和 Fine-tuning 的区别':
    'RAG 和 Fine-tuning 是两种让 LLM 使用特定领域知识的方式，核心区别：\n\n| | RAG | Fine-tuning |\n|--|-----|-------------|\n| **原理** | 检索外部文档，注入 prompt | 在领域数据上重新训练模型权重 |\n| **知识更新** | 实时（更新文档即可） | 需要重新训练 |\n| **成本** | 低（只需向量数据库） | 高（GPU 训练 + 数据标注） |\n| **适用场景** | 知识库问答、文档搜索 | 风格迁移、专业术语、特定格式 |\n| **幻觉风险** | 较低（有出处可查） | 较高（模型可能编造） |\n\n实际项目中两者常组合使用：Fine-tuning 教模型理解领域术语和回答风格，RAG 提供最新的具体信息。',
}

function buildMockMessages(message: string, category: string): string {
  const response =
    MOCK_RESPONSE_MAP[message] ??
    MOCK_RESPONSE_MAP[Object.keys(MOCK_RESPONSE_MAP).find((k) => message.startsWith(k.slice(0, 20))) ?? ''] ??
    `根据你的问题「${message.slice(0, 30)}…」，以下是处理结果。`
  return JSON.stringify([
    { role: 'user', content: message },
    { role: 'assistant', content: response },
  ])
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

  const insertConv = db.prepare(
    `INSERT INTO conversations (conversation_id, user_id, title, model, provider, messages, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-' || ? || ' minutes'))`,
  )
  const insertOp = db.prepare(
    `INSERT INTO operations (operation_id, conversation_id, user_id, model, provider, status, total_steps, total_duration, total_tokens, cost, error_summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-' || ? || ' minutes'))`,
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

      // Give each mock operation a realistic source conversation so the admin
      // UI shows the user's question instead of a meaningless operation id.
      const prompt = randomChoice(PROMPTS)
      const convId = `conv_sim_${nanoid()}`
      const mockMessages = buildMockMessages(prompt.message, prompt.category)
      insertConv.run(convId, userId, prompt.message.slice(0, 50), model, provider, mockMessages, minutesAgo)

      insertOp.run(
        opId,
        convId,
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
