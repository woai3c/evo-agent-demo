// Trigger auto-fix: reads unfixed harness_bug patterns and generates PRs.
// 1. Run `pnpm inspect` first to discover harness bugs
// 2. Run `pnpm autofix` to generate fix PRs
// Run: pnpm autofix
import 'dotenv/config'

import { db } from '../src/db/index.js'
import { runAutoFix } from '../src/evolution/auto-pr.js'

const unfixed = db
  .prepare(
    "SELECT COUNT(*) as c FROM patterns WHERE category = 'harness_bug' AND fix_status = 'unfixed' AND resolution != ''",
  )
  .get() as { c: number }

console.log(`Found ${unfixed.c} unfixed harness bugs. Running auto-fix...`)

if (unfixed.c === 0) {
  console.log('Nothing to fix.')
  process.exit(0)
}

const results = await runAutoFix()

for (const r of results) {
  console.log(`\n[${r.status}] ${r.patternName}`)
  console.log(`  Pattern: ${r.patternId}`)
  console.log(`  Branch: ${r.branch}`)
  if (r.prUrl) console.log(`  PR: ${r.prUrl}`)
  if (r.error) console.log(`  Error: ${r.error}`)
}

console.log(`\nAuto-fix complete: ${results.filter((r) => r.status !== 'failed').length}/${results.length} succeeded`)
