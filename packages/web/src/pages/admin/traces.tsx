import { ChevronDown, ChevronRight } from 'lucide-react'

import { useEffect, useState } from 'react'

import { fetchTraceDetail, fetchTraces } from '../../lib/admin-api'

interface OperationRow {
  operation_id: string
  user_id: string
  model: string
  provider: string
  status: string
  total_steps: number
  total_duration: number
  total_tokens: { input: number; output: number; cached: number }
  cost: number
  error_summary: string | null
  created_at: string
}

interface StepRow {
  stepId: string
  stepIndex: number
  type: string
  durationMs: number
  tokens: { input: number; output: number } | null
  toolName: string | null
  toolInput: Record<string, unknown> | null
  toolSuccess: boolean | null
  error: { code: string; message: string } | null
}

const STATUS_COLORS: Record<string, string> = {
  success: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
  interrupted: 'bg-yellow-100 text-yellow-700',
}

export function AdminTraces() {
  const [operations, setOperations] = useState<OperationRow[]>([])
  const [total, setTotal] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [steps, setSteps] = useState<StepRow[]>([])
  const [filter, setFilter] = useState({ status: '', provider: '' })

  useEffect(() => {
    fetchTraces({ status: filter.status || undefined, provider: filter.provider || undefined, limit: 50 }).then(
      (data) => {
        setOperations(data.operations)
        setTotal(data.total)
      },
    )
  }, [filter])

  const toggleExpand = async (opId: string) => {
    if (expandedId === opId) {
      setExpandedId(null)
      return
    }
    const data = await fetchTraceDetail(opId)
    setSteps(data.steps)
    setExpandedId(opId)
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Trace 浏览器</h1>
        <span className="text-sm text-gray-400">共 {total} 条</span>
      </div>

      <div className="flex gap-3 mb-4">
        <select
          value={filter.status}
          onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
          className="rounded-md border px-2 py-1 text-sm"
        >
          <option value="">全部状态</option>
          <option value="success">成功</option>
          <option value="error">失败</option>
        </select>
        <select
          value={filter.provider}
          onChange={(e) => setFilter((f) => ({ ...f, provider: e.target.value }))}
          className="rounded-md border px-2 py-1 text-sm"
        >
          <option value="">全部供应商</option>
          <option value="deepseek">DeepSeek</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </div>

      {operations.length === 0 ? (
        <p className="text-gray-400">暂无 Trace 数据。请先进行一些对话。</p>
      ) : (
        <div className="border rounded-lg bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left w-8"></th>
                <th className="px-4 py-2 text-left">Operation</th>
                <th className="px-4 py-2 text-left">用户</th>
                <th className="px-4 py-2 text-left">模型</th>
                <th className="px-4 py-2 text-left">状态</th>
                <th className="px-4 py-2 text-right">步数</th>
                <th className="px-4 py-2 text-right">耗时</th>
                <th className="px-4 py-2 text-right">Tokens</th>
                <th className="px-4 py-2 text-right">费用</th>
                <th className="px-4 py-2 text-left">时间</th>
              </tr>
            </thead>
            <tbody>
              {operations.map((op) => (
                <>
                  <tr
                    key={op.operation_id}
                    className="border-t hover:bg-gray-50 cursor-pointer"
                    onClick={() => toggleExpand(op.operation_id)}
                  >
                    <td className="px-4 py-2">
                      {expandedId === op.operation_id ? (
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-gray-400" />
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{op.operation_id.slice(0, 16)}...</td>
                    <td className="px-4 py-2">{op.user_id}</td>
                    <td className="px-4 py-2 text-xs">{op.model}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs rounded-full px-2 py-0.5 ${STATUS_COLORS[op.status] ?? 'bg-gray-100'}`}>
                        {op.status === 'success' ? '成功' : op.status === 'error' ? '失败' : op.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">{op.total_steps}</td>
                    <td className="px-4 py-2 text-right">{(op.total_duration / 1000).toFixed(1)}s</td>
                    <td className="px-4 py-2 text-right">
                      {((op.total_tokens.input + op.total_tokens.output) / 1000).toFixed(1)}k
                    </td>
                    <td className="px-4 py-2 text-right">${op.cost.toFixed(4)}</td>
                    <td className="px-4 py-2 text-xs text-gray-400">{op.created_at}</td>
                  </tr>
                  {expandedId === op.operation_id && (
                    <tr key={`${op.operation_id}-detail`}>
                      <td colSpan={10} className="bg-gray-50 px-8 py-4">
                        <StepTimeline steps={steps} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StepTimeline({ steps }: { steps: StepRow[] }) {
  if (steps.length === 0) return <p className="text-gray-400 text-sm">无步骤数据</p>

  return (
    <div className="space-y-1 font-mono text-xs">
      {steps.map((step) => (
        <div key={step.stepId} className="flex items-start gap-2">
          <span className="text-gray-400 w-16">Step {step.stepIndex}</span>
          <span className={`w-20 ${step.type === 'call_llm' ? 'text-blue-600' : 'text-purple-600'}`}>
            [{step.type === 'call_llm' ? 'LLM' : 'Tool'}]
          </span>
          <span className="flex-1">
            {step.toolName && <span className="font-semibold">{step.toolName} </span>}
            {step.tokens && (
              <span className="text-gray-500">
                in:{step.tokens.input} out:{step.tokens.output}
              </span>
            )}
            {step.toolSuccess != null && (
              <span className={step.toolSuccess ? 'text-green-600' : 'text-red-600'}>
                {step.toolSuccess ? ' ✓' : ' ✗'}
              </span>
            )}
            {step.error && <span className="text-red-500"> {step.error.message}</span>}
          </span>
          <span className="text-gray-400">{step.durationMs}ms</span>
        </div>
      ))}
    </div>
  )
}
