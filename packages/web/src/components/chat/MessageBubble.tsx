import { Bot, User } from 'lucide-react'
import remarkGfm from 'remark-gfm'

import Markdown from 'react-markdown'

import { ToolCallCard } from './ToolCallCard'
import type { ToolCallInfo } from './ToolCallCard'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCallInfo[]
  isStreaming?: boolean
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
          <Bot className="h-4 w-4 text-blue-600" />
        </div>
      )}
      <div className={`max-w-[75%] ${isUser ? 'order-first' : ''}`}>
        {isUser ? (
          <div className="rounded-2xl rounded-tr-sm bg-blue-600 px-4 py-2 text-white text-sm">{message.content}</div>
        ) : (
          <div className="space-y-1">
            {message.toolCalls?.map((tool, i) => (
              <ToolCallCard key={i} tool={tool} />
            ))}
            {message.content && (
              <div className="rounded-2xl rounded-tl-sm bg-white border px-4 py-2 text-sm prose prose-sm prose-gray max-w-none">
                <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
              </div>
            )}
            {message.isStreaming && !message.content && !message.toolCalls?.length && (
              <div className="rounded-2xl rounded-tl-sm bg-white border px-4 py-3">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" />
                  <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce [animation-delay:0.1s]" />
                  <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce [animation-delay:0.2s]" />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
          <User className="h-4 w-4 text-gray-600" />
        </div>
      )}
    </div>
  )
}
