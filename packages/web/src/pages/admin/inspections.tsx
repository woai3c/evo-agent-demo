import { GitPullRequest, Loader2, Play, Wrench } from 'lucide-react'

import { useEffect, useRef, useState } from 'react'

import { fetchInspections, triggerAutoFix } from '../../lib/admin-api'

interface AutoFixResultItem {
  source: 'pattern' | 'behavior'
  sourceId: string
  sourceName: string
  branch: string
  prUrl: string | null
  status: 'pr_created' | 'branch_created' | 'failed'
  error?: string
}

interface InspectionRow {
  inspection_id: string
  round: number
  started_at: string
  finished_at: string | null
  traces_analyzed: number
  new_patterns: number
  harness_bugs: number
  tokens_used: { input: number; output: number } | null
  cost: number
  summary: string
  details: { newPatterns: unknown[]; bugs: { title: string; severity: string; description: string }[] } | null
}

let activeFixPromise: Promise<{ results?: AutoFixResultItem[] }> | null = null
let cachedFixResults: AutoFixResultItem[] | null = null

export function AdminInspections() {
  const [inspections, setInspections] = useState<InspectionRow[]>([])
  const [running, setRunning] = useState(false)
  const [fixing, setFixing] = useState(() => activeFixPromise !== null)
  const [fixResults, setFixResults] = useState<AutoFixResultItem[] | null>(() => cachedFixResults)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const load = () => fetchInspections().then((data) => setInspections(data.inspections))

  useEffect(() => {
    mountedRef.current = true
    load()

    if (activeFixPromise) {
      activeFixPromise.then((data) => {
        if (!mountedRef.current) return
        const results = data.results ?? []
        cachedFixResults = results
        setFixResults(results)
        setFixing(false)
      })
    }

    return () => {
      mountedRef.current = false
    }
  }, [])

  const runInspection = async () => {
    setRunning(true)
    try {
      await fetch('/api/inspections/run', { method: 'POST' })
      await load()
    } finally {
      setRunning(false)
    }
  }

  const runAutofix = async () => {
    setFixing(true)
    setFixResults(null)
    cachedFixResults = null

    const promise = triggerAutoFix()
    activeFixPromise = promise

    try {
      const data = await promise
      const results = data.results ?? []
      cachedFixResults = results
      if (mountedRef.current) {
        setFixResults(results)
      }
    } finally {
      activeFixPromise = null
      if (mountedRef.current) {
        setFixing(false)
      }
    }
  }

  const totalCost = inspections.reduce((sum, i) => sum + i.cost, 0)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">巡检记录</h1>
          {inspections.length > 0 && (
            <p className="text-sm text-gray-500 mt-1">
              共 {inspections.length} 轮，累计成本 ¥{totalCost.toFixed(4)}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={runInspection}
            disabled={running || fixing}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? '巡检中...' : '巡检 A：识别 Pattern'}
          </button>
          <button
            onClick={runAutofix}
            disabled={running || fixing}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700 disabled:bg-gray-300"
          >
            {fixing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
            {fixing ? '修复中...' : '巡检 B：自动修复'}
          </button>
        </div>
      </div>

      {fixResults && fixResults.length > 0 && (
        <div className="border rounded-lg bg-white p-4 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <GitPullRequest className="h-4 w-4" />
            自动修复结果
          </h3>
          <div className="space-y-2">
            {fixResults.map((r) => (
              <div
                key={r.sourceId}
                className={`text-sm rounded px-3 py-2 ${
                  r.status === 'failed'
                    ? 'bg-red-50 text-red-800'
                    : r.status === 'pr_created'
                      ? 'bg-green-50 text-green-800'
                      : 'bg-yellow-50 text-yellow-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] rounded px-1.5 py-0.5 ${r.source === 'pattern' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}
                    >
                      {r.source === 'pattern' ? 'Bug 修复' : '行为优化'}
                    </span>
                    <span className="font-medium">{r.sourceName}</span>
                  </div>
                  <span className="text-xs">
                    {r.status === 'pr_created' ? '已创建 PR' : r.status === 'branch_created' ? '已创建分支' : '失败'}
                  </span>
                </div>
                {r.prUrl && (
                  <a
                    href={r.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {r.prUrl}
                  </a>
                )}
                {r.status === 'branch_created' && <p className="text-xs mt-0.5">分支: {r.branch}</p>}
                {r.error && <p className="text-xs mt-0.5">错误: {r.error}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {fixResults && fixResults.length === 0 && (
        <div className="border rounded-lg bg-gray-50 p-4 mb-6 text-sm text-gray-500">
          没有待修复的 Harness 缺陷。请先运行巡检 A 识别问题。
        </div>
      )}

      {inspections.length === 0 ? (
        <p className="text-gray-400">暂未运行过巡检。点击上方按钮开始第一轮巡检。</p>
      ) : (
        <div className="space-y-3">
          {inspections.map((insp) => (
            <div key={insp.inspection_id} className="border rounded-lg bg-white">
              <button
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50"
                onClick={() => setExpandedId(expandedId === insp.inspection_id ? null : insp.inspection_id)}
              >
                <div className="flex items-center gap-4">
                  <span className="text-lg font-bold text-blue-600">#{insp.round}</span>
                  <div>
                    <div className="flex items-center gap-3 text-sm">
                      <span>分析 {insp.traces_analyzed} 条错误</span>
                      <span className="text-green-600 font-medium">+{insp.new_patterns} Pattern</span>
                      {insp.harness_bugs > 0 && (
                        <span className="text-red-600 font-medium">{insp.harness_bugs} 个缺陷</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">{insp.started_at}</p>
                  </div>
                </div>
                <span className="text-xs text-gray-400">¥{insp.cost.toFixed(4)}</span>
              </button>

              {expandedId === insp.inspection_id && (
                <div className="border-t px-4 py-3 bg-gray-50">
                  <p className="text-sm mb-3">{insp.summary}</p>
                  {insp.details?.bugs && insp.details.bugs.length > 0 && (
                    <div className="mt-2">
                      <h3 className="text-sm font-semibold text-red-600 mb-1">Harness 缺陷</h3>
                      {insp.details.bugs.map((bug, i) => (
                        <div key={i} className="text-xs bg-red-50 rounded p-2 mb-1">
                          <span
                            className={`rounded px-1 py-0.5 mr-2 ${bug.severity === 'high' ? 'bg-red-200' : bug.severity === 'medium' ? 'bg-yellow-200' : 'bg-gray-200'}`}
                          >
                            {bug.severity}
                          </span>
                          <strong>{bug.title}</strong>: {bug.description}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
