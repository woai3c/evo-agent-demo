const BASE = '/api'

export async function fetchOverview() {
  const res = await fetch(`${BASE}/dashboard/overview`)
  return res.json()
}

export async function fetchTraces(params?: { status?: string; provider?: string; limit?: number; offset?: number }) {
  const qs = new URLSearchParams()
  if (params?.status) qs.set('status', params.status)
  if (params?.provider) qs.set('provider', params.provider)
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

export async function fetchInspections() {
  const res = await fetch(`${BASE}/inspections`)
  return res.json()
}
