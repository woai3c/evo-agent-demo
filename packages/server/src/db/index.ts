import type Database from 'better-sqlite3'

import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { initDatabase } from './schema.js'

const dbPath = process.env.DB_PATH || resolve('data', 'evo.db')
const dir = dirname(dbPath)
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true })
}

export const db: Database.Database = initDatabase(dbPath)
