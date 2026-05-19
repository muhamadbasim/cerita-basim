-- Cerita Basim — D1 initial schema
-- Run: wrangler d1 migrations apply cerita-basim-db --remote

CREATE TABLE IF NOT EXISTS comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  post_slug    TEXT NOT NULL,
  parent_id    INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email_hash   TEXT NOT NULL,
  email_enc    TEXT NOT NULL,
  body_md      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','spam')),
  ip_hash      TEXT,
  ua_hash      TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  approved_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_slug, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status, created_at);

CREATE TABLE IF NOT EXISTS trusted_emails (
  email_hash   TEXT PRIMARY KEY,
  trusted_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  comment_id   INTEGER REFERENCES comments(id)
);

CREATE TABLE IF NOT EXISTS subscribers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT UNIQUE NOT NULL,
  status       TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (status IN ('unconfirmed','active','unsubscribed','bounced')),
  confirm_tok  TEXT,
  unsub_tok    TEXT NOT NULL,
  source       TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  confirmed_at INTEGER,
  unsubed_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_subs_status ON subscribers(status);

CREATE TABLE IF NOT EXISTS dispatches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  post_slug    TEXT NOT NULL,
  triggered_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
  total        INTEGER,
  sent         INTEGER DEFAULT 0,
  failed       INTEGER DEFAULT 0,
  cursor_id    INTEGER
);
