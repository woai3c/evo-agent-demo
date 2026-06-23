const TRUNCATION_MAX_BYTES = 30_000

export function truncateToolResult(result: string, maxBytes?: number): string {
  const limit = maxBytes ?? TRUNCATION_MAX_BYTES
  if (result.length <= limit) return result

  const headBudget = Math.floor(limit * 0.8)
  const tailBudget = limit - headBudget - 60

  const head = result.slice(0, headBudget)
  const tail = result.slice(-tailBudget)
  const omitted = result.length - limit

  return `${head}\n\n... [${omitted} characters truncated] ...\n\n${tail}`
}
