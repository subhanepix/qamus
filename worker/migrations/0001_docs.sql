-- One row per username: the whole synced document as JSON.
CREATE TABLE IF NOT EXISTS docs (
  user TEXT PRIMARY KEY,
  doc TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
