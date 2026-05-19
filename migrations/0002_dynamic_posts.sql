-- Dynamic posts table — for content published via API/CMS (not Git)
-- Complements static markdown posts from src/content/posts/

CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT UNIQUE NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  body_md      TEXT NOT NULL,
  tags         TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  cover        TEXT,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  featured     INTEGER NOT NULL DEFAULT 0,
  author       TEXT NOT NULL DEFAULT 'Basim',
  source       TEXT DEFAULT 'api',          -- 'api', 'cms', 'webhook', 'agent'
  published_at INTEGER,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, published_at);
CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
