-- Phase B: triage, notes, segment summaries and meeting reports.

-- A transcript whose text is short for the meeting's length (fewer than 6
-- characters per second over at least 10 minutes) may be incomplete or have
-- long silences (ballots). It is processed, with low confidence.
ALTER TABLE transcripts ADD COLUMN suspect_incomplete INTEGER NOT NULL DEFAULT 0 CHECK (suspect_incomplete IN (0,1));
UPDATE transcripts SET suspect_incomplete = 1
WHERE meeting_id IN (
  SELECT m.id FROM meetings m JOIN transcripts t ON t.meeting_id = m.id
  WHERE m.duration_seconds >= 600 AND t.characters < 6 * m.duration_seconds
);

ALTER TABLE files ADD COLUMN low_confidence_reason TEXT;

-- The ladder of attempts for each task of a file.
ALTER TABLE llm_calls ADD COLUMN task TEXT;            -- triage | note | summary | report
ALTER TABLE llm_calls ADD COLUMN meeting_id TEXT;      -- source meeting (resumed parts report into the first file)
ALTER TABLE llm_calls ADD COLUMN ref TEXT NOT NULL DEFAULT '';  -- segment label for summaries
ALTER TABLE llm_calls ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;
ALTER TABLE llm_calls ADD COLUMN round INTEGER NOT NULL DEFAULT 1;
CREATE INDEX llm_calls_task ON llm_calls (file_id, task, meeting_id, ref);

-- documents is rebuilt (it was empty): one row per task, attempt and
-- reference, with the source meeting. dossier_events (empty) points at it.
DROP TABLE dossier_events;
DROP TABLE documents;
CREATE TABLE documents (
  id             TEXT PRIMARY KEY,
  file_id        TEXT NOT NULL REFERENCES files (id),
  meeting_id     TEXT NOT NULL REFERENCES meetings (id),
  kind           TEXT NOT NULL CHECK (kind IN
                   ('triage','note','report','opinion','options_memo','decision','press','check','segment_summary')),
  ref            TEXT NOT NULL DEFAULT '',      -- segment label, or the checked document id
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
  UNIQUE (file_id, meeting_id, kind, ref, attempt)
);
CREATE INDEX documents_file ON documents (file_id, kind);

CREATE TABLE dossier_events (
  id          TEXT PRIMARY KEY,
  dossier_id  TEXT NOT NULL REFERENCES dossiers (id),
  file_id     TEXT NOT NULL REFERENCES files (id),
  document_id TEXT NOT NULL REFERENCES documents (id),
  change      TEXT NOT NULL CHECK (change IN ('first','maintains','revises')),
  position    TEXT NOT NULL,
  stands_with TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (dossier_id, file_id)
);
