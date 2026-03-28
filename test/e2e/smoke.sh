#!/usr/bin/env bash
# FEAT-018: End-to-end smoke test — full user journey (shell runner)
#
# Exercises the complete user journey:
#   install → init → build → up → doctor → down → destroy
#
# Use this script to run the full pipeline manually before submitting PRs,
# or to document failures for the backlog.
#
# Prerequisites:
#   - Docker running
#   - Ollama running with a model pulled (default: llama3:8b)
#   - clawhq CLI built: npm run build && npm link (or use --tsx for source)
#
# Usage:
#   ./test/e2e/smoke.sh [--tsx] [--blueprint <name>] [--no-ollama]
#
# Options:
#   --tsx          Run CLI from source via tsx instead of built binary
#   --blueprint    Blueprint to use (default: family-hub)
#   --no-ollama    Skip Ollama-dependent phases (up/doctor)
#   --keep         Keep the deploy directory on success (for inspection)
#
# Exit code: 0 if all phases pass, 1 if any phase fails.

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────

BLUEPRINT="family-hub"
USE_TSX=false
SKIP_OLLAMA=false
KEEP_DIR=false
DEPLOY_DIR=""
PASS=0
FAIL=0

declare -A PHASE_RESULTS

# ── Arg parsing ───────────────────────────────────────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tsx)       USE_TSX=true ;;
    --blueprint) BLUEPRINT="$2"; shift ;;
    --no-ollama) SKIP_OLLAMA=true ;;
    --keep)      KEEP_DIR=true ;;
    *)           echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

# ── Setup ─────────────────────────────────────────────────────────────────────

DEPLOY_DIR=$(mktemp -d /tmp/clawhq-e2e-XXXXXX)
echo "Deploy dir: $DEPLOY_DIR"

cleanup() {
  if [[ "$KEEP_DIR" == "true" ]] || [[ $FAIL -gt 0 ]]; then
    echo ""
    echo "Deploy dir preserved for inspection: $DEPLOY_DIR"
  else
    rm -rf "$DEPLOY_DIR"
  fi
}
trap cleanup EXIT

# Resolve CLI runner
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ "$USE_TSX" == "true" ]]; then
  CLI="npx tsx $REPO_ROOT/src/cli/index.ts"
elif command -v clawhq &>/dev/null; then
  CLI="clawhq"
elif [[ -f "$REPO_ROOT/dist/cli/index.js" ]]; then
  CLI="node $REPO_ROOT/dist/cli/index.js"
else
  echo "ERROR: clawhq not found. Run 'npm run build && npm link' or use --tsx" >&2
  exit 1
fi

# ── Helpers ───────────────────────────────────────────────────────────────────

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
DIM='\033[2m'
RESET='\033[0m'

phase() {
  local name="$1"
  local label="$2"
  echo ""
  echo -e "${BOLD}── Phase ${name}: ${label} ──${RESET}"
}

pass() {
  local name="$1"
  local msg="$2"
  echo -e "  ${GREEN}✔${RESET} $msg"
  PHASE_RESULTS["$name"]="PASS"
  (( PASS++ )) || true
}

fail() {
  local name="$1"
  local msg="$2"
  echo -e "  ${RED}✘${RESET} $msg"
  PHASE_RESULTS["$name"]="FAIL"
  (( FAIL++ )) || true
}

skip() {
  local name="$1"
  local msg="$2"
  echo -e "  ${YELLOW}⊘${RESET} $msg (skipped)"
  PHASE_RESULTS["$name"]="SKIP"
}

check_docker() {
  if ! command -v docker &>/dev/null; then
    return 1
  fi
  if ! docker info &>/dev/null; then
    return 1
  fi
  return 0
}

check_ollama() {
  command -v ollama &>/dev/null && ollama list &>/dev/null
}

# ── Phase 1: Install ──────────────────────────────────────────────────────────

phase "1" "install — scaffold deployment directory"

if $CLI install --deploy-dir "$DEPLOY_DIR" &>/tmp/clawhq-e2e-install.log 2>&1; then
  pass "install" "clawhq install succeeded"
else
  fail "install" "clawhq install failed"
  cat /tmp/clawhq-e2e-install.log
fi

# Verify structure
REQUIRED_DIRS=(engine workspace workspace/identity workspace/memory cron ops ops/audit security)
for d in "${REQUIRED_DIRS[@]}"; do
  if [[ -d "$DEPLOY_DIR/$d" ]]; then
    echo -e "  ${DIM}✓ $d${RESET}"
  else
    fail "install" "Missing directory: $d"
  fi
done

# ── Phase 2: Init ─────────────────────────────────────────────────────────────

phase "2" "init — generate config from blueprint"

if $CLI init \
    --blueprint "$BLUEPRINT" \
    --deploy-dir "$DEPLOY_DIR" \
    --guided \
    </dev/null \
    &>/tmp/clawhq-e2e-init.log 2>&1; then
  pass "init" "clawhq init succeeded"
else
  # init with no TTY may fail on interactive prompts — try with pre-canned env
  GATEWAY_TOKEN="smoke-test-token" \
  $CLI init \
    --blueprint "$BLUEPRINT" \
    --deploy-dir "$DEPLOY_DIR" \
    --guided \
    </dev/null \
    &>/tmp/clawhq-e2e-init.log 2>&1 || true
  # Check if critical files were created regardless
  if [[ -f "$DEPLOY_DIR/engine/openclaw.json" ]]; then
    pass "init" "clawhq init produced engine/openclaw.json"
  else
    fail "init" "clawhq init failed — no engine/openclaw.json"
    echo -e "  ${DIM}Log:${RESET}"
    cat /tmp/clawhq-e2e-init.log | head -30
  fi
fi

# Verify critical files
CRITICAL_FILES=(engine/openclaw.json engine/docker-compose.yml engine/.env cron/jobs.json)
for f in "${CRITICAL_FILES[@]}"; do
  if [[ -f "$DEPLOY_DIR/$f" ]]; then
    echo -e "  ${DIM}✓ $f${RESET}"
  else
    fail "init" "Missing: $f"
  fi
done

# ── Phase 3: Validate config ──────────────────────────────────────────────────

phase "3" "validate — config sanity checks"

# Check openclaw.json
if [[ -f "$DEPLOY_DIR/engine/openclaw.json" ]]; then
  if python3 -c "import json; cfg=json.load(open('$DEPLOY_DIR/engine/openclaw.json')); assert cfg.get('dangerouslyDisableDeviceAuth') == True, 'LM-01 failed'; assert cfg.get('tools', {}).get('exec', {}).get('host') == 'gateway', 'LM-04 failed'; assert cfg.get('tools', {}).get('exec', {}).get('security') == 'full', 'LM-05 failed'; print('LM-01 LM-04 LM-05 OK')" 2>/dev/null; then
    pass "validate" "Landmine rules LM-01, LM-04, LM-05 passed"
  else
    fail "validate" "Landmine rules failed in openclaw.json"
  fi
fi

# Check .env permissions
ENV_PATH="$DEPLOY_DIR/engine/.env"
if [[ -f "$ENV_PATH" ]]; then
  PERMS=$(stat -c %a "$ENV_PATH" 2>/dev/null || stat -f %OLp "$ENV_PATH" 2>/dev/null)
  if [[ "$PERMS" == "600" ]]; then
    pass "validate" ".env has mode 0600"
  else
    fail "validate" ".env has mode $PERMS, expected 0600"
  fi
fi

# ── Phase 4: Build ────────────────────────────────────────────────────────────

phase "4" "build — Docker image"

if ! check_docker; then
  skip "build" "Docker not available"
elif $CLI build --deploy-dir "$DEPLOY_DIR" &>/tmp/clawhq-e2e-build.log 2>&1; then
  pass "build" "clawhq build succeeded"
else
  fail "build" "clawhq build failed"
  echo -e "  ${DIM}Log (last 20 lines):${RESET}"
  tail -20 /tmp/clawhq-e2e-build.log
fi

# ── Phase 5: Up ───────────────────────────────────────────────────────────────

phase "5" "up — deploy and health check"

if ! check_docker; then
  skip "up" "Docker not available"
elif [[ "$SKIP_OLLAMA" == "true" ]] || ! check_ollama; then
  skip "up" "Ollama not available (use --no-ollama to suppress this check)"
elif $CLI up --deploy-dir "$DEPLOY_DIR" &>/tmp/clawhq-e2e-up.log 2>&1; then
  pass "up" "clawhq up succeeded — agent is running and reachable"
  # Verify container is actually running
  if docker compose -f "$DEPLOY_DIR/engine/docker-compose.yml" ps --status running 2>/dev/null | grep -q "openclaw"; then
    pass "up" "Container openclaw is running"
  else
    fail "up" "clawhq up exited 0 but no running container found"
  fi
else
  fail "up" "clawhq up failed"
  echo -e "  ${DIM}Log (last 30 lines):${RESET}"
  tail -30 /tmp/clawhq-e2e-up.log
fi

# ── Phase 6: Doctor ───────────────────────────────────────────────────────────

phase "6" "doctor — diagnostics"

if ! check_docker; then
  skip "doctor" "Docker not available"
elif [[ "${PHASE_RESULTS[up]:-}" != "PASS" ]]; then
  skip "doctor" "Agent not running (phase 5 did not pass)"
elif DOCTOR_OUT=$($CLI doctor --deploy-dir "$DEPLOY_DIR" --json 2>/dev/null); then
  HEALTHY=$(echo "$DOCTOR_OUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('healthy','false'))" 2>/dev/null)
  ERR_COUNT=$(echo "$DOCTOR_OUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('errors',[])))" 2>/dev/null)
  if [[ "$HEALTHY" == "True" ]] || [[ "$HEALTHY" == "true" ]]; then
    pass "doctor" "All checks passed ($ERR_COUNT errors)"
  else
    fail "doctor" "Doctor reported unhealthy ($ERR_COUNT errors)"
    echo "$DOCTOR_OUT" | python3 -m json.tool 2>/dev/null | head -40
  fi
else
  fail "doctor" "clawhq doctor failed to run"
fi

# ── Phase 7: Down ─────────────────────────────────────────────────────────────

phase "7" "down — graceful shutdown"

if ! check_docker; then
  skip "down" "Docker not available"
elif $CLI down --deploy-dir "$DEPLOY_DIR" &>/tmp/clawhq-e2e-down.log 2>&1; then
  pass "down" "clawhq down succeeded"
else
  fail "down" "clawhq down failed"
  cat /tmp/clawhq-e2e-down.log
fi

# ── Phase 8: Destroy ──────────────────────────────────────────────────────────

phase "8" "destroy — verified destruction"

if ! check_docker; then
  skip "destroy" "Docker not available"
elif $CLI destroy --deploy-dir "$DEPLOY_DIR" --confirm &>/tmp/clawhq-e2e-destroy.log 2>&1; then
  pass "destroy" "clawhq destroy succeeded"
  # Verify .env is gone
  if [[ ! -f "$DEPLOY_DIR/engine/.env" ]]; then
    pass "destroy" "Secrets removed — .env is gone"
  else
    fail "destroy" ".env still present after destroy"
  fi
else
  fail "destroy" "clawhq destroy failed"
  cat /tmp/clawhq-e2e-destroy.log
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}── Summary ──────────────────────────────────────────────${RESET}"
echo ""

for phase_name in install init validate build up doctor down destroy; do
  result="${PHASE_RESULTS[$phase_name]:-NOT_RUN}"
  case "$result" in
    PASS) echo -e "  ${GREEN}✔${RESET} Phase $phase_name" ;;
    FAIL) echo -e "  ${RED}✘${RESET} Phase $phase_name" ;;
    SKIP) echo -e "  ${YELLOW}⊘${RESET} Phase $phase_name (skipped)" ;;
    *)    echo -e "  ${DIM}?${RESET} Phase $phase_name (not run)" ;;
  esac
done

echo ""
echo -e "  Passed: ${GREEN}${PASS}${RESET}  Failed: ${RED}${FAIL}${RESET}"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo -e "${RED}Smoke test FAILED — file failures as backlog items${RESET}"
  echo ""
  exit 1
else
  echo -e "${GREEN}Smoke test PASSED${RESET}"
  echo ""
  exit 0
fi
