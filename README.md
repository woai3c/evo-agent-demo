# Evo — 会自我进化的 AI Agent Harness Demo

一个多工具 AI 工作助手，内置 **Operation Tracing**、**Error Pattern 自动识别** 和 **LLM 驱动的自动巡检** —— 演示 AI Agent Harness 如何通过生产数据实现自我进化。

## 快速开始

> **建议先 Fork 本仓库，再克隆你自己的 Fork。** 自动修复（`pnpm autofix`）会通过 `gh` 向 `origin` 远程**真实创建 PR**——直接克隆原仓库的话 `origin` 指向本项目，你的测试 PR 会提到这里来；Fork 后 `origin` 指向你自己的仓库，PR 就落在你的 Fork 上。

```bash
git clone https://github.com/<your-username>/evo-agent-demo   # 换成你 Fork 后的仓库地址
cd evo-agent-demo
pnpm install
cp .env.example .env          # 填入至少一个 LLM API Key
pnpm db:seed                  # 填充 Chinook 演示数据
pnpm build                    # 构建所有包
pnpm start                    # 启动 server (3000)，不监听文件变更
pnpm dev:web                  # 另开终端，启动前端 (5173)
```

打开 http://localhost:5173 即可开始对话——**每次对话都会自动产生 Trace**，在管理面板 `/admin` 就能看到对应的操作、步骤、错误等数据。

> **启动方式怎么选**：要演示自动修复（`pnpm autofix` 会修改源码文件）时，用上面的 `pnpm build` + `pnpm start`——server 不监听文件，不会被改动触发重启；纯开发、不跑 autofix 时，直接 `pnpm dev` 一条命令同时起 server + 前端（tsx watch 自动重载）更方便。

## 演示：Self-Evolving 完整闭环

下面用 `--mock`（直接插构造数据，**不启 server、不调 LLM**）快速看收敛效果；除真实 `simulate` 外，其余命令都不需要 server 在跑。

```bash
# 1. 注入 mock 流量（含 ~35% 错误）—— 不需要 server
pnpm simulate --mock

# 2. 巡检：分析未匹配错误，自动生成 Pattern —— 不需要 server（调 LLM API）
pnpm inspect

# 3. 打开管理面板查看巡检结果
#    http://localhost:5173/admin

# 4. 重复执行，观察收敛效果（新增 Pattern → 0，覆盖率 → 100%）
pnpm simulate --mock && pnpm inspect

# 5. 自动修复：为 harness_bug / critical 行为自动生成 fix PR —— PR 提交到你的 origin（务必先 Fork！需 gh CLI 已登录）
pnpm autofix
```

这就是核心演示闭环：模拟流量 → 产生错误 → 巡检发现 Pattern → 覆盖率上升 → Harness 缺陷自动提 PR 修复。

> **想演示真正的 Agent 执行**（真实 LLM 回复 + 真实工具调用）：把第 1 步换成在 `/` 页面**手动对话**，或 `pnpm simulate`（真实跑，**需 server 在跑** + 调 API）。`--mock` 只是零成本快速铺数据看收敛；要展示"会自我进化的 AI Agent 产品"本身，请用真实模式。

## 架构

pnpm monorepo，三个包：

```
packages/
  shared/    @evo/shared    TypeScript 类型定义（无运行时依赖）
  server/    @evo/server    Hono + Node.js：Agent 循环、工具、Tracing、进化引擎
  web/       @evo/web       Vite + React：对话界面 + 管理面板
```

### 服务端子系统

| 子系统     | 路径         | 职责                                                                      |
| ---------- | ------------ | ------------------------------------------------------------------------- |
| Agent Loop | `agent/`     | 核心执行引擎 — streamText + maxSteps，工具调度                            |
| 工具（×6） | `tools/`     | webSearch、webFetch、readFile、codeRunner、dbQuery、sendEmail             |
| 供应商     | `providers/` | DeepSeek、OpenAI、Anthropic、Alibaba (Qwen)、Zhipu (GLM)、Moonshot (Kimi) |
| Tracing    | `tracing/`   | 嵌入式追踪器（run step = trace event）、脱敏、SQLite 持久化               |
| 进化引擎   | `evolution/` | 错误分桶、Pattern 匹配、巡检 Agent、自动修复流水线                        |
| 上下文     | `context/`   | 消息压缩、工具结果截断                                                    |

### 技术栈

- **LLM 接入**：Vercel AI SDK（DeepSeek / OpenAI / Anthropic / Alibaba Qwen / Zhipu GLM / Moonshot Kimi）
- **后端**：Hono + Node.js + better-sqlite3（零配置）
- **前端**：React 19 + Tailwind CSS + Recharts
- **语言**：TypeScript（ESM）

## 可用命令

```bash
# 推荐启动方式（server 不监听文件，autofix 安全）
pnpm build              # 构建所有包
pnpm start              # 启动 server（不监听文件变更）
pnpm dev:web            # 另开终端，启动前端（Vite HMR）

# 开发模式（仅在不涉及 autofix 时使用）
pnpm dev                # 同时启动 server + web（tsx watch，文件变更自动重启）
pnpm dev:server         # 仅启动 server（tsx watch）

# 代码质量
pnpm typecheck          # 全量类型检查
pnpm lint               # ESLint 检查 + 自动修复
pnpm format             # Prettier 格式化

# 数据与演示
pnpm db:seed            # 填充 Chinook 演示数据
pnpm simulate           # 发送真实对话到 server（需先启动 server，调用 LLM API，默认 10 条）
pnpm simulate 20        # 发送 20 轮对话
pnpm simulate --mock    # 直接往数据库插入 mock trace 数据（不需要启动 server，不调用 API，默认 100 条）
pnpm simulate --mock 50 # 插入 50 条 mock trace
pnpm simulate --errors  # 只发送会触发错误的 prompt（真实模式，制造失败数据用）
pnpm inspect            # 巡检：错误模式识别 + 行为分析（不需 server，调用 LLM API）
pnpm autofix            # 自动修复：为 harness bug 自动生成 fix PR（不需 server，需 gh CLI 已登录）
```

## 环境变量

| 变量                 | 必填       | 默认值              | 说明                                               |
| -------------------- | ---------- | ------------------- | -------------------------------------------------- |
| `DEEPSEEK_API_KEY`   | 至少填一个 | —                   | DeepSeek API Key                                   |
| `OPENAI_API_KEY`     | —          | —                   | OpenAI API Key                                     |
| `ANTHROPIC_API_KEY`  | —          | —                   | Anthropic API Key                                  |
| `ALIBABA_API_KEY`    | —          | —                   | Alibaba Qwen (通义千问) API Key                    |
| `ZHIPU_API_KEY`      | —          | —                   | Zhipu GLM (智谱) API Key                           |
| `MOONSHOT_API_KEY`   | —          | —                   | Moonshot Kimi (月之暗面) API Key                   |
| `TAVILY_API_KEY`     | —          | —                   | Tavily Web Search API Key                          |
| `DEFAULT_PROVIDER`   | —          | `deepseek`          | 巡检/自动修复的兜底供应商                          |
| `DEFAULT_MODEL`      | —          | `deepseek-v4-flash` | 巡检/自动修复的兜底模型                            |
| `INSPECTOR_PROVIDER` | —          | —                   | 巡检/自动修复专用供应商（优先于 DEFAULT_PROVIDER） |
| `INSPECTOR_MODEL`    | —          | —                   | 巡检/自动修复专用模型（优先于 DEFAULT_MODEL）      |
| `PORT`               | —          | `3000`              | 服务端端口                                         |
| `DB_PATH`            | —          | `./data/evo.db`     | SQLite 数据库路径                                  |

对话默认使用 DeepSeek（硬编码在 `packages/shared/src/constants.ts`），前端可切换供应商。巡检和自动修复的模型优先级：`INSPECTOR_*` → `DEFAULT_*` → 硬编码兜底值。

## `pnpm simulate` vs `pnpm simulate --mock`

|                     | `pnpm simulate`                                                          | `pnpm simulate --mock`                                                                       |
| ------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **做什么**          | 从 prompt 池中随机选取问题，通过 HTTP 发送到 server，触发真实 Agent 执行 | 直接往 SQLite 插入构造的 trace 数据（operations + steps + errors）                           |
| **需要启动 server** | 是                                                                       | 否                                                                                           |
| **调用 LLM API**    | 是（消耗 token，产生费用）                                               | 否（零成本）                                                                                 |
| **默认条数**        | 10                                                                       | 100                                                                                          |
| **产生的数据**      | 真实的 Agent 执行 trace，包含完整的 LLM 回复和工具返回                   | 模拟的 trace 数据，有合理的 token 用量和错误分布（约 35% 错误率），但不含真实的 LLM 回复内容 |
| **适用场景**        | 测试完整的 Agent 执行链路                                                | 快速积累 trace 数据以演示巡检和 Pattern 收敛效果                                             |

推荐先用 `--mock` 跑一遍完整的巡检流程看效果，再用不带 `--mock` 的模式测试真实 Agent 执行。

## 核心概念

- **Harness**：包裹 LLM 的运行时 —— Agent 循环、工具、上下文管理、错误恢复。它不是 Agent 本身，而是让 Agent 稳定运行的基础设施。
- **Tracing 是一等公民**：每一步 Agent 执行自动产生 trace event。如果某一步没有 trace，说明代码有 bug，而不是 trace 没注册。
- **Self-Evolving**：两阶段巡检流水线。**Phase 1**（错误模式识别）：从聚合 trace 中自动发现错误模式，分类为用户侧错误 / 供应商侧错误 / Harness 缺陷，并自动修复（Pattern 入库 + 历史错误回扫；Harness 缺陷自动生成 fix PR）。**Phase 2**（行为分析）：对 operation 做语义聚类，按 5 个维度评估健康度，为不健康行为生成改进建议。

## Self-Evolving 三个层次

| 层次          | 人做什么             | Agent 做什么               | Demo 覆盖    |
| ------------- | -------------------- | -------------------------- | ------------ |
| L1 纯人工     | 看日志、分类、修复   | 无                         | —            |
| L2 Agent 辅助 | 确认 + 决策          | 找出可疑问题               | 初始状态     |
| L3 Agent 主导 | 审查 PR + 高风险决策 | 采集 / 识别 / 修改 / 提 PR | **主要演示** |

## 管理面板

访问 http://localhost:5173/admin ，左侧边栏导航：

- **概览**：执行次数、成功率、P95 延迟、Pattern 覆盖率
- **Trace 浏览器**：操作列表，点击展开步骤时间线（含完整 LLM 回复和工具返回）
- **错误分析**：按供应商 × 类型分桶，Top 未匹配错误
- **Pattern 库**：已发现的 Pattern、匹配规则、命中次数、fix_status 管理
- **巡检记录**：每轮巡检详情、费用、发现的 Harness 缺陷
- **行为分析**：语义聚类 + 5 维健康度评估 + 改进建议
- **进化趋势**：成功率曲线、未匹配率下降曲线、Pattern 增长曲线

## 许可证

[MIT](./LICENSE)
