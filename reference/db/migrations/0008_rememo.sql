-- Redoing a full file from its options memo: memos of epochs before
-- memo_from_epoch no longer count (with decide_from_epoch, neither do the
-- decisions, red-line checks and press products). Nothing is deleted.
ALTER TABLE files ADD COLUMN memo_from_epoch INTEGER NOT NULL DEFAULT 0;
