import { Loader2, Play } from 'lucide-react'

import { useEffect, useState } from 'react'

import { fetchInspections } from '../../lib/admin-api'

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

export function AdminInspections() {
  const [inspections, setInspections] = useState<InspectionRow[]>([])
  const [running, setRunning] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = () => fetchInspections().then((data) => setInspections(data.inspections))

  useEffect(() => {
    load()
  }, [])

  const triggerInspection = async () => {
    setRunning(true)
    try {
      await fetch('/api/inspections/run', { method: 'POST' })
      await load()
    } finally {
      setRunning(false)
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
        <button
          onClick={triggerInspection}
          disabled={running}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:bg-gray-300"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? '巡检中...' : '运行巡检'}
        </button>
      </div>

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
