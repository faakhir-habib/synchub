-- Sync is now last-write-wins: the incoming version always wins when it
-- differs from canonical, so the manual conflict-resolution feature is
-- removed. Drop the conflicts table. Its indexes (@@index([project_id,
-- status]) and the hand-written partial "uniq_open_conflict") are dropped
-- implicitly with the table. Nothing references it via foreign key, so a
-- plain DROP is safe.
DROP TABLE "conflicts";
