export function truncateToolResult(result: string, maxBytes: number = 30_000): string {
  if (result.length <= maxBytes) return result

  const headBudget = Math.floor(maxBytes * 0.8)
  const tailBudget = maxBytes - headBudget - 60

  const head = result.slice(0, headBudget)
  const tail = result.slice(-tailBudget)
  const omitted = result.length - maxBytes

  return `${head}\n\n... [${omitted} characters truncated] ...\n\n${tail}`
}
