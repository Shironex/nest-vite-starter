#!/bin/sh
# Entrypoint of the api image: applies pending Prisma migrations, then starts the
# command (`node apps/api/dist/src/main.js` by default).
#
#   RUN_MIGRATIONS=true   (default) migrate before starting. Safe with ONE replica.
#   RUN_MIGRATIONS=false  skip it: a separate one-shot `migrate` service (see
#                         docker-compose.prod.yml) or a release step runs the
#                         migrations instead, which is what you want with several
#                         replicas so they do not all race to migrate.
#
#   api-entrypoint migrate   run the migrations and exit (the one-shot form).
set -eu

run_migrations() {
  echo "[entrypoint] prisma migrate deploy"
  # The config (packages/database/prisma.config.ts) names the schema, the
  # migrations folder and DATABASE_URL, so no flags are needed.
  cd /app/packages/database
  ./node_modules/.bin/prisma migrate deploy
  cd /app
}

if [ "${1:-}" = "migrate" ]; then
  run_migrations
  exit 0
fi

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  run_migrations
fi

exec "$@"
