PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  email              TEXT NOT NULL UNIQUE,
  password_hash      TEXT NOT NULL,
  password_salt      TEXT NOT NULL,
  notify_webhook_url TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS machines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  token         TEXT NOT NULL UNIQUE,
  os            TEXT,
  os_version    TEXT,
  label         TEXT,
  agent_version TEXT,
  last_ip       TEXT,
  status        TEXT NOT NULL DEFAULT 'offline',
  last_seen_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pairing_codes (
  code       TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  machine_id INTEGER REFERENCES machines(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alias      TEXT NOT NULL,
  sync_mode  TEXT NOT NULL DEFAULT 'auto',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, alias)
);

CREATE TABLE IF NOT EXISTS mappings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  machine_id  INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  local_path  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, machine_id)
);

CREATE TABLE IF NOT EXISTS file_state (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  hash         TEXT NOT NULL,
  size         INTEGER NOT NULL DEFAULT 0,
  last_machine_id INTEGER REFERENCES machines(id) ON DELETE SET NULL,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, filename)
);

CREATE TABLE IF NOT EXISTS conflicts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename       TEXT NOT NULL,
  machine_id     INTEGER REFERENCES machines(id) ON DELETE SET NULL,
  candidate_hash TEXT NOT NULL,
  auto_merged    INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'open',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at    TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  machine_id INTEGER REFERENCES machines(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,
  filename   TEXT,
  bytes      INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_user_time ON events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_filestate_project ON file_state(project_id);
CREATE INDEX IF NOT EXISTS idx_conflicts_open ON conflicts(project_id, status);
