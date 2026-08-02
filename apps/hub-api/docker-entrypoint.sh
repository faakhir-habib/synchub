#!/bin/sh
# Runs pending Prisma migrations against the mounted DATABASE_URL, then
# starts the compiled hub-api server. Fails fast if either step errors.
set -e

npx prisma migrate deploy --schema=./prisma/schema.prisma

exec node dist/main.js
