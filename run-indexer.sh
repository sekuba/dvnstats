#!/usr/bin/env bash
# Run the indexer against the self-managed stack in docker-compose.yml.
#
# `envio start` (never `envio dev`): dev mode provisions its own containers
# under hardcoded names and would fight with / recreate our stack.
#
# Exported vars win over .env (envio's dotenv does not override the
# environment), so ENVIO_API_TOKEN still comes from .env.
set -euo pipefail
cd "$(dirname "$0")"

export ENVIO_PG_HOST=localhost
export ENVIO_PG_PORT=17432
export ENVIO_PG_USER=postgres
export ENVIO_PG_PASSWORD=testing
export ENVIO_PG_DATABASE=envio-dev
export ENVIO_PG_SCHEMA=public

export HASURA_GRAPHQL_ENDPOINT=http://localhost:17480/v1/metadata
export HASURA_GRAPHQL_ADMIN_SECRET=testing
export HASURA_GRAPHQL_ROLE=admin

# Health/metrics server. Envio's own default is 9898; 17498 keeps it in the
# same block as the Postgres/Hasura ports above.
export ENVIO_INDEXER_PORT=17498
export ENVIO_TUI=false

# Supervised, because envio treats "the indexer doesn't have data-sources which
# can continue fetching" as fatal and exits. One malformed HyperSync response on
# a single chain killed an unattended backfill on 2026-08-24 at 10:02 and it sat
# dead for two hours. `envio start` resumes from the last checkpoint, so a
# restart costs seconds and loses no data.
MAX_RESTARTS=${MAX_RESTARTS:-50}
attempt=0
while :; do
  set +e
  pnpm exec envio start "$@"
  code=$?
  set -e

  if [ "$code" -eq 0 ]; then
    echo "[supervisor] indexer exited cleanly"
    break
  fi

  attempt=$((attempt + 1))
  if [ "$attempt" -ge "$MAX_RESTARTS" ]; then
    echo "[supervisor] giving up after $attempt restarts (last exit code $code)"
    exit "$code"
  fi

  backoff=$(( attempt < 6 ? attempt * 10 : 60 ))
  echo "[supervisor] indexer exited $code — restart $attempt/$MAX_RESTARTS in ${backoff}s"
  sleep "$backoff"
done
