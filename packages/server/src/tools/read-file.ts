import { readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'

import { tool } from 'ai'

import { z } from 'zod'

const UPLOADS_DIR = resolve('data', 'uploads')
const ALLOWED_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.log'])
const MAX_SIZE = 50_000

export const readFileTool = tool({
  description:
    'Read a user-uploaded document from the uploads directory. Supports .txt, .md, .csv, .json, and .log files. ' +
    'Files larger than 50,000 characters are truncated. Pass only the filename (e.g. "report.txt"), not a full path.',
  parameters: z.object({
    fileId: z.string().describe('File name in the uploads directory (e.g. "report.txt")'),
  }),
  execute: async ({ fileId }) => {
    const resolved = resolve(UPLOADS_DIR, fileId)
    if (!resolved.startsWith(UPLOADS_DIR)) {
      return { error: 'Invalid file path' }
    }

    const ext = extname(fileId).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return { error: `Unsupported file type: ${ext}. Supported: ${[...ALLOWED_EXTENSIONS].join(', ')}` }
    }

    if (!existsSync(resolved)) {
      return { error: `File not found: ${fileId}` }
    }

    try {
      const content = readFileSync(resolved, 'utf-8')
      const truncated = content.length > MAX_SIZE
      return {
        fileName: fileId,
        contentLength: content.length,
        truncated,
        content: truncated ? content.slice(0, MAX_SIZE) + '\n\n... [file truncated]' : content,
      }
    } catch {
      return { error: `File not found: ${fileId}` }
    }
  },
})
