import { nanoid } from 'nanoid'

import type { TokenUsage } from '@evo/shared'

import { db } from '../db/index.js'
import { matchError } from '../evolution/pattern-matcher.js'

export interface InsertOperationParams {
  operationId: string
  conversationId?: string
  userId: string
  model: string
  provider: string
}

export interface InsertStepParams {
  operationId: string
  stepIndex: number
  type: 'call_llm' | 'call_tool'
  durationMs: number
  tokens?: TokenUsage
  toolName?: string
  toolInput?: Record<string, unknown>
  toolOutputSize?: number
  toolSuccess?: boolean
  error?: { code: string; message: string; providerStatus: number | null }
  contextSnapshot?: { totalTokens: number; windowUsagePct: number; compressionTriggered: boolean }
}

export interface InsertErrorParams {
  operationId: string
  stepId: string
  provider: string
  errorType: string
  statusCode?: number
  message: string
  toolName?: string
}

const insertOperationStmt = db.prepare(`
  INSERT INTO operations (operation_id, conversation_id, user_id, model, provider, status)
  VALUES (?, ?, ?, ?, ?, 'error')
`)

const insertStepStmt = db.prepare(`
  INSERT INTO steps (step_id, operation_id, step_index, type, duration_ms, tokens, tool_name, tool_input, tool_output_size, tool_success, error, context_snapshot)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const insertErrorStmt = db.prepare(`
  INSERT INTO errors (error_id, operation_id, step_id, provider, error_type, status_code, message, tool_name)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)

const updateOperationStmt = db.prepare(`
  UPDATE operations
  SET status = ?, total_steps = ?, total_duration = ?, total_tokens = ?, cost = ?, error_summary = ?
  WHERE operation_id = ?
`)

export class TraceStore {
  insertOperation(params: InsertOperationParams): void {
    insertOperationStmt.run(
      params.operationId,
      params.conversationId ?? null,
      params.userId,
      params.model,
      params.provider,
    )
  }

  insertStep(params: InsertStepParams): string {
    const stepId = `step_${nanoid()}`
    insertStepStmt.run(
      stepId,
      params.operationId,
      params.stepIndex,
      params.type,
      params.durationMs,
      params.tokens ? JSON.stringify(params.tokens) : null,
      params.toolName ?? null,
      params.toolInput ? JSON.stringify(params.toolInput) : null,
      params.toolOutputSize ?? null,
      params.toolSuccess != null ? (params.toolSuccess ? 1 : 0) : null,
      params.error ? JSON.stringify(params.error) : null,
      params.contextSnapshot ? JSON.stringify(params.contextSnapshot) : null,
    )
    return stepId
  }

  insertError(params: InsertErrorParams): void {
    const pattern = matchError({
      provider: params.provider,
      errorType: params.errorType,
      statusCode: params.statusCode,
      message: params.message,
      toolName: params.toolName,
    })

    const errorId = `err_${nanoid()}`
    insertErrorStmt.run(
      errorId,
      params.operationId,
      params.stepId,
      params.provider,
      params.errorType,
      params.statusCode ?? null,
      params.message,
      params.toolName ?? null,
    )

    if (pattern) {
      db.prepare('UPDATE errors SET pattern_id = ? WHERE error_id = ?').run(pattern.patternId, errorId)
    }
  }

  finishOperation(
    operationId: string,
    status: 'success' | 'error' | 'interrupted',
    totalSteps: number,
    totalDuration: number,
    totalTokens: TokenUsage,
    cost: number,
    errorSummary: string | null,
  ): void {
    updateOperationStmt.run(
      status,
      totalSteps,
      totalDuration,
      JSON.stringify(totalTokens),
      cost,
      errorSummary,
      operationId,
    )
  }
}

export const traceStore = new TraceStore()
