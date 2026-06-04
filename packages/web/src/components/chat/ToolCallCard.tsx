import { CheckCircle2, ChevronDown, ChevronRight, Loader2, XCircle } from 'lucide-react'

import { useState } from 'react'

export interface ToolCallInfo {
  toolName: string
  input: Record<string, unknown>
  result?: { success: boolean; outputSize: number }
}

const TOOL_LABELS: Record<string, string> = {
  webSearch: '网络搜索',
  webFetch: '网页抓取',
  readFile: '读取文件',
  codeRunner: '代码执行',
  dbQuery: '数据库查询',
  sendEmail: '发送邮件',
}

export function ToolCallCard({ tool }: { tool: ToolCallInfo }) {
  const [open, setOpen] = useState(false)
  const label = TOOL_LABELS[tool.toolName] ?? tool.toolName
  const pending = !tool.result
  const success = tool.result?.success

  return (
    <div className="my-2 rounded-lg border bg-gray-50 text-sm">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-100 rounded-lg"
        onClick={() => setOpen(!open)}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
        ) : success ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <XCircle className="h-4 w-4 text-red-500" />
        )}
        <span className="font-medium text-gray-700">{label}</span>
        {tool.result && (
          <span className="text-xs text-gray-400 ml-auto mr-2">{(tool.result.outputSize / 1024).toFixed(1)}KB</span>
        )}
        {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
      </button>
      {open && (
        <div className="border-t px-3 py-2">
          <pre className="whitespace-pre-wrap text-xs text-gray-600 max-h-48 overflow-auto">
            {JSON.stringify(tool.input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
