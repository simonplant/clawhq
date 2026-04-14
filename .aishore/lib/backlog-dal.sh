#!/usr/bin/env bash
# backlog-dal.sh — Data access layer for backlog operations.
# Consolidates all jq-based backlog reads and writes into a single module.
# Depends on globals from the main script: BACKLOG_DIR, BACKLOG_FILES, ARCHIVE_DIR,
# CORE_HEALTHY, CORE_CMD, ITEM_ID, AISHORE_BASE_BRANCH, AISHORE_DIFF_TARGET,
# map_backlog_files, ensure_tmpdir, portable_date_iso, portable_date_epoch,
# _to_json_array, log_*, JQ_PRIO_RANK, PICKABLE_ITEMS_FILTER, ITEM_PROJECTION

# ============================================================================
# QUERY FUNCTIONS (read-only, stdout-returning)
# ============================================================================

dal_resolve_file() {
    local id="$1"
    local expected=""
    case "$id" in
        FEAT-*) expected="backlog.json" ;;
        BUG-*)  expected="bugs.json" ;;
    esac
    # Check expected file first if prefix matched
    if [[ -n "$expected" ]] && [[ -f "$BACKLOG_DIR/$expected" ]] && jq -e --arg id "$id" '.items[] | select(.id == $id)' "$BACKLOG_DIR/$expected" &>/dev/null; then
        printf '%s\n' "$expected"
        return 0
    fi
    # Fall through: search all files
    local _rf
    for _rf in "${BACKLOG_FILES[@]}"; do
        [[ "$_rf" == "$expected" ]] && continue
        if [[ -f "$BACKLOG_DIR/$_rf" ]] && jq -e --arg id "$id" '.items[] | select(.id == $id)' "$BACKLOG_DIR/$_rf" &>/dev/null; then
            printf '%s\n' "$_rf"
            return 0
        fi
    done
    log_error "Item not found in any backlog: $id"
    return 1
}

dal_find_item() {
    local id="$1"
    local file
    file=$(dal_resolve_file "$id") || return 1
    local item
    item=$(jq -e --arg id "$id" '.items[] | select(.id == $id)' "$BACKLOG_DIR/$file" 2>/dev/null) || {
        log_error "Item not found: $id"
        return 1
    }
    printf '%s\n' "$item"
}

dal_count() {
    local file="$1"
    jq '.items | length' "$file" 2>/dev/null || echo 0
}

dal_count_by_status() {
    local file="$1" status="$2"
    jq --arg s "$status" '[.items[] | select((.status // "todo") == $s)] | length' "$file" 2>/dev/null || echo 0
}

dal_count_ready() {
    local file="$1"
    jq '[.items[] | select(.readyForSprint == true and (.passes == false or .passes == null)) | select(.intent != null and .intent != "" and (.intent | length) >= 20)] | length' "$file" 2>/dev/null || echo 0
}

dal_list_ready() {
    local file="$1"
    jq -r '.items[] | select(.readyForSprint == true and (.passes == false or .passes == null)) | select(.intent != null and .intent != "" and (.intent | length) >= 20) | "  \(.id): \(.title)"' "$file" 2>/dev/null
}

dal_collect_done_ids() {
    local done_ids="[]"
    _dal_collect_done_one() {
        local f="$1"
        [[ -f "$BACKLOG_DIR/$f" ]] || return 0
        local ids
        ids=$(jq '[.items[] | select(.status == "done") | .id]' "$BACKLOG_DIR/$f" 2>/dev/null || echo "[]")
        done_ids=$(printf '%s\n%s\n' "$done_ids" "$ids" | jq -s 'add | unique')
    }
    map_backlog_files _dal_collect_done_one
    # Also include archived sprint item IDs (completed items removed via 'clean')
    local archive_file="$ARCHIVE_DIR/sprints.jsonl"
    if [[ -f "$archive_file" ]] && [[ -s "$archive_file" ]]; then
        local archived_ids
        archived_ids=$(jq -r '.itemId // empty' "$archive_file" 2>/dev/null | jq -R . | jq -s '.' 2>/dev/null || echo "[]")
        done_ids=$(printf '%s\n%s\n' "$done_ids" "$archived_ids" | jq -s 'add | unique')
    fi
    printf '%s\n' "$done_ids"
}

dal_next_id() {
    local prefix="$1"
    local max=0
    _dal_next_id_max() {
        local f="$1"
        [[ -f "$BACKLOG_DIR/$f" ]] || return 0
        local file_max
        file_max=$(jq -r --arg pfx "$prefix-" '[.items[].id | select(startswith($pfx)) | ltrimstr($pfx) | select(test("^[0-9]+$")) | tonumber] | max // 0' "$BACKLOG_DIR/$f" 2>/dev/null || echo 0)
        [[ "$file_max" -gt "$max" ]] && max="$file_max"
    }
    map_backlog_files _dal_next_id_max
    # Check archive to prevent ID reuse after items are completed/removed
    local archive_file="$BACKLOG_DIR/archive/sprints.jsonl"
    if [[ -f "$archive_file" ]]; then
        local archive_max
        archive_max=$(jq -n -r --arg pfx "$prefix-" '[inputs | .itemId | select(startswith($pfx)) | ltrimstr($pfx) | select(test("^[0-9]+$")) | tonumber] | max // empty' "$archive_file" 2>/dev/null)
        [[ -n "$archive_max" && "$archive_max" -gt "$max" ]] && max="$archive_max"
    fi
    printf "%s-%03d" "$prefix" "$((max + 1))"
}

dal_list_pickable_ids() {
    local skip_ids="${1:-}"
    local priority_filter="${2:-}"
    local skip_json="[]"
    if [[ -n "$skip_ids" ]]; then
        skip_json=$(_to_json_array "$skip_ids")
    fi
    local prio_json="[]"
    if [[ -n "$priority_filter" ]]; then
        # shellcheck disable=SC2086
        prio_json=$(printf '%s\n' $priority_filter | jq -R . | jq -s .)
    fi
    local done_ids_json
    done_ids_json=$(dal_collect_done_ids)
    local _lpi_tmp
    _lpi_tmp="$(ensure_tmpdir)/pickable_ids.txt"
    : > "$_lpi_tmp"
    _dal_list_pickable_one() {
        local backlog="$1"
        jq -r --argjson skip "$skip_json" --argjson done_ids "$done_ids_json" --arg core_healthy "$CORE_HEALTHY" --argjson prios "$prio_json" "$JQ_PRIO_RANK"'
            '"$PICKABLE_ITEMS_FILTER"' |
            [.[] | select(($prios | length) == 0 or (.priority // "should") as $p | $prios | index($p) != null)] |
            .[] | (.priority // "should" | prio_rank | tostring) + "\t" + .id
        ' "$BACKLOG_DIR/$backlog" 2>/dev/null >> "$_lpi_tmp" || true
    }
    map_backlog_files _dal_list_pickable_one
    sort -t$'\t' -k1,1n -s "$_lpi_tmp" | cut -f2
}

# ============================================================================
# MUTATION FUNCTIONS (modify files on disk)
# ============================================================================

dal_update_item() {
    local file="$1" id="$2" jq_expr="$3"
    shift 3
    local tmp
    tmp="$(ensure_tmpdir)/update_item.json"
    # remaining args are --arg pairs for jq
    # shellcheck disable=SC2086
    jq --arg id "$id" "$@" \
        "(.items[] | select(.id == \$id)) |= (. $jq_expr)" \
        "$BACKLOG_DIR/$file" > "$tmp" || {
        log_error "Failed to update item $id in $file"
        rm -f "$tmp"
        return 1
    }
    mv "$tmp" "$BACKLOG_DIR/$file"
}

dal_add_item() {
    local file="$1"
    shift
    # remaining args are --arg/--argjson pairs and the jq expression
    local tmp
    tmp="$(ensure_tmpdir)/add_item.json"
    jq "$@" "$BACKLOG_DIR/$file" > "$tmp" || {
        log_error "Failed to add item to $file"
        rm -f "$tmp"
        return 1
    }
    mv "$tmp" "$BACKLOG_DIR/$file"
}

dal_remove_item() {
    local file="$1" id="$2"
    local tmp
    tmp="$(ensure_tmpdir)/remove_item.json"
    jq --arg id "$id" '.items |= map(select(.id != $id))' "$BACKLOG_DIR/$file" > "$tmp" || {
        log_error "Failed to remove item $id from $file"
        rm -f "$tmp"
        return 1
    }
    mv "$tmp" "$BACKLOG_DIR/$file"
}

dal_remove_by_status() {
    local file="$1" status="$2"
    local tmp
    tmp="$(ensure_tmpdir)/remove_by_status.json"
    jq --arg s "$status" '.items |= map(select((.status // "todo") != $s))' "$BACKLOG_DIR/$file" > "$tmp" || {
        log_error "Failed to remove $status items from $file"
        rm -f "$tmp"
        return 1
    }
    mv "$tmp" "$BACKLOG_DIR/$file"
}

dal_synthesize_heal() {
    local causing_item_id="$1"
    local core_output="$2"

    # Guard: never heal a heal
    local causing_heal_source
    causing_heal_source=$(jq -r --arg id "$causing_item_id" '.items[] | select(.id == $id) | .healSource // ""' "$BACKLOG_DIR/bugs.json" 2>/dev/null || echo "")
    if [[ -n "$causing_heal_source" ]]; then
        log_warning "Heal item $causing_item_id itself caused a core regression — removing it"
        dal_remove_item "bugs.json" "$causing_item_id" 2>/dev/null || true
        return 1
    fi

    local heal_id
    heal_id=$(dal_next_id "BUG")
    local heal_title="Heal: core regression after $causing_item_id"
    local heal_intent="Restore core functionality — CORE_CMD must pass again. The merge of $causing_item_id broke the core. Diagnose the regression, fix the code, and verify the core works end-to-end."

    local tmp
    tmp="$(ensure_tmpdir)/heal_item.json"
    jq --arg id "$heal_id" \
       --arg title "$heal_title" \
       --arg intent "$heal_intent" \
       --arg healSource "$causing_item_id" \
       --arg core_cmd "$CORE_CMD" \
       --arg core_output "$core_output" \
       '.items += [{
           id: $id,
           title: $title,
           intent: $intent,
           track: "core",
           priority: "must",
           category: "heal",
           healSource: $healSource,
           readyForSprint: true,
           status: "todo",
           steps: ["Diagnose why CORE_CMD fails after merging " + $healSource, "Fix the regression in the code", "Verify CORE_CMD passes"],
           acceptanceCriteria: [{text: "CORE_CMD passes", verify: $core_cmd}],
           description: ("Core regression after merging " + $healSource + ".\n\nCORE_CMD: " + $core_cmd + "\n\nOutput:\n" + $core_output)
       }]' "$BACKLOG_DIR/bugs.json" > "$tmp" || {
        log_error "Failed to synthesize heal item"
        rm -f "$tmp"
        return 1
    }
    mv "$tmp" "$BACKLOG_DIR/bugs.json"
    log_warning "Heal item $heal_id created for core regression caused by $causing_item_id"
    printf '%s' "$heal_id"
}

# ============================================================================
# SPRINT STATE OPERATIONS
# ============================================================================

dal_create_sprint() {
    local item_json="$1"
    local source="$2"
    local now
    now=$(portable_date_iso)

    local tmp_sprint
    tmp_sprint="$(ensure_tmpdir)/sprint_create.json"
    jq -n \
        --arg sprintId "sprint-$(date +%s)" \
        --arg startedAt "$now" \
        --arg source "$source" \
        --argjson item "$item_json" \
        '{
            sprintId: $sprintId,
            startedAt: $startedAt,
            status: "in_progress",
            item: {
                id: $item.id,
                title: ($item.title // $item.description),
                intent: ($item.intent // null),
                description: ($item.description // null),
                sourceBacklog: $source,
                steps: ($item.steps // []),
                acceptanceCriteria: ($item.acceptanceCriteria // []),
                scope: ($item.scope // []),
                startedAt: $startedAt
            }
        }' > "$tmp_sprint" || {
        log_error "Failed to create sprint JSON"
        rm -f "$tmp_sprint"
        return 1
    }
    mv "$tmp_sprint" "$BACKLOG_DIR/sprint.json"

    ITEM_ID=$(jq -r '.item.id' "$BACKLOG_DIR/sprint.json")
    log_info "Sprint created: $ITEM_ID - $(jq -r '.item.title' "$BACKLOG_DIR/sprint.json")"
}

dal_mark_complete() {
    local item_id="$1"
    local source="$2"
    local attempts="${3:-1}"
    local now
    now=$(portable_date_iso)

    [[ -z "$source" ]] && { log_error "Cannot mark complete: source backlog is empty"; return 1; }

    # Update source backlog
    if ! dal_update_item "$source" "$item_id" \
        '| . + {passes: true, status: "done", readyForSprint: false, completedAt: $ts}' \
        --arg ts "$now"; then
        log_error "Failed to update $source"
        return 1
    fi

    # Update sprint.json
    local tmp_sprint
    tmp_sprint="$(ensure_tmpdir)/sprint_update.json"
    if jq --arg ts "$now" --argjson attempts "$attempts" '.status = "completed" | .completedAt = $ts | .attempts = $attempts | .item.status = "passed" | .item.completedAt = $ts' \
        "$BACKLOG_DIR/sprint.json" > "$tmp_sprint" 2>/dev/null; then
        mv "$tmp_sprint" "$BACKLOG_DIR/sprint.json"
    else
        rm -f "$tmp_sprint"
        log_warning "Failed to update sprint.json status (item already marked complete in $source)"
    fi

    # Append enriched record to archive (non-fatal — primary state is already consistent)
    local sprint_id
    sprint_id=$(jq -r '.sprintId' "$BACKLOG_DIR/sprint.json" 2>/dev/null || echo "unknown")

    # Git diff stats
    local files_changed=0 lines_added=0 lines_removed=0
    local diffstat
    local diff_base="${AISHORE_BASE_BRANCH:-}"
    local diff_target="${AISHORE_DIFF_TARGET:-HEAD}"
    if [[ -z "$diff_base" ]]; then
        diff_base="HEAD~1"
    fi
    diffstat=$(git diff --shortstat "$diff_base" "$diff_target" 2>/dev/null || true)
    if [[ -n "$diffstat" ]]; then
        files_changed=$(printf '%s\n' "$diffstat" | sed -En 's/[^0-9]*([0-9]+) file.*/\1/p')
        lines_added=$(printf '%s\n' "$diffstat" | sed -En 's/.*[^0-9]([0-9]+) insertion.*/\1/p')
        lines_removed=$(printf '%s\n' "$diffstat" | sed -En 's/.*[^0-9]([0-9]+) deletion.*/\1/p')
    fi
    files_changed="${files_changed:-0}"
    lines_added="${lines_added:-0}"
    lines_removed="${lines_removed:-0}"

    # Duration from sprint start
    local duration=0
    local started_at
    started_at=$(jq -r '.startedAt // ""' "$BACKLOG_DIR/sprint.json" 2>/dev/null || true)
    if [[ -n "$started_at" ]]; then
        local start_epoch
        start_epoch=$(portable_date_epoch "$started_at")
        [[ "$start_epoch" -gt 0 ]] && duration=$(( $(date +%s) - start_epoch ))
    fi

    # Priority, category, and title from source backlog item (single jq call)
    local item_priority="" item_category="" item_title=""
    if [[ -n "$source" && -f "$BACKLOG_DIR/$source" ]]; then
        local pc_json
        pc_json=$(jq -r --arg id "$item_id" '.items[] | select(.id == $id) | [(.priority // ""), (.category // ""), (.title // "")] | @tsv' "$BACKLOG_DIR/$source" 2>/dev/null || true)
        if [[ -n "$pc_json" ]]; then
            item_priority=$(printf '%s' "$pc_json" | cut -f1)
            item_category=$(printf '%s' "$pc_json" | cut -f2)
            item_title=$(printf '%s' "$pc_json" | cut -f3)
        fi
    fi

    if ! jq -cn \
        --arg date "$(date +%Y-%m-%d)" \
        --arg sid "$sprint_id" \
        --arg iid "$item_id" \
        --argjson attempts "$attempts" \
        --argjson filesChanged "${files_changed}" \
        --argjson linesAdded "${lines_added}" \
        --argjson linesRemoved "${lines_removed}" \
        --argjson duration "$duration" \
        --arg priority "$item_priority" \
        --arg category "$item_category" \
        --arg title "$item_title" \
        '{date: $date, sprintId: $sid, itemId: $iid, status: "complete", attempts: $attempts, filesChanged: $filesChanged, linesAdded: $linesAdded, linesRemoved: $linesRemoved, duration: $duration, priority: (if $priority == "" then null else $priority end), category: (if $category == "" then null else $category end), title: (if $title == "" then null else $title end)}' \
        >> "$ARCHIVE_DIR/sprints.jsonl" 2>/dev/null; then
        log_warning "Failed to append to archive — sprint data is still consistent"
    fi
}

dal_mark_failed() {
    local item_id="$1"
    local reason="$2"
    local source="$3"
    if [[ -z "$source" ]]; then
        log_warning "Cannot record failure for '$item_id': source backlog unknown"
        return 0
    fi
    local now
    now=$(portable_date_iso)
    if ! dal_update_item "$source" "$item_id" \
        '| . + {lastFailReason: $reason, lastFailAt: $ts, failCount: ((.failCount // 0) + 1)}' \
        --arg reason "$reason" --arg ts "$now" 2>/dev/null; then
        log_warning "Failed to record sprint failure for $item_id"
    fi
    return 0
}

dal_reset_sprint() {
    local tmp
    tmp="$(ensure_tmpdir)/sprint_reset.json"
    printf '%s\n' '{"sprintId": null, "status": "idle", "item": null}' > "$tmp"
    mv "$tmp" "$BACKLOG_DIR/sprint.json"
}
