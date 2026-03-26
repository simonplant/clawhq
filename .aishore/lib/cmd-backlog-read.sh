#!/usr/bin/env bash
# Module: cmd-backlog-read — backlog read/check commands (dispatcher, list, show, check, rm, history)
# Lazy-loaded by _load_module; all globals (BACKLOG_DIR, BACKLOG_FILES, ARCHIVE_DIR,
# PROJECT_ROOT, jq, log_*, parse_opts, validate_status, validate_priority,
# find_item, resolve_backlog_file, remove_item, check_readiness_gates,
# check_complexity_hints, collect_done_ids, reverse_lines, require_tool,
# JQ_PRIO_RANK, _load_module) come from the main script.
# Write commands (add, edit, populate) remain in cmd-backlog-write.sh.

cmd_backlog() {
    require_tool jq
    local subcmd="${1:-list}"
    shift || true
    case "$subcmd" in
        list|ls)    cmd_backlog_list "$@" ;;
        add|new)    _load_module cmd-backlog-write; cmd_backlog_add "$@" ;;
        show)       cmd_backlog_show "$@" ;;
        edit)       _load_module cmd-backlog-write; cmd_backlog_edit "$@" ;;
        rm|remove)  cmd_backlog_rm "$@" ;;
        check)      cmd_backlog_check "$@" ;;
        history)    cmd_backlog_history "$@" ;;
        populate)   _load_module cmd-backlog-write; cmd_backlog_populate "$@" ;;
        *)
            log_error "Unknown backlog command: $subcmd"
            echo "Usage: backlog {list|add|show|edit|check|rm|history|populate}" >&2
            return 1
            ;;
    esac
}

cmd_backlog_check() {
    # Handle --all flag
    if [[ "${1:-}" == "--all" ]]; then
        _backlog_check_all
        return $?
    fi

    local id="${1:-}"
    [[ -z "$id" ]] && { log_error "Usage: backlog check <ID|--all>"; return 1; }
    [[ $# -gt 1 ]] && { log_error "Unexpected argument: ${2}"; return 1; }

    # Verify item exists
    find_item "$id" >/dev/null || return 1

    local gates_warnings
    local exit_code=0
    if gates_warnings=$(check_readiness_gates "$id"); then
        log_success "$id passes all readiness gates"
    else
        log_warning "$id has readiness warnings:"
        printf '%b\n' "$gates_warnings"
        exit_code=1
    fi

    # Advisory complexity hints (shown alongside gate results, never block)
    local hints
    if ! hints=$(check_complexity_hints "$id"); then
        log_warning "$id advisory hints:"
        printf '%b\n' "$hints"
    fi

    return "$exit_code"
}

_backlog_check_all() {
    local pass_count=0 fail_count=0 total=0
    local -a table_rows=()

    for f in "${BACKLOG_FILES[@]}"; do
        [[ -f "$BACKLOG_DIR/$f" ]] || continue
        local ids
        ids=$(jq -r '.items[] | select((.status // "todo") != "done") | .id' "$BACKLOG_DIR/$f" 2>/dev/null) || continue
        [[ -z "$ids" ]] && continue

        while IFS= read -r item_id; do
            ((total++)) || true
            local gates_warnings result failures
            if gates_warnings=$(check_readiness_gates "$item_id" 2>/dev/null); then
                result="PASS"
                failures="-"
                ((pass_count++)) || true
            else
                result="FAIL"
                # Extract failure reasons from warnings (strip leading "  - " prefix)
                failures=$(printf '%b' "$gates_warnings" | sed -n 's/^  - //p' | paste -sd ',' - )
                [[ -z "$failures" ]] && failures="unknown"
                ((fail_count++)) || true
            fi
            table_rows+=("$(printf '%s\t%s\t%s' "$item_id" "$result" "$failures")")
        done <<< "$ids"
    done

    if [[ "$total" -eq 0 ]]; then
        log_info "No non-done items found"
        return 0
    fi

    # Print table
    printf "%-10s %-6s %s\n" "ID" "GATE" "FAILURES"
    printf "%-10s %-6s %s\n" "──────────" "──────" "──────────────────────────────────────────"
    for row in "${table_rows[@]}"; do
        IFS=$'\t' read -r id result failures <<< "$row"
        printf "%-10s %-6s %s\n" "$id" "$result" "$failures"
    done
    echo ""
    printf '%s item(s): %s pass, %s fail\n' "$total" "$pass_count" "$fail_count"

    [[ "$fail_count" -gt 0 ]] && return 1
    return 0
}

cmd_backlog_list() {
    local filter_status="" filter_type="" filter_priority="" filter_ready=false filter_no_ready=false
    parse_opts "val:filter_status:--status" "val:filter_type:--type" "val:filter_priority:--priority" "bool:filter_ready:--ready" "bool:filter_no_ready:--no-ready" -- "$@" || return 1

    # Determine which files to scan
    local files=()
    case "$filter_type" in
        feat|feature) files=("backlog.json") ;;
        bug)          files=("bugs.json") ;;
        "")           files=("${BACKLOG_FILES[@]}") ;;
        *) log_error "Invalid type: $filter_type (must be: feat, bug)"; return 1 ;;
    esac

    # Build jq filter
    local jq_filter='.items[]'
    if [[ -n "$filter_status" ]]; then
        validate_status "$filter_status" || return 1
        jq_filter="$jq_filter | select((.status // \"todo\") == \"$filter_status\")"
    fi
    if [[ -n "$filter_priority" ]]; then
        validate_priority "$filter_priority" || return 1
        jq_filter="$jq_filter | select((.priority // \"should\") == \"$filter_priority\")"
    fi
    if [[ "$filter_ready" == "true" ]]; then
        jq_filter="$jq_filter | select(.readyForSprint == true)"
    elif [[ "$filter_no_ready" == "true" ]]; then
        jq_filter="$jq_filter | select(.readyForSprint != true)"
    fi

    # Collect done IDs for dependency checking
    local done_ids
    done_ids=$(collect_done_ids)

    # Header
    printf "%-10s %-8s %-13s %-6s %-20s %s\n" "ID" "PRI" "STATUS" "READY" "BLOCKED" "TITLE"
    printf "%-10s %-8s %-13s %-6s %-20s %s\n" "──────────" "────────" "─────────────" "──────" "────────────────────" "─────────────────────────────"

    local count=0
    for f in "${files[@]}"; do
        [[ -f "$BACKLOG_DIR/$f" ]] || continue
        local items
        # shellcheck disable=SC1010
        items=$(jq -r --argjson done "$done_ids" "${JQ_PRIO_RANK}[$jq_filter] | sort_by(.priority // \"should\" | prio_rank) | .[] | [.id, .priority // \"-\", .status // \"todo\", (if .readyForSprint then \"yes\" else \"no\" end), ((.dependsOn // []) | map(select(. as \$d | \$done | index(\$d) | not)) | if length == 0 then \"-\" else join(\",\") end), .title] | @tsv" "$BACKLOG_DIR/$f" 2>/dev/null) || continue
        if [[ -n "$items" ]]; then
            while IFS=$'\t' read -r id pri status ready blocked title; do
                local blocked_display=""
                if [[ "$blocked" != "-" ]]; then
                    blocked_display="[blocked: $blocked]"
                fi
                printf "%-10s %-8s %-13s %-6s %-20s %s\n" "$id" "$pri" "$status" "$ready" "$blocked_display" "$title"
                ((count++)) || true
            done <<< "$items"
        fi
    done

    echo ""
    printf '%s item(s)\n' "$count"
}

cmd_backlog_show() {
    local id="${1:-}"
    [[ -z "$id" ]] && { log_error "Usage: backlog show <ID>"; return 1; }
    [[ $# -gt 1 ]] && { log_error "Unexpected argument: ${2}"; return 1; }

    local item
    item=$(find_item "$id") || return 1

    echo ""
    printf '%s\n' "$item" | jq -r '
        "ID:          \(.id)",
        "Title:       \(.title)",
        "Status:      \(.status // "todo")",
        "Priority:    \(.priority // "-")",
        "Category:    \(.category // "-")",
        "Ready:       \(if .readyForSprint then "yes" else "no" end)",
        "Passes:      \(if .passes then "yes" else "no" end)",
        "",
        if .intent then "Intent:      \(.intent)\n" else empty end,
        "Description: \(.description // "-")",
        "",
        if (.steps // [] | length) > 0 then "Steps:" else empty end,
        (.steps // [] | to_entries[] | "  \(.key + 1). \(.value)"),
        if (.steps // [] | length) > 0 then "" else empty end,
        if (.acceptanceCriteria // [] | length) > 0 then "Acceptance Criteria:" else empty end,
        (.acceptanceCriteria // [] | .[] | if type == "object" then "  - \(.text)" + (if .verify then " (verify: \(.verify))" else "" end) else "  - \(.)" end),
        if (.scope // [] | length) > 0 then "\nScope:" else empty end,
        (.scope // [] | .[] | "  - \(.)"),
        if (.dependsOn // [] | length) > 0 then "\nDependencies: \(.dependsOn | join(", "))" else empty end,
        if .groomedAt then "\nGroomed:      \(.groomedAt)" else empty end,
        if .groomingNotes then "Notes:        \(.groomingNotes)" else empty end,
        if .resolved_at then "Resolved:     \(.resolved_at)" else empty end,
        if .completedAt then "Completed:    \(.completedAt)" else empty end
    '
}

cmd_backlog_history() {
    local limit=20 all=false

    parse_opts "num:limit:--limit" "bool:all:--all" -- "$@" || return 1

    local sprints_file="$ARCHIVE_DIR/sprints.jsonl"
    if [[ ! -f "$sprints_file" || ! -s "$sprints_file" ]]; then
        echo "No sprint history found"
        return 0
    fi

    printf "%-12s %-12s %-10s %-10s %s\n" "ID" "DATE" "STATUS" "DURATION" "TITLE"
    printf "%-12s %-12s %-10s %-10s %s\n" "──────────" "──────────" "────────" "────────" "─────────────────────"

    local _hist_jq='[.itemId // "-", .date // "-", .status // "-", (if (.duration // 0) > 0 then (if .duration >= 60 then "\(.duration / 60 | floor)m \(.duration % 60)s" else "\(.duration)s" end) else "-" end), ((.title // "-") | if length > 40 then .[:40] + "…" else . end)] | @tsv'
    local _hist_input
    if [[ "$all" == "true" ]]; then
        _hist_input=$(cat "$sprints_file")
    else
        _hist_input=$(tail -n "$limit" "$sprints_file")
    fi
    printf '%s\n' "$_hist_input" | jq -r "$_hist_jq" | reverse_lines | \
        while IFS=$'\t' read -r id date status duration title; do
            printf "%-12s %-12s %-10s %-10s %s\n" "$id" "$date" "$status" "$duration" "$title"
        done
}

cmd_backlog_rm() {
    local id="${1:-}" force=false
    [[ -z "$id" ]] && { log_error "Usage: backlog rm <ID> [--force]"; return 1; }
    shift || true

    parse_opts "bool:force:--force" -- "$@" || return 1

    local title
    title=$(find_item "$id" | jq -r '.title') || return 1

    local file
    file=$(resolve_backlog_file "$id") || return 1

    if [[ "$force" == "false" ]]; then
        echo "Remove $id: $title?"
        read -r -p "Confirm (y/N): " confirm
        [[ "$confirm" != "y" && "$confirm" != "Y" ]] && { echo "Cancelled"; return 0; }
    fi

    if ! remove_item "$file" "$id"; then
        log_error "Failed to remove item"
        return 1
    fi

    log_success "Removed $id: $title"
}
