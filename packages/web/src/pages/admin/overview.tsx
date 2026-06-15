import { Activity, AlertTriangle, CheckCircle, Clock, Hash, Shield, TrendingUp, Zap } from 'lucide-react'

import { useEffect, useState } from 'react'

import { fetchOverview } from '../../lib/admin-api'

interface OverviewData {
  totalOperations: number
  todayOperations: number
  weekOperations: number
  monthOperations: number
  successRate: number
  avgSteps: number
  avgDuration: number
  avgTokens: number
  p95Latency: number
  totalErrors: number
  unmatchedErrors: number
  totalPatterns: number
  providerDistribution: { provider: string; count: number }[]
  successRateSparkline: number[]
}

const PIE_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#06b6d4']

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null
  const w = 80
  const h = 24
  const max = Math.max(...data, 0.01)
  const min = Math.min(...data, 0)
  const range = max - min || 0.01
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ')
  return (
    <svg width={w} height={h} className="ml-2 inline-block">
      <polyline fill="none" stroke="#22c55e" strokeWidth="1.5" points={points} />
    </svg>
  )
}

function PieChart({ data, total }: { data: { provider: string; count: number }[]; total: number }) {
  if (data.length === 0 || total === 0) return null
  const size = 180
  const cx = size / 2
  const cy = size / 2
  const r = 70

  const slices = data.reduce<{ path: string; color: string; provider: string; count: number; endAngle: number }[]>(
    (acc, d, i) => {
      const startAngle = acc.length > 0 ? acc[acc.length - 1].endAngle : -Math.PI / 2
      const angle = (d.count / total) * 2 * Math.PI
      const endAngle = startAngle + angle
      const x1 = cx + r * Math.cos(startAngle)
      const y1 = cy + r * Math.sin(startAngle)
      const x2 = cx + r * Math.cos(endAngle)
      const y2 = cy + r * Math.sin(endAngle)
      const large = angle > Math.PI ? 1 : 0
      const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
      acc.push({ path, color: PIE_COLORS[i % PIE_COLORS.length], provider: d.provider, count: d.count, endAngle })
      return acc
    },
    [],
  )

  return (
    <div className="flex items-center gap-6">
      <svg width={size} height={size}>
        {slices.map((s) => (
          <path key={s.provider} d={s.path} fill={s.color} stroke="white" strokeWidth="2">
            <title>
              {s.provider}: {s.count} ({((s.count / total) * 100).toFixed(0)}%)
            </title>
          </path>
        ))}
      </svg>
      <div className="space-y-1.5">
        {slices.map((s) => (
          <div key={s.provider} className="flex items-center gap-2 text-sm">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: s.color }} />
            <span>
              {s.provider}: {s.count} ({((s.count / total) * 100).toFixed(0)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function AdminOverview() {
  const [data, setData] = useState<OverviewData | null>(null)

  useEffect(() => {
    fetchOverview().then(setData)
  }, [])

  if (!data) return <div className="p-6 text-gray-400">加载中...</div>

  const stats = [
    {
      label: '执行次数',
      value: String(data.totalOperations),
      icon: Activity,
      color: 'text-blue-600 bg-blue-50',
      sub: `今日 ${data.todayOperations} · 本周 ${data.weekOperations} · 本月 ${data.monthOperations}`,
    },
    {
      label: '成功率',
      value: `${(data.successRate * 100).toFixed(1)}%`,
      icon: CheckCircle,
      color: 'text-green-600 bg-green-50',
      sparkline: data.successRateSparkline,
    },
    {
      label: '平均步数',
      value: data.avgSteps.toFixed(1),
      icon: TrendingUp,
      color: 'text-purple-600 bg-purple-50',
    },
    {
      label: '平均 Token',
      value: data.avgTokens > 1000 ? `${(data.avgTokens / 1000).toFixed(1)}k` : String(Math.round(data.avgTokens)),
      icon: Hash,
      color: 'text-cyan-600 bg-cyan-50',
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
      <div className="grid grid-cols-5 gap-4 mb-8">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border bg-white p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={`rounded-lg p-1.5 ${s.color}`}>
                <s.icon className="h-4 w-4" />
              </div>
              <p className="text-sm text-gray-500">{s.label}</p>
            </div>
            <div className="flex items-center">
              <p className="text-2xl font-bold">{s.value}</p>
              {'sparkline' in s && s.sparkline && <Sparkline data={s.sparkline} />}
            </div>
            {'sub' in s && s.sub && <p className="text-xs text-gray-400 mt-1">{s.sub}</p>}
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
            <PieChart data={data.providerDistribution} total={data.totalOperations} />
          </div>
        </div>
      )}
    </div>
  )
}
