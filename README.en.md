# Evo — Self-Evolving AI Agent Harness Demo

> Companion project for the ebook "Building Self-Evolving AI Agents". [中文](./README.md)

A multi-tool AI work assistant with built-in **Operation Tracing**, **Error Pattern detection**, and **LLM-driven automated inspection** — demonstrating how an AI Agent Harness can evolve itself through production data.

## Quick Start

```bash
pnpm install
cp .env.example .env          # fill in at least one LLM API key
pnpm db:seed                  # seed Chinook demo data + demo users
pnpm dev                      # starts server (3000) + web (5173)
```

Open http://localhost:5173 and start chatting.

## Demo: Self-Evolving in Action

```bash
# 1. Simulate multi-user traffic with injected errors
pnpm simulate

# 2. Run the inspector agent to analyze unmatched errors
pnpm inspect

# 3. Open admin dashboard to see patterns discovered
#    http://localhost:5173/admin

# 4. Repeat to observe convergence (new patterns → 0, coverage → 100%)
pnpm simulate && pnpm inspect
```

This is the core "aha moment" of the book: simulate traffic → errors occur → inspector discovers patterns → auto-fix → coverage rises.

## Architecture

pnpm monorepo with three packages:

```
packages/
  shared/    @evo/shared    TypeScript types and constants (no runtime deps)
  server/    @evo/server    Hono + Node.js: agent loop, tools, tracing, evolution
  web/       @evo/web       Vite + React: chat UI + admin dashboard
```

### Server Subsystems

| Subsystem  | Path         | Purpose                                                             |
| ---------- | ------------ | ------------------------------------------------------------------- |
| Agent Loop | `agent/`     | Core execution engine — streamText + maxSteps, tool dispatch        |
| Tools (×6) | `tools/`     | webSearch, webFetch, readFile, codeRunner, dbQuery, sendEmail       |
| Providers  | `providers/` | DeepSeek V4, OpenAI GPT-5.x, Anthropic Claude 4.x                   |
| Tracing    | `tracing/`   | Embedded tracer (run step = trace event), sanitizer, SQLite store   |
| Evolution  | `evolution/` | Error bucketer, pattern matcher, inspector agent, auto-fix pipeline |
| Context    | `context/`   | Message compression, tool result truncation                         |

### Tech Stack

- **LLM**: Vercel AI SDK with DeepSeek / OpenAI / Anthropic
- **Backend**: Hono + Node.js + better-sqlite3 (zero config)
- **Frontend**: React 19 + Tailwind CSS + Recharts
- **Language**: TypeScript (ESM)

## Commands

```bash
pnpm dev                # start server + web in parallel (dev mode)
pnpm dev:server         # server only (tsx watch, auto-reload)
pnpm dev:web            # web only (Vite HMR)
pnpm build              # build all packages
pnpm typecheck          # tsc --noEmit across all packages
pnpm lint               # eslint --fix
pnpm format             # prettier --write
pnpm db:seed            # seed Chinook demo data
pnpm simulate           # simulate multi-user traffic with injected errors
pnpm inspect            # trigger one inspection round
```

## Key Concepts

- **Harness**: The runtime wrapping the LLM — agent loop, tools, context management, error recovery. Not the agent itself, but what makes the agent work reliably.
- **Tracing as first-class citizen**: Every agent step automatically produces a trace event. If a step has no trace, it's a code bug — not a missing registration.
- **Self-Evolving**: Error patterns are automatically detected from aggregated traces, classified (user_error / provider_error / harness_bug), and fixed through an LLM-driven inspection agent.

## Self-Evolving Levels

| Level               | Human                        | Agent                             | Demo Coverage          |
| ------------------- | ---------------------------- | --------------------------------- | ---------------------- |
| L1 Manual           | Read logs, classify, fix     | None                              | —                      |
| L2 Agent-assisted   | Confirm + decide             | Find suspicious issues            | Initial state          |
| L3 Agent-led        | Review + high-risk decisions | Collect / classify / fix / commit | **Main focus**         |
| L4 Agent-autonomous | Set goals                    | Full loop + self-optimize         | Context tuner (embryo) |

## Admin Dashboard

Visit http://localhost:5173/admin with sidebar navigation:

- **Overview**: Operation count, success rate, P95 latency, pattern coverage
- **Trace Explorer**: Operation list with expandable step timeline
- **Error Analysis**: Error buckets by provider × type, top unmatched
- **Pattern Registry**: Discovered patterns with match rules and hit counts
- **Inspection Log**: Inspection rounds with cost, new patterns, harness bugs
- **Evolution Trends**: Success rate, unmatched error rate, pattern growth curves

## License

[MIT](./LICENSE)
