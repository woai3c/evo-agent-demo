import { Activity, AlertTriangle, CheckCircle, Clock, Shield, TrendingUp } from 'lucide-react'

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

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
    { label: '总执行次数', value: data.totalOperations, icon: Activity, color: 'text-blue-600' },
    { label: '成功率', value: `${(data.successRate * 100).toFixed(1)}%`, icon: CheckCircle, color: 'text-green-600' },
    { label: '平均步数', value: data.avgSteps.toFixed(1), icon: TrendingUp, color: 'text-purple-600' },
    { label: 'P95 延迟', value: `${(data.p95Latency / 1000).toFixed(1)}s`, icon: Clock, color: 'text-orange-600' },
    { label: '错误总数', value: data.totalErrors, icon: AlertTriangle, color: 'text-red-600' },
    { label: '未匹配错误', value: data.unmatchedErrors, icon: AlertTriangle, color: 'text-yellow-600' },
    { label: 'Pattern 数', value: data.totalPatterns, icon: Shield, color: 'text-indigo-600' },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">管理面板</h1>

      <div className="grid grid-cols-4 gap-4 mb-8">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border bg-white p-4">
            <div className="flex items-center gap-2 mb-1">
              <s.icon className={`h-4 w-4 ${s.color}`} />
              <p className="text-sm text-gray-500">{s.label}</p>
            </div>
            <p className="text-2xl font-bold">{s.value}</p>
          </div>
        ))}
      </div>

      {data.providerDistribution.length > 0 && (
        <div className="rounded-lg border bg-white p-4 mb-8">
          <h2 className="text-sm font-semibold text-gray-500 mb-3">供应商分布</h2>
          <div className="flex gap-4">
            {data.providerDistribution.map((p) => (
              <div key={p.provider} className="flex items-center gap-2">
                <span className="text-sm font-medium">{p.provider}</span>
                <span className="text-xs bg-gray-100 rounded-full px-2 py-0.5">{p.count} 次</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        {[
          { to: '/admin/traces', label: 'Trace 浏览器', desc: '查看每次 Agent 执行的完整时间线' },
          { to: '/admin/errors', label: '错误分析', desc: '按供应商和错误类型分桶查看' },
          { to: '/admin/patterns', label: 'Pattern 库', desc: '已识别的错误模式和匹配规则' },
          { to: '/admin/inspections', label: '巡检记录', desc: '自动巡检 Agent 的运行日志' },
          { to: '/admin/trends', label: '进化趋势', desc: '成功率、Pattern 覆盖率等趋势图' },
        ].map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="rounded-lg border bg-white p-4 hover:border-blue-500 transition-colors"
          >
            <p className="font-semibold">{item.label}</p>
            <p className="text-sm text-gray-400 mt-1">{item.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
