import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { fetchErrorBuckets } from '../../lib/admin-api'

interface ErrorRecord {
  error_id: string
  operation_id: string
  provider: string
  error_type: string
  status_code: number | null
  message: string
  tool_name: string | null
  pattern_id: string | null
  pattern_name: string | null
  pattern_category: string | null
  created_at: string
}

interface ErrorData {
  buckets: { provider: string; error_type: string; count: number }[]
  topUnmatched: { message: string; provider: string; error_type: string; tool_name: string | null; count: number }[]
  byTool: { tool_name: string; count: number }[]
  dailyErrorTrend: { date: string; error_type: string; count: number }[]
  recentErrors: ErrorRecord[]
}

function heatColor(count: number, max: number): string {
  if (count === 0 || max === 0) return 'bg-gray-50 text-gray-300'
  const ratio = count / max
  if (ratio > 0.6) return 'bg-red-500 text-white font-bold'
  if (ratio > 0.3) return 'bg-red-300 text-red-900'
  if (ratio > 0.1) return 'bg-red-100 text-red-700'
  return 'bg-red-50 text-red-600'
}

const TREND_COLORS = ['#ef4444', '#f97316', '#eab308', '#3b82f6', '#8b5cf6', '#06b6d4']

const CATEGORY_COLORS: Record<string, string> = {
  user_error: 'bg-yellow-100 text-yellow-700',
  provider_error: 'bg-orange-100 text-orange-700',
  harness_bug: 'bg-red-100 text-red-700',
}

function formatLocalTime(utcStr: string): string {
  const d = new Date(utcStr.endsWith('Z') ? utcStr : utcStr + 'Z')
  if (isNaN(d.getTime())) return utcStr
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function AdminErrors() {
  const [data, setData] = useState<ErrorData | null>(null)

  useEffect(() => {
    fetchErrorBuckets().then(setData)
  }, [])

  if (!data) return <div className="p-6 text-gray-400">加载中...</div>

  const hasData = data.buckets.length > 0 || data.topUnmatched.length > 0

  const providers = [...new Set(data.buckets.map((b) => b.provider))]
  const errorTypes = [...new Set(data.buckets.map((b) => b.error_type))]
  const bucketMap = new Map(data.buckets.map((b) => [`${b.provider}|${b.error_type}`, b.count]))
  const maxCount = Math.max(...data.buckets.map((b) => b.count), 1)

  const trendTypes = [...new Set((data.dailyErrorTrend ?? []).map((d) => d.error_type))]
  const trendDates = [...new Set((data.dailyErrorTrend ?? []).map((d) => d.date))].sort()
  const trendData = trendDates.map((date) => {
    const row: Record<string, unknown> = { date }
    for (const et of trendTypes) {
      row[et] = (data.dailyErrorTrend ?? []).find((d) => d.date === date && d.error_type === et)?.count ?? 0
    }
    return row
  })

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">错误分析</h1>

      {!hasData ? (
        <p className="text-gray-400">暂无错误记录。</p>
      ) : (
        <div className="space-y-8">
          {/* Heatmap */}
          {providers.length > 0 && errorTypes.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-3">错误热力图（供应商 x 类型）</h2>
              <div className="border rounded-lg bg-white overflow-auto">
                <table className="text-sm">
                  <thead>
                    <tr>
                      <th className="px-4 py-2 text-left text-gray-500 bg-gray-50 sticky left-0 z-10">供应商</th>
                      {errorTypes.map((et) => (
                        <th key={et} className="px-4 py-2 text-center text-gray-500 bg-gray-50 whitespace-nowrap">
                          {et}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {providers.map((p) => (
                      <tr key={p} className="border-t">
                        <td className="px-4 py-2 font-medium bg-white sticky left-0 z-10">{p}</td>
                        {errorTypes.map((et) => {
                          const count = bucketMap.get(`${p}|${et}`) ?? 0
                          return (
                            <td key={et} className="px-1 py-1 text-center">
                              <div
                                className={`rounded px-3 py-1.5 text-xs tabular-nums ${heatColor(count, maxCount)}`}
                                title={`${p} / ${et}: ${count}`}
                              >
                                {count}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Trend chart */}
          {trendData.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-3">错误趋势（按类型）</h2>
              <div className="border rounded-lg bg-white p-4">
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    {trendTypes.map((et, i) => (
                      <Line
                        key={et}
                        type="monotone"
                        dataKey={et}
                        stroke={TREND_COLORS[i % TREND_COLORS.length]}
                        name={et}
                        strokeWidth={2}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          {/* Recent errors list */}
          {data.recentErrors && data.recentErrors.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-3">
                错误明细
                <span className="text-sm font-normal text-gray-400 ml-2">共 {data.recentErrors.length} 条</span>
              </h2>
              <div className="border rounded-lg bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-4 py-2 text-left">时间</th>
                      <th className="px-4 py-2 text-left">Operation</th>
                      <th className="px-4 py-2 text-left">供应商</th>
                      <th className="px-4 py-2 text-left">类型</th>
                      <th className="px-4 py-2 text-left">工具</th>
                      <th className="px-4 py-2 text-left">错误消息</th>
                      <th className="px-4 py-2 text-left">匹配 Pattern</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentErrors.map((e) => (
                      <tr key={e.error_id} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">
                          {formatLocalTime(e.created_at)}
                        </td>
                        <td className="px-4 py-2">
                          <Link
                            to={`/admin/traces?op=${e.operation_id}`}
                            className="text-xs font-mono text-blue-600 hover:underline"
                            title={e.operation_id}
                          >
                            {e.operation_id.slice(0, 12)}...
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-xs">{e.provider}</td>
                        <td className="px-4 py-2">
                          <span className="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">
                            {e.error_type}
                          </span>
                          {e.status_code && <span className="ml-1 text-xs text-gray-400">{e.status_code}</span>}
                        </td>
                        <td className="px-4 py-2 text-xs">{e.tool_name ?? '—'}</td>
                        <td className="px-4 py-2 font-mono text-xs max-w-xs truncate" title={e.message}>
                          {e.message}
                        </td>
                        <td className="px-4 py-2">
                          {e.pattern_id ? (
                            <Link to="/admin/patterns" className="text-xs hover:underline">
                              <span
                                className={`rounded-full px-2 py-0.5 ${CATEGORY_COLORS[e.pattern_category ?? ''] ?? 'bg-green-100 text-green-700'}`}
                              >
                                {e.pattern_name}
                              </span>
                            </Link>
                          ) : (
                            <span className="text-xs text-gray-400">未匹配</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Top unmatched */}
          {data.topUnmatched.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-3">Top 未匹配错误</h2>
              <div className="border rounded-lg bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-4 py-2 text-left">错误消息</th>
                      <th className="px-4 py-2 text-left">供应商</th>
                      <th className="px-4 py-2 text-left">类型</th>
                      <th className="px-4 py-2 text-left">工具</th>
                      <th className="px-4 py-2 text-right">次数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topUnmatched.map((e, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-4 py-2 font-mono text-xs max-w-md truncate">{e.message}</td>
                        <td className="px-4 py-2">{e.provider}</td>
                        <td className="px-4 py-2 text-xs">{e.error_type}</td>
                        <td className="px-4 py-2 text-xs">{e.tool_name ?? '—'}</td>
                        <td className="px-4 py-2 text-right font-semibold">{e.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* By tool */}
          {data.byTool.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-3">按工具分布</h2>
              <div className="flex gap-3">
                {data.byTool.map((t) => (
                  <div key={t.tool_name} className="border rounded-lg bg-white px-4 py-2">
                    <span className="text-sm font-medium">{t.tool_name}</span>
                    <span className="ml-2 text-xs bg-red-50 text-red-700 rounded-full px-2 py-0.5">{t.count}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
