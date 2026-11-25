-- Repair: a resumed part must point at the first part of its session. Before
-- triage prompt 1.1 a part could be linked to another resumed part and was
-- then closed as "noted" without work. Re-link to the root and requeue the
-- work; nothing else changes and no document is touched.
UPDATE files SET duplicate_of = (
    SELECT p.duplicate_of FROM files p WHERE p.meeting_id = files.duplicate_of
  ),
  status = CASE WHEN status = 'noted' AND status_reason LIKE 'Part of %; no separate work.' THEN 'triaged' ELSE status END,
  status_reason = CASE WHEN status = 'noted' AND status_reason LIKE 'Part of %; no separate work.' THEN NULL ELSE status_reason END
WHERE duplicate_of IN (SELECT meeting_id FROM files WHERE duplicate_of IS NOT NULL);
