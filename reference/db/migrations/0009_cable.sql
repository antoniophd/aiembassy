-- foreign_keys: off
-- The cable (2026-11-13): a new document kind. SQLite cannot change a
-- CHECK constraint in place, so the documents table is rebuilt (the SQLite
-- procedure: foreign keys off, copy, drop, rename, foreign_key_check before
-- commit). Rows, ids and references are unchanged.
CREATE TABLE documents_new (
  id             TEXT PRIMARY KEY,
  file_id        TEXT NOT NULL REFERENCES files (id),
  meeting_id     TEXT NOT NULL REFERENCES meetings (id),
  kind           TEXT NOT NULL CHECK (kind IN
                   ('triage','note','report','opinion','options_memo','decision','press','cable','check','segment_summary')),
  ref            TEXT NOT NULL DEFAULT '',
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
  low_confidence INTEGER NOT NULL DEFAULT 0 CHECK (low_confidence IN (0,1)),
  low_confidence_reason TEXT,
  UNIQUE (file_id, meeting_id, kind, ref, attempt)
);
INSERT INTO documents_new (id, file_id, meeting_id, kind, ref, author_role, attempt, body_json, text, provider, model,
  prompt_id, prompt_version, input_tokens, output_tokens, duration_ms, llm_call_id, created_at, low_confidence,
  low_confidence_reason)
SELECT id, file_id, meeting_id, kind, ref, author_role, attempt, body_json, text, provider, model, prompt_id,
  prompt_version, input_tokens, output_tokens, duration_ms, llm_call_id, created_at, low_confidence,
  low_confidence_reason FROM documents;
DROP TABLE documents;
ALTER TABLE documents_new RENAME TO documents;
CREATE INDEX documents_file ON documents (file_id, kind);
