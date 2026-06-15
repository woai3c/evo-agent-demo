# Evo — 会自我进化的 AI Agent Harness Demo

一个多工具 AI 工作助手，内置 **Operation Tracing**、**Error Pattern 自动识别** 和 **LLM 驱动的自动巡检** —— 演示 AI Agent Harness 如何通过生产数据实现自我进化。

## 快速开始

```bash
pnpm install
cp .env.example .env          # 填入至少一个 LLM API Key
pnpm db:seed                  # 填充 Chinook 演示数据 + 演示用户
pnpm dev                      # 同时启动 server (3000) + web (5173)
```

打开 http://localhost:5173 即可开始对话。

## 演示：Self-Evolving 完整闭环

```bash
# 1. 模拟多用户流量（含注入错误）
pnpm simulate

# 2. 运行巡检 Agent，分析未匹配错误并自动生成 Pattern
pnpm inspect

# 3. 打开管理面板查看巡检结果
#    http://localhost:5173/admin

# 4. 重复执行，观察收敛效果（新增 Pattern → 0，覆盖率 → 100%）
pnpm simulate && pnpm inspect
```

这就是本书的核心演示闭环：模拟流量 → 产生错误 → 巡检发现 → 自动修复 → 覆盖率上升。

## 架构

pnpm monorepo，三个包：

```
packages/
  shared/    @evo/shared    TypeScript 类型定义（无运行时依赖）
  server/    @evo/server    Hono + Node.js：Agent 循环、工具、Tracing、进化引擎
  web/       @evo/web       Vite + React：对话界面 + 管理面板
```

### 服务端子系统

| 子系统     | 路径         | 职责                                                          |
| ---------- | ------------ | ------------------------------------------------------------- |
| Agent Loop | `agent/`     | 核心执行引擎 — streamText + maxSteps，工具调度                |
| 工具（×6） | `tools/`     | webSearch、webFetch、readFile、codeRunner、dbQuery、sendEmail |
| 供应商     | `providers/` | DeepSeek V4、OpenAI GPT-5.x、Anthropic Claude 4.x             |
| Tracing    | `tracing/`   | 嵌入式追踪器（run step = trace event）、脱敏、SQLite 持久化   |
| 进化引擎   | `evolution/` | 错误分桶、Pattern 匹配、巡检 Agent、自动修复流水线            |
| 上下文     | `context/`   | 消息压缩、工具结果截断                                        |

### 技术栈

- **LLM 接入**：Vercel AI SDK（DeepSeek / OpenAI / Anthropic）
- **后端**：Hono + Node.js + better-sqlite3（零配置）
- **前端**：React 19 + Tailwind CSS + Recharts
- **语言**：TypeScript（ESM）

## 可用命令

```bash
pnpm dev                # 同时启动 server + web（开发模式）
pnpm dev:server         # 仅启动 server（tsx watch 自动重载）
pnpm dev:web            # 仅启动 web（Vite HMR）
pnpm build              # 构建所有包
pnpm typecheck          # 全量类型检查
pnpm lint               # ESLint 检查 + 自动修复
pnpm format             # Prettier 格式化
pnpm db:seed            # 填充 Chinook 演示数据
pnpm simulate           # 模拟多用户流量（含注入错误）
pnpm inspect            # 触发一轮巡检
```

## 核心概念

- **Harness**：包裹 LLM 的运行时 —— Agent 循环、工具、上下文管理、错误恢复。它不是 Agent 本身，而是让 Agent 稳定运行的基础设施。
- **Tracing 是一等公民**：每一步 Agent 执行自动产生 trace event。如果某一步没有 trace，说明代码有 bug，而不是 trace 没注册。
- **Self-Evolving**：错误模式从聚合 trace 中自动发现，被分类为用户侧错误 / 供应商侧错误 / Harness 缺陷，并由 LLM 驱动的巡检 Agent 自动修复。

## Self-Evolving 四个层次

| 层次          | 人做什么           | Agent 做什么              | Demo 覆盖             |
| ------------- | ------------------ | ------------------------- | --------------------- |
| L1 纯人工     | 看日志、分类、修复 | 无                        | —                     |
| L2 Agent 辅助 | 确认 + 决策        | 找出可疑问题              | 初始状态              |
| L3 Agent 主导 | 审查 + 高风险决策  | 采集 / 识别 / 修改 / 提交 | **主要演示**          |
| L4 Agent 自主 | 设定目标           | 全链路自动 + 自优化       | Context Tuner（胚胎） |

## 管理面板

访问 http://localhost:5173/admin ，左侧边栏导航：

- **概览**：执行次数、成功率、P95 延迟、Pattern 覆盖率
- **Trace 浏览器**：操作列表，点击展开步骤时间线
- **错误分析**：按供应商 × 类型分桶，Top 未匹配错误
- **Pattern 库**：已发现的 Pattern、匹配规则、命中次数
- **巡检记录**：每轮巡检详情、费用、发现的 Harness 缺陷
- **进化趋势**：成功率曲线、未匹配率下降曲线、Pattern 增长曲线

## 许可证

[MIT](./LICENSE)
