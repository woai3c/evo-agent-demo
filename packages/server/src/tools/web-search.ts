import { tool } from 'ai'

import { z } from 'zod'

export const webSearchTool = tool({
  description: 'Search the web using a search engine. Returns a list of results with titles, URLs, and snippets.',
  parameters: z.object({
    query: z.string().describe('The search query'),
    maxResults: z.number().optional().default(5).describe('Maximum number of results (1-10)'),
  }),
  execute: async ({ query, maxResults }) => {
    const apiKey = process.env.TAVILY_API_KEY
    if (!apiKey) {
      return { error: 'Web search is not configured (TAVILY_API_KEY missing)', results: [] }
    }

    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: Math.min(maxResults, 10),
        include_answer: true,
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { error: `Search API error: ${res.status} ${text.slice(0, 200)}`, results: [] }
    }

    const data = await res.json()
    return {
      answer: data.answer ?? null,
      results: (data.results ?? []).map((r: Record<string, unknown>) => ({
        title: r.title,
        url: r.url,
        snippet: typeof r.content === 'string' ? r.content.slice(0, 500) : '',
      })),
    }
  },
})
