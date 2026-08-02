-- Enforce at most one OPEN conflict per (project_id, filename). Prisma's
-- schema language cannot express a partial/filtered unique index, so this
-- is hand-written and NOT represented in schema.prisma (see the comment on
-- the Conflict model there). SQLite supports partial indexes via WHERE.
CREATE UNIQUE INDEX "uniq_open_conflict" ON "conflicts"("project_id", "filename") WHERE "status" = 'open';
