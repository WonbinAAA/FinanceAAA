CREATE TABLE line_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  owner_hash TEXT NOT NULL,
  image_hash TEXT,
  state TEXT NOT NULL CHECK (state IN ('details', 'ready', 'saving', 'saved', 'cancelled', 'expired')),
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  lease_until INTEGER NOT NULL DEFAULT 0,
  scan_json TEXT,
  draft_json TEXT,
  result_json TEXT,
  details_order TEXT
);

CREATE INDEX line_drafts_owner ON line_drafts(owner_hash, created_at DESC);
CREATE INDEX line_drafts_expiry ON line_drafts(state, created_at);
CREATE UNIQUE INDEX line_drafts_image ON line_drafts(owner_hash, image_hash)
  WHERE image_hash IS NOT NULL AND state IN ('details', 'ready', 'saving', 'saved');
