#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${REPO_ROOT:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
MIN_AGE_DAYS="${MIN_AGE_DAYS:-7}"
MAX_AGE_DAYS="${MAX_AGE_DAYS:-14}"
DRY_RUN="${DRY_RUN:-0}"
REPOSITORY_FULL_NAME="${REPOSITORY_FULL_NAME:-SynapseNetworkAI/Synapse-Network}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR missing required command: $1" >&2
    exit 1
  fi
}

assert_integer() {
  case "$2" in
    ''|*[!0-9]*)
      echo "ERROR ${1} must be a non-negative integer, got: $2" >&2
      exit 1
      ;;
  esac
}

cleanup() {
  rm -rf "${TMP_DIR}"
}

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/branch-cleanup.XXXXXX")"
trap cleanup EXIT

require_command git
require_command gh
require_command node
require_command awk
require_command sort
require_command grep
require_command date

assert_integer "MIN_AGE_DAYS" "${MIN_AGE_DAYS}"
assert_integer "MAX_AGE_DAYS" "${MAX_AGE_DAYS}"
assert_integer "DRY_RUN" "${DRY_RUN}"

if [ "${MIN_AGE_DAYS}" -ge "${MAX_AGE_DAYS}" ]; then
  echo "ERROR MIN_AGE_DAYS must be smaller than MAX_AGE_DAYS" >&2
  exit 1
fi

cd "${ROOT_DIR}"

if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR gh auth status failed; aborting branch cleanup" >&2
  exit 1
fi

GIT_TERMINAL_PROMPT=0 git fetch origin --prune >/dev/null 2>&1
git worktree prune >/dev/null 2>&1

CURRENT_BRANCH="$(git branch --show-current || true)"

if ! git worktree list --porcelain > "${TMP_DIR}/worktrees.txt"; then
  echo "ERROR git worktree list --porcelain failed; aborting branch cleanup" >&2
  exit 1
fi

awk '/^branch / { sub("^refs/heads/", "", $2); print $2 }' "${TMP_DIR}/worktrees.txt" | sort -u > "${TMP_DIR}/worktree_branches.txt"

if ! gh pr list --state open --limit 200 --json headRefName --jq '.[].headRefName' > "${TMP_DIR}/open_pr_heads.txt"; then
  echo "ERROR failed to resolve open PR head branches; aborting branch cleanup" >&2
  exit 1
fi

git for-each-ref --format='%(refname:short)|%(committerdate:unix)' refs/heads refs/remotes/origin \
  | awk -F'|' '
      {
        ref=$1
        ts=$2 + 0
        base=ref
        sub(/^origin\//, "", base)
        if (!(base in latest) || ts > latest[base]) {
          latest[base]=ts
        }
      }
      END {
        for (branch in latest) {
          print branch "|" latest[branch]
        }
      }
    ' \
  | sort > "${TMP_DIR}/branch_dates.txt"

NOW_TS="$(date -u +%s)"
MIN_AGE_SECONDS="$((MIN_AGE_DAYS * 86400))"
MAX_AGE_SECONDS="$((MAX_AGE_DAYS * 86400))"

SCANNED_COUNT=0
CANDIDATE_COUNT=0
DELETED_REMOTE_COUNT=0
DELETED_LOCAL_COUNT=0
REMOTE_FAILED_COUNT=0
LOCAL_FAILED_COUNT=0
SKIPPED_PROTECTED_COUNT=0
SKIPPED_CURRENT_COUNT=0
SKIPPED_OPEN_PR_COUNT=0
SKIPPED_WORKTREE_COUNT=0
SKIPPED_OUTSIDE_WINDOW_COUNT=0

while IFS='|' read -r BRANCH BRANCH_TS; do
  [ -z "${BRANCH}" ] && continue
  SCANNED_COUNT="$((SCANNED_COUNT + 1))"

  case "${BRANCH}" in
    main|origin|HEAD)
      SKIPPED_PROTECTED_COUNT="$((SKIPPED_PROTECTED_COUNT + 1))"
      echo "SKIPPED_PROTECTED ${BRANCH}"
      continue
      ;;
  esac

  if [ -n "${CURRENT_BRANCH}" ] && [ "${BRANCH}" = "${CURRENT_BRANCH}" ]; then
    SKIPPED_CURRENT_COUNT="$((SKIPPED_CURRENT_COUNT + 1))"
    echo "SKIPPED_CURRENT ${BRANCH}"
    continue
  fi

  if grep -Fqx "${BRANCH}" "${TMP_DIR}/open_pr_heads.txt"; then
    SKIPPED_OPEN_PR_COUNT="$((SKIPPED_OPEN_PR_COUNT + 1))"
    echo "SKIPPED_OPEN_PR ${BRANCH}"
    continue
  fi

  if grep -Fqx "${BRANCH}" "${TMP_DIR}/worktree_branches.txt"; then
    SKIPPED_WORKTREE_COUNT="$((SKIPPED_WORKTREE_COUNT + 1))"
    echo "SKIPPED_WORKTREE ${BRANCH}"
    continue
  fi

  AGE_SECONDS="$((NOW_TS - BRANCH_TS))"
  if [ "${AGE_SECONDS}" -lt "${MIN_AGE_SECONDS}" ] || [ "${AGE_SECONDS}" -ge "${MAX_AGE_SECONDS}" ]; then
    SKIPPED_OUTSIDE_WINDOW_COUNT="$((SKIPPED_OUTSIDE_WINDOW_COUNT + 1))"
    continue
  fi

  CANDIDATE_COUNT="$((CANDIDATE_COUNT + 1))"
  echo "CANDIDATE ${BRANCH}"

  if [ "${DRY_RUN}" != "0" ]; then
    continue
  fi

  if git show-ref --verify --quiet "refs/remotes/origin/${BRANCH}"; then
    ENCODED_BRANCH="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "${BRANCH}")"
    if gh api -X DELETE "repos/${REPOSITORY_FULL_NAME}/git/refs/heads/${ENCODED_BRANCH}" >/dev/null 2>&1; then
      DELETED_REMOTE_COUNT="$((DELETED_REMOTE_COUNT + 1))"
      echo "DELETED_REMOTE ${BRANCH}"
    else
      REMOTE_FAILED_COUNT="$((REMOTE_FAILED_COUNT + 1))"
      echo "REMOTE_DELETE_FAILED ${BRANCH}"
    fi
  fi

  if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
    if git branch -D "${BRANCH}" >/dev/null 2>&1; then
      DELETED_LOCAL_COUNT="$((DELETED_LOCAL_COUNT + 1))"
      echo "DELETED_LOCAL ${BRANCH}"
    else
      LOCAL_FAILED_COUNT="$((LOCAL_FAILED_COUNT + 1))"
      echo "LOCAL_DELETE_FAILED ${BRANCH}"
    fi
  fi
done < "${TMP_DIR}/branch_dates.txt"

if [ "${DRY_RUN}" = "0" ]; then
  GIT_TERMINAL_PROMPT=0 git fetch origin --prune >/dev/null 2>&1 || true
  git worktree prune >/dev/null 2>&1 || true
fi

git for-each-ref --format='%(refname:short)|%(committerdate:unix)' refs/heads refs/remotes/origin \
  | awk -F'|' '
      {
        ref=$1
        ts=$2 + 0
        base=ref
        sub(/^origin\//, "", base)
        if (!(base in latest) || ts > latest[base]) {
          latest[base]=ts
        }
      }
      END {
        for (branch in latest) {
          print branch "|" latest[branch]
        }
      }
    ' \
  | sort > "${TMP_DIR}/branch_dates_after.txt"

REMAINING_CANDIDATES_COUNT=0
while IFS='|' read -r BRANCH BRANCH_TS; do
  [ -z "${BRANCH}" ] && continue

  case "${BRANCH}" in
    main|origin|HEAD)
      continue
      ;;
  esac

  if [ -n "${CURRENT_BRANCH}" ] && [ "${BRANCH}" = "${CURRENT_BRANCH}" ]; then
    continue
  fi

  if grep -Fqx "${BRANCH}" "${TMP_DIR}/open_pr_heads.txt"; then
    continue
  fi

  if grep -Fqx "${BRANCH}" "${TMP_DIR}/worktree_branches.txt"; then
    continue
  fi

  AGE_SECONDS="$((NOW_TS - BRANCH_TS))"
  if [ "${AGE_SECONDS}" -lt "${MIN_AGE_SECONDS}" ] || [ "${AGE_SECONDS}" -ge "${MAX_AGE_SECONDS}" ]; then
    continue
  fi

  REMAINING_CANDIDATES_COUNT="$((REMAINING_CANDIDATES_COUNT + 1))"
done < "${TMP_DIR}/branch_dates_after.txt"

echo "SUMMARY scanned=${SCANNED_COUNT} candidates=${CANDIDATE_COUNT} deleted_remote=${DELETED_REMOTE_COUNT} deleted_local=${DELETED_LOCAL_COUNT} remote_delete_failed=${REMOTE_FAILED_COUNT} local_delete_failed=${LOCAL_FAILED_COUNT} skipped_protected=${SKIPPED_PROTECTED_COUNT} skipped_current=${SKIPPED_CURRENT_COUNT} skipped_open_pr=${SKIPPED_OPEN_PR_COUNT} skipped_worktree=${SKIPPED_WORKTREE_COUNT} skipped_outside_window=${SKIPPED_OUTSIDE_WINDOW_COUNT} remaining_candidates=${REMAINING_CANDIDATES_COUNT} dry_run=${DRY_RUN} min_age_days=${MIN_AGE_DAYS} max_age_days=${MAX_AGE_DAYS}"
