import { ChevronDown, ChevronRight } from 'lucide-react'

import { Fragment, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { fetchTraceDetail, fetchTraces } from '../../lib/admin-api'
import { formatLocalTime } from '../../lib/format'

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
  conversation_title: string | null
}

interface StepRow {
  stepId: string
  stepIndex: number
  type: string
  durationMs: number
  tokens: { input: number; output: number } | null
  toolName: string | null
  toolInput: Record<string, unknown> | null
  toolOutputSize: number | null
  toolOutput: Record<string, unknown> | null
  toolSuccess: boolean | null
  llmResponse: string | null
  error: { code: string; message: string } | null
}

const STATUS_COLORS: Record<string, string> = {
  success: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
  running: 'bg-blue-100 text-blue-700 animate-pulse',
  interrupted: 'bg-yellow-100 text-yellow-700',
}

export function AdminTraces() {
  const [searchParams] = useSearchParams()
  const [operations, setOperations] = useState<OperationRow[]>([])
  const [total, setTotal] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [steps, setSteps] = useState<StepRow[]>([])
  const [filter, setFilter] = useState({ status: '', provider: '', from: '', to: '' })

  useEffect(() => {
    fetchTraces({
      status: filter.status || undefined,
      provider: filter.provider || undefined,
      from: filter.from || undefined,
      to: filter.to || undefined,
      limit: 50,
    }).then((data) => {
      setOperations(data.operations)
      setTotal(data.total)
    })
  }, [filter])

  useEffect(() => {
    const opId = searchParams.get('op')
    if (opId && !expandedId) {
      fetchTraceDetail(opId).then((data) => {
        setSteps(data.steps)
        setExpandedId(opId)
      })
    }
  }, [searchParams, expandedId])

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
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Trace 浏览器</h1>
        <span className="text-sm text-gray-400">共 {total} 条</span>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
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
          <option value="alibaba">Alibaba (Qwen)</option>
          <option value="zhipu">Zhipu (GLM)</option>
          <option value="moonshotai">Moonshot (Kimi)</option>
        </select>
        <div className="flex items-center gap-1.5 text-sm">
          <span className="text-gray-500">从</span>
          <input
            type="date"
            value={filter.from}
            onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))}
            className="rounded-md border px-2 py-1 text-sm"
          />
          <span className="text-gray-500">至</span>
          <input
            type="date"
            value={filter.to}
            onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))}
            className="rounded-md border px-2 py-1 text-sm"
          />
          {(filter.from || filter.to) && (
            <button
              onClick={() => setFilter((f) => ({ ...f, from: '', to: '' }))}
              className="text-xs text-blue-600 hover:underline"
            >
              清除
            </button>
          )}
        </div>
      </div>

      {operations.length === 0 ? (
        <p className="text-gray-400">暂无 Trace 数据。请先进行一些对话。</p>
      ) : (
        <div className="border rounded-lg bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left w-8"></th>
                <th className="px-4 py-2 text-left">对话</th>
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
              {operations.map((op) => {
                const tokIn = op.total_tokens?.input ?? 0
                const tokOut = op.total_tokens?.output ?? 0
                const tokCached = op.total_tokens?.cached ?? 0
                return (
                  <Fragment key={op.operation_id}>
                    <tr
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
                      <td className="px-4 py-2 text-xs max-w-[200px] truncate" title={op.operation_id}>
                        {op.conversation_title || op.operation_id.slice(0, 16) + '...'}
                      </td>
                      <td className="px-4 py-2">{op.user_id}</td>
                      <td className="px-4 py-2 text-xs">{op.model}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`text-xs rounded-full px-2 py-0.5 ${STATUS_COLORS[op.status] ?? 'bg-gray-100'}`}
                        >
                          {op.status === 'success'
                            ? '成功'
                            : op.status === 'error'
                              ? '失败'
                              : op.status === 'running'
                                ? '处理中'
                                : op.status === 'interrupted'
                                  ? '已中断'
                                  : op.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">{op.total_steps}</td>
                      <td className="px-4 py-2 text-right">{(op.total_duration / 1000).toFixed(1)}s</td>
                      <td
                        className="px-4 py-2 text-right"
                        title={`输入: ${tokIn} | 输出: ${tokOut} | 缓存: ${tokCached}`}
                      >
                        {((tokIn + tokOut) / 1000).toFixed(1)}k
                        {tokCached > 0 && tokIn > 0 && (
                          <span className="ml-1 text-[10px] text-green-600">
                            {Math.round((tokCached / tokIn) * 100)}%
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">¥{op.cost.toFixed(4)}</td>
                      <td className="px-4 py-2 text-xs text-gray-400">{formatLocalTime(op.created_at)}</td>
                    </tr>
                    {expandedId === op.operation_id && (
                      <tr>
                        <td colSpan={10} className="bg-gray-50 px-8 py-4">
                          <StepTimeline steps={steps} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
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
    <div className="space-y-0.5 text-xs">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1
        const isLLM = step.type === 'call_llm'
        return (
          <div key={step.stepId} className="flex items-stretch gap-0">
            {/* tree connector */}
            <div className="w-6 flex flex-col items-center shrink-0">
              <div className={`w-px flex-1 ${i === 0 ? 'bg-transparent' : 'bg-gray-300'}`} />
              <div
                className={`w-2.5 h-2.5 rounded-full shrink-0 border-2 ${
                  step.error
                    ? 'border-red-400 bg-red-50'
                    : isLLM
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-purple-400 bg-purple-50'
                }`}
              />
              <div className={`w-px flex-1 ${isLast ? 'bg-transparent' : 'bg-gray-300'}`} />
            </div>

            {/* content */}
            <div className="flex-1 py-1.5 pl-2 min-w-0">
              {/* header row */}
              <div className="flex items-center gap-2 font-mono">
                <span className="text-gray-400">Step {step.stepIndex}</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    isLLM ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                  }`}
                >
                  {isLLM ? 'LLM' : 'Tool'}
                </span>
                {step.toolName && <span className="font-semibold text-gray-700">{step.toolName}</span>}
                {step.toolSuccess != null && (
                  <span className={`font-bold ${step.toolSuccess ? 'text-green-600' : 'text-red-500'}`}>
                    {step.toolSuccess ? '✓' : '✗'}
                  </span>
                )}
                <span className="ml-auto text-gray-400 tabular-nums">{step.durationMs}ms</span>
              </div>

              {/* detail rows */}
              <div className="mt-0.5 space-y-0.5 text-gray-500 font-mono">
                {step.tokens && (
                  <div>
                    Tokens: in:{step.tokens.input.toLocaleString()} out:{step.tokens.output.toLocaleString()}
                  </div>
                )}
                {step.toolInput && (
                  <div className="truncate max-w-2xl" title={JSON.stringify(step.toolInput)}>
                    输入: {JSON.stringify(step.toolInput)}
                  </div>
                )}
                {step.toolOutput && (
                  <div className="truncate max-w-2xl" title={JSON.stringify(step.toolOutput)}>
                    输出: {JSON.stringify(step.toolOutput)}
                  </div>
                )}
                {!step.toolOutput && step.toolOutputSize != null && (
                  <div>
                    输出大小:{' '}
                    {step.toolOutputSize >= 1024
                      ? `${(step.toolOutputSize / 1024).toFixed(1)} KB`
                      : `${step.toolOutputSize} B`}
                  </div>
                )}
                {step.llmResponse && (
                  <div className="truncate max-w-2xl text-gray-600" title={step.llmResponse}>
                    回复: {step.llmResponse}
                  </div>
                )}
                {step.error && (
                  <div className="text-red-500">
                    错误: [{step.error.code}] {step.error.message}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
