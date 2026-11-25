-- Reprocessing in two steps (2026-11-13): a reworked file can be held
-- after its new triage, so the levels are reviewed before any other work is
-- spent on it. Released by setting the flag back to 0.
ALTER TABLE files ADD COLUMN hold_after_triage INTEGER NOT NULL DEFAULT 0;
