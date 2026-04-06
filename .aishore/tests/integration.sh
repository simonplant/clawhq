#!/usr/bin/env bash
# integration.sh — End-to-end integration tests for aishore
#
# Tests every documented command, flag, workflow, and edge case.
# Creates temporary backlog items, exercises them, and cleans up.
# Safe to run on any repo — restores backlog state on exit.
#
# Usage: bash .aishore/tests/integration.sh
#        bash .aishore/tests/integration.sh --ci   (exit 1 on first failure)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
AISHORE="$SCRIPT_DIR/.aishore/aishore"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
RESET='\033[0m'

ci_mode=false
[[ "${1:-}" == "--ci" ]] && ci_mode=true

passed=0
failed=0
total=0

# ─── Test helpers ───────────────────────────────────────────────────────────

# Assert command succeeds (exit 0)
assert_ok() {
    local label="$1"; shift
    total=$((total + 1))
    local output
    if output=$("$@" 2>&1); then
        echo -e "${GREEN}PASS${RESET}  $label"
        ((passed++))
    else
        echo -e "${RED}FAIL${RESET}  $label (expected exit 0, got $?)"
        echo "       output: $(echo "$output" | head -3)"
        ((failed++))
        $ci_mode && exit 1
    fi
}

# Assert command fails (exit != 0)
assert_fail() {
    local label="$1"; shift
    total=$((total + 1))
    local output
    if output=$("$@" 2>&1); then
        echo -e "${RED}FAIL${RESET}  $label (expected failure, got exit 0)"
        echo "       output: $(echo "$output" | head -3)"
        ((failed++))
        $ci_mode && exit 1
    else
        echo -e "${GREEN}PASS${RESET}  $label"
        ((passed++))
    fi
}

# Assert command output contains a string
assert_contains() {
    local label="$1" needle="$2"; shift 2
    total=$((total + 1))
    local output
    output=$("$@" 2>&1) || true
    if echo "$output" | grep -Fq "$needle"; then
        echo -e "${GREEN}PASS${RESET}  $label"
        ((passed++))
    else
        echo -e "${RED}FAIL${RESET}  $label (output missing: '$needle')"
        echo "       got: $(echo "$output" | head -3)"
        ((failed++))
        $ci_mode && exit 1
    fi
}

# Assert command output does NOT contain a string
assert_not_contains() {
    local label="$1" needle="$2"; shift 2
    total=$((total + 1))
    local output
    output=$("$@" 2>&1) || true
    if echo "$output" | grep -Fq "$needle"; then
        echo -e "${RED}FAIL${RESET}  $label (output should not contain: '$needle')"
        ((failed++))
        $ci_mode && exit 1
    else
        echo -e "${GREEN}PASS${RESET}  $label"
        ((passed++))
    fi
}

# ─── Snapshot/restore backlog for safe testing ──────────────────────────────

SNAP_DIR=$(mktemp -d)
trap 'restore_backlog; rm -rf "$SNAP_DIR"' EXIT

snapshot_backlog() {
    cp "$SCRIPT_DIR"/backlog/backlog.json "$SNAP_DIR/backlog.json" 2>/dev/null || true
    cp "$SCRIPT_DIR"/backlog/bugs.json "$SNAP_DIR/bugs.json" 2>/dev/null || true
}

restore_backlog() {
    cp "$SNAP_DIR/backlog.json" "$SCRIPT_DIR/backlog/backlog.json" 2>/dev/null || true
    cp "$SNAP_DIR/bugs.json" "$SCRIPT_DIR/backlog/bugs.json" 2>/dev/null || true
}

snapshot_backlog

echo "═══════════════════════════════════════"
echo "  aishore Integration Tests"
echo "═══════════════════════════════════════"
echo ""

# ─── 1. Syntax & basics ────────────────────────────────────────────────────

echo -e "${CYAN}── Syntax & basics ──${RESET}"

assert_ok    "bash -n passes"              bash -n "$AISHORE"
assert_ok    "jq validates backlog JSON"   jq empty "$SCRIPT_DIR"/backlog/*.json
assert_ok    "version command"             "$AISHORE" version
assert_contains "version matches VERSION file" \
    "$(cat "$SCRIPT_DIR/.aishore/VERSION" | tr -d '[:space:]')" \
    "$AISHORE" version

echo ""

# ─── 2. Help system ────────────────────────────────────────────────────────

echo -e "${CYAN}── Help system ──${RESET}"

assert_ok       "help (compact)"            "$AISHORE" help
assert_ok       "help --full"               "$AISHORE" help --full
assert_contains "help mentions run"         "run"     "$AISHORE" help
assert_contains "help mentions backlog"     "backlog" "$AISHORE" help
assert_contains "help branding"             "iterative intent-based development" "$AISHORE" help

# All help topics
for topic in run backlog groom scaffold review status update clean init; do
    assert_ok "help $topic" "$AISHORE" help "$topic"
done

assert_fail  "help invalid topic"  "$AISHORE" help nonexistent
assert_fail  "unknown command"     "$AISHORE" foobar

echo ""

# ─── 3. Status & list (read-only) ──────────────────────────────────────────

echo -e "${CYAN}── Status & list ──${RESET}"

assert_ok       "status"                    "$AISHORE" status
assert_ok       "backlog list"              "$AISHORE" backlog list
assert_ok       "backlog list --ready"      "$AISHORE" backlog list --ready
assert_ok       "backlog list --no-ready"   "$AISHORE" backlog list --no-ready
assert_ok       "clean --dry-run"           "$AISHORE" clean --dry-run

echo ""

# ─── 4. Backlog CRUD workflow ──────────────────────────────────────────────

echo -e "${CYAN}── Backlog CRUD workflow ──${RESET}"

# Create
assert_ok "backlog add feat" "$AISHORE" backlog add \
    --type feat --title "Integration test item" \
    --intent "Verify the full CRUD lifecycle works correctly in automated testing" \
    --priority should --category test \
    --steps "Step one" --steps "Step two" --steps "Step three" \
    --ac "First AC" --ac-verify "echo pass" \
    --ac "Second AC" \
    --scope "tests/**" \
    --desc "Temporary item for integration testing" \
    --ready

# Find the created ID (latest FEAT-*)
local_test_id=$(jq -r '.items[-1].id' "$SCRIPT_DIR/backlog/backlog.json")
[[ "$local_test_id" == FEAT-* ]] || { echo -e "${RED}FAIL${RESET}  could not find created item"; ((failed++)); }

# Read
assert_contains "show has title"    "Integration test item"  "$AISHORE" backlog show "$local_test_id"
assert_contains "show has intent"   "CRUD lifecycle"         "$AISHORE" backlog show "$local_test_id"
assert_contains "show has steps"    "Step two"               "$AISHORE" backlog show "$local_test_id"
assert_contains "show has AC"       "First AC"               "$AISHORE" backlog show "$local_test_id"
assert_contains "show has verify"   "echo pass"              "$AISHORE" backlog show "$local_test_id"
assert_contains "show has scope"    "tests/**"               "$AISHORE" backlog show "$local_test_id"
assert_contains "show has category" "test"                   "$AISHORE" backlog show "$local_test_id"
assert_contains "show has desc"     "Temporary item"         "$AISHORE" backlog show "$local_test_id"

# Update
assert_ok "edit title"    "$AISHORE" backlog edit "$local_test_id" --title "Updated title"
assert_ok "edit priority" "$AISHORE" backlog edit "$local_test_id" --priority must
assert_ok "edit status"   "$AISHORE" backlog edit "$local_test_id" --status in-progress
assert_ok "edit groomed"  "$AISHORE" backlog edit "$local_test_id" --groomed-at --groomed-notes "Test note"
assert_ok "edit AC"       "$AISHORE" backlog edit "$local_test_id" --ac "New AC" --ac-verify "true"
assert_ok "edit steps"    "$AISHORE" backlog edit "$local_test_id" --steps "Implement the new feature end to end"
assert_ok "edit scope"    "$AISHORE" backlog edit "$local_test_id" --scope "new/**"
# Check readiness gates (before edits that break readiness)
assert_ok "check item" "$AISHORE" backlog check "$local_test_id"

assert_ok "edit deps"     "$AISHORE" backlog edit "$local_test_id" --depends-on "FAKE-001"
assert_ok "edit no-ready" "$AISHORE" backlog edit "$local_test_id" --no-ready

# Verify edits
assert_contains "edit applied: title"    "Updated title"  "$AISHORE" backlog show "$local_test_id"
assert_contains "edit applied: priority" "must"           "$AISHORE" backlog show "$local_test_id"
assert_contains "edit applied: status"   "in-progress"    "$AISHORE" backlog show "$local_test_id"
assert_contains "edit applied: groomed"  "Test note"      "$AISHORE" backlog show "$local_test_id"
assert_contains "edit applied: scope"    "new/**"         "$AISHORE" backlog show "$local_test_id"
assert_contains "edit applied: deps"     "FAKE-001"       "$AISHORE" backlog show "$local_test_id"

# Delete
assert_ok "rm item" "$AISHORE" backlog rm "$local_test_id" --force
assert_fail "show after rm" "$AISHORE" backlog show "$local_test_id"

echo ""

# ─── 5. Bug item routing ───────────────────────────────────────────────────

echo -e "${CYAN}── Bug item routing ──${RESET}"

assert_ok "add bug" "$AISHORE" backlog add --type bug \
    --title "Integration test bug" \
    --intent "Verify bug items get BUG- prefix and route to bugs.json file" \
    --ac "Bug exists"

local_bug_id=$(jq -r '.items[-1].id' "$SCRIPT_DIR/backlog/bugs.json")
assert_contains "bug has BUG- prefix" "BUG-" echo "$local_bug_id"
assert_ok "bug in bugs.json" jq -e --arg id "$local_bug_id" '.items[] | select(.id == $id)' "$SCRIPT_DIR/backlog/bugs.json"
assert_ok "rm bug" "$AISHORE" backlog rm "$local_bug_id" --force

echo ""

# ─── 6. Clean & archive workflow ───────────────────────────────────────────

echo -e "${CYAN}── Clean & archive workflow ──${RESET}"

# Create, mark done, clean, verify archived
assert_ok "add for clean test" "$AISHORE" backlog add --type feat \
    --title "Clean test item" \
    --intent "Verify clean archives done items and removes them from active backlog"
local_clean_id=$(jq -r '.items[-1].id' "$SCRIPT_DIR/backlog/backlog.json")
assert_ok "mark done" "$AISHORE" backlog edit "$local_clean_id" --status done
assert_contains "clean dry-run shows item" "1" "$AISHORE" clean --dry-run
assert_ok "clean" "$AISHORE" clean
assert_fail "item gone from backlog" "$AISHORE" backlog show "$local_clean_id"
assert_ok "item in archive" jq -e --arg id "$local_clean_id" '.[] | select(.id == $id)' "$SCRIPT_DIR/backlog/archive/backlog_done.json"

echo ""

# ─── 7. Dry-run ────────────────────────────────────────────────────────────

echo -e "${CYAN}── Dry-run ──${RESET}"

# Create a ready item for dry-run
assert_ok "add for dry-run" "$AISHORE" backlog add --type feat \
    --title "Dry run test" \
    --intent "Verify dry-run shows correct developer prompt and scope advisory" \
    --steps "Do the thing" \
    --ac "Thing done" --ac-verify "echo done" \
    --scope "src/**" --scope "tests/**" \
    --ready
local_dr_id=$(jq -r '.items[-1].id' "$SCRIPT_DIR/backlog/backlog.json")

assert_ok          "run --dry-run"              "$AISHORE" run --dry-run
assert_contains    "dry-run shows item"         "$local_dr_id"        "$AISHORE" run --dry-run
assert_contains    "dry-run shows prompt"       "Developer Agent"     "$AISHORE" run --dry-run
assert_contains    "dry-run shows scope"        "src/**"              "$AISHORE" run --dry-run "$local_dr_id"
assert_contains    "dry-run ID picks correct"   "$local_dr_id"        "$AISHORE" run --dry-run "$local_dr_id"
assert_contains    "dry-run done scope"         "Auto-groom"          "$AISHORE" run done --dry-run

# Priority scope filtering (item is "should", p0 wants "must")
assert_fail        "p0 dry-run rejects should"  "$AISHORE" run p0 --dry-run
assert_ok          "p1 dry-run accepts should"  "$AISHORE" run p1 --dry-run

# Clean up
assert_ok "rm dry-run item" "$AISHORE" backlog rm "$local_dr_id" --force

echo ""

# ─── 8. Lock mechanism ─────────────────────────────────────────────────────

echo -e "${CYAN}── Lock mechanism ──${RESET}"

# Stale lock recovery (PID 99999 should be dead)
mkdir -p "$SCRIPT_DIR/.aishore/data/status/.aishore.lock"
echo 99999 > "$SCRIPT_DIR/.aishore/data/status/.aishore.lock/pid"
assert_ok "stale lock recovered" "$AISHORE" status

# Active lock blocks (use our own PID)
mkdir -p "$SCRIPT_DIR/.aishore/data/status/.aishore.lock"
echo $$ > "$SCRIPT_DIR/.aishore/data/status/.aishore.lock/pid"
assert_fail "active lock blocks" "$AISHORE" groom
rm -rf "$SCRIPT_DIR/.aishore/data/status/.aishore.lock"

# Old flat lockfile migration
touch "$SCRIPT_DIR/.aishore/data/status/.aishore.lock"
assert_ok "flat lockfile migrated" "$AISHORE" status
rm -rf "$SCRIPT_DIR/.aishore/data/status/.aishore.lock"

echo ""

# ─── 9. Validation edge cases ──────────────────────────────────────────────

echo -e "${CYAN}── Validation edge cases ──${RESET}"

assert_fail "add without title"        "$AISHORE" backlog add --type feat
assert_fail "add invalid priority"     "$AISHORE" backlog add --title "x" --priority invalid
assert_fail "add invalid type"         "$AISHORE" backlog add --title "x" --type invalid
assert_fail "edit invalid status"      "$AISHORE" backlog edit FEAT-001 --status invalid
assert_fail "edit no flags"            "$AISHORE" backlog edit FEAT-001
assert_fail "check no args"            "$AISHORE" backlog check
assert_fail "rm no args"               "$AISHORE" backlog rm
assert_fail "show nonexistent"         "$AISHORE" backlog show NONEXISTENT
assert_fail "unknown backlog sub"      "$AISHORE" backlog foobar
assert_fail "ac-verify without ac"     "$AISHORE" backlog add --title "x" --intent "xxxxxxxxxxxxxxxxxxxx" --ac-verify "echo"

echo ""

# ─── 10. Removed commands reject cleanly ────────────────────────────────────

echo -e "${CYAN}── Removed commands reject ──${RESET}"

assert_fail "metrics rejected"          "$AISHORE" metrics
assert_fail "report rejected"           "$AISHORE" report
assert_fail "checksums rejected"        "$AISHORE" checksums
assert_fail "config check rejected"     "$AISHORE" config check
assert_fail "backlog history rejected"  "$AISHORE" backlog history
assert_fail "backlog populate rejected" "$AISHORE" backlog populate

echo ""

# ─── 11. Removed flags reject cleanly ──────────────────────────────────────

echo -e "${CYAN}── Removed flags reject ──${RESET}"

assert_fail "--parallel rejected"     "$AISHORE" run --parallel 2 --dry-run
assert_fail "--auto-review rejected"  "$AISHORE" run --auto-review --dry-run
assert_fail "--no-summary rejected"   "$AISHORE" run --no-summary --dry-run
assert_fail "--timeout rejected"      "$AISHORE" run --timeout 5 --dry-run
assert_fail "--category rejected"     "$AISHORE" run --category test --dry-run

echo ""

# ─── 12. Drift check ───────────────────────────────────────────────────────

echo -e "${CYAN}── Drift check ──${RESET}"

assert_contains "zero drift" "No drift detected" bash "$SCRIPT_DIR/scripts/check-drift.sh"

echo ""

# ─── Summary ────────────────────────────────────────────────────────────────

echo "═══════════════════════════════════════"
if [[ "$failed" -eq 0 ]]; then
    echo -e "${GREEN}All $total tests passed${RESET}"
else
    echo -e "${RED}$failed of $total tests failed${RESET}"
fi
echo "═══════════════════════════════════════"

[[ "$failed" -gt 0 ]] && exit 1
exit 0
