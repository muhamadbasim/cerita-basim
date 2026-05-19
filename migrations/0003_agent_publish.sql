-- Migration 0003: Agent Publish feature
-- Adds agent registry, audit log, and stats tables
-- Requirements: AGP-030 (agent registry), AGP-040 (audit log), AGP-021 (agent stats)

CREATE TABLE IF NOT EXISTS agents (
  agent_id      TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  token_hash    TEXT UNIQUE NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  last_used_at  INTEGER,
  revoked_at    INTEGER,
  notes         TEXT
);

CREATE TABLE IF NOT EXISTS agent_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT NOT NULL CHECK (action IN ('submit','approve','reject','edit','revoke','create_agent')),
  agent_id   TEXT NOT NULL,
  draft_id   INTEGER,
  slug       TEXT,
  actor      TEXT NOT NULL,
  metadata   TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_audit_agent ON agent_audit(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON agent_audit(action, created_at);

CREATE TABLE IF NOT EXISTS agent_stats (
  agent_id                    TEXT PRIMARY KEY REFERENCES agents(agent_id),
  total_submitted             INTEGER NOT NULL DEFAULT 0,
  total_approved              INTEGER NOT NULL DEFAULT 0,
  total_rejected              INTEGER NOT NULL DEFAULT 0,
  total_edited_before_approve INTEGER NOT NULL DEFAULT 0,
  last_submit_at              INTEGER,
  last_approve_at             INTEGER
);
