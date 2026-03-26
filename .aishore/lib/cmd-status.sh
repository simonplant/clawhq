#!/usr/bin/env bash
# Module: cmd-status — backlog status overview command
# Lazy-loaded by _load_module; all globals (ARCHIVE_DIR, BACKLOG_DIR, BACKLOG_FILES,
# STATUS_DIR, CYAN, NC, colors, jq, count_items, list_ready_items, log_*, parse_opts)
# come from the main script.

_status_output() {
    local sprints_file="$ARCHIVE_DIR/sprints.jsonl"

    log_header "Backlog Status"
    echo ""

    # --- Item counts by status per declared file (single jq pass per file) ---
    local any_file=false
    local total=0 done_total=0
    local f
    for f in "${BACKLOG_FILES[@]}"; do
        local full_path="$BACKLOG_DIR/$f"
        [[ -f "$full_path" ]] || continue
        any_file=true
        local f_todo f_inprog f_done
        read -r f_todo f_inprog f_done < <(jq -r '[
            ([.items[] | select((.status // "todo") == "todo")] | length),
            ([.items[] | select(.status == "in-progress")] | length),
            ([.items[] | select(.status == "done")] | length)
        ] | @tsv' "$full_path" 2>/dev/null || echo "0 0 0")
        local label="${f%.json}"
        echo "${label}: ${f_todo:-0} todo, ${f_inprog:-0} in-progress, ${f_done:-0} done"
        total=$((total + $(count_items "$full_path")))
        done_total=$((done_total + ${f_done:-0}))
    done

    if [[ "$any_file" == "false" ]]; then
        log_warning "Backlog is empty"
    fi

    # --- Ready for sprint ---
    echo ""
    log_subheader "Ready for sprint"
    local has_ready=false

    for f in "${BACKLOG_FILES[@]}"; do
        [[ -f "$BACKLOG_DIR/$f" ]] || continue
        local ready
        ready=$(list_ready_items "$BACKLOG_DIR/$f")
        if [[ -n "$ready" ]]; then
            printf '%s\n' "$ready"
            has_ready=true
        fi
    done

    if [[ "$has_ready" == "false" ]]; then
        log_warning "No items ready for sprint — run 'groom' or 'backlog edit <ID> --ready'"
    fi

    # --- Currently running ---
    local sprint_file="$BACKLOG_DIR/sprint.json"
    if [[ -f "$sprint_file" ]]; then
        local sprint_status sprint_item_id sprint_item_title
        sprint_status=$(jq -r '.status // "idle"' "$sprint_file" 2>/dev/null || echo "idle")
        if [[ "$sprint_status" != "idle" ]]; then
            sprint_item_id=$(jq -r '.item.id // empty' "$sprint_file" 2>/dev/null || true)
            sprint_item_title=$(jq -r '.item.title // empty' "$sprint_file" 2>/dev/null || true)
            if [[ -n "$sprint_item_id" ]]; then
                echo ""
                log_subheader "Currently running"
                echo "  ${sprint_item_id} — ${sprint_item_title}"
            fi
        fi
    fi

    # --- Recent sprints ---
    echo ""
    log_subheader "Recent sprints"
    if [[ -f "$sprints_file" ]] && [[ -s "$sprints_file" ]]; then
        tail -5 "$sprints_file" | jq -r '"\(.date) \(.itemId) \(.status) \((.title // "-") | if length > 40 then .[:40] + "…" else . end)"' 2>/dev/null | while IFS= read -r line; do
            echo "  $line"
        done
    else
        log_info "No sprints run yet"
    fi

    # --- Warnings ---
    if [[ "$any_file" == "false" ]]; then
        echo ""
        log_warning "Backlog is empty — run 'backlog add' to create items"
    fi

    if [[ "$total" -gt 0 && "$total" -eq "$done_total" ]]; then
        echo ""
        log_info "All items completed"
    fi
}

cmd_status() {
    require_tool jq

    local watch=false
    local interval=30
    parse_opts "bool:watch:--watch" "num:interval:--interval" -- "$@" || return 1

    if [[ "$watch" == "false" ]]; then
        _status_output
        return 0
    fi

    # Watch mode: loop until sprint completes or Ctrl-C
    while true; do
        printf '\033[2J\033[H'
        _status_output

        # Check if sprint is idle (complete)
        local sprint_file="$BACKLOG_DIR/sprint.json"
        local sprint_status="idle"
        if [[ -f "$sprint_file" ]]; then
            sprint_status=$(jq -r '.status // "idle"' "$sprint_file" 2>/dev/null || echo "idle")
        fi
        if [[ "$sprint_status" == "idle" || "$sprint_status" == "completed" ]]; then
            echo ""
            log_info "Sprint complete"
            return 0
        fi

        # Countdown to next refresh
        local remaining="$interval"
        while [[ "$remaining" -gt 0 ]]; do
            printf '\r'"${CYAN}Refreshing in %ds... (Ctrl-C to stop)${NC}" "$remaining"
            sleep 1
            remaining=$((remaining - 1))
        done
    done
}
