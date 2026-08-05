-- Conflicts no longer exist (sync is last-write-wins), so the per-user
-- "notify on conflicts" preference has nothing left to gate. Drop the column.
ALTER TABLE "users" DROP COLUMN "notify_conflicts";
