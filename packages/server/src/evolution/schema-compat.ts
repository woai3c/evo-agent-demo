import { db } from '../db/index.js'

interface AliasMapping {
  toolName: string
  wrongParam: string
  correctParam: string
  hitCount: number
}

let aliasCache: AliasMapping[] | null = null

export function invalidateSchemaCompatCache(): void {
  aliasCache = null
}

export function learnSchemaAliases(): { newAliases: number; totalAliases: number } {
  const failedCalls = db
    .prepare(
      `SELECT tool_name, tool_input, error
       FROM steps
       WHERE type = 'call_tool' AND tool_success = 0 AND tool_input IS NOT NULL AND error IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 200`,
    )
    .all() as { tool_name: string; tool_input: string; error: string }[]

  const toolSchemas: Record<string, string[]> = {
    webSearch: ['query', 'maxResults'],
    webFetch: ['url'],
    readFile: ['filename'],
    codeRunner: ['code', 'timeout'],
    dbQuery: ['sql'],
    sendEmail: ['to', 'subject', 'body'],
  }

  const candidates = new Map<string, { toolName: string; wrongParam: string; correctParam: string; count: number }>()

  for (const row of failedCalls) {
    const schema = toolSchemas[row.tool_name]
    if (!schema) continue

    let input: Record<string, unknown>
    try {
      input = JSON.parse(row.tool_input)
    } catch {
      continue
    }

    const inputKeys = Object.keys(input)
    const extraKeys = inputKeys.filter((k) => !schema.includes(k))
    const missingKeys = schema.filter((k) => !(k in input))

    if (extraKeys.length === 1 && missingKeys.length === 1) {
      const wrong = extraKeys[0]
      const correct = missingKeys[0]
      const key = `${row.tool_name}:${wrong}→${correct}`
      const existing = candidates.get(key)
      if (existing) {
        existing.count++
      } else {
        candidates.set(key, { toolName: row.tool_name, wrongParam: wrong, correctParam: correct, count: 1 })
      }
    }
  }

  const existingAliases = db.prepare('SELECT tool_name, wrong_param, correct_param FROM schema_aliases').all() as {
    tool_name: string
    wrong_param: string
    correct_param: string
  }[]
  const existingSet = new Set(existingAliases.map((a) => `${a.tool_name}:${a.wrong_param}→${a.correct_param}`))

  let newAliases = 0
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO schema_aliases (tool_name, wrong_param, correct_param, hit_count, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  )
  const updateStmt = db.prepare(
    `UPDATE schema_aliases SET hit_count = hit_count + ? WHERE tool_name = ? AND wrong_param = ? AND correct_param = ?`,
  )

  for (const [key, c] of candidates) {
    if (c.count < 2) continue
    if (existingSet.has(key)) {
      updateStmt.run(c.count, c.toolName, c.wrongParam, c.correctParam)
    } else {
      insertStmt.run(c.toolName, c.wrongParam, c.correctParam, c.count)
      newAliases++
    }
  }

  aliasCache = null
  const total = (db.prepare('SELECT COUNT(*) as count FROM schema_aliases').get() as { count: number }).count

  return { newAliases, totalAliases: total }
}

function loadAliases(): AliasMapping[] {
  if (aliasCache) return aliasCache
  aliasCache = (
    db.prepare('SELECT tool_name, wrong_param, correct_param, hit_count FROM schema_aliases').all() as {
      tool_name: string
      wrong_param: string
      correct_param: string
      hit_count: number
    }[]
  ).map((r) => ({
    toolName: r.tool_name,
    wrongParam: r.wrong_param,
    correctParam: r.correct_param,
    hitCount: r.hit_count,
  }))
  return aliasCache
}

export function applySchemaCompat(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const aliases = loadAliases().filter((a) => a.toolName === toolName)
  if (aliases.length === 0) return args

  const fixed = { ...args }
  for (const alias of aliases) {
    if (alias.wrongParam in fixed && !(alias.correctParam in fixed)) {
      fixed[alias.correctParam] = fixed[alias.wrongParam]
      delete fixed[alias.wrongParam]
    }
  }
  return fixed
}
