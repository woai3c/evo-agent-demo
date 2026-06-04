import { useEffect, useState } from 'react'

import { fetchPatterns } from '../../lib/admin-api'

interface PatternRow {
  pattern_id: string
  name: string
  category: string
  provider: string
  error_type: string
  match_rule: Record<string, unknown>
  user_message: string
  hit_count: number
  status: string
  created_by: string
  first_seen: string
}

const CATEGORY_LABELS: Record<string, { text: string; color: string }> = {
  user_error: { text: '用户侧', color: 'bg-yellow-100 text-yellow-700' },
  provider_error: { text: '供应商侧', color: 'bg-orange-100 text-orange-700' },
  harness_bug: { text: 'Harness 缺陷', color: 'bg-red-100 text-red-700' },
}

export function AdminPatterns() {
  const [patterns, setPatterns] = useState<PatternRow[]>([])

  useEffect(() => {
    fetchPatterns().then((data) => setPatterns(data.patterns))
  }, [])

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Pattern 库</h1>

      {patterns.length === 0 ? (
        <p className="text-gray-400">暂未发现任何 Pattern。请先运行一次巡检或手动添加。</p>
      ) : (
        <div className="border rounded-lg bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">名称</th>
                <th className="px-4 py-2 text-left">分类</th>
                <th className="px-4 py-2 text-left">供应商</th>
                <th className="px-4 py-2 text-left">错误类型</th>
                <th className="px-4 py-2 text-right">匹配次数</th>
                <th className="px-4 py-2 text-left">状态</th>
                <th className="px-4 py-2 text-left">创建方式</th>
                <th className="px-4 py-2 text-left">发现时间</th>
              </tr>
            </thead>
            <tbody>
              {patterns.map((p) => {
                const cat = CATEGORY_LABELS[p.category] ?? { text: p.category, color: 'bg-gray-100' }
                return (
                  <tr key={p.pattern_id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium">{p.name}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs rounded-full px-2 py-0.5 ${cat.color}`}>{cat.text}</span>
                    </td>
                    <td className="px-4 py-2">{p.provider}</td>
                    <td className="px-4 py-2 text-xs">{p.error_type}</td>
                    <td className="px-4 py-2 text-right font-semibold">{p.hit_count}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`text-xs rounded-full px-2 py-0.5 ${p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
                      >
                        {p.status === 'active' ? '活跃' : p.status === 'resolved' ? '已解决' : p.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">{p.created_by}</td>
                    <td className="px-4 py-2 text-xs text-gray-400">{p.first_seen}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
