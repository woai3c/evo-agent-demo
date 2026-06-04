import { useCallback, useEffect, useRef, useState } from 'react'

import { ChatInput } from '../components/chat/ChatInput'
import { ConversationSidebar } from '../components/chat/ConversationSidebar'
import { MessageBubble } from '../components/chat/MessageBubble'
import type { ChatMessage } from '../components/chat/MessageBubble'
import { ProviderSelector } from '../components/chat/ProviderSelector'
import type { ToolCallInfo } from '../components/chat/ToolCallCard'
import { fetchConversations, fetchMessages, sendMessageStream } from '../lib/api'
import type { ConversationRow } from '../lib/api'

function getStoredUser(): string | null {
  return localStorage.getItem('evo-user-id')
}

function LoginPrompt({ onLogin }: { onLogin: (userId: string) => void }) {
  const [name, setName] = useState('')

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    localStorage.setItem('evo-user-id', trimmed)
    onLogin(trimmed)
  }

  return (
    <div className="flex items-center justify-center h-[calc(100vh-57px)]">
      <div className="bg-white rounded-xl border shadow-sm p-8 w-80 text-center">
        <h2 className="text-lg font-semibold mb-1">欢迎使用 Evo</h2>
        <p className="text-sm text-gray-500 mb-4">输入用户名即可开始</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="用户名（如 alice）"
          className="w-full rounded-lg border px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />
        <button
          onClick={submit}
          disabled={!name.trim()}
          className="w-full rounded-lg bg-blue-600 py-2 text-sm text-white hover:bg-blue-700 disabled:bg-gray-300"
        >
          开始对话
        </button>
      </div>
    </div>
  )
}

export function Chat() {
  const [userId, setUserId] = useState<string | null>(getStoredUser)
  const [conversations, setConversations] = useState<ConversationRow[]>([])
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [provider, setProvider] = useState('deepseek')
  const [model, setModel] = useState('deepseek-v4-flash')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const loadConversations = useCallback(async () => {
    if (!userId) return
    try {
      const convs = await fetchConversations(userId)
      setConversations(convs)
    } catch {
      // ignore
    }
  }, [userId])

  useEffect(() => {
    if (userId) {
      fetchConversations(userId)
        .then(setConversations)
        .catch(() => {})
    }
  }, [userId])

  const loadConversationMessages = useCallback(async (convId: string) => {
    try {
      const raw = await fetchMessages(convId)
      const parsed: ChatMessage[] = []
      let idx = 0

      for (const msg of raw) {
        if (msg.role === 'user') {
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
          parsed.push({ id: `msg-${idx++}`, role: 'user', content })
        } else if (msg.role === 'assistant') {
          const parts = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }]
          let text = ''
          const toolCalls: ToolCallInfo[] = []
          for (const part of parts) {
            if (part.type === 'text') text += part.text ?? ''
            if (part.type === 'tool-call') {
              toolCalls.push({
                toolName: part.toolName,
                input: part.args ?? {},
                result: { success: true, outputSize: 0 },
              })
            }
          }
          parsed.push({
            id: `msg-${idx++}`,
            role: 'assistant',
            content: text,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          })
        }
      }

      setMessages(parsed)
    } catch {
      setMessages([])
    }
  }, [])

  const handleSelectConversation = useCallback(
    (convId: string) => {
      if (isStreaming) return
      setActiveConvId(convId)
      loadConversationMessages(convId)
    },
    [isStreaming, loadConversationMessages],
  )

  const handleNewChat = useCallback(() => {
    if (isStreaming) return
    setActiveConvId(null)
    setMessages([])
  }, [isStreaming])

  const handleSend = useCallback(
    async (text: string) => {
      if (!userId || isStreaming) return

      const userMsg: ChatMessage = { id: `msg-${Date.now()}`, role: 'user', content: text }
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        content: '',
        isStreaming: true,
      }

      setMessages((prev) => [...prev, userMsg, assistantMsg])
      setIsStreaming(true)

      const controller = new AbortController()
      abortRef.current = controller

      let convId = activeConvId

      await sendMessageStream(
        { userId, conversationId: convId ?? undefined, message: text, provider, model },
        {
          onConversationId: (id) => {
            convId = id
            setActiveConvId(id)
          },
          onTextDelta: (delta) => {
            setMessages((prev) => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last.role === 'assistant') {
                updated[updated.length - 1] = { ...last, content: last.content + delta }
              }
              return updated
            })
          },
          onToolCall: (toolName, input) => {
            setMessages((prev) => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last.role === 'assistant') {
                const toolCalls = [...(last.toolCalls ?? []), { toolName, input }]
                updated[updated.length - 1] = { ...last, toolCalls }
              }
              return updated
            })
          },
          onToolResult: (toolName, success, outputSize) => {
            setMessages((prev) => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last.role === 'assistant' && last.toolCalls) {
                const toolCalls = last.toolCalls.map((tc) =>
                  tc.toolName === toolName && !tc.result ? { ...tc, result: { success, outputSize } } : tc,
                )
                updated[updated.length - 1] = { ...last, toolCalls }
              }
              return updated
            })
          },
          onError: (message) => {
            setMessages((prev) => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last.role === 'assistant') {
                updated[updated.length - 1] = {
                  ...last,
                  content: last.content + `\n\n**错误：** ${message}`,
                  isStreaming: false,
                }
              }
              return updated
            })
          },
          onDone: () => {
            setMessages((prev) => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last.role === 'assistant') {
                updated[updated.length - 1] = { ...last, isStreaming: false }
              }
              return updated
            })
            setIsStreaming(false)
            abortRef.current = null
            loadConversations()
          },
        },
        controller.signal,
      ).catch(() => {
        setIsStreaming(false)
        abortRef.current = null
      })
    },
    [userId, isStreaming, activeConvId, provider, model, loadConversations],
  )

  if (!userId) {
    return <LoginPrompt onLogin={setUserId} />
  }

  return (
    <div className="flex h-[calc(100vh-57px)]">
      <ConversationSidebar
        conversations={conversations}
        activeId={activeConvId}
        onSelect={handleSelectConversation}
        onNew={handleNewChat}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <div className="border-b bg-white px-4 py-2 flex items-center justify-between">
          <ProviderSelector provider={provider} model={model} onProviderChange={setProvider} onModelChange={setModel} />
          <span className="text-xs text-gray-400">
            当前用户：<strong>{userId}</strong>
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <h2 className="text-xl font-semibold text-gray-400 mb-2">开始一段对话</h2>
                <p className="text-sm text-gray-400">让 Evo 帮你搜索网页、查询数据库、执行代码、发送邮件等</p>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <ChatInput onSend={handleSend} disabled={isStreaming} />
      </main>
    </div>
  )
}
