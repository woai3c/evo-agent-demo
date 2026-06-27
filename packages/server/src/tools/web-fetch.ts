import { tool } from 'ai'

import { z } from 'zod'

const PRIVATE_IP_RE =
  /^(127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|0\.0\.0\.0|localhost|::1|\[::1\])$/i

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export const webFetchTool = tool({
  description:
    `Fetch a web page by URL and return its text content. Useful for reading articles, documentation, or any public web page after finding URLs via webSearch. ` +
    `When summarizing the returned content for the user, preserve key details, concrete examples, section structure, and numbers — don't over-compress. ` +
    `Content is capped at 20,000 characters; longer pages are truncated.`,
  parameters: z.object({
    url: z.string().url().describe('The URL to fetch'),
  }),
  execute: async ({ url }) => {
    const parsed = new URL(url)
    if (PRIVATE_IP_RE.test(parsed.hostname)) {
      return { error: 'Fetching private/internal URLs is not allowed', url }
    }

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Evo-Agent/1.0' },
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      })

      if (!res.ok) {
        return { error: `HTTP ${res.status} ${res.statusText}`, statusCode: res.status, url }
      }

      const contentType = res.headers.get('content-type') ?? ''
      const raw = await res.text()
      const text = contentType.includes('text/html') ? stripHtml(raw) : raw

      const maxLength = 20_000
      const truncated = text.length > maxLength
      return {
        url,
        contentLength: text.length,
        truncated,
        text: truncated ? text.slice(0, maxLength) + '\n\n... [content truncated]' : text,
      }
    } catch (err) {
      // Network failure / DNS / timeout (AbortSignal) would otherwise throw and
      // kill the agent loop; return an error result so the model can recover.
      const message = err instanceof Error ? err.message : String(err)
      return { error: `Failed to fetch URL: ${message}`, url }
    }
  },
})
