const BASE = '/api'

export async function fetchOverview() {
  const res = await fetch(`${BASE}/dashboard/overview`)
  return res.json()
}

export async function fetchTraces(params?: {
  status?: string
  provider?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}) {
  const qs = new URLSearchParams()
  if (params?.status) qs.set('status', params.status)
  if (params?.provider) qs.set('provider', params.provider)
  if (params?.from) qs.set('from', params.from)
  if (params?.to) qs.set('to', params.to)
  if (params?.limit) qs.set('limit', String(params.limit))
  if (params?.offset) qs.set('offset', String(params.offset))
  const res = await fetch(`${BASE}/traces?${qs}`)
  return res.json()
}

export async function fetchTraceDetail(operationId: string) {
  const res = await fetch(`${BASE}/traces/${operationId}`)
  return res.json()
}

export async function fetchErrorBuckets() {
  const res = await fetch(`${BASE}/dashboard/errors`)
  return res.json()
}

export async function fetchPatterns() {
  const res = await fetch(`${BASE}/patterns`)
  return res.json()
}

export async function fetchTrends(days = 30) {
  const res = await fetch(`${BASE}/dashboard/trends?days=${days}`)
  return res.json()
}

export async function fetchBehaviors() {
  const res = await fetch(`${BASE}/dashboard/behaviors`)
  return res.json()
}

export async function fetchInspections() {
  const res = await fetch(`${BASE}/inspections`)
  return res.json()
}

export async function triggerAutoFix() {
  const res = await fetch(`${BASE}/inspections/autofix`, { method: 'POST' })
  return res.json()
}

export async function createPattern(body: {
  name: string
  category: string
  provider: string
  errorType: string
  matchRule: Record<string, unknown>
  userMessage: string
  resolution: string
}) {
  const res = await fetch(`${BASE}/patterns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

export async function updatePattern(
  patternId: string,
  body: {
    status?: string
    name?: string
    user_message?: string
    resolution?: string
    category?: string
    provider?: string
    error_type?: string
    match_rule?: Record<string, unknown>
  },
) {
  const res = await fetch(`${BASE}/patterns/${patternId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}
