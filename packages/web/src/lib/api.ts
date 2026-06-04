const BASE = '/api'

export async function fetchConversations(userId: string) {
  const res = await fetch(`${BASE}/chat/conversations?userId=${encodeURIComponent(userId)}`)
  if (!res.ok) throw new Error(`Failed to fetch conversations: ${res.status}`)
  const data = await res.json()
  return data.conversations as ConversationRow[]
}

export async function fetchMessages(conversationId: string) {
  const res = await fetch(`${BASE}/chat/conversations/${conversationId}/messages`)
  if (!res.ok) throw new Error(`Failed to fetch messages: ${res.status}`)
  const data = await res.json()
  return data.messages as CoreMessageRow[]
}

export interface ConversationRow {
  conversation_id: string
  user_id: string
  title: string
  model: string
  provider: string
  created_at: string
  updated_at: string
}

export interface CoreMessageRow {
  role: string
  content: unknown
}

export interface SendMessageParams {
  userId: string
  conversationId?: string
  message: string
  provider?: string
  model?: string
}

export interface ChatStreamCallbacks {
  onConversationId: (id: string) => void
  onTextDelta: (text: string) => void
  onToolCall: (toolName: string, input: Record<string, unknown>) => void
  onToolResult: (toolName: string, success: boolean, outputSize: number) => void
  onError: (message: string) => void
  onDone: (operationId: string) => void
}

export async function sendMessageStream(
  params: SendMessageParams,
  callbacks: ChatStreamCallbacks,
  signal?: AbortSignal,
) {
  const res = await fetch(`${BASE}/chat/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  })

  if (!res.ok || !res.body) {
    callbacks.onError(`Request failed: ${res.status}`)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    let eventType = ''
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim()
      } else if (line.startsWith('data: ') && eventType) {
        try {
          const data = JSON.parse(line.slice(6))
          switch (eventType) {
            case 'conversation':
              callbacks.onConversationId(data.conversationId)
              break
            case 'text-delta':
              callbacks.onTextDelta(data.text)
              break
            case 'tool-call':
              callbacks.onToolCall(data.toolName, data.input)
              break
            case 'tool-result':
              callbacks.onToolResult(data.toolName, data.success, data.outputSize)
              break
            case 'error':
              callbacks.onError(data.message)
              break
            case 'done':
              callbacks.onDone(data.operationId)
              break
          }
        } catch {
          // skip malformed JSON
        }
        eventType = ''
      }
    }
  }
}
