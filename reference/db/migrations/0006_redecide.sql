-- Re-deciding a file: decisions, red-line checks and press products accepted
-- in epochs before decide_from_epoch no longer count (they stay stored); the
-- report, claim checks, opinions and options memo stay accepted.
ALTER TABLE files ADD COLUMN decide_from_epoch INTEGER NOT NULL DEFAULT 0;
