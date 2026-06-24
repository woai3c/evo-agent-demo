import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { useEffect, useState } from 'react'

import { fetchTrends } from '../../lib/admin-api'
import { formatLocalTime } from '../../lib/format'

interface TrendData {
  dailyOperations: { date: string; total: number; success: number }[]
  dailyErrors: { date: string; total: number; matched: number }[]
  patternGrowth: { date: string; new_patterns: number }[]
  dailyTokens: { date: string; avg_tokens: number }[]
  inspectionSnapshots: {
    round: number
    started_at: string
    traces_analyzed: number
    new_patterns: number
    harness_bugs: number
    cost: number
    success_rate_before: number
    success_rate_after: number
    unmatched_before: number
    unmatched_after: number
    patterns_before: number
    patterns_after: number
  }[]
}

export function AdminTrends() {
  const [data, setData] = useState<TrendData | null>(null)

  useEffect(() => {
    fetchTrends(30).then(setData)
  }, [])

  if (!data) return <div className="p-6 text-gray-400">加载中...</div>

  const hasOps = data.dailyOperations.length > 0
  const hasErrors = data.dailyErrors.length > 0
  const hasPatterns = data.patternGrowth.length > 0
  const hasTokens = data.dailyTokens.length > 0
  const hasSnapshots = data.inspectionSnapshots.length > 0

  if (!hasOps && !hasErrors && !hasPatterns) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">进化趋势</h1>
        <p className="text-gray-400">数据不足，暂无法展示趋势。继续使用 Evo 来积累数据吧！</p>
      </div>
    )
  }

  const successRateData = data.dailyOperations.map((d) => ({
    date: d.date,
    rate: d.total > 0 ? ((d.success / d.total) * 100).toFixed(1) : 0,
    total: d.total,
  }))

  const unmatchedRateData = data.dailyErrors.map((d) => ({
    date: d.date,
    rate: d.total > 0 ? (((d.total - d.matched) / d.total) * 100).toFixed(1) : 0,
    total: d.total,
  }))

  const cumulativePatterns = data.patternGrowth.reduce<{ date: string; cumulative: number; new: number }[]>(
    (acc, d) => {
      const prev = acc.length > 0 ? acc[acc.length - 1].cumulative : 0
      acc.push({ date: d.date, cumulative: prev + d.new_patterns, new: d.new_patterns })
      return acc
    },
    [],
  )

  const tokenData = data.dailyTokens.map((d) => ({
    date: d.date,
    avgTokens: Math.round(d.avg_tokens),
  }))

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">进化趋势</h1>

      <div className="space-y-8">
        {hasOps && (
          <section className="border rounded-lg bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-500 mb-4">成功率趋势</h2>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={successRateData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="rate" stroke="#22c55e" name="成功率 (%)" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </section>
        )}

        {hasErrors && (
          <section className="border rounded-lg bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-500 mb-4">未匹配错误比例</h2>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={unmatchedRateData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="rate" stroke="#ef4444" name="未匹配率 (%)" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </section>
        )}

        {hasPatterns && (
          <section className="border rounded-lg bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-500 mb-4">累计 Pattern 增长</h2>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={cumulativePatterns}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="cumulative" stroke="#6366f1" name="累计 Pattern" strokeWidth={2} />
                <Line type="monotone" dataKey="new" stroke="#a5b4fc" name="新增 Pattern" strokeWidth={1} />
              </LineChart>
            </ResponsiveContainer>
          </section>
        )}

        {hasTokens && (
          <section className="border rounded-lg bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-500 mb-4">平均 Token 消耗趋势</h2>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={tokenData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Line type="monotone" dataKey="avgTokens" stroke="#f59e0b" name="平均 Token" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </section>
        )}

        {hasSnapshots && (
          <section className="border rounded-lg bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-500 mb-4">巡检 Before / After 对比</h2>
            <div className="overflow-x-auto">
              <table className="w-full whitespace-nowrap text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left">轮次</th>
                    <th className="px-3 py-2 text-left">时间</th>
                    <th className="px-3 py-2 text-right">分析错误</th>
                    <th className="px-3 py-2 text-right">新 Pattern</th>
                    <th className="px-3 py-2 text-center">成功率变化</th>
                    <th className="px-3 py-2 text-center">未匹配错误变化</th>
                    <th className="px-3 py-2 text-center">Pattern 总数变化</th>
                    <th className="px-3 py-2 text-right">成本</th>
                  </tr>
                </thead>
                <tbody>
                  {data.inspectionSnapshots.map((s) => (
                    <tr key={s.round} className="border-t">
                      <td className="px-3 py-2 font-bold text-blue-600">#{s.round}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{formatLocalTime(s.started_at)}</td>
                      <td className="px-3 py-2 text-right">{s.traces_analyzed}</td>
                      <td className="px-3 py-2 text-right text-green-600">+{s.new_patterns}</td>
                      <td className="px-3 py-2 text-center text-xs">
                        {(s.success_rate_before * 100).toFixed(1)}% → {(s.success_rate_after * 100).toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-center text-xs">
                        {s.unmatched_before} → {s.unmatched_after}
                        {s.unmatched_after < s.unmatched_before && (
                          <span className="text-green-600 ml-1">({s.unmatched_after - s.unmatched_before})</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center text-xs">
                        {s.patterns_before} → {s.patterns_after}
                      </td>
                      <td className="px-3 py-2 text-right text-xs">¥{s.cost.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
