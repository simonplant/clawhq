#!/usr/bin/env bash
# Module: cmd-backlog-read — backlog read/check commands (dispatcher, list, show, check, rm)
# Lazy-loaded by _load_module; all globals (BACKLOG_DIR, BACKLOG_FILES, ARCHIVE_DIR,
# PROJECT_ROOT, jq, log_*, parse_opts, validate_status, validate_priority,
# find_item, resolve_backlog_file, remove_item, check_readiness_gates,
# collect_done_ids, require_tool,
# JQ_PRIO_RANK, _load_module) come from the main script.
# Write commands (add, edit) in cmd-backlog-write.sh, populate in cmd-populate.sh.

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
        populate)   _load_module cmd-populate; cmd_backlog_populate "$@" ;;
        *)
            log_error "Unknown backlog command: $subcmd"
            echo "Usage: backlog {list|add|show|edit|check|rm|populate}" >&2
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
    log_info "$pass_count/$total items ready for sprint"

    [[ "$fail_count" -gt 0 ]] && return 1
    return 0
}

cmd_backlog_list() {
    local filter_status="" filter_type="" filter_priority="" filter_ready=false filter_no_ready=false filter_failed=false
    parse_opts "val:filter_status:--status" "val:filter_type:--type" "val:filter_priority:--priority" "bool:filter_ready:--ready" "bool:filter_no_ready:--no-ready" "bool:filter_failed:--failed" -- "$@" || return 1

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
    if [[ "$filter_failed" == "true" ]]; then
        jq_filter="$jq_filter | select((.failCount // 0) > 0)"
    fi

    # Collect done IDs for dependency checking
    local done_ids
    done_ids=$(collect_done_ids)

    # Header
    printf "%-10s %-8s %-8s %-13s %-6s %-6s %-20s %s\n" "ID" "PRI" "TRACK" "STATUS" "READY" "FAILS" "BLOCKED" "TITLE"
    printf "%-10s %-8s %-8s %-13s %-6s %-6s %-20s %s\n" "──────────" "────────" "────────" "─────────────" "──────" "──────" "────────────────────" "─────────────────────────────"

    local count=0
    for f in "${files[@]}"; do
        [[ -f "$BACKLOG_DIR/$f" ]] || continue
        local items
        # shellcheck disable=SC1010
        items=$(jq -r --argjson done "$done_ids" "${JQ_PRIO_RANK}[$jq_filter] | sort_by(.priority // \"should\" | prio_rank) | .[] | [.id, .priority // \"-\", .track // \"feature\", .status // \"todo\", (if .readyForSprint then \"yes\" else \"no\" end), ((.failCount // 0) | tostring), ((.dependsOn // []) | map(select(. as \$d | \$done | index(\$d) | not)) | if length == 0 then \"-\" else join(\",\") end), .title] | @tsv" "$BACKLOG_DIR/$f" 2>/dev/null) || continue
        if [[ -n "$items" ]]; then
            while IFS=$'\t' read -r id pri track status ready fails blocked title; do
                local blocked_display="" fails_display="-"
                if [[ "$blocked" != "-" ]]; then
                    blocked_display="[blocked: $blocked]"
                fi
                if [[ "$fails" -gt 0 ]] 2>/dev/null; then
                    fails_display="$fails"
                fi
                printf "%-10s %-8s %-8s %-13s %-6s %-6s %-20s %s\n" "$id" "$pri" "$track" "$status" "$ready" "$fails_display" "$blocked_display" "$title"
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
        "Track:       \(.track // "feature")",
        "Category:    \(.category // "-")",
        "Ready:       \(if .readyForSprint then "yes" else "no" end)",
        "Passes:      \(if .passes then "yes" else "no" end)",
        if (.failCount // 0) > 0 or .lastFailReason then
            "Fail count:   \(.failCount // 0)",
            if .lastFailReason then "Last failure: \(.lastFailReason)" else empty end,
            if .lastFailAt then "Last fail at: \(.lastFailAt)" else empty end
        else empty end,
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

    # Clean stale dependsOn references to the removed item in all backlog files
    local bf
    for bf in "${BACKLOG_FILES[@]}"; do
        [[ -f "$BACKLOG_DIR/$bf" ]] || continue
        if jq -e --arg id "$id" '.items[] | select(.dependsOn[]? == $id)' "$BACKLOG_DIR/$bf" >/dev/null 2>&1; then
            local tmp
            tmp="$(ensure_tmpdir)/clean_deps.json"
            jq --arg id "$id" '.items |= map(.dependsOn |= (if . then map(select(. != $id)) else . end))' "$BACKLOG_DIR/$bf" > "$tmp" && mv "$tmp" "$BACKLOG_DIR/$bf"
        fi
    done

    log_success "Removed $id: $title"
}
