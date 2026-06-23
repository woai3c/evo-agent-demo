import type { Operation, Step } from '@evo/shared'

import { db } from '../db/index.js'

export function buildSnapshot(operationId: string): { operation: Operation; steps: Step[] } | null {
  const row = db.prepare('SELECT * FROM operations WHERE operation_id = ?').get(operationId) as Record<
    string,
    unknown
  > | null
  if (!row) return null

  const operation: Operation = {
    operationId: row.operation_id as string,
    userId: row.user_id as string,
    model: row.model as string,
    provider: row.provider as string as Operation['provider'],
    status: row.status as Operation['status'],
    totalSteps: row.total_steps as number,
    totalDuration: row.total_duration as number,
    totalTokens: JSON.parse((row.total_tokens as string) || '{"input":0,"output":0,"cached":0}'),
    cost: row.cost as number,
    errorSummary: (row.error_summary as string) ?? null,
    createdAt: row.created_at as string,
  }

  const stepRows = db
    .prepare('SELECT * FROM steps WHERE operation_id = ? ORDER BY step_index')
    .all(operationId) as Record<string, unknown>[]

  const steps: Step[] = stepRows.map((s) => ({
    stepId: s.step_id as string,
    operationId: s.operation_id as string,
    stepIndex: s.step_index as number,
    type: s.type as Step['type'],
    durationMs: s.duration_ms as number,
    tokens: s.tokens ? JSON.parse(s.tokens as string) : null,
    toolName: (s.tool_name as string as Step['toolName']) ?? null,
    toolInput: s.tool_input ? JSON.parse(s.tool_input as string) : null,
    toolOutputSize: (s.tool_output_size as number) ?? null,
    toolOutput: s.tool_output ? JSON.parse(s.tool_output as string) : null,
    toolSuccess: s.tool_success != null ? Boolean(s.tool_success) : null,
    llmResponse: (s.llm_response as string) ?? null,
    error: s.error ? JSON.parse(s.error as string) : null,
    contextSnapshot: s.context_snapshot ? JSON.parse(s.context_snapshot as string) : null,
    createdAt: s.created_at as string,
  }))

  return { operation, steps }
}
