ALTER TABLE line_drafts ADD COLUMN entry_json TEXT;

CREATE TABLE line_input_sessions (
  owner_hash TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('ส่วนตัว', 'บริษัท')),
  selection_order TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  draft_id TEXT
);
