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
  // Don't let the kept tail begin with a tool result whose assistant tool-call
  // got dropped into the summary — providers reject an orphaned tool message
  // (400). Walk the boundary back to include the assistant that owns any leading
  // tool results.
  let tailStart = Math.max(systemMsgs.length, messages.length - lastN)
  while (tailStart > systemMsgs.length && messages[tailStart]?.role === 'tool') {
    tailStart--
  }

  const tail = messages.slice(tailStart)
  const middle = messages.slice(systemMsgs.length, tailStart)
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
