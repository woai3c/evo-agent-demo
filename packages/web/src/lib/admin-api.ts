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

export interface SSECallbacks {
  onLog?: (message: string) => void
  onDone?: (data: unknown) => void
  onError?: (error: string) => void
}

async function consumeSSE(url: string, callbacks: SSECallbacks): Promise<unknown> {
  const res = await fetch(url, { method: 'POST' })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    const msg = body.error ?? `HTTP ${res.status}`
    callbacks.onError?.(msg)
    return null
  }

  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: unknown = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    let currentEvent = ''
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
      } else if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (currentEvent === 'log') {
          callbacks.onLog?.(data)
        } else if (currentEvent === 'done') {
          result = JSON.parse(data)
          callbacks.onDone?.(result)
        } else if (currentEvent === 'error') {
          const parsed = JSON.parse(data)
          callbacks.onError?.(parsed.error ?? data)
        }
        currentEvent = ''
      }
    }
  }

  return result
}

export async function triggerInspection(callbacks: SSECallbacks = {}) {
  return consumeSSE(`${BASE}/inspections/run`, callbacks)
}

export async function triggerAutoFix(callbacks: SSECallbacks = {}) {
  return consumeSSE(`${BASE}/inspections/autofix`, callbacks)
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
