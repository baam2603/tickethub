#!/usr/bin/env bash
# ==============================================================================
# Script: verify-pr.sh
# Description: Automated isolated worktree pre-flight runner for PR reviews.
#              Checks out the PR in a clean temporary git worktree, validates
#              Section 6 media URLs reachability, and executes full verification.
# ==============================================================================

set -euo pipefail

export LC_ALL=C.UTF-8
export LANG=C.UTF-8

PR_NUMBER="${1:-}"

if [ -z "$PR_NUMBER" ]; then
  echo "Usage: $0 <PR_NUMBER>"
  echo "Example: $0 22"
  exit 1
fi

MAIN_REPO_DIR=$(pwd -P)
WORKTREE_DIR=$(mktemp -d /tmp/tickethub-pr-"$PR_NUMBER"-XXXXXX)
TEMP_BRANCH="pr-$PR_NUMBER-review-$$"

cleanup() {
  echo ""
  echo "Cleaning up temporary review worktree..."
  cd "$MAIN_REPO_DIR"
  git worktree remove --force "$WORKTREE_DIR" 2>/dev/null || true
  git branch -D "$TEMP_BRANCH" 2>/dev/null || true
  rm -rf "$WORKTREE_DIR"
}
trap cleanup EXIT

echo "======================================================================"
echo "FRONT-TIER PRE-FLIGHT VERIFICATION FOR PR #$PR_NUMBER"
echo "======================================================================"

# 1. Fetch PR metadata
echo "[1/4] Fetching PR metadata via GitHub CLI..."
PR_DATA=$(gh pr view "$PR_NUMBER" --json number,title,body,headRefName,headRefOid)
PR_TITLE=$(node -p "(${PR_DATA}).title")
PR_BODY=$(node -p "(${PR_DATA}).body || ''")

echo "PR Title: $PR_TITLE"

# 2. Validate Section 6 media link reachability
echo ""
echo "[2/4] Verifying reachability of Section 6 visual proof media URLs..."
MEDIA_URLS=$(printf "%s" "$PR_BODY" | grep -Eo 'https?://[^ )>"]+' | grep -Ei '(\.(png|jpe?g|gif|webp|mp4|webm|mov)|loom\.com|youtube\.com|youtu\.be|github\.com/user-attachments)' || true)

MEDIA_STATUS="N/A"
if [ -n "$MEDIA_URLS" ]; then
  MEDIA_STATUS="PASSED"
  while IFS= read -r url; do
    [ -z "$url" ] && continue
    echo -n "Checking media link $url ... "
    HTTP_CODE=$(curl -sI -L -m 5 -o /dev/null -w "%{http_code}" "$url" || echo "FAILED")
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
      echo "OK (HTTP $HTTP_CODE)"
    else
      echo "UNREACHABLE (HTTP $HTTP_CODE)"
      MEDIA_STATUS="FAILED"
    fi
  done <<< "$MEDIA_URLS"
else
  echo "No direct visual proof media URLs found in PR description."
fi

# 3. Create isolated git worktree
echo ""
echo "[3/4] Creating isolated git worktree at $WORKTREE_DIR..."
git fetch origin "pull/$PR_NUMBER/head:$TEMP_BRANCH" --quiet
git worktree add --quiet "$WORKTREE_DIR" "$TEMP_BRANCH"

# Copy local node_modules & pnpm store pointers to speed up installation
if [ -d "$MAIN_REPO_DIR/node_modules" ]; then
  cp -r "$MAIN_REPO_DIR/node_modules" "$WORKTREE_DIR/" 2>/dev/null || true
fi
if [ -d "$MAIN_REPO_DIR/apps/web/node_modules" ]; then
  mkdir -p "$WORKTREE_DIR/apps/web"
  cp -r "$MAIN_REPO_DIR/apps/web/node_modules" "$WORKTREE_DIR/apps/web/" 2>/dev/null || true
fi
if [ -d "$MAIN_REPO_DIR/apps/api/node_modules" ]; then
  mkdir -p "$WORKTREE_DIR/apps/api"
  cp -r "$MAIN_REPO_DIR/apps/api/node_modules" "$WORKTREE_DIR/apps/api/" 2>/dev/null || true
fi

cd "$WORKTREE_DIR"

LINT_STATUS="PASSED"
FORMAT_STATUS="PASSED"
TYPECHECK_STATUS="PASSED"
TEST_STATUS="PASSED"
DOC_PARITY_STATUS="PASSED"

echo ""
echo "[4/4] Executing technical verification suites inside PR worktree..."

# Step 4.1: Format check
echo -n "Checking code style (Prettier)... "
if pnpm format:check >/dev/null 2>&1; then
  echo "PASSED"
else
  echo "FAILED"
  FORMAT_STATUS="FAILED"
fi

# Step 4.2: Lint check with zero warnings
echo -n "Checking linter rules (ESLint --max-warnings 0)... "
if pnpm lint >/dev/null 2>&1; then
  echo "PASSED"
else
  echo "FAILED"
  LINT_STATUS="FAILED"
fi

# Step 4.3: TypeScript typecheck
echo -n "Checking strict types (tsc --noEmit)... "
if pnpm typecheck >/dev/null 2>&1; then
  echo "PASSED"
else
  echo "FAILED"
  TYPECHECK_STATUS="FAILED"
fi

# Step 4.4: Root node tests & doc parity
echo -n "Checking root unit tests & doc parity... "
if node --test tests/*.test.mjs >/dev/null 2>&1; then
  echo "PASSED"
else
  echo "FAILED"
  DOC_PARITY_STATUS="FAILED"
fi

# Step 4.5: Workspace unit tests
echo -n "Checking workspace unit tests... "
if pnpm test >/dev/null 2>&1; then
  echo "PASSED"
else
  echo "FAILED"
  TEST_STATUS="FAILED"
fi

echo ""
echo "======================================================================"
echo "PRE-FLIGHT VERIFICATION MATRIX: PR #$PR_NUMBER"
echo "======================================================================"
printf "%-35s | %-10s\n" "Verification Dimension" "Result"
echo "------------------------------------+-----------"
printf "%-35s | %-10s\n" "Media URLs Reachable (Section 6)" "$MEDIA_STATUS"
printf "%-35s | %-10s\n" "Prettier Code Style" "$FORMAT_STATUS"
printf "%-35s | %-10s\n" "ESLint (Zero Warnings Enforced)" "$LINT_STATUS"
printf "%-35s | %-10s\n" "TypeScript Strict Types" "$TYPECHECK_STATUS"
printf "%-35s | %-10s\n" "Doc Parity & Root Tests" "$DOC_PARITY_STATUS"
printf "%-35s | %-10s\n" "Workspace Test Suites" "$TEST_STATUS"
echo "======================================================================"

if [ "$MEDIA_STATUS" = "FAILED" ] || [ "$FORMAT_STATUS" = "FAILED" ] || [ "$LINT_STATUS" = "FAILED" ] || [ "$TYPECHECK_STATUS" = "FAILED" ] || [ "$DOC_PARITY_STATUS" = "FAILED" ] || [ "$TEST_STATUS" = "FAILED" ]; then
  echo "RECOMMENDED VERDICT: REQUEST_CHANGES (Technical verification failures detected)"
else
  echo "RECOMMENDED VERDICT: PROCEED TO BUSINESS LOGIC REVIEW (All pre-flight checks clean)"
fi
echo "======================================================================"
