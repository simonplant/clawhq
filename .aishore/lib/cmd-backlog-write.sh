#!/usr/bin/env bash
# Module: cmd-backlog-write — backlog write commands (add, edit)
# Lazy-loaded by _load_module; all globals (BACKLOG_DIR, BACKLOG_FILES, ARCHIVE_DIR,
# PROJECT_ROOT, jq, log_*, parse_opts, validate_arg, validate_priority, validate_status,
# next_id, add_item, update_item, find_item, resolve_backlog_file, _build_ac_json,
# check_readiness_gates) come from the main script.
# Read commands (list, show, check, rm) remain in cmd-backlog-read.sh.

# Known item fields — anything not in this list is rejected.
readonly _ITEM_FIELDS="title intent description priority category steps acceptanceCriteria scope dependsOn readyForSprint type"

# Validate that a JSON object contains only known fields.
# Prints unknown field names to stderr and returns 1 if any found.
_validate_item_fields() {
    local json="$1"
    local unknown
    unknown=$(echo "$json" | jq -r --arg known "$_ITEM_FIELDS" '
        ($known | split(" ")) as $allowed |
        keys | map(select(. as $k | $allowed | index($k) | not)) | .[]
    ')
    if [[ -n "$unknown" ]]; then
        log_error "Unknown fields: $unknown"
        log_error "Allowed fields: $_ITEM_FIELDS"
        return 1
    fi
}

cmd_backlog_add() {
    local raw_json=""

    # Require --json flag
    if [[ "${1:-}" == "--json" ]]; then
        shift
    elif [[ "${1:-}" == "--help" || "${1:-}" == "-h" || -z "${1:-}" ]]; then
        _backlog_add_usage
        return 0
    else
        log_error "backlog add requires --json"
        _backlog_add_usage
        return 1
    fi

    # Read JSON from argument or stdin
    if [[ $# -gt 0 && "$1" != "-" ]]; then
        raw_json="$1"
    else
        if [[ -t 0 ]]; then
            log_error "--json requires a JSON string argument or piped stdin"
            _backlog_add_usage
            return 1
        fi
        raw_json=$(cat)
    fi

    # Validate it's valid JSON
    if ! echo "$raw_json" | jq empty 2>/dev/null; then
        log_error "Invalid JSON"
        return 1
    fi

    # Reject unknown fields
    _validate_item_fields "$raw_json" || return 1

    # Extract and validate title (required)
    local title
    title=$(echo "$raw_json" | jq -r '.title // empty')
    if [[ -z "$title" ]]; then
        log_error "JSON must include a \"title\" field"
        return 1
    fi

    # Extract type and determine prefix/file
    local item_type
    item_type=$(echo "$raw_json" | jq -r '.type // "feat"')
    case "$item_type" in
        feat|feature) item_type="feat" ;;
        bug) ;;
        *) log_error "Invalid type: $item_type (must be: feat, bug)"; return 1 ;;
    esac

    # Validate priority if provided
    local priority
    priority=$(echo "$raw_json" | jq -r '.priority // "should"')
    validate_priority "$priority" || return 1

    local prefix target_file
    if [[ "$item_type" == "feat" ]]; then
        prefix="FEAT"
        target_file="backlog.json"
    else
        prefix="BUG"
        target_file="bugs.json"
    fi

    # Generate ID
    local new_id
    new_id=$(next_id "$prefix")

    # Normalize and insert: extract only known fields, enforce system fields
    if ! add_item "$target_file" \
        --arg new_id "$new_id" \
        --argjson input "$raw_json" \
        '.items += [{
            id: $new_id,
            title: $input.title,
            intent: ($input.intent // null),
            description: ($input.description // ""),
            priority: ($input.priority // "should"),
            category: ($input.category // null),
            steps: (if ($input.steps // null | type) == "array" then $input.steps else [] end),
            acceptanceCriteria: (if ($input.acceptanceCriteria // null | type) == "array" then $input.acceptanceCriteria else [] end),
            scope: (if ($input.scope // null | type) == "array" then $input.scope else [] end),
            dependsOn: (if ($input.dependsOn // null | type) == "array" then $input.dependsOn else [] end),
            status: "todo",
            passes: false,
            readyForSprint: ($input.readyForSprint // false)
        }]'; then
        log_error "Failed to add item"
        return 1
    fi

    log_success "Created $new_id: $title"

    # Advisory warning for short intent
    local intent
    intent=$(echo "$raw_json" | jq -r '.intent // empty')
    if [[ -n "$intent" && ${#intent} -lt 20 ]]; then
        log_warning "Intent is only ${#intent} chars — items with intent <20 chars are skipped at sprint time"
    fi

    # Run readiness gates if marked ready
    local is_ready
    is_ready=$(echo "$raw_json" | jq -r '.readyForSprint // false')
    if [[ "$is_ready" == "true" ]]; then
        local gates_warnings
        if ! gates_warnings=$(check_readiness_gates "$new_id"); then
            log_warning "Readiness warnings for $new_id:"
            printf '%b\n' "$gates_warnings"
        fi
    fi
}

_backlog_add_usage() {
    cat <<'EOF'
Usage: aishore backlog add --json '<JSON>'
       echo '<JSON>' | aishore backlog add --json -

Accepts a JSON object with these fields:
  title               (string, required)  Item title
  intent              (string)  Commander's intent — the non-negotiable outcome
  description         (string)  Context for the developer
  type                (string)  "feat" (default) or "bug"
  priority            (string)  must, should, could, future (default: should)
  category            (string)  Category label
  steps               (array of strings)  Implementation steps
  acceptanceCriteria  (array)  Strings or {"text": "...", "verify": "..."} objects
  scope               (array of strings)  File glob patterns
  dependsOn           (array of strings)  Item IDs this depends on
  readyForSprint      (boolean)  Mark as sprint-ready (default: false)

System-managed fields (id, status, passes) are set automatically.
Unknown fields are rejected.

Example:
  .aishore/aishore backlog add --json '{
    "title": "Export inventory to CSV",
    "intent": "User gets a complete export or a clear error. Never a partial write.",
    "priority": "should",
    "acceptanceCriteria": [
      "Running tool export --format csv writes a valid CSV",
      {"text": "CSV includes header row", "verify": "head -1 out.csv | grep -q itemId"}
    ],
    "readyForSprint": true
  }'
EOF
}

cmd_backlog_edit() {
    local id="${1:-}"
    [[ -z "$id" ]] && { log_error "Usage: backlog edit <ID> --json '<JSON>'"; return 1; }
    shift

    # Verify item exists
    find_item "$id" >/dev/null || return 1

    local file
    file=$(resolve_backlog_file "$id") || return 1

    # Require --json flag
    if [[ "${1:-}" == "--json" ]]; then
        shift
    elif [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
        _backlog_edit_usage
        return 0
    else
        log_error "backlog edit requires --json"
        _backlog_edit_usage
        return 1
    fi

    local raw_json=""

    # Read JSON from argument or stdin
    if [[ $# -gt 0 && "$1" != "-" ]]; then
        raw_json="$1"
    else
        if [[ -t 0 ]]; then
            log_error "--json requires a JSON string argument or piped stdin"
            _backlog_edit_usage
            return 1
        fi
        raw_json=$(cat)
    fi

    # Validate it's valid JSON
    if ! echo "$raw_json" | jq empty 2>/dev/null; then
        log_error "Invalid JSON"
        return 1
    fi

    # Reject unknown fields (edit allows additional system-settable fields)
    local unknown
    unknown=$(echo "$raw_json" | jq -r '
        ["title","intent","description","priority","category","steps",
         "acceptanceCriteria","scope","dependsOn","readyForSprint",
         "status","groomedAt","groomingNotes"] as $allowed |
        keys | map(select(. as $k | $allowed | index($k) | not)) | .[]
    ')
    if [[ -n "$unknown" ]]; then
        log_error "Unknown fields: $unknown"
        log_error "Allowed fields for edit: title, intent, description, priority, category, steps, acceptanceCriteria, scope, dependsOn, readyForSprint, status, groomedAt, groomingNotes"
        return 1
    fi

    # Validate priority if provided
    local priority
    priority=$(echo "$raw_json" | jq -r '.priority // empty')
    if [[ -n "$priority" ]]; then
        validate_priority "$priority" || return 1
    fi

    # Validate status if provided
    local new_status
    new_status=$(echo "$raw_json" | jq -r '.status // empty')
    if [[ -n "$new_status" ]]; then
        validate_status "$new_status" || return 1
    fi

    # Validate groomedAt format if provided
    local groomed_at
    groomed_at=$(echo "$raw_json" | jq -r '.groomedAt // empty')
    if [[ -n "$groomed_at" ]] && ! [[ "$groomed_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
        log_error "Invalid groomedAt format: $groomed_at (expected YYYY-MM-DD)"
        return 1
    fi

    # Capture old status for transition message
    local old_status=""
    if [[ -n "$new_status" ]]; then
        old_status=$(jq -r --arg id "$id" \
            '[.items[] | select(.id == $id)][0].status // "todo"' \
            "$BACKLOG_DIR/$file")
    fi

    # Handle status transitions: inject resolved_at / remove it
    if [[ "$new_status" == "done" ]]; then
        local resolved_ts
        resolved_ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
        raw_json=$(echo "$raw_json" | jq --arg ts "$resolved_ts" '. + {resolved_at: $ts}')
    elif [[ "$new_status" == "todo" ]]; then
        raw_json=$(echo "$raw_json" | jq '. + {_delete_resolved_at: true}')
    fi

    # Build jq update: merge provided fields onto existing item
    if ! update_item "$file" "$id" \
        ' as $item | $input | to_entries | reduce .[] as $kv ($item;
            if $kv.key == "_delete_resolved_at" then del(.resolved_at)
            else .[$kv.key] = $kv.value end
        ) | del(._delete_resolved_at)' \
        --argjson input "$raw_json"; then
        log_error "Failed to update item"
        return 1
    fi

    # Print status transition if status was changed
    if [[ -n "$new_status" ]]; then
        echo "$id: $old_status → $new_status"
    fi

    log_success "Updated $id"

    # Run readiness gates if setting ready
    local setting_ready
    setting_ready=$(echo "$raw_json" | jq -r '.readyForSprint // empty')
    if [[ "$setting_ready" == "true" ]]; then
        local gates_warnings
        if ! gates_warnings=$(check_readiness_gates "$id"); then
            log_warning "Readiness warnings for $id:"
            printf '%b\n' "$gates_warnings"
        fi
    fi
}

_backlog_edit_usage() {
    cat <<'EOF'
Usage: aishore backlog edit <ID> --json '<JSON>'
       echo '<JSON>' | aishore backlog edit <ID> --json -

Merges the provided fields onto the existing item. Only fields present
in the JSON are updated — omitted fields are left unchanged.

Accepts the same fields as 'add', plus:
  status          (string)  todo, in-progress, done, skip
  groomedAt       (string)  Date in YYYY-MM-DD format
  groomingNotes   (string)  Grooming notes

Example:
  .aishore/aishore backlog edit FEAT-001 --json '{"priority": "must", "readyForSprint": true}'
EOF
}
