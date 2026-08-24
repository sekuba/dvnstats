#!/usr/bin/env bash
# Stop the indexer. Leaves Postgres/Hasura running — use `pnpm stack:down` for
# those, and never `docker compose down -v` (that deletes the data volume).
#
# run-indexer.sh is a supervisor: killing the `envio start` child alone just
# makes it restart after its backoff. So this signals the supervisor's whole
# process group — supervisor, pnpm wrapper, envio, and any pending `sleep`.
#
# Stopping is cheap: envio flushes and the next start resumes from its last
# checkpoint ("Successfully resumed indexing state").
#
# Restart with `pnpm start`, or detached:
#   setsid nohup ./run-indexer.sh >> logs/indexer-v38.log 2>&1 &
set -euo pipefail
cd "$(dirname "$0")"
repo="$PWD"

# Read a process's argv as an array. Matching on argv (not a `pgrep -f` regex
# over the whole command line) is what keeps this from ever matching an
# interactive shell that merely mentions "run-indexer.sh" in its command.
# The braces put the redirection itself inside the silenced block: a process
# that exits between the /proc scan and this read would otherwise make bash
# print its own "No such file or directory" for the failed input redirect.
argv_of() {
  local pid=$1
  [[ -r "/proc/$pid/cmdline" ]] || return 1
  { mapfile -d '' -t ARGV < "/proc/$pid/cmdline"; } 2>/dev/null || return 1
  ((${#ARGV[@]} > 0))
}

in_repo() {
  [[ "$(readlink -f "/proc/$1/cwd" 2>/dev/null || true)" == "$repo" ]]
}

# `bash ./run-indexer.sh` — exactly two argv entries, so `bash -c '...'` can
# never qualify.
is_supervisor() {
  argv_of "$1" || return 1
  ((${#ARGV[@]} == 2)) || return 1
  case "${ARGV[0]##*/}" in bash | sh) ;; *) return 1 ;; esac
  [[ "${ARGV[1]}" == *run-indexer.sh ]] || return 1
  in_repo "$1"
}

# `node .../envio/bin.mjs start`
is_indexer() {
  argv_of "$1" || return 1
  [[ "${ARGV[0]##*/}" == node* ]] || return 1
  local a found_bin=0 found_start=0
  for a in "${ARGV[@]}"; do
    [[ "$a" == */envio/bin.mjs ]] && found_bin=1
    [[ "$a" == start ]] && found_start=1
  done
  ((found_bin && found_start)) && in_repo "$1"
}

pids=()
for pid in /proc/[0-9]*; do
  pid=${pid#/proc/}
  if is_supervisor "$pid" || is_indexer "$pid"; then pids+=("$pid"); fi
done

if [[ ${#pids[@]} -eq 0 ]]; then
  echo "indexer: not running"
  exit 0
fi

# Process groups, deduplicated: the supervisor leads the group its children sit
# in, so this is usually a single group covering everything.
pgids=()
for pid in "${pids[@]}"; do
  pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)
  [[ -n "$pgid" ]] || continue
  [[ " ${pgids[*]-} " == *" $pgid "* ]] || pgids+=("$pgid")
done

alive() { for p in "${pids[@]}"; do kill -0 "$p" 2>/dev/null && return 0; done; return 1; }

wait_for_exit() {
  local deadline=$((SECONDS + $1))
  while ((SECONDS < deadline)); do
    alive || return 0
    sleep 1
  done
  return 1
}

echo "indexer: stopping pids ${pids[*]} (process groups ${pgids[*]})"
for pgid in "${pgids[@]}"; do kill -TERM "-$pgid" 2>/dev/null || true; done

if wait_for_exit 30; then
  echo "indexer: stopped"
  exit 0
fi

echo "indexer: did not exit on SIGTERM, sending SIGKILL" >&2
for pgid in "${pgids[@]}"; do kill -KILL "-$pgid" 2>/dev/null || true; done
wait_for_exit 10 || {
  echo "indexer: FAILED to stop ${pids[*]}" >&2
  exit 1
}
echo "indexer: killed"
