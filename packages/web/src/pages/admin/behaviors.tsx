import { AlertTriangle, CheckCircle, ChevronDown, ChevronRight, Clock, Coins, Footprints, Gauge } from 'lucide-react'

import { useEffect, useState } from 'react'

import { fetchBehaviors } from '../../lib/admin-api'
import { formatLocalTime } from '../../lib/format'

interface BehaviorRow {
  behaviorId: string
  name: string
  description: string
  toolSequence: string
  operationCount: number
  successRate: number
  avgDuration: number
  avgSteps: number
  avgTokens: number
  avgCost: number
  toolErrorRate: number
  healthScore: number
  healthFlags: string[]
  suggestion: string
  suggestionSeverity: 'none' | 'critical' | 'suggestion'
  fixStatus: 'none' | 'unfixed' | 'branch_created' | 'pr_created' | 'merged'
  fixPrUrl: string | null
  sampleOperations: { id: string; title: string | null }[]
  firstSeen: string
  lastSeen: string
}

interface BehaviorSummary {
  totalBehaviors: number
  unhealthyCount: number
  avgHealthScore: number
}

const FLAG_LABELS: Record<string, { label: string; color: string }> = {
  low_success_rate: { label: '成功率低', color: 'bg-red-100 text-red-700' },
  high_latency: { label: '延迟高', color: 'bg-orange-100 text-orange-700' },
  high_step_count: { label: '步数多', color: 'bg-yellow-100 text-yellow-700' },
  high_cost: { label: '费用高', color: 'bg-purple-100 text-purple-700' },
  high_tool_error_rate: { label: '工具出错率高', color: 'bg-red-100 text-red-700' },
}

function HealthBar({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color = score >= 0.8 ? 'bg-green-500' : score >= 0.6 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span
        className={`text-xs font-mono ${score >= 0.8 ? 'text-green-600' : score >= 0.6 ? 'text-yellow-600' : 'text-red-600'}`}
      >
        {pct}%
      </span>
    </div>
  )
}

export function AdminBehaviors() {
  const [behaviors, setBehaviors] = useState<BehaviorRow[]>([])
  const [summary, setSummary] = useState<BehaviorSummary | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    fetchBehaviors().then((data) => {
      setBehaviors(data.behaviors)
      setSummary(data.summary)
    })
  }, [])

  if (!summary) return <div className="p-6 text-gray-400">加载中...</div>

  const stats = [
    { label: '行为模式', value: String(summary.totalBehaviors), icon: Footprints, color: 'text-blue-600 bg-blue-50' },
    {
      label: '不健康',
      value: String(summary.unhealthyCount),
      icon: AlertTriangle,
      color: 'text-red-600 bg-red-50',
    },
    {
      label: '健康的',
      value: String(summary.totalBehaviors - summary.unhealthyCount),
      icon: CheckCircle,
      color: 'text-green-600 bg-green-50',
    },
    {
      label: '平均健康度',
      value: `${(summary.avgHealthScore * 100).toFixed(0)}%`,
      icon: Gauge,
      color: 'text-cyan-600 bg-cyan-50',
    },
  ]

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">行为分析</h1>
        <p className="text-sm text-gray-500 mt-1">
          基于对话内容和 Trace 数据的语义聚类 + 确定性健康评估（灵感来自 Adaline Evaluators）
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border bg-white p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={`rounded-lg p-1.5 ${s.color}`}>
                <s.icon className="h-4 w-4" />
              </div>
              <p className="text-sm text-gray-500">{s.label}</p>
            </div>
            <p className="text-2xl font-bold">{s.value}</p>
          </div>
        ))}
      </div>

      {behaviors.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Footprints className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>暂无行为数据。请先进行一些对话，然后运行巡检。</p>
          <p className="text-xs mt-1">行为分析在巡检的 Phase 2 阶段自动执行</p>
        </div>
      ) : (
        <div className="space-y-3">
          {behaviors.map((b) => {
            const expanded = expandedId === b.behaviorId
            return (
              <div key={b.behaviorId} className="border rounded-lg bg-white overflow-hidden">
                <div
                  className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-gray-50"
                  onClick={() => setExpandedId(expanded ? null : b.behaviorId)}
                >
                  <div className="shrink-0">
                    {expanded ? (
                      <ChevronDown className="h-4 w-4 text-gray-400" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{b.name}</span>
                      <span className="text-xs text-gray-400 font-mono">{b.operationCount} ops</span>
                      {b.healthFlags.map((f) => {
                        const info = FLAG_LABELS[f]
                        return info ? (
                          <span key={f} className={`text-[10px] px-1.5 py-0.5 rounded ${info.color}`}>
                            {info.label}
                          </span>
                        ) : null
                      })}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      {b.description}
                      <span className="text-gray-400 ml-2">{formatLocalTime(b.firstSeen)}</span>
                    </p>
                  </div>

                  <div className="shrink-0 flex items-center gap-6 text-xs text-gray-500">
                    <div className="text-center">
                      <div className="font-mono">{(b.successRate * 100).toFixed(0)}%</div>
                      <div className="text-[10px]">成功率</div>
                    </div>
                    <div className="text-center">
                      <div className="font-mono">{(b.avgDuration / 1000).toFixed(1)}s</div>
                      <div className="text-[10px]">延迟</div>
                    </div>
                    <div className="text-center">
                      <div className="font-mono">{b.avgSteps.toFixed(1)}</div>
                      <div className="text-[10px]">步数</div>
                    </div>
                    <div className="text-center">
                      <div className="font-mono">¥{b.avgCost.toFixed(4)}</div>
                      <div className="text-[10px]">费用</div>
                    </div>
                    <HealthBar score={b.healthScore} />
                  </div>
                </div>

                {expanded && (
                  <div className="border-t px-5 py-4 bg-gray-50 space-y-4">
                    {/* Tool sequence */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 mb-1">工具调用序列</h4>
                      <p className="text-sm font-mono bg-white rounded border px-3 py-2">{b.toolSequence}</p>
                    </div>

                    {/* Metrics grid */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 mb-2">详细指标</h4>
                      <div className="grid grid-cols-6 gap-3">
                        {[
                          { label: '成功率', value: `${(b.successRate * 100).toFixed(1)}%`, icon: CheckCircle },
                          { label: '平均延迟', value: `${(b.avgDuration / 1000).toFixed(1)}s`, icon: Clock },
                          { label: '平均步数', value: b.avgSteps.toFixed(1), icon: Footprints },
                          {
                            label: '平均 Token',
                            value:
                              b.avgTokens > 1000
                                ? `${(b.avgTokens / 1000).toFixed(1)}k`
                                : String(Math.round(b.avgTokens)),
                            icon: Gauge,
                          },
                          { label: '平均费用', value: `¥${b.avgCost.toFixed(4)}`, icon: Coins },
                          {
                            label: '工具出错率',
                            value: `${(b.toolErrorRate * 100).toFixed(1)}%`,
                            icon: AlertTriangle,
                          },
                        ].map((m) => (
                          <div key={m.label} className="bg-white rounded border px-3 py-2">
                            <div className="flex items-center gap-1 text-[10px] text-gray-400 mb-0.5">
                              <m.icon className="h-3 w-3" />
                              {m.label}
                            </div>
                            <div className="text-sm font-mono font-medium">{m.value}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Health evaluation */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 mb-1">健康评估</h4>
                      <div className="flex items-center gap-2">
                        <HealthBar score={b.healthScore} />
                        {b.healthFlags.length === 0 && <span className="text-xs text-green-600">所有维度健康</span>}
                        {b.healthFlags.map((f) => {
                          const info = FLAG_LABELS[f]
                          return info ? (
                            <span key={f} className={`text-xs px-2 py-0.5 rounded ${info.color}`}>
                              {info.label}
                            </span>
                          ) : null
                        })}
                      </div>
                    </div>

                    {/* Suggestion */}
                    {b.suggestion && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 mb-1 flex items-center gap-2">
                          优化建议
                          {b.suggestionSeverity === 'critical' && (
                            <span className="text-[10px] rounded px-1.5 py-0.5 bg-red-100 text-red-700 font-normal">
                              强烈建议（可自动修复）
                            </span>
                          )}
                          {b.suggestionSeverity === 'suggestion' && (
                            <span className="text-[10px] rounded px-1.5 py-0.5 bg-gray-100 text-gray-600 font-normal">
                              一般建议
                            </span>
                          )}
                        </h4>
                        <div
                          className={`text-sm rounded px-3 py-2 ${
                            b.suggestionSeverity === 'critical'
                              ? 'bg-red-50 border border-red-200 text-red-900'
                              : 'bg-amber-50 border border-amber-200 text-amber-900'
                          }`}
                        >
                          {b.suggestion}
                        </div>
                        {b.suggestionSeverity === 'critical' && b.fixStatus !== 'none' && (
                          <div className="mt-1.5 flex items-center gap-2 text-xs">
                            <span className="text-gray-500">修复状态：</span>
                            {b.fixPrUrl ? (
                              <a
                                href={b.fixPrUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                PR 已创建
                              </a>
                            ) : (
                              <span
                                className={`rounded-full px-2 py-0.5 ${
                                  b.fixStatus === 'unfixed'
                                    ? 'bg-red-100 text-red-600'
                                    : b.fixStatus === 'branch_created'
                                      ? 'bg-yellow-100 text-yellow-700'
                                      : b.fixStatus === 'merged'
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-gray-100 text-gray-600'
                                }`}
                              >
                                {b.fixStatus === 'unfixed'
                                  ? '待修复（运行巡检 B）'
                                  : b.fixStatus === 'branch_created'
                                    ? '已创建分支'
                                    : b.fixStatus === 'merged'
                                      ? '已合并'
                                      : b.fixStatus}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Sample operations */}
                    {b.sampleOperations.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-500 mb-1">代表性 Operation</h4>
                        <div className="flex flex-wrap gap-1">
                          {b.sampleOperations.map((op) => (
                            <a
                              key={op.id}
                              href={`/admin/traces?op=${op.id}`}
                              title={op.title ?? op.id}
                              className="inline-block max-w-[220px] truncate rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-600 hover:underline"
                            >
                              {op.title || `${op.id.slice(0, 16)}...`}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
