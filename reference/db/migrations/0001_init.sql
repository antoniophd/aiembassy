-- Embassy v2 schema. One SQLite file, WAL mode (set at open).
-- Rule: the state of a meeting file lives in files.status only. Documents
-- never carry status. Stored documents are never rewritten: a new attempt is
-- a new row.

-- Every in-scope meeting seen in the UN Transcripts index.
CREATE TABLE meetings (
  id               TEXT PRIMARY KEY,            -- index slug, e.g. sc/880, ga/c4/99/21
  body             TEXT NOT NULL CHECK (body IN
                     ('security_council','ga_plenary','ga_c1','ga_c2','ga_c3','ga_c4','ga_c5','ga_c6')),
  session          INTEGER,                     -- GA session; NULL for the Council
  number           INTEGER NOT NULL,
  part             INTEGER NOT NULL DEFAULT 1,  -- 2, 3, … for resumed parts (slug suffix)
  date             TEXT NOT NULL,               -- New York date, YYYY-MM-DD
  title            TEXT NOT NULL,
  duration_seconds INTEGER,
  has_transcript   INTEGER NOT NULL CHECK (has_transcript IN (0,1)),
  page_url         TEXT NOT NULL,
  json_url         TEXT NOT NULL,
  index_body       TEXT,                        -- the index's own label
  first_seen_at    TEXT NOT NULL,
  last_seen_at     TEXT NOT NULL
);
CREATE INDEX meetings_date ON meetings (date);
CREATE INDEX meetings_body_date ON meetings (body, date);

-- One downloaded English transcript per meeting.
CREATE TABLE transcripts (
  meeting_id    TEXT PRIMARY KEY REFERENCES meetings (id),
  url           TEXT NOT NULL,
  title         TEXT NOT NULL,
  language      TEXT NOT NULL CHECK (language = 'en'),
  statements    INTEGER NOT NULL,
  characters    INTEGER NOT NULL,
  segment_count INTEGER NOT NULL,
  speakers_json TEXT NOT NULL,                  -- speaker index (labels are not verified identities)
  sha256        TEXT NOT NULL,
  retrieved_at  TEXT NOT NULL
);

-- Evidence segments [E#], at most 24 of 10,000 characters per transcript.
CREATE TABLE segments (
  meeting_id    TEXT NOT NULL REFERENCES transcripts (meeting_id),
  seq           INTEGER NOT NULL,
  label         TEXT NOT NULL,                  -- E1, E2, …
  start_seconds INTEGER NOT NULL,
  end_seconds   INTEGER NOT NULL,
  text          TEXT NOT NULL,
  speakers_json TEXT NOT NULL,
  PRIMARY KEY (meeting_id, seq),
  UNIQUE (meeting_id, label)
);

CREATE TABLE dossiers (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  standing_position TEXT,
  stands_with       TEXT,                       -- JSON array of groups, or ["national capacity"]
  interest          TEXT,                       -- profile interest id
  red_line          TEXT,                       -- profile red line id
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- The meeting file. status is the single source of state.
CREATE TABLE files (
  id             TEXT PRIMARY KEY,
  meeting_id     TEXT NOT NULL UNIQUE REFERENCES meetings (id),
  status         TEXT NOT NULL DEFAULT 'queued' CHECK (status IN
                   ('queued','triaged','in_progress','adopted','not_adopted','noted','reported','failed')),
  status_reason  TEXT,
  level          TEXT CHECK (level IN ('note','report','full_file')),
  lead           TEXT,
  opinions_json  TEXT,
  press          INTEGER CHECK (press IN (0,1)),
  press_reason   TEXT,
  dossier_id     TEXT REFERENCES dossiers (id),
  duplicate_of   TEXT REFERENCES meetings (id),
  low_confidence INTEGER NOT NULL DEFAULT 0 CHECK (low_confidence IN (0,1)),
  profile_version TEXT,
  team_version   TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX files_status ON files (status);

-- Every model call is claimed here before it is sent; the id is
-- deterministic, so a retry or a second run never sends a duplicate.
CREATE TABLE llm_calls (
  id              TEXT PRIMARY KEY,
  run_id          TEXT REFERENCES runs (id),
  file_id         TEXT REFERENCES files (id),
  purpose         TEXT NOT NULL,                -- role/task, e.g. dpr.triage, check.claim
  provider        TEXT NOT NULL,
  model_requested TEXT NOT NULL,
  model_used      TEXT,
  fallback        INTEGER NOT NULL DEFAULT 0 CHECK (fallback IN (0,1)),
  reasoning       INTEGER NOT NULL DEFAULT 0 CHECK (reasoning IN (0,1)),
  prompt_id       TEXT,
  prompt_version  TEXT,
  state           TEXT NOT NULL CHECK (state IN ('claimed','complete','failed')),
  error_kind      TEXT,                         -- provider | output | check
  error           TEXT,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  duration_ms     INTEGER,
  claimed_at      TEXT NOT NULL,
  finished_at     TEXT
);
CREATE INDEX llm_calls_claimed ON llm_calls (claimed_at);

-- Generated work. No status column: a document either exists or not.
CREATE TABLE documents (
  id             TEXT PRIMARY KEY,
  file_id        TEXT NOT NULL REFERENCES files (id),
  kind           TEXT NOT NULL CHECK (kind IN
                   ('triage','note','report','opinion','options_memo','decision','press','check','segment_summary')),
  author_role    TEXT NOT NULL,
  attempt        INTEGER NOT NULL DEFAULT 1,
  body_json      TEXT NOT NULL,
  text           TEXT NOT NULL,
  provider       TEXT NOT NULL,
  model          TEXT NOT NULL,
  prompt_id      TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  duration_ms    INTEGER,
  llm_call_id    TEXT REFERENCES llm_calls (id),
  created_at     TEXT NOT NULL,
  UNIQUE (file_id, kind, author_role, attempt)
);

CREATE TABLE dossier_events (
  id          TEXT PRIMARY KEY,
  dossier_id  TEXT NOT NULL REFERENCES dossiers (id),
  file_id     TEXT NOT NULL REFERENCES files (id),
  document_id TEXT NOT NULL REFERENCES documents (id),   -- the adopted decision
  change      TEXT NOT NULL CHECK (change IN ('first','maintains','revises')),
  position    TEXT NOT NULL,
  stands_with TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (dossier_id, file_id)
);

-- Runs (needed by the alert rule: did a scheduled run start and finish?).
CREATE TABLE runs (
  id            TEXT PRIMARY KEY,
  trigger       TEXT NOT NULL CHECK (trigger IN ('timer','manual')),
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  outcome       TEXT CHECK (outcome IN ('completed','budget','failed')),
  steps         INTEGER NOT NULL DEFAULT 0,
  calls         INTEGER NOT NULL DEFAULT 0,
  summary_json  TEXT
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE alerts (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('run_missed','run_unfinished','stalled','model_failures')),
  message     TEXT NOT NULL,
  detail_json TEXT,
  created_at  TEXT NOT NULL,
  resolved_at TEXT
);
