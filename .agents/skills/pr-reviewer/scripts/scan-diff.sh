#!/usr/bin/env bash
# ==============================================================================
# Script: scan-diff.sh
# Description: Performs deep static analysis on newly added lines (+) in a PR diff
#              to detect forbidden characters, mock code, design token violations,
#              anti-patterns, and quality debt before PM manual review.
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

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

DIFF_FILE="$TMP_DIR/pr-$PR_NUMBER.diff"
ADDED_LINES_FILE="$TMP_DIR/added_lines.txt"
FRONTEND_ADDED_LINES_FILE="$TMP_DIR/frontend_added_lines.txt"
BACKEND_ADDED_LINES_FILE="$TMP_DIR/backend_added_lines.txt"

print_sample() {
  local content="$1"
  if [ -n "$content" ]; then
    printf "%s\n" "$content" | sed -n '1,10p'
  fi
}

# 1. Fetch diff via GitHub CLI
gh pr diff "$PR_NUMBER" > "$DIFF_FILE"

# 2. Extract added lines (+), skipping diff headers (+++)
grep -E '^\+[^+]' "$DIFF_FILE" > "$ADDED_LINES_FILE" || true

# 3. Extract added lines specifically for frontend files (apps/web)
awk '
  /^diff --git a\/apps\/web/ { in_web = 1; next }
  /^diff --git a\// { in_web = 0; next }
  in_web && /^\+[^+]/ { print }
' "$DIFF_FILE" > "$FRONTEND_ADDED_LINES_FILE" || true

# 4. Extract added lines specifically for backend files (apps/api)
awk '
  /^diff --git a\/apps\/api/ { in_api = 1; next }
  /^diff --git a\// { in_api = 0; next }
  in_api && /^\+[^+]/ { print }
' "$DIFF_FILE" > "$BACKEND_ADDED_LINES_FILE" || true

WARNING_COUNT=0
LEAD_COUNT=0

echo "======================================================================"
echo "FRONT-TIER STATIC DIFF SCAN REPORT: PR #$PR_NUMBER"
echo "======================================================================"

# Check 1: Emoji characters
echo "[1] Scanning for Emoji characters (Strict Zero-Emoji Policy):"
EMOJI_HITS=$(perl -CS -ne 'print if /\p{Extended_Pictographic}/' "$ADDED_LINES_FILE" || true)
if [ -n "$EMOJI_HITS" ]; then
  echo "WARNING: Detected emoji characters in newly added lines:"
  print_sample "$EMOJI_HITS"
  WARNING_COUNT=$((WARNING_COUNT + 1))
else
  echo "OK: No emoji characters detected."
fi
echo ""

# Check 2: Forbidden dash characters (En-dash U+2013, Em-dash U+2014)
echo "[2] Scanning for forbidden dash characters (En-dash U+2013, Em-dash U+2014):"
DASH_HITS=$(perl -CS -ne 'print if /[\x{2013}\x{2014}]/' "$ADDED_LINES_FILE" || true)
if [ -n "$DASH_HITS" ]; then
  echo "WARNING: Detected forbidden dash characters:"
  print_sample "$DASH_HITS"
  WARNING_COUNT=$((WARNING_COUNT + 1))
else
  echo "OK: No en-dash or em-dash characters detected."
fi
echo ""

# Check 3: Raw <img> tags in Next.js frontend code
echo "[3] Scanning for raw <img> tags in Next.js code (Enforcing next/image):"
IMG_HITS=$(grep -En "<img\s+|<img\b" "$FRONTEND_ADDED_LINES_FILE" || true)
if [ -n "$IMG_HITS" ]; then
  echo "WARNING: Detected raw <img> tags in apps/web. Must use Next.js <Image />:"
  print_sample "$IMG_HITS"
  WARNING_COUNT=$((WARNING_COUNT + 1))
else
  echo "OK: No raw <img> tags detected."
fi
echo ""

# Check 4: Arbitrary Tailwind values and raw hex color codes (Design Tokens compliance)
echo "[4] Scanning for raw hex color codes and arbitrary Tailwind values in apps/web:"
HEX_HITS=$(grep -En "(#[0-9a-fA-F]{3,8}\b|(bg|text|border|ring|fill|stroke)-\[#[0-9a-fA-F]{3,8}\])" "$FRONTEND_ADDED_LINES_FILE" || true)
if [ -n "$HEX_HITS" ]; then
  echo "LEAD: Detected raw hex colors or arbitrary Tailwind values in frontend:"
  print_sample "$HEX_HITS"
  echo "Note: If colors are inside SVG icons, they may be acceptable."
  echo "Component styles must use CSS design tokens from docs/DESIGN_TOKENS.md."
  LEAD_COUNT=$((LEAD_COUNT + 1))
else
  echo "OK: No raw hex colors or arbitrary Tailwind color classes detected."
fi
echo ""

# Check 5: Debugger and console statements
echo "[5] Scanning for console.log / debugger statements:"
DEBUG_HITS=$(grep -En "(console\.(log|debug|warn|trace)\b|debugger;)" "$ADDED_LINES_FILE" || true)
if [ -n "$DEBUG_HITS" ]; then
  echo "WARNING: Detected console or debugger statements left in code:"
  print_sample "$DEBUG_HITS"
  WARNING_COUNT=$((WARNING_COUNT + 1))
else
  echo "OK: No leftover console.log or debugger statements detected."
fi
echo ""

# Check 6: Loose TypeScript casting and suppressions
echo "[6] Scanning for loose type casting (any) and TypeScript suppressions:"
TYPE_HITS=$(grep -En "(:\s*any\b|as\s+any\b|<any>|@ts-ignore|@ts-nocheck)" "$ADDED_LINES_FILE" || true)
if [ -n "$TYPE_HITS" ]; then
  echo "WARNING: Detected any casting or ts-ignore suppressions:"
  print_sample "$TYPE_HITS"
  WARNING_COUNT=$((WARNING_COUNT + 1))
else
  echo "OK: No any casting or TypeScript suppressions detected."
fi
echo ""

# Check 7: Empty catch blocks
echo "[7] Scanning for empty or swallowed catch blocks:"
CATCH_HITS=$(grep -En "catch\s*(\([^)]*\))?\s*\{\s*\}" "$ADDED_LINES_FILE" || true)
if [ -n "$CATCH_HITS" ]; then
  echo "WARNING: Detected empty catch blocks swallowing errors:"
  print_sample "$CATCH_HITS"
  WARNING_COUNT=$((WARNING_COUNT + 1))
else
  echo "OK: No empty catch blocks detected."
fi
echo ""

# Check 8: Potential hardcoded secret or credential patterns
echo "[8] Scanning for potential hardcoded secrets, private keys, or API credentials:"
SECRET_HITS=$(grep -EIn "(api[_-]?key|secret|password|jwt_secret)\s*[:=]\s*[\"'][^\"']{8,}[\"']" "$ADDED_LINES_FILE" || true)
if [ -n "$SECRET_HITS" ]; then
  echo "WARNING: Detected potential hardcoded secrets or credentials:"
  print_sample "$SECRET_HITS"
  WARNING_COUNT=$((WARNING_COUNT + 1))
else
  echo "OK: No hardcoded secret patterns detected."
fi
echo ""

# Check 9: Raw SQL query bypasses in backend
echo "[9] Scanning for raw SQL bypasses in apps/api:"
SQL_HITS=$(grep -En '(rawQuery|\$queryRaw|query\([^)]*(SELECT|INSERT|UPDATE|DELETE))' "$BACKEND_ADDED_LINES_FILE" || true)
if [ -n "$SQL_HITS" ]; then
  echo "WARNING: Detected potential raw SQL queries bypassing Drizzle ORM:"
  print_sample "$SQL_HITS"
  WARNING_COUNT=$((WARNING_COUNT + 1))
else
  echo "OK: No raw SQL query bypasses detected."
fi
echo ""

# Check 10: Client-side storage and mock auth leads
echo "[10] Scanning for client-side mocking leads (Requires contextual judgment):"
MOCK_HITS=$(grep -En "(localStorage|sessionStorage|mockData|fakeToken|dummyToken)" "$ADDED_LINES_FILE" || true)
if [ -n "$MOCK_HITS" ]; then
  echo "LEAD: Detected client storage keywords or mock data references:"
  print_sample "$MOCK_HITS"
  echo "Note: Reviewer must verify if this is fake auth token storage (Violation)"
  echo "or non-sensitive UI state persistence such as theme/sidebar (Acceptable)."
  LEAD_COUNT=$((LEAD_COUNT + 1))
else
  echo "OK: No mock or client storage keywords detected."
fi
echo ""

# Check 11: Artificial delay simulation (setTimeout >= 300ms)
echo "[11] Scanning for setTimeout with delays >= 300ms:"
TIMEOUT_HITS=$(grep -En "setTimeout\([^,]+,\s*[3-9][0-9]{2,}\)" "$ADDED_LINES_FILE" || true)
if [ -n "$TIMEOUT_HITS" ]; then
  echo "LEAD: Detected setTimeout with delay of 300ms or higher:"
  print_sample "$TIMEOUT_HITS"
  echo "Note: Reviewer must verify whether this is for search debouncing (Acceptable)"
  echo "or faking network loading delays (Violation - TRASH_CODE)."
  LEAD_COUNT=$((LEAD_COUNT + 1))
else
  echo "OK: No suspicious setTimeout calls detected."
fi
echo ""

echo "======================================================================"
echo "SUMMARY FOR PR #$PR_NUMBER: $WARNING_COUNT Warning(s), $LEAD_COUNT Lead(s)"
if [ "$WARNING_COUNT" -gt 0 ]; then
  echo "STATUS: ATTENTION REQUIRED (Found $WARNING_COUNT potential policy violation(s))"
elif [ "$LEAD_COUNT" -gt 0 ]; then
  echo "STATUS: MANUAL AUDIT REQUIRED (Found $LEAD_COUNT contextual lead(s))"
else
  echo "STATUS: CLEAN (Zero static warnings and zero leads detected)"
fi
echo "======================================================================"
