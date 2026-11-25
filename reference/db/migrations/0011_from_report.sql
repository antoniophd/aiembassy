-- Reworking a file from its report (2026-11-13): every
-- document of an epoch before report_from_epoch stops counting except the
-- triage and the segment summaries, which are reused. Nothing is deleted.
ALTER TABLE files ADD COLUMN report_from_epoch INTEGER NOT NULL DEFAULT 0;
