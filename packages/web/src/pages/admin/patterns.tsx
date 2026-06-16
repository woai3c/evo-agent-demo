import { Pencil, Plus } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { useEffect, useState } from 'react'

import { createPattern, fetchPatterns, fetchTrends, updatePattern } from '../../lib/admin-api'

interface PatternRow {
  pattern_id: string
  name: string
  category: string
  provider: string
  error_type: string
  match_rule: Record<string, unknown>
  user_message: string
  resolution: string
  hit_count: number
  status: string
  created_by: string
  first_seen: string
  fix_status: string
  fix_pr_url: string | null
}

const CATEGORY_LABELS: Record<string, { text: string; color: string }> = {
  user_error: { text: '用户侧', color: 'bg-yellow-100 text-yellow-700' },
  provider_error: { text: '供应商侧', color: 'bg-orange-100 text-orange-700' },
  harness_bug: { text: 'Harness 缺陷', color: 'bg-red-100 text-red-700' },
}

const EMPTY_FORM = {
  name: '',
  category: 'user_error',
  provider: '*',
  errorType: '',
  statusCode: '',
  messageRegex: '',
  userMessage: '',
  resolution: '',
}

export function AdminPatterns() {
  const [patterns, setPatterns] = useState<PatternRow[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [trendData, setTrendData] = useState<{ date: string; cumulative: number; new_patterns: number }[]>([])

  const load = () => fetchPatterns().then((data) => setPatterns(data.patterns))

  const loadTrend = () =>
    fetchTrends(90).then((data) => {
      const growth = data.patternGrowth as { date: string; new_patterns: number }[]
      let cumulative = 0
      setTrendData(
        growth.map((g) => {
          cumulative += g.new_patterns
          return { date: g.date, cumulative, new_patterns: g.new_patterns }
        }),
      )
    })

  useEffect(() => {
    load()
    loadTrend()
  }, [])

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  const openEdit = (p: PatternRow) => {
    const rule = p.match_rule || {}
    setEditingId(p.pattern_id)
    setForm({
      name: p.name,
      category: p.category,
      provider: p.provider,
      errorType: p.error_type,
      statusCode: rule.statusCode != null ? String(rule.statusCode) : '',
      messageRegex: (rule.messageRegex as string) || '',
      userMessage: p.user_message,
      resolution: p.resolution,
    })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name || !form.errorType) return
    setSaving(true)
    try {
      const matchRule: Record<string, unknown> = { errorType: form.errorType }
      if (form.statusCode) matchRule.statusCode = Number(form.statusCode)
      if (form.messageRegex) matchRule.messageRegex = form.messageRegex
      if (form.provider !== '*') matchRule.provider = form.provider

      if (editingId) {
        await updatePattern(editingId, {
          name: form.name,
          category: form.category,
          provider: form.provider,
          error_type: form.errorType,
          match_rule: matchRule,
          user_message: form.userMessage,
          resolution: form.resolution,
        })
      } else {
        await createPattern({
          name: form.name,
          category: form.category,
          provider: form.provider,
          errorType: form.errorType,
          matchRule,
          userMessage: form.userMessage,
          resolution: form.resolution,
        })
      }
      setForm(EMPTY_FORM)
      setEditingId(null)
      setShowForm(false)
      await load()
    } finally {
      setSaving(false)
    }
  }

  const handleToggleStatus = async (p: PatternRow) => {
    const newStatus = p.status === 'active' ? 'resolved' : 'active'
    await updatePattern(p.pattern_id, { status: newStatus })
    await load()
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Pattern 库</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          手动添加
        </button>
      </div>

      {showForm && (
        <div className="border rounded-lg bg-white p-4 mb-6 space-y-3">
          <h3 className="font-medium text-sm text-gray-700">{editingId ? '编辑 Pattern' : '新建 Pattern'}</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">名称 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如 deepseek-rate-limit-429"
                className="w-full rounded border px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">分类</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full rounded border px-2 py-1.5 text-sm"
              >
                <option value="user_error">用户侧错误</option>
                <option value="provider_error">供应商侧错误</option>
                <option value="harness_bug">Harness 缺陷</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">供应商</label>
              <input
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                placeholder="* 表示通用"
                className="w-full rounded border px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">错误类型 *</label>
              <input
                value={form.errorType}
                onChange={(e) => setForm({ ...form, errorType: e.target.value })}
                placeholder="如 rate_limit"
                className="w-full rounded border px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">状态码（可选）</label>
              <input
                value={form.statusCode}
                onChange={(e) => setForm({ ...form, statusCode: e.target.value })}
                placeholder="如 429"
                className="w-full rounded border px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">消息正则（可选）</label>
              <input
                value={form.messageRegex}
                onChange={(e) => setForm({ ...form, messageRegex: e.target.value })}
                placeholder="如 rate limit"
                className="w-full rounded border px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">用户提示语</label>
            <input
              value={form.userMessage}
              onChange={(e) => setForm({ ...form, userMessage: e.target.value })}
              placeholder="显示给用户的友好错误信息"
              className="w-full rounded border px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">修复方式</label>
            <input
              value={form.resolution}
              onChange={(e) => setForm({ ...form, resolution: e.target.value })}
              placeholder="描述如何修复此类错误"
              className="w-full rounded border px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving || !form.name || !form.errorType}
              className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:bg-gray-300"
            >
              {saving ? '保存中...' : editingId ? '保存修改' : '创建'}
            </button>
            <button
              onClick={() => {
                setShowForm(false)
                setEditingId(null)
              }}
              className="rounded border px-4 py-1.5 text-sm hover:bg-gray-50"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {trendData.length > 1 && (
        <div className="border rounded-lg bg-white p-4 mb-6">
          <h3 className="text-sm font-medium text-gray-700 mb-3">Pattern 累积趋势</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip
                labelFormatter={(v) => `日期: ${v}`}
                formatter={(value: number, name: string) => [value, name === 'cumulative' ? '累计 Pattern' : '新增']}
              />
              <Line
                type="monotone"
                dataKey="cumulative"
                stroke="#3b82f6"
                strokeWidth={2}
                name="cumulative"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="new_patterns"
                stroke="#93c5fd"
                strokeDasharray="4 2"
                name="new_patterns"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

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
                <th className="px-4 py-2 text-left">修复</th>
                <th className="px-4 py-2 text-left">创建方式</th>
                <th className="px-4 py-2 text-left">操作</th>
              </tr>
            </thead>
            <tbody>
              {patterns.map((p) => {
                const cat = CATEGORY_LABELS[p.category] ?? { text: p.category, color: 'bg-gray-100' }
                return (
                  <tr key={p.pattern_id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium" title={p.user_message}>
                      {p.name}
                    </td>
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
                    <td className="px-4 py-2">
                      {p.category === 'harness_bug' ? (
                        p.fix_pr_url ? (
                          <a
                            href={p.fix_pr_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline"
                          >
                            PR 已创建
                          </a>
                        ) : (
                          <span
                            className={`text-xs rounded-full px-2 py-0.5 ${
                              p.fix_status === 'unfixed'
                                ? 'bg-red-100 text-red-600'
                                : p.fix_status === 'branch_created'
                                  ? 'bg-yellow-100 text-yellow-700'
                                  : p.fix_status === 'merged'
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {p.fix_status === 'unfixed'
                              ? '待修复'
                              : p.fix_status === 'branch_created'
                                ? '已创建分支'
                                : p.fix_status === 'merged'
                                  ? '已合并'
                                  : p.fix_status}
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">{p.created_by}</td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => openEdit(p)}
                          className="text-xs rounded px-2 py-1 text-blue-600 hover:bg-blue-50"
                          title="编辑"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleToggleStatus(p)}
                          className={`text-xs rounded px-2 py-1 ${
                            p.status === 'active'
                              ? 'text-gray-600 hover:bg-gray-100'
                              : 'text-green-600 hover:bg-green-50'
                          }`}
                        >
                          {p.status === 'active' ? '停用' : '启用'}
                        </button>
                      </div>
                    </td>
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
