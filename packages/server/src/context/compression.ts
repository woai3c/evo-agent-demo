import type { CoreMessage } from 'ai'

const AVG_CHARS_PER_TOKEN = 4
const DEFAULT_WINDOW = 128_000
const COMPRESSION_THRESHOLD = 0.7

export function compressMessages(messages: CoreMessage[], opts?: { maxTokens?: number }): CoreMessage[] {
  const maxTokens = opts?.maxTokens ?? DEFAULT_WINDOW
  const budget = Math.floor(maxTokens * COMPRESSION_THRESHOLD)

  const estimatedTokens = messages.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    return sum + Math.ceil(content.length / AVG_CHARS_PER_TOKEN)
  }, 0)

  if (estimatedTokens <= budget) return messages

  const systemMsgs = messages.filter((m) => m.role === 'system')
  const lastN = 4
  const tail = messages.slice(-lastN)

  const middle = messages.slice(systemMsgs.length, -lastN)
  if (middle.length === 0) return messages

  const summaryParts: string[] = []
  for (const m of middle) {
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    if (m.role === 'user') {
      summaryParts.push(`User: ${text.slice(0, 100)}`)
    } else if (m.role === 'assistant') {
      summaryParts.push(`Assistant: ${text.slice(0, 200)}`)
    }
  }

  const compressed: CoreMessage = {
    role: 'user' as const,
    content: `[Earlier conversation summary (${middle.length} messages compressed):\n${summaryParts.join('\n')}\n]`,
  }

  return [...systemMsgs, compressed, ...tail]
}
