// Data sanitizer — strips sensitive fields before writing to trace DB.
// Signals ≠ raw content. We need structural features of errors, not what users said.

export function sanitizeToolInput(_input: Record<string, unknown>): Record<string, unknown> {
  // TODO: strip API keys, emails, file paths
  return _input
}
