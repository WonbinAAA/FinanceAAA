-- Link state is private runtime data. No existing ledger row is seeded or changed.
CREATE TABLE company_link_control (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1))
);
INSERT INTO company_link_control(singleton,enabled) VALUES(1,0);
CREATE TABLE company_link_groups (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL UNIQUE,
  transaction_hash TEXT NOT NULL,
  config_json TEXT NOT NULL CHECK(json_valid(config_json))
);
CREATE TABLE company_link_sources (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES company_link_groups(id),
  revision INTEGER NOT NULL CHECK(revision>0),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
);
