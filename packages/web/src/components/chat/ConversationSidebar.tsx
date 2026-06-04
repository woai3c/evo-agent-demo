import { MessageSquare, MessageSquarePlus } from 'lucide-react'

import type { ConversationRow } from '../../lib/api'

interface ConversationSidebarProps {
  conversations: ConversationRow[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr + 'Z')
  const now = Date.now()
  const diff = now - date.getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

export function ConversationSidebar({ conversations, activeId, onSelect, onNew }: ConversationSidebarProps) {
  return (
    <aside className="w-64 border-r bg-white flex flex-col">
      <div className="p-3">
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:border-gray-400 transition-colors"
        >
          <MessageSquarePlus className="h-4 w-4" />
          新对话
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {conversations.length === 0 && <p className="text-xs text-gray-400 text-center mt-4">暂无对话</p>}
        {conversations.map((c) => (
          <button
            key={c.conversation_id}
            onClick={() => onSelect(c.conversation_id)}
            className={`w-full flex items-start gap-2 rounded-lg px-3 py-2 text-left text-sm mb-0.5 transition-colors ${
              c.conversation_id === activeId ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            <MessageSquare className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{c.title}</p>
              <p className="text-xs text-gray-400 mt-0.5">{timeAgo(c.updated_at)}</p>
            </div>
          </button>
        ))}
      </div>
    </aside>
  )
}
