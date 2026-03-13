/**
 * Todoist-sync CLI tool generator.
 *
 * Generates a bash CLI for task polling and due alerts.
 * Integration: tasks (todoist) → requires TODOIST_API_KEY.
 * Used by heartbeat cron, not called directly.
 */

export function generateTodoistSyncTool(): string {
  return `#!/usr/bin/env bash
# todoist-sync — Task polling, due alerts, state tracking
# Usage: todoist-sync <command>
#
# Commands:
#   check    — check for due/overdue tasks, report new alerts only
#   digest   — full today's task digest (for morning cron)
#   poll     — detect new tasks and completions since last run
#
# Environment:
#   TODOIST_API_KEY — API token (required)
#
# State stored in: ~/.openclaw/workspace/memory/todoist-state.json

set -euo pipefail

STATE_DIR="\${HOME}/.openclaw/workspace/memory"
STATE_FILE="\${STATE_DIR}/todoist-state.json"
LOG_FILE="\${STATE_DIR}/todoist-sync.log"
COOLDOWN_SECS=14400  # 4 hours

mkdir -p "$STATE_DIR"

if [ -z "\${TODOIST_API_KEY:-}" ]; then
  echo "Error: TODOIST_API_KEY not set" >&2
  exit 1
fi

_now() { date +%s; }
_now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

_log() {
  echo "$(date -u +'%Y-%m-%d %H:%M UTC') $*" >> "$LOG_FILE"
}

_atomic_write() {
  local target="$1" content="$2"
  local tmpf
  tmpf=$(mktemp "\${target}.XXXXXX")
  echo "$content" > "$tmpf" && mv -f "$tmpf" "$target"
}

_init_state() {
  if [ ! -f "$STATE_FILE" ]; then
    jq -n '{lastPoll: 0, lastPollAt: "1970-01-01T00:00:00Z", lastDigest: 0, notified: {}, knownTasks: {}}' > "$STATE_FILE"
  fi
  if [ "$(jq -r '.lastPollAt // empty' "$STATE_FILE")" = "" ]; then
    local tmp
    tmp=$(jq '.lastPollAt = "1970-01-01T00:00:00Z"' "$STATE_FILE")
    _atomic_write "$STATE_FILE" "$tmp"
  fi
}

_fetch_tasks_json() {
  curl --silent --fail-with-body \\
    -H "Authorization: Bearer \${TODOIST_API_KEY}" \\
    "https://api.todoist.com/api/v1/tasks" | jq '.results'
}

_fetch_completed_json() {
  curl --silent --fail-with-body \\
    -H "Authorization: Bearer \${TODOIST_API_KEY}" \\
    "https://api.todoist.com/api/v1/tasks/completed?limit=50" | jq '.items'
}

cmd_check() {
  _init_state
  local now
  now=$(_now)

  local tasks
  tasks=$(_fetch_tasks_json) || { echo "Error fetching tasks" >&2; exit 1; }

  local today
  today=$(date -u +%Y-%m-%d)

  local due_tasks
  due_tasks=$(echo "$tasks" | jq -r --arg today "$today" \\
    '[.[] | select(.due != null and .due.date != null and .due.date <= $today)]')

  local count
  count=$(echo "$due_tasks" | jq 'length')

  if [ "$count" -eq 0 ]; then
    echo "HEARTBEAT_OK"
    return
  fi

  local output=""
  local alerts=0

  for id in $(echo "$due_tasks" | jq -r '.[].id'); do
    local last_notified
    last_notified=$(jq -r --arg id "$id" '.notified[$id] // 0' "$STATE_FILE")

    local elapsed=$(( now - last_notified ))
    if [ "$elapsed" -lt "$COOLDOWN_SECS" ]; then
      continue
    fi

    local task_line
    task_line=$(echo "$due_tasks" | jq -r --arg id "$id" \\
      '.[] | select((.id | tostring) == $id) |
      "[P\\(.priority)] \\(.content) (due: \\(.due.date))"')

    output+="\${task_line}"$'\\n'
    alerts=$((alerts + 1))

    local tmp
    tmp=$(jq --arg id "$id" --argjson now "$now" '.notified[$id] = $now' "$STATE_FILE")
    _atomic_write "$STATE_FILE" "$tmp"
  done

  if [ "$alerts" -gt 0 ]; then
    echo "\${alerts} task(s) due/overdue:"
    echo "$output"
    _log "check: alerted on $alerts tasks"
  else
    echo "HEARTBEAT_OK"
  fi
}

cmd_digest() {
  _init_state
  local now
  now=$(_now)

  local tasks
  tasks=$(_fetch_tasks_json) || { echo "Error fetching tasks" >&2; exit 1; }

  local today
  today=$(date -u +%Y-%m-%d)

  local projects
  projects=$(curl --silent --fail-with-body \\
    -H "Authorization: Bearer \${TODOIST_API_KEY}" \\
    "https://api.todoist.com/api/v1/projects" | jq '.results')

  local due_tasks
  due_tasks=$(echo "$tasks" | jq --arg today "$today" \\
    '[.[] | select(.due != null and .due.date != null and .due.date <= $today)] |
    sort_by([
      (if .priority == 4 then 0 elif .priority == 3 then 1 elif .priority == 2 then 2 else 3 end),
      (.due.date // "9999")
    ])')

  local count
  count=$(echo "$due_tasks" | jq 'length')

  if [ "$count" -eq 0 ]; then
    echo "No tasks due today. All clear."
  else
    echo "Tasks for today (\${count}):"
    echo ""
    echo "$due_tasks" | jq -r --argjson projects "$projects" '
      .[] |
      . as $task |
      ($projects | .[] | select((.id | tostring) == ($task.project_id | tostring)) | .name) as $proj_name |
      "[P\\(.priority)] \\(.content)\\n    \\($proj_name // "Inbox") | due: \\(.due.date)"'
  fi

  local tmp
  tmp=$(jq --argjson now "$now" '.lastDigest = $now' "$STATE_FILE")
  echo "$tmp" > "$STATE_FILE"
  _log "digest: $count tasks reported"
}

cmd_poll() {
  _init_state
  local now_epoch now_iso
  now_epoch=$(_now)
  now_iso=$(_now_iso)

  local last_poll_iso
  last_poll_iso=$(jq -r '.lastPollAt // "1970-01-01T00:00:00Z"' "$STATE_FILE")

  local tasks
  tasks=$(_fetch_tasks_json) || { echo "Error fetching tasks" >&2; exit 1; }

  local completed_raw new_completions
  completed_raw=$(_fetch_completed_json) || { echo "Error fetching completions" >&2; exit 1; }
  new_completions=$(echo "$completed_raw" | jq --arg since "$last_poll_iso" \\
    '[.[] | select(.completed_at > $since)]')

  local current
  current=$(echo "$tasks" | jq \\
    '[.[] | {key: (.id | tostring), value: {content: .content, due: ((.due // {}).date // null), priority: .priority}}] | from_entries')

  local known
  known=$(jq '.knownTasks' "$STATE_FILE")

  local new_tasks
  new_tasks=$(jq -n --argjson current "$current" --argjson known "$known" \\
    '[$current | to_entries[] | select($known[.key] == null) | .value.content]')

  local new_count completed_count
  new_count=$(echo "$new_tasks" | jq 'length')
  completed_count=$(echo "$new_completions" | jq 'length')

  local changes=false
  local output=""

  if [ "$new_count" -gt 0 ]; then
    output+="\${new_count} new task(s) added:"$'\\n'
    output+=$(echo "$new_tasks" | jq -r '.[] | "  - \\(.)"')$'\\n'
    changes=true
  fi

  if [ "$completed_count" -gt 0 ]; then
    output+="\${completed_count} task(s) completed:"$'\\n'
    output+=$(echo "$new_completions" | jq -r '.[] | "  done: \\(.content)"')$'\\n'
    changes=true
  fi

  local tmp
  tmp=$(jq \\
    --argjson epoch "$now_epoch" \\
    --arg iso "$now_iso" \\
    --argjson tasks "$current" \\
    '.lastPoll = $epoch | .lastPollAt = $iso | .knownTasks = $tasks' "$STATE_FILE")
  echo "$tmp" > "$STATE_FILE"

  if [ "$changes" = true ]; then
    echo "$output"
    _log "poll: $new_count new, $completed_count completed"
  else
    echo "HEARTBEAT_OK"
    _log "poll: no changes"
  fi
}

case "\${1:-help}" in
  check)   cmd_check;;
  digest)  cmd_digest;;
  poll)    cmd_poll;;
  help|--help|-h|*)
    sed -n '2,13p' "$0" | sed 's/^# \\?//'
    ;;
esac
`;
}
