#!/usr/bin/env bash
# Smoke test — runs every aishore command in safe/dry-run mode.
# Exit non-zero on first failure with clear error message.
set -euo pipefail

AISHORE="$(cd "$(dirname "$0")/../.." && pwd)/.aishore/aishore"

total=0

run_cmd() {
  local label="$1"
  shift
  total=$((total + 1))
  if ! "$@" >/dev/null 2>&1; then
    echo "FAIL: $label" >&2
    return 1
  fi
}

# Phase 1: syntax check (must pass before anything else)
run_cmd "bash -n .aishore/aishore" bash -n "$AISHORE"

# Phase 2: fast commands (sequential — <50ms each)
run_cmd "help"              "$AISHORE" help
run_cmd "version"           "$AISHORE" version
run_cmd "backlog list"      "$AISHORE" backlog list
run_cmd "status"            "$AISHORE" status
run_cmd "clean --dry-run"   "$AISHORE" clean --dry-run

# Phase 3: slow commands (parallel — each >250ms)
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

slow_cmds=(
  "update --dry-run"
)

for cmd in "${slow_cmds[@]}"; do
  total=$((total + 1))
  # shellcheck disable=SC2086
  ( "$AISHORE" $cmd >/dev/null 2>&1 && echo pass || echo "$cmd" ) > "$tmpdir/$(echo "$cmd" | tr ' ' '_')" &
done
wait

for f in "$tmpdir"/*; do
  result=$(cat "$f")
  if [[ "$result" != "pass" ]]; then
    echo "FAIL: $result" >&2
    exit 1
  fi
done

echo "smoke: all $total commands passed"
