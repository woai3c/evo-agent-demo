import { db } from '../db/index.js'

export interface ErrorBucket {
  provider: string
  errorType: string
  statusCode: number | null
  toolName: string | null
  message: string
  count: number
  samples: { errorId: string; operationId: string; createdAt: string }[]
}

export function bucketErrors(options?: { since?: string; unmatched?: boolean }): ErrorBucket[] {
  let where = 'WHERE 1=1'
  const params: unknown[] = []

  if (options?.since) {
    where += ' AND e.created_at >= ?'
    params.push(options.since)
  }
  if (options?.unmatched) {
    where += ' AND e.pattern_id IS NULL'
  }

  const rows = db
    .prepare(
      `SELECT e.provider, e.error_type, e.status_code, e.tool_name, e.message, COUNT(*) as count
       FROM errors e ${where}
       GROUP BY e.provider, e.error_type, e.status_code, e.tool_name, e.message
       ORDER BY count DESC`,
    )
    .all(...params) as Record<string, unknown>[]

  return rows.map((row) => {
    const samples = db
      .prepare(
        `SELECT error_id, operation_id, created_at FROM errors
         WHERE provider = ? AND error_type = ? AND message = ?
         ORDER BY created_at DESC LIMIT 3`,
      )
      .all(row.provider, row.error_type, row.message) as { errorId: string; operationId: string; createdAt: string }[]

    return {
      provider: row.provider as string,
      errorType: row.error_type as string,
      statusCode: row.status_code as number | null,
      toolName: row.tool_name as string | null,
      message: row.message as string,
      count: row.count as number,
      samples,
    }
  })
}
