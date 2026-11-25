-- Restarting a file: documents accepted in epochs before accept_from_epoch no
-- longer count (they stay stored); the whole file is worked again from triage.
ALTER TABLE files ADD COLUMN accept_from_epoch INTEGER NOT NULL DEFAULT 0;
