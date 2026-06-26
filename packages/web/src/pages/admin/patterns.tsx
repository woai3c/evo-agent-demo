import { ChevronDown, Pencil, Plus, X } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { useCallback, useEffect, useRef, useState } from 'react'

import { createPattern, fetchPatterns, fetchTrends, updatePattern } from '../../lib/admin-api'
import { formatLocalTime } from '../../lib/format'

interface PatternRow {
  pattern_id: string
  name: string
  category: string
  provider: string
  error_type: string
  match_rule: Record<string, unknown>
  sample_error: string | null
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
  ignore: { text: '已忽略', color: 'bg-gray-100 text-gray-500' },
}

function formatCreatedBy(createdBy: string): string {
  if (createdBy === 'manual') return '手动'
  const m = createdBy.match(/^inspector_round_(\d+)$/)
  return m ? `巡检 #${m[1]}` : createdBy
}

const EMPTY_FORM = {
  name: '',
  category: 'user_error',
  provider: '*',
  errorType: '',
  statusCode: '',
  messageRegex: '',
}

export function AdminPatterns() {
  const [patterns, setPatterns] = useState<PatternRow[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingManual, setEditingManual] = useState(true)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [trendData, setTrendData] = useState<{ date: string; cumulative: number; new_patterns: number }[]>([])

  const dialogRef = useRef<HTMLDialogElement>(null)

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

  const openDialog = useCallback(() => dialogRef.current?.showModal(), [])
  const closeDialog = useCallback(() => {
    dialogRef.current?.close()
    setShowForm(false)
    setEditingId(null)
  }, [])

  const openCreate = () => {
    setEditingId(null)
    setEditingManual(true)
    setForm(EMPTY_FORM)
    setShowForm(true)
    openDialog()
  }

  const openEdit = (p: PatternRow) => {
    const rule = p.match_rule || {}
    setEditingId(p.pattern_id)
    setEditingManual(p.created_by === 'manual')
    setForm({
      name: p.name,
      category: p.category,
      provider: p.provider,
      errorType: p.error_type,
      statusCode: rule.statusCode != null ? String(rule.statusCode) : '',
      messageRegex: (rule.messageRegex as string) || '',
    })
    setShowForm(true)
    openDialog()
  }

  const handleSave = async () => {
    if (!form.name || !form.errorType) return
    setSaving(true)
    try {
      // Auto-generated patterns are derived from collected errors — only the
      // LLM-assigned category may be corrected; everything else stays locked.
      if (editingId && !editingManual) {
        const patch: Record<string, string> = { category: form.category }
        if (form.category === 'ignore') patch.status = 'resolved'
        await updatePattern(editingId, patch)
        closeDialog()
        await load()
        return
      }

      const matchRule: Record<string, unknown> = { errorType: form.errorType }
      if (form.statusCode) matchRule.statusCode = Number(form.statusCode)
      if (form.messageRegex) matchRule.messageRegex = form.messageRegex
      if (form.provider !== '*') matchRule.provider = form.provider

      if (editingId) {
        const update: Record<string, unknown> = {
          name: form.name,
          category: form.category,
          provider: form.provider,
          error_type: form.errorType,
          match_rule: matchRule,
        }
        if (form.category === 'ignore') update.status = 'resolved'
        await updatePattern(editingId, update)
      } else {
        await createPattern({
          name: form.name,
          category: form.category,
          provider: form.provider,
          errorType: form.errorType,
          matchRule,
        })
      }
      closeDialog()
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

  const handleFixStatusChange = async (p: PatternRow, newFixStatus: string) => {
    await updatePattern(p.pattern_id, {
      fix_status: newFixStatus,
      ...(newFixStatus === 'unfixed' ? { fix_pr_url: null } : {}),
    })
    await load()
  }

  const locked = editingId !== null && !editingManual

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

      <dialog
        ref={dialogRef}
        className="rounded-xl bg-white p-0 shadow-xl backdrop:bg-black/40 w-full max-w-lg"
        onClose={closeDialog}
        onClick={(e) => {
          if (e.target === dialogRef.current) closeDialog()
        }}
      >
        {showForm && (
          <div className="p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-gray-800">{editingId ? '编辑 Pattern' : '新建 Pattern'}</h3>
                {locked && (
                  <p className="mt-0.5 text-xs text-gray-400">
                    自动生成的 Pattern 仅可修改「分类」，其余字段由错误采集生成，不可改
                  </p>
                )}
              </div>
              <button onClick={closeDialog} className="rounded-full p-1 hover:bg-gray-100">
                <X className="h-4 w-4 text-gray-400" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">名称 *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="如 deepseek-rate-limit-429"
                  disabled={locked}
                  className={`w-full rounded border px-2 py-1.5 text-sm ${locked ? 'bg-gray-100 text-gray-400' : ''}`}
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
                  <option value="ignore">忽略</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">供应商</label>
                <input
                  value={form.provider}
                  onChange={(e) => setForm({ ...form, provider: e.target.value })}
                  placeholder="* 表示通用"
                  disabled={locked}
                  className={`w-full rounded border px-2 py-1.5 text-sm ${locked ? 'bg-gray-100 text-gray-400' : ''}`}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">错误类型 *</label>
                <input
                  value={form.errorType}
                  onChange={(e) => setForm({ ...form, errorType: e.target.value })}
                  placeholder="如 rate_limit"
                  disabled={locked}
                  className={`w-full rounded border px-2 py-1.5 text-sm ${locked ? 'bg-gray-100 text-gray-400' : ''}`}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">状态码（可选）</label>
                <input
                  value={form.statusCode}
                  onChange={(e) => setForm({ ...form, statusCode: e.target.value })}
                  placeholder="如 429"
                  disabled={locked}
                  className={`w-full rounded border px-2 py-1.5 text-sm ${locked ? 'bg-gray-100 text-gray-400' : ''}`}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">消息正则（可选）</label>
                <input
                  value={form.messageRegex}
                  onChange={(e) => setForm({ ...form, messageRegex: e.target.value })}
                  placeholder="如 rate limit"
                  disabled={locked}
                  className={`w-full rounded border px-2 py-1.5 text-sm ${locked ? 'bg-gray-100 text-gray-400' : ''}`}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={closeDialog} className="rounded border px-4 py-1.5 text-sm hover:bg-gray-50">
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name || !form.errorType}
                className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:bg-gray-300"
              >
                {saving ? '保存中...' : editingId ? '保存修改' : '创建'}
              </button>
            </div>
          </div>
        )}
      </dialog>

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
        <div className="border rounded-lg bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left whitespace-nowrap">名称</th>
                <th className="px-4 py-2 text-left whitespace-nowrap">分类</th>
                <th className="px-4 py-2 text-left whitespace-nowrap">供应商</th>
                <th className="px-4 py-2 text-left whitespace-nowrap">错误类型</th>
                <th className="px-4 py-2 text-left whitespace-nowrap">错误样本</th>
                <th className="px-4 py-2 text-right whitespace-nowrap">匹配次数</th>
                <th className="px-4 py-2 text-left whitespace-nowrap">状态</th>
                <th className="px-4 py-2 text-left whitespace-nowrap">修复</th>
                <th className="px-4 py-2 text-left whitespace-nowrap">创建方式</th>
                <th className="px-4 py-2 text-left whitespace-nowrap">创建时间</th>
                <th className="px-4 py-2 text-left whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody>
              {patterns.map((p) => {
                const cat = CATEGORY_LABELS[p.category] ?? { text: p.category, color: 'bg-gray-100' }
                return (
                  <tr key={p.pattern_id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium">{p.name}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-block whitespace-nowrap text-xs rounded-full px-2 py-0.5 ${cat.color}`}>
                        {cat.text}
                      </span>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{p.provider}</td>
                    <td className="px-4 py-2 text-xs whitespace-nowrap">{p.error_type}</td>
                    <td className="px-4 py-2">
                      {p.sample_error ? (
                        <div className="max-w-[260px] truncate text-xs text-gray-600" title={p.sample_error}>
                          {p.sample_error}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold">{p.hit_count}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block whitespace-nowrap text-xs rounded-full px-2 py-0.5 ${p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
                      >
                        {p.status === 'active' ? '活跃' : p.status === 'resolved' ? '已解决' : p.status}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {p.category === 'harness_bug' ? (
                        <div className="flex items-center gap-1.5">
                          <div className="relative inline-block">
                            <select
                              value={p.fix_status}
                              onChange={(e) => handleFixStatusChange(p, e.target.value)}
                              className={`appearance-none text-xs rounded-full pl-2 pr-5 py-0.5 cursor-pointer border-0 ${
                                p.fix_status === 'unfixed'
                                  ? 'bg-red-100 text-red-600'
                                  : p.fix_status === 'pr_created'
                                    ? 'bg-blue-100 text-blue-600'
                                    : p.fix_status === 'branch_created'
                                      ? 'bg-yellow-100 text-yellow-700'
                                      : p.fix_status === 'merged'
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              <option value="unfixed">待修复</option>
                              <option value="branch_created">已创建分支</option>
                              <option value="pr_created">PR 已创建</option>
                              <option value="merged">已合并</option>
                              <option value="ignore">忽略</option>
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3 opacity-50" />
                          </div>
                          {p.fix_pr_url && (
                            <a
                              href={p.fix_pr_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline"
                            >
                              PR
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap" title={p.created_by}>
                      {formatCreatedBy(p.created_by)}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">
                      {formatLocalTime(p.first_seen)}
                    </td>
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
                          className={`whitespace-nowrap text-xs rounded px-2 py-1 ${
                            p.status === 'active'
                              ? 'text-gray-600 hover:bg-gray-100'
                              : 'text-green-600 hover:bg-green-50'
                          }`}
                        >
                          {p.status === 'active' ? '解决' : '激活'}
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
