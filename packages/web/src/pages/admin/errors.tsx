import { useEffect, useState } from 'react'

import { fetchErrorBuckets } from '../../lib/admin-api'

interface ErrorData {
  buckets: { provider: string; error_type: string; count: number }[]
  topUnmatched: { message: string; provider: string; error_type: string; tool_name: string | null; count: number }[]
  byTool: { tool_name: string; count: number }[]
}

export function AdminErrors() {
  const [data, setData] = useState<ErrorData | null>(null)

  useEffect(() => {
    fetchErrorBuckets().then(setData)
  }, [])

  if (!data) return <div className="p-6 text-gray-400">加载中...</div>

  const hasData = data.buckets.length > 0 || data.topUnmatched.length > 0

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">错误分析</h1>

      {!hasData ? (
        <p className="text-gray-400">暂无错误记录。</p>
      ) : (
        <div className="space-y-8">
          {data.buckets.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-3">错误分桶（供应商 × 类型）</h2>
              <div className="border rounded-lg bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-4 py-2 text-left">供应商</th>
                      <th className="px-4 py-2 text-left">错误类型</th>
                      <th className="px-4 py-2 text-right">数量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.buckets.map((b, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-4 py-2">{b.provider}</td>
                        <td className="px-4 py-2">
                          <span className="bg-red-50 text-red-700 rounded px-2 py-0.5 text-xs">{b.error_type}</span>
                        </td>
                        <td className="px-4 py-2 text-right font-semibold">{b.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

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
