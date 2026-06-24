import { readFile } from 'node:fs/promises'
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

    const MAX_RETRIES = 3
    const BASE_DELAY_MS = 100

    const retryWithBackoff = async (fn: () => Promise<string>, retries: number): Promise<string> => {
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          return await fn()
        } catch (err: any) {
          if (err.code === 'ENOENT') throw err // permanent
          if (attempt === retries - 1) throw err
          await new Promise(resolve => setTimeout(resolve, BASE_DELAY_MS * Math.pow(2, attempt)))
        }
      }
      throw new Error('Unreachable')
    }

    try {
      const content = await retryWithBackoff(() => readFile(resolved, 'utf-8'), MAX_RETRIES)
      const truncated = content.length > MAX_SIZE
      return {
        fileName: fileId,
        contentLength: content.length,
        truncated,
        content: truncated ? content.slice(0, MAX_SIZE) + '\n\n... [file truncated]' : content,
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { error: `File not found: ${fileId}` }
      }
      return { error: `Failed to read file: ${fileId}. Error: ${err.message}` }
    }
  },
})
