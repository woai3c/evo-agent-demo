// SQLite schema — all tables for Evo
// Trace tables: operations, steps, errors
// Evolution tables: patterns, inspections
// App tables: users, conversations, sent_emails
// Demo data: Chinook dataset (artists, albums, tracks, genres, invoices, customers, ...)
import Database from 'better-sqlite3'

export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    -- ── Trace tables ──

    CREATE TABLE IF NOT EXISTS operations (
      operation_id   TEXT PRIMARY KEY,
      user_id        TEXT NOT NULL,
      model          TEXT NOT NULL,
      provider       TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'error',
      total_steps    INTEGER NOT NULL DEFAULT 0,
      total_duration INTEGER NOT NULL DEFAULT 0,
      total_tokens   TEXT NOT NULL DEFAULT '{}',
      cost           REAL NOT NULL DEFAULT 0,
      error_summary  TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS steps (
      step_id          TEXT PRIMARY KEY,
      operation_id     TEXT NOT NULL REFERENCES operations(operation_id),
      step_index       INTEGER NOT NULL,
      type             TEXT NOT NULL,
      duration_ms      INTEGER NOT NULL DEFAULT 0,
      tokens           TEXT,
      tool_name        TEXT,
      tool_input       TEXT,
      tool_output_size INTEGER,
      tool_success     INTEGER,
      error            TEXT,
      context_snapshot TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS errors (
      error_id     TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL REFERENCES operations(operation_id),
      step_id      TEXT NOT NULL REFERENCES steps(step_id),
      provider     TEXT NOT NULL,
      error_type   TEXT NOT NULL,
      status_code  INTEGER,
      message      TEXT NOT NULL,
      tool_name    TEXT,
      pattern_id   TEXT REFERENCES patterns(pattern_id),
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Evolution tables ──

    CREATE TABLE IF NOT EXISTS patterns (
      pattern_id   TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      category     TEXT NOT NULL,
      provider     TEXT NOT NULL DEFAULT '*',
      error_type   TEXT NOT NULL,
      match_rule   TEXT NOT NULL DEFAULT '{}',
      user_message TEXT NOT NULL DEFAULT '',
      resolution   TEXT NOT NULL DEFAULT '',
      hit_count    INTEGER NOT NULL DEFAULT 0,
      first_seen   TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen    TEXT NOT NULL DEFAULT (datetime('now')),
      status       TEXT NOT NULL DEFAULT 'active',
      created_by   TEXT NOT NULL DEFAULT 'manual'
    );

    CREATE TABLE IF NOT EXISTS inspections (
      inspection_id   TEXT PRIMARY KEY,
      round           INTEGER NOT NULL,
      started_at      TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at     TEXT,
      traces_analyzed INTEGER NOT NULL DEFAULT 0,
      new_patterns    INTEGER NOT NULL DEFAULT 0,
      harness_bugs    INTEGER NOT NULL DEFAULT 0,
      tokens_used     TEXT,
      cost            REAL NOT NULL DEFAULT 0,
      summary         TEXT NOT NULL DEFAULT '',
      details         TEXT
    );

    -- ── App tables ──

    CREATE TABLE IF NOT EXISTS users (
      user_id    TEXT PRIMARY KEY,
      username   TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS conversations (
      conversation_id TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(user_id),
      title           TEXT NOT NULL DEFAULT 'New conversation',
      model           TEXT NOT NULL,
      provider        TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sent_emails (
      email_id   TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      recipient  TEXT NOT NULL,
      subject    TEXT NOT NULL,
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Indexes ──

    CREATE INDEX IF NOT EXISTS idx_operations_user    ON operations(user_id);
    CREATE INDEX IF NOT EXISTS idx_operations_status  ON operations(status);
    CREATE INDEX IF NOT EXISTS idx_operations_created ON operations(created_at);
    CREATE INDEX IF NOT EXISTS idx_steps_operation    ON steps(operation_id);
    CREATE INDEX IF NOT EXISTS idx_errors_operation   ON errors(operation_id);
    CREATE INDEX IF NOT EXISTS idx_errors_pattern     ON errors(pattern_id);
    CREATE INDEX IF NOT EXISTS idx_errors_type        ON errors(error_type);
  `)

  return db
}
