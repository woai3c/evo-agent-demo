# Evo — Self-Evolving AI Agent Harness Demo

> Companion project for the ebook _"构建会自我进化的 AI Agent 产品"_.

A multi-tool AI work assistant with built-in **Operation Tracing**, **Error Pattern detection**, and **automated self-inspection** — demonstrating how an AI Agent Harness can evolve itself through production data.

## Quick Start

```bash
pnpm install
cp .env.example .env          # add at least one LLM API key
pnpm db:seed                  # seed Chinook demo data
pnpm dev                      # starts server (3000) + web (5173)
```

## Architecture

```
packages/
  shared/    @evo/shared    Type definitions shared between server and web
  server/    @evo/server    Hono API server: agent loop, tools, tracing, evolution
  web/       @evo/web       Vite + React: chat UI + admin dashboard
```

## Key Concepts

- **Harness**: The system wrapping the LLM — agent loop, tools, context management, error recovery
- **Tracing**: Every agent step automatically produces a trace event (not bolted on via callbacks)
- **Self-Evolving**: Error patterns are automatically detected, classified, and fixed through an inspection agent

## License

[MIT](./LICENSE)
