import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'

import { Hono } from 'hono'

const UPLOADS_DIR = resolve('data', 'uploads')
const ALLOWED_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.log'])
const MAX_FILE_SIZE = 1_000_000 // 1 MB

/** Ensure the uploads directory exists */
export function ensureUploadsDir() {
  if (!existsSync(UPLOADS_DIR)) {
    mkdirSync(UPLOADS_DIR, { recursive: true })
  }
}

/**
 * Sanitize a filename: strip path separators, collapse whitespace,
 * and limit total length to 200 characters.
 */
function sanitizeFilename(raw: string): string {
  let name = raw.replace(/[\\/]/g, '').replace(/\.\./g, '').trim()
  name = name.replace(/\s+/g, '_')
  if (name.length > 200) {
    const ext = extname(name)
    name = name.slice(0, 200 - ext.length) + ext
  }
  return name || 'unnamed'
}

export const uploadsRoutes = new Hono()

uploadsRoutes.post('/', async (c) => {
  ensureUploadsDir()

  const body = await c.req.parseBody()
  const file = body['file']

  if (!file || typeof file === 'string') {
    return c.json({ error: 'A file field is required' }, 400)
  }

  const blob = file as File
  const ext = extname(blob.name).toLowerCase()

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return c.json({ error: `Unsupported file type: ${ext}. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}` }, 400)
  }

  if (blob.size > MAX_FILE_SIZE) {
    return c.json({ error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1_000_000} MB` }, 400)
  }

  const filename = sanitizeFilename(blob.name)
  const dest = resolve(UPLOADS_DIR, filename)

  // Prevent path traversal after sanitization
  if (!dest.startsWith(UPLOADS_DIR)) {
    return c.json({ error: 'Invalid filename' }, 400)
  }

  const buffer = Buffer.from(await blob.arrayBuffer())
  writeFileSync(dest, buffer)

  return c.json({ success: true, fileId: filename, size: buffer.length })
})

uploadsRoutes.get('/', async (c) => {
  ensureUploadsDir()

  const entries = readdirSync(UPLOADS_DIR)
  const files = entries
    .filter((name) => ALLOWED_EXTENSIONS.has(extname(name).toLowerCase()))
    .map((name) => {
      const stat = statSync(resolve(UPLOADS_DIR, name))
      return { fileId: name, size: stat.size, createdAt: stat.birthtime.toISOString() }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return c.json({ files })
})
