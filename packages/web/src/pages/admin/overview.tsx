import { Activity, AlertTriangle, CheckCircle, Clock, Shield, TrendingUp, Zap } from 'lucide-react'

import { useEffect, useState } from 'react'

import { fetchOverview } from '../../lib/admin-api'

interface OverviewData {
  totalOperations: number
  successRate: number
  avgSteps: number
  avgDuration: number
  p95Latency: number
  totalErrors: number
  unmatchedErrors: number
  totalPatterns: number
  providerDistribution: { provider: string; count: number }[]
}

export function AdminOverview() {
  const [data, setData] = useState<OverviewData | null>(null)

  useEffect(() => {
    fetchOverview().then(setData)
  }, [])

  if (!data) return <div className="p-6 text-gray-400">加载中...</div>

  const stats = [
    { label: '总执行次数', value: String(data.totalOperations), icon: Activity, color: 'text-blue-600 bg-blue-50' },
    {
      label: '成功率',
      value: `${(data.successRate * 100).toFixed(1)}%`,
      icon: CheckCircle,
      color: 'text-green-600 bg-green-50',
    },
    {
      label: '平均步数',
      value: data.avgSteps.toFixed(1),
      icon: TrendingUp,
      color: 'text-purple-600 bg-purple-50',
    },
    {
      label: 'P95 延迟',
      value: `${(data.p95Latency / 1000).toFixed(1)}s`,
      icon: Clock,
      color: 'text-orange-600 bg-orange-50',
    },
  ]

  const evolutionStats = [
    { label: '错误总数', value: String(data.totalErrors), icon: AlertTriangle, color: 'text-red-600 bg-red-50' },
    {
      label: '未匹配错误',
      value: String(data.unmatchedErrors),
      icon: Zap,
      color: 'text-yellow-600 bg-yellow-50',
    },
    { label: 'Pattern 数', value: String(data.totalPatterns), icon: Shield, color: 'text-indigo-600 bg-indigo-50' },
    {
      label: 'Pattern 覆盖率',
      value:
        data.totalErrors > 0
          ? `${(((data.totalErrors - data.unmatchedErrors) / data.totalErrors) * 100).toFixed(1)}%`
          : '—',
      icon: CheckCircle,
      color: 'text-emerald-600 bg-emerald-50',
    },
  ]

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">概览</h1>

      <h2 className="text-sm font-semibold text-gray-500 mb-3">运行指标</h2>
      <div className="grid grid-cols-4 gap-4 mb-8">
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

      <h2 className="text-sm font-semibold text-gray-500 mb-3">Self-Evolving 指标</h2>
      <div className="grid grid-cols-4 gap-4 mb-8">
        {evolutionStats.map((s) => (
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

      {data.providerDistribution.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 mb-3">供应商分布</h2>
          <div className="rounded-lg border bg-white p-4">
            <div className="flex gap-6">
              {data.providerDistribution.map((p) => {
                const pct = data.totalOperations > 0 ? (p.count / data.totalOperations) * 100 : 0
                return (
                  <div key={p.provider} className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{p.provider}</span>
                      <span className="text-xs text-gray-400">
                        {p.count} 次 ({pct.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
