// Manually trigger one inspection round.
// 1. Run `pnpm simulate` first to accumulate error traces
// 2. Run `pnpm inspect` to see patterns discovered
// 3. Open admin dashboard to see trends update
// Run: pnpm inspect
import { config } from 'dotenv'

import { resolve } from 'node:path'

import { db } from '../src/db/index.js'
import { runInspection } from '../src/evolution/inspector.js'

config({ path: resolve(import.meta.dirname, '../../../.env') })

const errorCount = (db.prepare('SELECT COUNT(*) as c FROM errors WHERE pattern_id IS NULL').get() as { c: number }).c
console.log(`Found ${errorCount} unmatched errors. Running inspection...`)

const inspectionId = await runInspection()

const inspection = db.prepare('SELECT * FROM inspections WHERE inspection_id = ?').get(inspectionId) as Record<
  string,
  unknown
>

console.log(`\nInspection complete:`)
console.log(`  Round: ${inspection.round}`)
console.log(`  Traces analyzed: ${inspection.traces_analyzed}`)
console.log(`  New patterns: ${inspection.new_patterns}`)
console.log(`  Harness bugs: ${inspection.harness_bugs}`)
console.log(`  Cost: $${(inspection.cost as number).toFixed(4)}`)
console.log(`  Summary: ${inspection.summary}`)

const remainingUnmatched = (
  db.prepare('SELECT COUNT(*) as c FROM errors WHERE pattern_id IS NULL').get() as { c: number }
).c
const totalErrors = (db.prepare('SELECT COUNT(*) as c FROM errors').get() as { c: number }).c
const totalPatterns = (db.prepare('SELECT COUNT(*) as c FROM patterns').get() as { c: number }).c

console.log(`\nAfter inspection:`)
console.log(`  Total patterns: ${totalPatterns}`)
console.log(`  Unmatched errors: ${remainingUnmatched}/${totalErrors}`)
console.log(
  `  Coverage: ${totalErrors > 0 ? (((totalErrors - remainingUnmatched) / totalErrors) * 100).toFixed(1) : 0}%`,
)
