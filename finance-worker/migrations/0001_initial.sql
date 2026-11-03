-- No real accounts, balances, identities or financial history are seeded here.
PRAGMA foreign_keys = ON;
CREATE TABLE finance_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO finance_state(singleton, revision) VALUES (1, 0);

-- Compatibility storage preserves original fields, IDs, headers and row ordering.
-- Money is also stored as exact integer satang; never calculate with SQL REAL.
CREATE TABLE ledger_tables (
  name TEXT PRIMARY KEY,
  headers_json TEXT NOT NULL CHECK (json_valid(headers_json))
);
CREATE TABLE ledger_records (
  table_name TEXT NOT NULL REFERENCES ledger_tables(name),
  record_id TEXT NOT NULL,
  source_row INTEGER NOT NULL CHECK (source_row >= 3),
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  money_json TEXT NOT NULL CHECK (json_valid(money_json)),
  PRIMARY KEY (table_name, record_id),
  UNIQUE (table_name, source_row)
);
CREATE INDEX ledger_order ON ledger_records(table_name, source_row);

CREATE TABLE request_receipts (
  request_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at INTEGER NOT NULL
);
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL,
  email TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_session_expiry ON auth_sessions(expires_at);
CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
