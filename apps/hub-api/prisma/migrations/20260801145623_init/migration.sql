-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "password_salt" TEXT NOT NULL,
    "name" TEXT,
    "notify_webhook_url" TEXT,
    "notify_conflicts" INTEGER NOT NULL DEFAULT 1,
    "notify_sync" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "sessions" (
    "token" TEXT NOT NULL PRIMARY KEY,
    "user_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "machines" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "os" TEXT,
    "os_version" TEXT,
    "label" TEXT,
    "agent_version" TEXT,
    "last_ip" TEXT,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "last_seen_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "machines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pairing_codes" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "user_id" INTEGER NOT NULL,
    "machine_id" INTEGER,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pairing_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pairing_codes_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "projects" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "alias" TEXT NOT NULL,
    "sync_mode" TEXT NOT NULL DEFAULT 'auto',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "mappings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "project_id" INTEGER NOT NULL,
    "machine_id" INTEGER NOT NULL,
    "local_path" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mappings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mappings_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "file_state" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "project_id" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "last_machine_id" INTEGER,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "file_state_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "file_state_last_machine_id_fkey" FOREIGN KEY ("last_machine_id") REFERENCES "machines" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "conflicts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "project_id" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "machine_id" INTEGER,
    "candidate_hash" TEXT NOT NULL,
    "auto_merged" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" DATETIME,
    CONSTRAINT "conflicts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "conflicts_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "read" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "machine_id" INTEGER,
    "project_id" INTEGER,
    "type" TEXT NOT NULL,
    "filename" TEXT,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "events_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "machines_token_key" ON "machines"("token");

-- CreateIndex
CREATE UNIQUE INDEX "projects_user_id_alias_key" ON "projects"("user_id", "alias");

-- CreateIndex
CREATE INDEX "mappings_machine_id_idx" ON "mappings"("machine_id");

-- CreateIndex
CREATE UNIQUE INDEX "mappings_project_id_machine_id_key" ON "mappings"("project_id", "machine_id");

-- CreateIndex
CREATE INDEX "file_state_project_id_idx" ON "file_state"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_state_project_id_filename_key" ON "file_state"("project_id", "filename");

-- CreateIndex
CREATE INDEX "conflicts_project_id_status_idx" ON "conflicts"("project_id", "status");

-- CreateIndex
CREATE INDEX "events_user_id_created_at_idx" ON "events"("user_id", "created_at");
