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
      operation_id    TEXT PRIMARY KEY,
      conversation_id TEXT,
      user_id         TEXT NOT NULL,
      model           TEXT NOT NULL,
      provider        TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'error',
      total_steps     INTEGER NOT NULL DEFAULT 0,
      total_duration  INTEGER NOT NULL DEFAULT 0,
      total_tokens    TEXT NOT NULL DEFAULT '{}',
      cost            REAL NOT NULL DEFAULT 0,
      error_summary   TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
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
      created_by   TEXT NOT NULL DEFAULT 'manual',
      fix_status   TEXT NOT NULL DEFAULT 'unfixed',
      fix_pr_url   TEXT
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

    CREATE TABLE IF NOT EXISTS behaviors (
      behavior_id     TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      tool_sequence   TEXT NOT NULL DEFAULT '',
      operation_count INTEGER NOT NULL DEFAULT 0,
      success_rate    REAL NOT NULL DEFAULT 0,
      avg_duration    INTEGER NOT NULL DEFAULT 0,
      avg_steps       REAL NOT NULL DEFAULT 0,
      avg_tokens      INTEGER NOT NULL DEFAULT 0,
      avg_cost        REAL NOT NULL DEFAULT 0,
      tool_error_rate REAL NOT NULL DEFAULT 0,
      health_score    REAL NOT NULL DEFAULT 1.0,
      health_flags    TEXT NOT NULL DEFAULT '[]',
      suggestion      TEXT NOT NULL DEFAULT '',
      suggestion_severity TEXT NOT NULL DEFAULT 'none',
      fix_status      TEXT NOT NULL DEFAULT 'none',
      fix_pr_url      TEXT,
      sample_operations TEXT NOT NULL DEFAULT '[]',
      first_seen      TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen       TEXT NOT NULL DEFAULT (datetime('now')),
      created_by      TEXT NOT NULL DEFAULT 'inspector'
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
      messages        TEXT NOT NULL DEFAULT '[]',
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

    -- ── Chinook demo data tables ──

    CREATE TABLE IF NOT EXISTS artists (
      artist_id INTEGER PRIMARY KEY,
      name      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS albums (
      album_id  INTEGER PRIMARY KEY,
      title     TEXT NOT NULL,
      artist_id INTEGER NOT NULL REFERENCES artists(artist_id)
    );

    CREATE TABLE IF NOT EXISTS genres (
      genre_id INTEGER PRIMARY KEY,
      name     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_types (
      media_type_id INTEGER PRIMARY KEY,
      name          TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tracks (
      track_id      INTEGER PRIMARY KEY,
      name          TEXT NOT NULL,
      album_id      INTEGER REFERENCES albums(album_id),
      media_type_id INTEGER NOT NULL REFERENCES media_types(media_type_id),
      genre_id      INTEGER REFERENCES genres(genre_id),
      composer      TEXT,
      milliseconds  INTEGER NOT NULL DEFAULT 0,
      bytes         INTEGER NOT NULL DEFAULT 0,
      unit_price    REAL NOT NULL DEFAULT 0.99
    );

    CREATE TABLE IF NOT EXISTS playlists (
      playlist_id INTEGER PRIMARY KEY,
      name        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlist_track (
      playlist_id INTEGER NOT NULL REFERENCES playlists(playlist_id),
      track_id    INTEGER NOT NULL REFERENCES tracks(track_id),
      PRIMARY KEY (playlist_id, track_id)
    );

    CREATE TABLE IF NOT EXISTS employees (
      employee_id  INTEGER PRIMARY KEY,
      last_name    TEXT NOT NULL,
      first_name   TEXT NOT NULL,
      title        TEXT,
      reports_to   INTEGER REFERENCES employees(employee_id),
      birth_date   TEXT,
      hire_date    TEXT,
      address      TEXT,
      city         TEXT,
      state        TEXT,
      country      TEXT,
      postal_code  TEXT,
      phone        TEXT,
      fax          TEXT,
      email        TEXT
    );

    CREATE TABLE IF NOT EXISTS customers (
      customer_id    INTEGER PRIMARY KEY,
      first_name     TEXT NOT NULL,
      last_name      TEXT NOT NULL,
      company        TEXT,
      address        TEXT,
      city           TEXT,
      state          TEXT,
      country        TEXT,
      postal_code    TEXT,
      phone          TEXT,
      fax            TEXT,
      email          TEXT NOT NULL,
      support_rep_id INTEGER REFERENCES employees(employee_id)
    );

    CREATE TABLE IF NOT EXISTS invoices (
      invoice_id      INTEGER PRIMARY KEY,
      customer_id     INTEGER NOT NULL REFERENCES customers(customer_id),
      invoice_date    TEXT NOT NULL,
      billing_address TEXT,
      billing_city    TEXT,
      billing_state   TEXT,
      billing_country TEXT,
      billing_postal_code TEXT,
      total           REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      invoice_line_id INTEGER PRIMARY KEY,
      invoice_id      INTEGER NOT NULL REFERENCES invoices(invoice_id),
      track_id        INTEGER NOT NULL REFERENCES tracks(track_id),
      unit_price      REAL NOT NULL,
      quantity        INTEGER NOT NULL
    );

  `)

  // Migrations for existing databases
  const opCols = db.prepare("PRAGMA table_info('operations')").all() as { name: string }[]
  if (!opCols.some((c) => c.name === 'conversation_id')) {
    db.exec('ALTER TABLE operations ADD COLUMN conversation_id TEXT')
  }

  const patCols = db.prepare("PRAGMA table_info('patterns')").all() as { name: string }[]
  if (!patCols.some((c) => c.name === 'fix_status')) {
    db.exec("ALTER TABLE patterns ADD COLUMN fix_status TEXT NOT NULL DEFAULT 'unfixed'")
    db.exec('ALTER TABLE patterns ADD COLUMN fix_pr_url TEXT')
  }

  const behCols = db.prepare("PRAGMA table_info('behaviors')").all() as { name: string }[]
  if (behCols.length > 0 && !behCols.some((c) => c.name === 'suggestion_severity')) {
    db.exec("ALTER TABLE behaviors ADD COLUMN suggestion_severity TEXT NOT NULL DEFAULT 'none'")
    db.exec("ALTER TABLE behaviors ADD COLUMN fix_status TEXT NOT NULL DEFAULT 'none'")
    db.exec('ALTER TABLE behaviors ADD COLUMN fix_pr_url TEXT')
  }

  db.exec(`
    -- ── Indexes ──

    CREATE INDEX IF NOT EXISTS idx_operations_user         ON operations(user_id);
    CREATE INDEX IF NOT EXISTS idx_operations_status       ON operations(status);
    CREATE INDEX IF NOT EXISTS idx_operations_created      ON operations(created_at);
    CREATE INDEX IF NOT EXISTS idx_operations_conversation ON operations(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_steps_operation    ON steps(operation_id);
    CREATE INDEX IF NOT EXISTS idx_errors_operation   ON errors(operation_id);
    CREATE INDEX IF NOT EXISTS idx_errors_pattern     ON errors(pattern_id);
    CREATE INDEX IF NOT EXISTS idx_errors_type        ON errors(error_type);
    CREATE INDEX IF NOT EXISTS idx_albums_artist      ON albums(artist_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_album       ON tracks(album_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_genre       ON tracks(genre_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_customer   ON invoices(customer_id);
    CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
  `)

  return db
}
