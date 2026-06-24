import { Check, Copy, GitPullRequest, Loader2, Play, ScrollText, Wrench } from 'lucide-react'

import { useEffect, useRef, useState } from 'react'

import { fetchAutofixRuns, fetchInspections, triggerAutoFix, triggerInspection } from '../../lib/admin-api'
import { formatLocalTime } from '../../lib/format'

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

interface AutofixRunRow {
  run_id: string
  started_at: string
  finished_at: string | null
  total_targets: number
  pr_created: number
  branch_created: number
  failed: number
  results: AutoFixResultItem[]
}

// Module-level state survives component remount
let activePromise: Promise<unknown> | null = null
let activeType: 'inspect' | 'autofix' | null = null
let cachedInspectLogs: string[] = []
let cachedAutofixLogs: string[] = []
let cachedFixResults: AutoFixResultItem[] | null = null

function LogPanel({ logs, title }: { logs: string[]; title: string }) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  if (logs.length === 0) return null

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(logs.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable (e.g. non-secure context) */
    }
  }

  return (
    <div className="border rounded-lg bg-gray-900 text-gray-100 mb-6 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 border-b border-gray-700">
        <ScrollText className="h-4 w-4 text-gray-400" />
        <span className="text-xs font-medium text-gray-300">{title}</span>
        <span className="text-[10px] text-gray-500 ml-auto">{logs.length} 条日志</span>
        <button
          onClick={copyLogs}
          title="复制全部日志"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-gray-300 hover:bg-gray-700"
        >
          {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto p-3 font-mono text-xs leading-relaxed space-y-0.5">
        {logs.map((log, i) => (
          <div key={i} className={log.includes('✗') ? 'text-red-400' : log.includes('✓') ? 'text-green-400' : ''}>
            <span className="text-gray-500 select-none mr-2">{String(i + 1).padStart(3, ' ')}</span>
            {log}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

export function AdminInspections() {
  const [inspections, setInspections] = useState<InspectionRow[]>([])
  const [running, setRunning] = useState(() => activeType === 'inspect')
  const [fixing, setFixing] = useState(() => activeType === 'autofix')
  const [inspectLogs, setInspectLogs] = useState<string[]>(() => [...cachedInspectLogs])
  const [autofixLogs, setAutofixLogs] = useState<string[]>(() => [...cachedAutofixLogs])
  const [fixResults, setFixResults] = useState<AutoFixResultItem[] | null>(() => cachedFixResults)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [tab, setTab] = useState<'inspect' | 'autofix'>('inspect')
  const [autofixRuns, setAutofixRuns] = useState<AutofixRunRow[]>([])
  const mountedRef = useRef(true)

  const load = () => fetchInspections().then((data) => setInspections(data.inspections))
  const loadAutofixRuns = () =>
    fetchAutofixRuns()
      .then((data) => setAutofixRuns(data?.runs ?? []))
      .catch(() => setAutofixRuns([]))

  const appendInspectLog = (msg: string) => {
    cachedInspectLogs.push(msg)
    setInspectLogs((prev) => [...prev, msg])
  }

  const appendAutofixLog = (msg: string) => {
    cachedAutofixLogs.push(msg)
    setAutofixLogs((prev) => [...prev, msg])
  }

  useEffect(() => {
    mountedRef.current = true
    load()
    loadAutofixRuns()

    if (activePromise) {
      activePromise.then(() => {
        if (!mountedRef.current) return
        setRunning(false)
        setFixing(false)
        load()
        loadAutofixRuns()
      })
    }

    return () => {
      mountedRef.current = false
    }
  }, [])

  const runInspection = async () => {
    setRunning(true)
    setTab('inspect')
    setInspectLogs([])
    cachedInspectLogs = []
    activeType = 'inspect'

    const promise = triggerInspection({
      onLog: (msg) => {
        if (mountedRef.current) appendInspectLog(msg)
        else cachedInspectLogs.push(msg)
      },
    })
    activePromise = promise

    try {
      await promise
      if (mountedRef.current) await load()
    } finally {
      activePromise = null
      activeType = null
      if (mountedRef.current) setRunning(false)
    }
  }

  const runAutofix = async () => {
    setFixing(true)
    setTab('autofix')
    setAutofixLogs([])
    setFixResults(null)
    cachedAutofixLogs = []
    cachedFixResults = null
    activeType = 'autofix'

    const promise = triggerAutoFix({
      onLog: (msg) => {
        if (mountedRef.current) appendAutofixLog(msg)
        else cachedAutofixLogs.push(msg)
      },
      onDone: (data) => {
        const results = (data as { results?: AutoFixResultItem[] }).results ?? []
        cachedFixResults = results
        if (mountedRef.current) setFixResults(results)
      },
    })
    activePromise = promise

    try {
      await promise
    } finally {
      activePromise = null
      activeType = null
      if (mountedRef.current) {
        setFixing(false)
        loadAutofixRuns()
      }
    }
  }

  const totalCost = inspections.reduce((sum, i) => sum + i.cost, 0)
  const busy = running || fixing

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">巡检记录</h1>
          <p className="text-sm text-gray-500 mt-1">
            {tab === 'inspect'
              ? `共 ${inspections.length} 轮巡检，累计成本 ¥${totalCost.toFixed(4)}`
              : `共 ${autofixRuns.length} 次自动修复`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={runInspection}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? '巡检中...' : '巡检 A：识别 Pattern'}
          </button>
          <button
            onClick={runAutofix}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700 disabled:bg-gray-300"
          >
            {fixing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
            {fixing ? '修复中...' : '巡检 B：自动修复'}
          </button>
        </div>
      </div>

      {/* Tabs: Inspection A history vs Auto-fix (Inspection B) history */}
      <div className="flex gap-1 border-b mb-4">
        <button
          onClick={() => setTab('inspect')}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === 'inspect' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          巡检 A 记录（{inspections.length}）
        </button>
        <button
          onClick={() => setTab('autofix')}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === 'autofix' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          自动修复记录（{autofixRuns.length}）
        </button>
      </div>

      {tab === 'inspect' ? (
        <LogPanel logs={inspectLogs} title="巡检 A 执行日志" />
      ) : (
        <LogPanel logs={autofixLogs} title="巡检 B 自动修复日志" />
      )}

      {tab === 'inspect' ? (
        <>
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
                        <p className="text-xs text-gray-400 mt-0.5">{formatLocalTime(insp.started_at)}</p>
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
        </>
      ) : (
        <>
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
                        {r.status === 'pr_created'
                          ? '已创建 PR'
                          : r.status === 'branch_created'
                            ? '已创建分支'
                            : '失败'}
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

          {autofixRuns.length === 0 ? (
            <p className="text-gray-400">暂未运行过自动修复。点击上方“巡检 B：自动修复”开始。</p>
          ) : (
            <div className="space-y-3">
              {autofixRuns.map((run) => (
                <div key={run.run_id} className="border rounded-lg bg-white">
                  <button
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50"
                    onClick={() => setExpandedId(expandedId === run.run_id ? null : run.run_id)}
                  >
                    <div className="flex items-center gap-4">
                      <GitPullRequest className="h-5 w-5 text-emerald-600" />
                      <div>
                        <div className="flex items-center gap-3 text-sm">
                          <span>处理 {run.total_targets} 个目标</span>
                          {run.pr_created > 0 && (
                            <span className="font-medium text-green-600">{run.pr_created} PR</span>
                          )}
                          {run.branch_created > 0 && (
                            <span className="font-medium text-yellow-600">{run.branch_created} 分支</span>
                          )}
                          {run.failed > 0 && <span className="font-medium text-red-600">{run.failed} 失败</span>}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">{formatLocalTime(run.started_at)}</p>
                      </div>
                    </div>
                  </button>

                  {expandedId === run.run_id && (
                    <div className="border-t px-4 py-3 bg-gray-50 space-y-1.5">
                      {run.results.length === 0 ? (
                        <p className="text-sm text-gray-400">无目标</p>
                      ) : (
                        run.results.map((r) => (
                          <div key={r.sourceId} className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-[10px] rounded px-1.5 py-0.5 ${r.source === 'pattern' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}
                              >
                                {r.source === 'pattern' ? 'Bug 修复' : '行为优化'}
                              </span>
                              <span>{r.sourceName}</span>
                            </div>
                            {r.prUrl ? (
                              <a
                                href={r.prUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline"
                              >
                                PR
                              </a>
                            ) : (
                              <span className="text-xs text-gray-400">
                                {r.status === 'failed' ? '失败' : r.status === 'branch_created' ? '仅分支' : r.status}
                              </span>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
