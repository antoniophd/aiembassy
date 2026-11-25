-- Reworking a file from its triage (a triage, report or later rule changed):
-- every document of an epoch before rework_from_epoch no longer counts except
-- the segment summaries, which are reused. Nothing is deleted.
ALTER TABLE files ADD COLUMN rework_from_epoch INTEGER NOT NULL DEFAULT 0;
