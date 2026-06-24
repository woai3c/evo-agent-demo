import Database from 'better-sqlite3'

import { tool } from 'ai'

import { z } from 'zod'

import { dbPath } from '../db/index.js'

// dbQuery executes untrusted, LLM-generated SQL. The string guards below are
// best-effort UX only; the real enforcement is this dedicated read-only
// connection, so a bypassed guard (leading comment / CTE / RETURNING clause)
// still cannot mutate the database.
let readonlyDb: Database
const MAX_RETRIES = 3
for (let i = 0; i < MAX_RETRIES; i++) {
  try {
    readonlyDb = new Database(dbPath, { readonly: true })
    break
  } catch (e) {
    if (i === MAX_RETRIES - 1) throw e
  }
}

const FORBIDDEN_RE = /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|REINDEX|VACUUM)\b/i
const MAX_ROWS = 100

const SCHEMA_HINT = `Available tables (Chinook music store):
- artists (artist_id, name)
- albums (album_id, title, artist_id)
- tracks (track_id, name, album_id, media_type_id, genre_id, composer, milliseconds, bytes, unit_price)
- genres (genre_id, name)
- media_types (media_type_id, name)
- playlists (playlist_id, name)
- playlist_track (playlist_id, track_id)
- customers (customer_id, first_name, last_name, company, address, city, state, country, postal_code, phone, fax, email, support_rep_id)
- employees (employee_id, last_name, first_name, title, reports_to, birth_date, hire_date, address, city, state, country, postal_code, phone, fax, email)
- invoices (invoice_id, customer_id, invoice_date, billing_address, billing_city, billing_state, billing_country, billing_postal_code, total)
- invoice_items (invoice_line_id, invoice_id, track_id, unit_price, quantity)`

export const dbQueryTool = tool({
  description: `Run a read-only SQL query against the Chinook demo database (a digital music store). Only SELECT statements are allowed.\n\n${SCHEMA_HINT}`,
  parameters: z.object({
    sql: z.string().describe('A SELECT SQL query'),
  }),
  execute: async ({ sql }) => {
    if (FORBIDDEN_RE.test(sql)) {
      return { error: 'Only SELECT queries are allowed' }
    }

    if (sql.includes(';') && sql.replace(/;[\s]*$/, '').includes(';')) {
      return { error: 'Multiple statements are not allowed' }
    }

    const trimmedSql = sql.trim()
    if (!trimmedSql || !trimmedSql.toUpperCase().startsWith('SELECT')) {
      return { error: 'Only SELECT queries are allowed' }
    }

    try {
      const rows = readonlyDb.prepare(sql).all() as Record<string, unknown>[]
      const truncated = rows.length > MAX_ROWS
      const limited = truncated ? rows.slice(0, MAX_ROWS) : rows
      const columns = limited.length > 0 ? Object.keys(limited[0]) : []

      return {
        columns,
        rowCount: rows.length,
        truncated,
        rows: limited,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { error: `SQL error: ${message}` }
    }
  },
})
