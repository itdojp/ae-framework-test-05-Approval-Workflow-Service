#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-}"
RUN_ID="${RUN_ID:-}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

if [[ -z "$PROFILE" ]]; then
  echo "Usage: bash scripts/ci/persist-artifacts.sh <profile>"
  exit 2
fi

if [[ -z "$RUN_ID" ]]; then
  echo "ERROR: RUN_ID is required"
  exit 1
fi

if [[ -z "$GITHUB_REPOSITORY" || -z "$GITHUB_TOKEN" ]]; then
  echo "ERROR: GITHUB_REPOSITORY and GITHUB_TOKEN are required"
  exit 1
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PUBLISH_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$PUBLISH_DIR"
}
trap cleanup EXIT

REPO_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"

git clone --depth 1 --branch main "$REPO_URL" "$PUBLISH_DIR"
mkdir -p "$PUBLISH_DIR/artifacts" "$PUBLISH_DIR/.ae"

if [[ -d "$PROJECT_ROOT/artifacts" ]]; then
  rsync -a "$PROJECT_ROOT/artifacts/" "$PUBLISH_DIR/artifacts/"
fi
if [[ -d "$PROJECT_ROOT/.ae" ]]; then
  rsync -a "$PROJECT_ROOT/.ae/" "$PUBLISH_DIR/.ae/"
fi

cd "$PUBLISH_DIR"

# Recompute derived cross-run reports on top of merged artifacts to avoid stale index/trend.
node scripts/testing/run-index-report.mjs
node scripts/testing/trend-report.mjs

if [[ -z "$(git status --porcelain -- artifacts .ae)" ]]; then
  echo "No artifact changes to commit."
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add artifacts .ae
git commit -m "ci: persist ${PROFILE} artifacts for ${RUN_ID} [skip ci]"

for attempt in 1 2 3; do
  if git push origin main; then
    echo "Artifact commit pushed: profile=${PROFILE} runId=${RUN_ID}"
    exit 0
  fi
  if [[ "$attempt" -eq 3 ]]; then
    break
  fi
  echo "WARN: push rejected (attempt=${attempt}), rebasing and retrying..."
  git pull --rebase origin main
done

echo "ERROR: failed to push artifact commit after retries"
exit 1
