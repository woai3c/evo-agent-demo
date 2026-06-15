import { Paperclip, SendHorizontal, X } from 'lucide-react'

import { useRef, useState } from 'react'

import { uploadFile } from '../../lib/api'

const ALLOWED_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.log']

interface ChatInputProps {
  onSend: (message: string) => void
  disabled?: boolean
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [text, setText] = useState('')
  const [attachedFile, setAttachedFile] = useState<{ name: string; uploading: boolean } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = () => {
    const trimmed = text.trim()
    if (!trimmed || disabled || attachedFile?.uploading) return
    const message = attachedFile ? `[已上传文件: ${attachedFile.name}]\n${trimmed}` : trimmed
    onSend(message)
    setText('')
    setAttachedFile(null)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 160) + 'px'
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      alert(`不支持的文件类型: ${ext}\n支持: ${ALLOWED_EXTENSIONS.join(', ')}`)
      return
    }
    if (file.size > 1024 * 1024) {
      alert('文件大小不能超过 1MB')
      return
    }

    setAttachedFile({ name: file.name, uploading: true })
    try {
      await uploadFile(file)
      setAttachedFile({ name: file.name, uploading: false })
    } catch (err) {
      alert(`上传失败: ${err instanceof Error ? err.message : String(err)}`)
      setAttachedFile(null)
    }
  }

  return (
    <div className="border-t bg-white p-4">
      <div className="max-w-3xl mx-auto">
        {attachedFile && (
          <div className="flex items-center gap-2 mb-2 px-1">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 border border-blue-200 px-2.5 py-1 text-xs text-blue-700">
              <Paperclip className="h-3 w-3" />
              {attachedFile.name}
              {attachedFile.uploading && <span className="text-blue-400">上传中...</span>}
              {!attachedFile.uploading && (
                <button onClick={() => setAttachedFile(null)} className="hover:text-red-500 ml-1">
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_EXTENSIONS.join(',')}
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || !!attachedFile}
            className="rounded-xl border p-2.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="上传文件"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder="输入消息...（Enter 发送，Shift+Enter 换行）"
            rows={1}
            disabled={disabled}
            className="flex-1 resize-none rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button
            onClick={handleSubmit}
            disabled={disabled || !text.trim() || attachedFile?.uploading}
            className="rounded-xl bg-blue-600 p-2.5 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
