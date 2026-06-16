# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Evo is the companion demo project for the ebook "构建会自我进化的 AI Agent 产品" (Building Self-Evolving AI Agents). It is a multi-tool AI work assistant with built-in Operation Tracing, Error Pattern detection, and automated self-inspection — demonstrating how an AI Agent Harness can evolve itself through production data.

The full PRD is at `tmp/self-evolving-harness-prd.md`. The source article is at `tmp/需要自进化的不是 Agent，而是 Harness.txt`.

## Commands

```bash
pnpm install            # install all workspaces
pnpm dev                # start server (3000) + web (5173) in parallel
pnpm dev:server         # server only (tsx watch, auto-reloads)
pnpm dev:web            # web only (vite)
pnpm build              # build all packages
pnpm start              # production server (requires build first, no tsx watch)
pnpm typecheck          # tsc --noEmit across all packages
pnpm lint               # eslint --fix
pnpm format             # prettier --write
pnpm format:check       # prettier --check
pnpm db:seed            # seed Chinook demo data into SQLite
pnpm simulate           # send real conversations to server (requires dev:server running, calls LLM API)
pnpm simulate 20        # send 20 conversations (default: 10)
pnpm simulate --mock    # insert mock trace data without API calls (default: 100)
pnpm inspect            # Inspection A: recognize error patterns (run simulate first)
pnpm autofix            # Inspection B: auto-fix harness bugs via PR generation
```

Single-package commands use `pnpm --filter`:

```bash
pnpm --filter @evo/server run dev
pnpm --filter @evo/web run dev
pnpm --filter @evo/server run typecheck
```

## Architecture

pnpm monorepo with three packages:

- **`packages/shared`** (`@evo/shared`) — TypeScript types and constants only, no runtime deps. Consumed by both server and web via `workspace:*`. Uses raw `.ts` source as entrypoint (no build step).
- **`packages/server`** (`@evo/server`) — Hono + Node.js HTTP server. Agent loop, 6 tools, tracing, evolution engine, REST API.
- **`packages/web`** (`@evo/web`) — Vite + React 19 + Tailwind + shadcn/ui. Chat UI + admin dashboard.

### Server internals (`packages/server/src/`)

The server has four subsystems that form a pipeline:

1. **Agent loop** (`agent/loop.ts`, `agent/dispatch.ts`) — Core execution engine. Each user message triggers `agentLoop()` which runs turns until the model stops. `dispatch.ts` routes `tool_call` to the correct tool.

2. **Tools** (`tools/`) — Six tools the agent can call: `webSearch` (Tavily), `webFetch`, `readFile`, `codeRunner`, `dbQuery` (Chinook SQLite), `sendEmail`. Defined using Vercel AI SDK `tool()`.

3. **Tracing** (`tracing/`) — Embedded inside the agent loop (not bolted on). `Tracer` emits events per step. `TraceStore` writes each step to SQLite immediately (partial trace > no trace on crash). `sanitizer.ts` strips sensitive fields. `snapshot.ts` builds the complete Operation record.

4. **Evolution** (`evolution/`) — The self-evolving pipeline:
   - `error-bucketer.ts` — groups errors by provider × errorType × statusCode × toolName
   - `pattern-matcher.ts` — checks errors against the pattern registry
   - `inspector.ts` — LLM-driven agent that analyzes unmatched errors, classifies them (`user_error` / `provider_error` / `harness_bug`), generates new patterns. Also runs behavior analysis (Phase 2).
   - `auto-fix.ts` — applies fixes: user/provider errors → new pattern + backfill; harness bugs → bug report awaiting human confirmation
   - `auto-pr.ts` — Inspection B: for each unfixed `harness_bug` pattern, LLM locates files → generates code fix → creates git branch/commit/push → opens PR via `gh`. Updates `fix_status`/`fix_pr_url` on the pattern.
   - `behavior-analyzer.ts` — Phase 2a (LLM semantic clustering of operations into behaviors) → Phase 2b (5 deterministic health evaluators) → Phase 2c (LLM suggestions for unhealthy behaviors)
   - `context-tuner.ts` — adjusts compression thresholds from trace data (L4 agent-autonomous embryo)

5. **Context management** (`context/`) — `compression.ts` reduces message history near window limits. `truncation.ts` applies per-tool head/tail byte budgets.

### Server API routes (`api/`)

All mounted under `/api/` in `app.ts`:

- `POST /api/chat/message` — accepts user message, runs agent loop, streams SSE
- `GET /api/chat/conversations` — list conversations
- `/api/traces`, `/api/patterns`, `/api/inspections`, `/api/dashboard` — admin data
- `POST /api/inspections/autofix` — trigger Inspection B (auto-fix PRs for harness bugs)

### Web routes (`packages/web/src/`)

- `/` — Chat page (conversation sidebar + message area)
- `/admin` — Dashboard overview (stats cards + nav to sub-pages)
- `/admin/traces`, `/admin/errors`, `/admin/patterns`, `/admin/inspections`, `/admin/behaviors`, `/admin/trends`

### Database

SQLite via `better-sqlite3` with WAL mode. Schema in `db/schema.ts`. Three table groups:

- **Trace**: `operations`, `steps`, `errors`
- **Evolution**: `patterns` (with `fix_status`/`fix_pr_url` for harness bugs), `inspections`, `behaviors`
- **App**: `users`, `conversations`, `sent_emails`
- **Demo data**: Chinook dataset (artists, albums, tracks, etc.) loaded by `pnpm db:seed`

### LLM providers

Vercel AI SDK with three providers configured in `providers/registry.ts`: DeepSeek (default), OpenAI, Anthropic. Provider/model names defined as const tuples in `shared/constants.ts`.

### Environment variables

- **API keys**: `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`
- **Chat model**: hardcoded in `shared/constants.ts` (`DEFAULT_PROVIDER = 'deepseek'`, `DEFAULT_MODEL = 'deepseek-v4-flash'`)
- **Inspection/auto-fix model**: `INSPECTOR_PROVIDER` → `DEFAULT_PROVIDER` → `'deepseek'`; `INSPECTOR_MODEL` → `DEFAULT_MODEL` → `'deepseek-v4-flash'` (priority chain, first non-empty wins)
- **Server**: `PORT` (default 3000), `DB_PATH` (default `./data/evo.db`)

### Communication protocol

Server → Web uses SSE with typed `StreamEvent` union: `text-delta`, `tool-call`, `tool-result`, `error`, `done`.

## Key Concepts

- **Harness**: The system wrapping the LLM (agent loop + tools + context + error recovery). Evo is the vehicle; the Self-Evolving Harness is the protagonist.
- **Tracing as first-class citizen**: `run step = trace event`. If a step has no trace, it's a code bug.
- **Self-Evolving**: Two-stage inspection pipeline. Inspection A detects error patterns from traces and classifies them (`user_error` / `provider_error` / `harness_bug`). Inspection B auto-generates fix PRs for unfixed harness bugs (commit → push → open PR). Behavior analysis clusters operations semantically and evaluates health.

## Conventions

- ESM only (`"type": "module"`) — use `.js` extensions in imports (e.g., `'./app.js'`)
- Prettier: single quotes, no semicolons, 120 print width, import order sorting (`@trivago/prettier-plugin-sort-imports`)
- ESLint: `typescript-eslint` recommended + `react-hooks` + `unused-imports` (unused imports are errors)
- Commits: conventional commits, enforced by commitlint + husky. lint-staged runs eslint + prettier on pre-commit.
- All user-facing text in Chinese; code, comments, commits in English
- Unused function params prefixed with `_` (eslint `argsIgnorePattern: '^_'`)
- Node.js >= 20.19.0 required
