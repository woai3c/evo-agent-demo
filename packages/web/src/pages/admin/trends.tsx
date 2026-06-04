import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { useEffect, useState } from 'react'

import { fetchTrends } from '../../lib/admin-api'

interface TrendData {
  dailyOperations: { date: string; total: number; success: number }[]
  dailyErrors: { date: string; total: number; matched: number }[]
  patternGrowth: { date: string; new_patterns: number }[]
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
      </div>
    </div>
  )
}
