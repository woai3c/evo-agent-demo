const API_KEY_RE = /\b(sk-|tvly-|key-|token-)[a-zA-Z0-9_-]{10,}\b/g
const EMAIL_RE = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g
const FILE_PATH_RE = /(?:[A-Z]:\\|\/(?:home|Users|tmp|var|etc)\/)[^\s"']+/g

function maskFilePath(p: string): string {
  const sep = p.includes('\\') ? '\\' : '/'
  const parts = p.split(/[/\\]/)
  return `***${sep}${parts[parts.length - 1]}`
}

function sanitizeString(s: string): string {
  return s
    .replace(API_KEY_RE, '***')
    .replace(EMAIL_RE, (m) => {
      const [local, domain] = m.split('@')
      return `${local[0]}***@***${domain.slice(domain.lastIndexOf('.'))}`
    })
    .replace(FILE_PATH_RE, maskFilePath)
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeString(value)
  if (Array.isArray(value)) return value.map(sanitizeValue)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sanitizeValue(v)
    return out
  }
  return value
}

// Tool inputs, tool outputs, and LLM responses can carry secrets (API keys),
// PII (emails), or local file paths. Scrub them (recursively) before persisting
// to the trace, which is exposed via the admin API.
export function sanitizeToolInput(input: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(input) as Record<string, unknown>
}

export function sanitizeToolOutput(output: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(output) as Record<string, unknown>
}

export function sanitizeText(text: string): string {
  return sanitizeString(text)
}
