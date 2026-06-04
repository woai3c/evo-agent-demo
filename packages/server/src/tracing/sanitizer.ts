const API_KEY_RE = /\b(sk-|tvly-|key-|token-)[a-zA-Z0-9_-]{10,}\b/g
const EMAIL_RE = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g

export function sanitizeToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      sanitized[key] = value.replace(API_KEY_RE, '***').replace(EMAIL_RE, (m) => {
        const [local, domain] = m.split('@')
        return `${local[0]}***@***${domain.slice(domain.lastIndexOf('.'))}`
      })
    } else {
      sanitized[key] = value
    }
  }
  return sanitized
}
