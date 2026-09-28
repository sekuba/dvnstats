#!/usr/bin/env bash
# Refresh dashboard/data/stats.json and publish the site to GitHub Pages.
#
# The site is the committed dashboard/ folder (HEAD) plus freshly computed
# data, so gh-pages is a build artifact: it holds a single commit that is
# force-pushed on every publish. Data never lands in main's history.
#
#   ./scripts/publish.sh             # incremental stats, then publish
#   ./scripts/publish.sh --full      # rebuild the stats cube first (~3 min)
#   ./scripts/publish.sh --dry-run   # build the site in a temp dir, don't push
#
# Cron (node from fnm is not on cron's PATH; git needs a non-interactive key):
#   17 */6 * * * PATH=$HOME/.local/share/fnm/aliases/default/bin:$PATH /path/to/repo/scripts/publish.sh >> /path/to/repo/logs/publish.log 2>&1
#   47 3 * * 0   PATH=$HOME/.local/share/fnm/aliases/default/bin:$PATH /path/to/repo/scripts/publish.sh --full >> /path/to/repo/logs/publish.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
repo="$PWD"

full=""
push=1
for arg in "$@"; do
  case "$arg" in
    --full) full="--full" ;;
    --dry-run) push=0 ;;
    *) echo "usage: $0 [--full] [--dry-run]" >&2; exit 2 ;;
  esac
done

# The page code comes from HEAD; publishing next to uncommitted edits would ship
# stats.json with a page that may not understand it.
if [[ -n "$(git status --porcelain -- dashboard)" ]]; then
  echo "publish: dashboard/ has uncommitted changes; commit them first" >&2
  exit 1
fi

echo "[$(date -u +%FT%TZ)] publish: building stats"
node scripts/precomputePacketStats.js $full

site="$(mktemp -d)"
trap 'rm -rf "$site"' EXIT
git archive HEAD dashboard | tar -x -C "$site" --strip-components=1
mkdir -p "$site/data"
cp dashboard/data/stats.json "$site/data/stats.json"
touch "$site/.nojekyll"

head="$(git rev-parse --short HEAD)"
git -C "$site" init -q -b gh-pages
git -C "$site" add -A
git -C "$site" \
  -c user.name="$(git config user.name)" \
  -c user.email="$(git config user.email)" \
  commit -q -m "site: main@${head}, stats $(date -u +%FT%TZ)"

if ((push)); then
  git -C "$site" push -q --force "$(git remote get-url origin)" gh-pages:gh-pages
  echo "publish: pushed main@${head} to gh-pages"
else
  echo "publish: dry run, site built in $site:"
  (cd "$site" && find . -path ./.git -prune -o -type f -print | sort | head -50)
  trap - EXIT
fi
