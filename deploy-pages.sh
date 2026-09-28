#!/usr/bin/env bash
# Kept for muscle memory: publishing now goes through scripts/publish.sh, which
# ships fresh stats with the committed dashboard/ (subtree push cannot, since
# dashboard/data is no longer tracked).
exec "$(dirname "$0")/scripts/publish.sh" "$@"
