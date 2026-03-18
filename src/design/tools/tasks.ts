/**
 * Tasks CLI tool generator.
 *
 * Generates a local work queue with channel tags, autonomy tiers, priority levels.
 * Always included — every agent needs a work queue.
 */

export interface TasksToolOptions {
  channels?: string[];  // default: standard set
}

const DEFAULT_CHANNELS = [
  "developer", "trader", "pa", "health", "security", "family",
  "kahu", "simon-growth", "clawdius-growth", "content", "finances", "network",
];

export function generateTasksTool(options: TasksToolOptions = {}): string {
  const channels = options.channels ?? DEFAULT_CHANNELS;
  const channelList = channels.join(" ");
  const channelDocList = channels.join(", ");

  return `#!/usr/bin/env bash
# tasks — Local task queue
# Usage: tasks <command> [args]
#
# Commands:
#   next                          — highest-priority actionable task
#   list [--channel X] [--autonomy do|do-tell|flag] [--status open|done|blocked]
#   add "Title" --channel X [--autonomy do] [--priority 2] [--due DATE] [--notes "..."] [--depends ID]
#   done <id> [--notes "result"]  — mark complete
#   block <id> --notes "reason"   — mark blocked
#   flag <id> --notes "reason"    — escalate to user
#   update <id> [--priority N] [--autonomy X] [--due DATE] [--notes "..."]
#   delete <id>                   — remove task
#   channels                      — list channels with open task counts
#   recon-status                  — staleness per channel (last recon timestamp)
#
# Channels: ${channelDocList}
#
# Autonomy: do (silent), do-tell (notify), flag (wait)
# Priority: 1=critical, 2=high, 3=medium, 4=low

set -euo pipefail

TASKS_FILE="\${HOME}/.openclaw/workspace/tasks.json"
RECON_FILE="\${HOME}/.openclaw/workspace/recon-state.json"

CHANNELS="${channelList}"
AUTONOMY_LEVELS="do do-tell flag"

# Initialize files if missing
[ -f "$TASKS_FILE" ] || echo '[]' > "$TASKS_FILE"
[ -f "$RECON_FILE" ] || echo '{}' > "$RECON_FILE"

_atomic_write() {
  local target="$1" content="$2"
  local tmpf
  tmpf=$(mktemp "\${target}.XXXXXX")
  echo "$content" > "$tmpf" && mv -f "$tmpf" "$target"
}

_gen_id() {
  cat /proc/sys/kernel/random/uuid 2>/dev/null | cut -c1-8 || date +%s | tail -c 8
}

_now() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

_validate_channel() {
  local ch="$1"
  for c in $CHANNELS; do
    [ "$c" = "$ch" ] && return 0
  done
  echo "Error: invalid channel '$ch'. Valid: $CHANNELS" >&2
  return 1
}

_validate_autonomy() {
  local a="$1"
  for v in $AUTONOMY_LEVELS; do
    [ "$v" = "$a" ] && return 0
  done
  echo "Error: invalid autonomy '$a'. Valid: $AUTONOMY_LEVELS" >&2
  return 1
}

# -- next: highest-priority actionable task --
cmd_next() {
  local result
  result=$(jq -r '
    [.[] | select(.status == "open" and (.autonomy == "do" or .autonomy == "do-tell"))] |
    sort_by([.priority, .due // "9999-99-99"]) |
    first |
    if . then
      "\\(.id) [\\(.channel)] \\(.title) (P\\(.priority), \\(.autonomy))\\(if .due then " due:\\(.due)" else "" end)\\(if .notes then " — \\(.notes)" else "" end)"
    else
      empty
    end
  ' "$TASKS_FILE")

  if [ -z "$result" ]; then
    echo "No actionable tasks."
    return 1
  fi
  echo "$result"
}

# -- list: filtered task listing --
cmd_list() {
  local channel="" autonomy="" status="open"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --channel)   channel="$2"; shift 2;;
      --autonomy)  autonomy="$2"; shift 2;;
      --status)    status="$2"; shift 2;;
      --all)       status=""; shift;;
      *) shift;;
    esac
  done

  local filter='.'
  [ -n "$status" ] && filter="$filter | select(.status == \\"$status\\")"
  [ -n "$channel" ] && filter="$filter | select(.channel == \\"$channel\\")"
  [ -n "$autonomy" ] && filter="$filter | select(.autonomy == \\"$autonomy\\")"

  local result
  result=$(jq -r "
    [.[] | $filter] |
    sort_by([.priority, .due // \\"9999-99-99\\"]) |
    .[] |
    \\"\\(.id) \\(
      if .autonomy == \\"do\\" then \\"do\\"
      elif .autonomy == \\"do-tell\\" then \\"do-tell\\"
      elif .autonomy == \\"flag\\" then \\"flag\\"
      else \\"?\\" end
    ) P\\(.priority) [\\(.channel)] \\(.title)\\(
      if .due then \\" due:\\(.due)\\" else \\"\\" end
    )\\(
      if .status == \\"blocked\\" then \\" BLOCKED\\" else \\"\\" end
    )\\"
  " "$TASKS_FILE")

  if [ -z "$result" ]; then
    echo "No tasks matching filter."
    return 0
  fi

  local count
  count=$(echo "$result" | wc -l)
  echo "$result"
  echo ""
  echo "Total: $count"
}

# -- add: create a task --
cmd_add() {
  if [ $# -lt 1 ]; then
    echo "Usage: tasks add \\"Title\\" --channel X [--autonomy do] [--priority 2] [--due DATE] [--notes \\"...\\"] [--depends ID]" >&2
    return 1
  fi

  local title="$1"; shift
  local channel="" autonomy="do" priority=3 due="" notes="" depends=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --channel)   channel="$2"; shift 2;;
      --autonomy)  autonomy="$2"; shift 2;;
      --priority)  priority="$2"; shift 2;;
      --due)       due="$2"; shift 2;;
      --notes)     notes="$2"; shift 2;;
      --depends)   depends="$2"; shift 2;;
      *) shift;;
    esac
  done

  if [ -z "$channel" ]; then
    echo "Error: --channel is required" >&2
    return 1
  fi

  _validate_channel "$channel" || return 1
  _validate_autonomy "$autonomy" || return 1

  local id
  id=$(_gen_id)
  local now
  now=$(_now)

  local tmp
  tmp=$(jq --arg id "$id" --arg title "$title" --arg ch "$channel" \\
    --arg auto "$autonomy" --argjson pri "$priority" \\
    --arg due "$due" --arg notes "$notes" --arg dep "$depends" \\
    --arg now "$now" \\
    '. + [{
      id: $id,
      title: $title,
      channel: $ch,
      status: "open",
      autonomy: $auto,
      priority: $pri,
      due: (if $due == "" then null else $due end),
      depends_on: (if $dep == "" then null else $dep end),
      notes: (if $notes == "" then null else $notes end),
      created_at: $now,
      completed_at: null
    }]' "$TASKS_FILE")
  _atomic_write "$TASKS_FILE" "$tmp"

  echo "Added: $title [$channel] id:$id"
}

# -- done: mark complete --
cmd_done() {
  if [ -z "\${1:-}" ]; then
    echo "Usage: tasks done <id> [--notes \\"result\\"]" >&2
    return 1
  fi
  local id="$1"; shift
  local notes=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --notes) notes="$2"; shift 2;;
      *) shift;;
    esac
  done

  local now
  now=$(_now)
  local tmp
  tmp=$(jq --arg id "$id" --arg now "$now" --arg notes "$notes" '
    map(if .id == $id then
      .status = "done" | .completed_at = $now |
      (if $notes != "" then .notes = ((.notes // "") + " | DONE: " + $notes) else . end)
    else . end)
  ' "$TASKS_FILE")
  _atomic_write "$TASKS_FILE" "$tmp"
  echo "Completed: $id"
}

# -- block: mark blocked --
cmd_block() {
  if [ -z "\${1:-}" ]; then
    echo "Usage: tasks block <id> --notes \\"reason\\"" >&2
    return 1
  fi
  local id="$1"; shift
  local notes=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --notes) notes="$2"; shift 2;;
      *) shift;;
    esac
  done

  local tmp
  tmp=$(jq --arg id "$id" --arg notes "$notes" '
    map(if .id == $id then
      .status = "blocked" |
      (if $notes != "" then .notes = ((.notes // "") + " | BLOCKED: " + $notes) else . end)
    else . end)
  ' "$TASKS_FILE")
  _atomic_write "$TASKS_FILE" "$tmp"
  echo "Blocked: $id"
}

# -- flag: escalate to user --
cmd_flag() {
  if [ -z "\${1:-}" ]; then
    echo "Usage: tasks flag <id> --notes \\"reason\\"" >&2
    return 1
  fi
  local id="$1"; shift
  local notes=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --notes) notes="$2"; shift 2;;
      *) shift;;
    esac
  done

  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local tmp
  tmp=$(jq --arg id "$id" --arg notes "$notes" --arg now "$now" '
    map(if .id == $id then
      .autonomy = "flag" |
      .notified_at = $now |
      (if $notes != "" then .notes = ((.notes // "") + " | FLAG: " + $notes) else . end)
    else . end)
  ' "$TASKS_FILE")
  _atomic_write "$TASKS_FILE" "$tmp"
  echo "Flagged for review: $id"
}

# -- notify: mark a task as notified (cooldown for heartbeat dedup) --
cmd_notify() {
  if [ -z "\${1:-}" ]; then
    echo "Usage: tasks notify <id>" >&2
    return 1
  fi
  local id="$1"
  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local tmp
  tmp=$(jq --arg id "$id" --arg now "$now" '
    map(if .id == $id then .notified_at = $now else . end)
  ' "$TASKS_FILE")
  _atomic_write "$TASKS_FILE" "$tmp"
  echo "Notified: $id (cooldown 4h)"
}

# -- flaggable: list flag tasks NOT notified in last 4h --
cmd_flaggable() {
  local now_epoch
  now_epoch=$(date +%s)
  local cooldown=14400  # 4 hours

  jq -r --argjson now "$now_epoch" --argjson cd "$cooldown" '
    [.[] | select(.status == "open" and .autonomy == "flag") |
     select(
       (.notified_at == null) or
       ((.notified_at | sub("\\\\.[0-9]+"; "") | strptime("%Y-%m-%dT%H:%M:%SZ") | mktime) < ($now - $cd))
     )] |
    if length == 0 then "No flaggable tasks (all within cooldown)."
    else .[] | "\\(.id) FLAG P\\(.priority) [\\(.channel)] \\(.title)\\(if .due then " due:\\(.due)" else "" end)"
    end
  ' "$TASKS_FILE"
}

# -- update: modify task fields --
cmd_update() {
  if [ -z "\${1:-}" ]; then
    echo "Usage: tasks update <id> [--priority N] [--autonomy X] [--due DATE] [--notes \\"...\\"]" >&2
    return 1
  fi
  local id="$1"; shift
  local priority="" autonomy="" due="" notes="" status=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --priority)  priority="$2"; shift 2;;
      --autonomy)  autonomy="$2"; shift 2;;
      --due)       due="$2"; shift 2;;
      --notes)     notes="$2"; shift 2;;
      --status)    status="$2"; shift 2;;
      *) shift;;
    esac
  done

  local data
  data=$(cat "$TASKS_FILE")

  [ -n "$priority" ] && data=$(echo "$data" | jq --arg id "$id" --argjson p "$priority" 'map(if .id == $id then .priority = $p else . end)')
  [ -n "$autonomy" ] && data=$(echo "$data" | jq --arg id "$id" --arg a "$autonomy" 'map(if .id == $id then .autonomy = $a else . end)')
  [ -n "$due" ] && data=$(echo "$data" | jq --arg id "$id" --arg d "$due" 'map(if .id == $id then .due = $d else . end)')
  [ -n "$notes" ] && data=$(echo "$data" | jq --arg id "$id" --arg n "$notes" 'map(if .id == $id then .notes = $n else . end)')
  [ -n "$status" ] && data=$(echo "$data" | jq --arg id "$id" --arg s "$status" 'map(if .id == $id then .status = $s else . end)')

  _atomic_write "$TASKS_FILE" "$data"
  echo "Updated: $id"
}

# -- delete: remove task --
cmd_delete() {
  if [ -z "\${1:-}" ]; then
    echo "Usage: tasks delete <id>" >&2
    return 1
  fi
  local tmp
  tmp=$(jq --arg id "$1" 'map(select(.id != $id))' "$TASKS_FILE")
  _atomic_write "$TASKS_FILE" "$tmp"
  echo "Deleted: $1"
}

# -- channels: overview with counts --
cmd_channels() {
  echo "Channel              Open  Blocked  Done"
  echo "-------------------  ----  -------  ----"
  for ch in $CHANNELS; do
    local open blocked done
    open=$(jq --arg ch "$ch" '[.[] | select(.channel == $ch and .status == "open")] | length' "$TASKS_FILE")
    blocked=$(jq --arg ch "$ch" '[.[] | select(.channel == $ch and .status == "blocked")] | length' "$TASKS_FILE")
    done=$(jq --arg ch "$ch" '[.[] | select(.channel == $ch and .status == "done")] | length' "$TASKS_FILE")
    [ "$open" -gt 0 ] || [ "$blocked" -gt 0 ] || [ "$done" -gt 0 ] || continue
    printf "%-20s  %4s  %7s  %4s\\n" "$ch" "$open" "$blocked" "$done"
  done
}

# -- recon-status: staleness per channel --
cmd_recon_status() {
  local now_epoch
  now_epoch=$(date +%s)

  echo "Channel              Last Recon           Age"
  echo "-------------------  -------------------  -----"
  for ch in $CHANNELS; do
    local last
    last=$(jq -r --arg ch "$ch" '.[$ch] // "never"' "$RECON_FILE")
    if [ "$last" = "never" ]; then
      printf "%-20s  %-19s  %s\\n" "$ch" "never" "-"
    else
      local last_epoch age_min
      last_epoch=$(date -d "$last" +%s 2>/dev/null || echo 0)
      age_min=$(( (now_epoch - last_epoch) / 60 ))
      if [ "$age_min" -ge 1440 ]; then
        local age_h=$(( age_min / 60 ))
        printf "%-20s  %-19s  %dh\\n" "$ch" "$last" "$age_h"
      else
        printf "%-20s  %-19s  %dm\\n" "$ch" "$last" "$age_min"
      fi
    fi
  done
}

# -- recon-touch: mark channel as scanned --
cmd_recon_touch() {
  if [ -z "\${1:-}" ]; then
    echo "Usage: tasks recon-touch <channel>" >&2
    return 1
  fi
  local now
  now=$(_now)
  local tmp
  tmp=$(jq --arg ch "$1" --arg now "$now" '.[$ch] = $now' "$RECON_FILE")
  _atomic_write "$RECON_FILE" "$tmp"
}

# -- clean: remove completed tasks older than N days --
cmd_clean() {
  local days="\${1:-7}"
  local cutoff
  cutoff=$(date -u -d "-\${days} days" +%Y-%m-%dT%H:%M:%SZ)
  local before
  before=$(jq 'length' "$TASKS_FILE")
  local tmp
  tmp=$(jq --arg cutoff "$cutoff" '
    [.[] | select(
      .status != "done" or
      (.completed_at // "9999") > $cutoff
    )]
  ' "$TASKS_FILE")
  _atomic_write "$TASKS_FILE" "$tmp"
  local after
  after=$(echo "$tmp" | jq 'length')
  echo "Cleaned: removed $((before - after)) completed tasks older than \${days} days"
}

# -- Main --
case "\${1:-help}" in
  next)          cmd_next;;
  list)          shift; cmd_list "$@";;
  add)           shift; cmd_add "$@";;
  done)          shift; cmd_done "$@";;
  block)         shift; cmd_block "$@";;
  flag)          shift; cmd_flag "$@";;
  notify)        shift; cmd_notify "$@";;
  flaggable)     cmd_flaggable;;
  update)        shift; cmd_update "$@";;
  delete)        shift; cmd_delete "$@";;
  channels)      cmd_channels;;
  recon-status)  cmd_recon_status;;
  recon-touch)   shift; cmd_recon_touch "$@";;
  clean)         shift; cmd_clean "$@";;
  help|--help|-h|*)
    sed -n '2,24p' "$0" | sed 's/^# \\?//'
    ;;
esac
`;
}
