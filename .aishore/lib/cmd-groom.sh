#!/usr/bin/env bash
# Module: cmd-groom — groom command and all groom helpers
# Lazy-loaded by _load_module; all globals (BACKLOG_DIR, BACKLOG_FILES, ARCHIVE_DIR,
# PROJECT_ROOT, GROOM_MAX_ITEMS, GROOM_MIN_PRIORITY, GROOM_SAFE_FIELDS, GROOM_MONITOR,
# jq, count_items, count_ready_items, count_items, log_*, parse_opts, acquire_lock,
# load_config, run_agent, check_result, recent_sprints_file, snapshot_backlog_files,
# map_backlog_files, ensure_tmpdir, _build_groom_feedback) come from the main script.

cmd_groom() {
    require_tool jq

    local mode="bugs" _backlog=false _architect=false
    parse_opts "bool:_backlog:--backlog" "bool:_architect:--architect" -- "$@" || return 1
    [[ "$_backlog" == "true" ]] && mode="backlog"
    [[ "$_architect" == "true" ]] && mode="architect"

    acquire_lock
    load_config
    cd "$PROJECT_ROOT"

    local agent
    if [[ "$mode" == "architect" ]]; then
        log_header "Architect: Scaffolding Review"
        agent="architect"
    elif [[ "$mode" == "backlog" ]]; then
        log_header "Product Owner: Backlog Grooming"
        agent="product-owner"
    else
        log_header "Tech Lead: Bugs/Tech Debt Grooming"
        agent="tech-lead"
    fi

    print_groom_summary

    local -a context_args
    mapfile -t context_args < <(_build_groom_context)

    run_groom_flow "$agent" "groom" context_args
}

print_groom_summary() {
    local backlog_file="$BACKLOG_DIR/backlog.json"
    local bugs_file="$BACKLOG_DIR/bugs.json"
    local total_f=0 total_b=0 ready_f=0 ready_b=0
    [[ -f "$backlog_file" ]] && { total_f=$(count_items "$backlog_file"); ready_f=$(count_ready_items "$backlog_file"); }
    [[ -f "$bugs_file" ]] && { total_b=$(count_items "$bugs_file"); ready_b=$(count_ready_items "$bugs_file"); }
    log_info "Items: $((total_f + total_b)) ($total_f features, $total_b bugs)  |  Ready: $((ready_f + ready_b)) ($ready_f features, $ready_b bugs)"
}

_build_groom_context() {
    local -a _gc=()
    local _gc_f
    for _gc_f in "${BACKLOG_FILES[@]}"; do
        [[ -f "$BACKLOG_DIR/$_gc_f" ]] && _gc+=("@$BACKLOG_DIR/$_gc_f")
    done
    local _gc_rs; _gc_rs=$(recent_sprints_file 20)
    [[ -n "$_gc_rs" ]] && _gc+=("$_gc_rs")
    printf '%s\n' "${_gc[@]}"
}


# Protect pre-existing items from groomer overwrites.
# Compares post-groom backlogs against the pre-groom snapshot.
# Restores any items that were modified or deleted by the groomer.
# Only groomer-added NEW items (IDs not in the snapshot) are kept.
protect_items_from_groom() {
    local snap_dir="$1" restored=0 deleted_restored=0

    _protect_one_file() {
        local f="$1"
        local snap_file="$snap_dir/$f" live_file="$BACKLOG_DIR/$f"
        [[ -f "$snap_file" && -f "$live_file" ]] || return 0

        # Single jq pass: protect pre-existing items and output "deleted modified" counts on last line
        local safe_fields_json
        safe_fields_json=$(printf '%s\n' "${GROOM_SAFE_FIELDS[@]}" | jq -R . | jq -sc .)
        local output
        output=$(jq --slurpfile snap "$snap_file" --argjson safe_fields "$safe_fields_json" '
            ($snap[0].items | map({(.id): .}) | add // {}) as $orig |
            (.items | map(.id)) as $live_ids |
            ([$orig | keys[] | select(. as $id | $live_ids | index($id) | not)] | length) as $del |
            ([.items[] | select($orig[.id] != null) | select(. as $c |
                ($orig[.id] | with_entries(select(.key | IN($safe_fields[]))))
                != ($c | with_entries(select(.key | IN($safe_fields[])))))] | length) as $mod |
            .items = ([.items[] |
                if $orig[.id] then $orig[.id] + {
                    readyForSprint: (.readyForSprint // $orig[.id].readyForSprint),
                    groomedAt:      (.groomedAt      // $orig[.id].groomedAt),
                    groomingNotes:  (.groomingNotes  // $orig[.id].groomingNotes),
                    priority:       (.priority       // $orig[.id].priority)
                } else . end
            ] + [$orig | to_entries[] | select(.key as $id | $live_ids | index($id) | not) | .value]) |
            ., "\($del) \($mod)"
        ' "$live_file")
        # Last line is "del mod" counts; everything before is the protected JSON
        local counts
        counts=$(tail -n1 <<< "$output" | tr -d '"')
        local _tmp_protect
        _tmp_protect="$(ensure_tmpdir)/protect_groom_$(basename "$f").json"
        if ! sed '$d' <<< "$output" > "$_tmp_protect"; then
            log_error "Failed to write protected backlog for $f"
            rm -f "$_tmp_protect"
            return 1
        fi
        mv "$_tmp_protect" "$live_file"
        local d m; read -r d m <<< "$counts"
        deleted_restored=$((deleted_restored + d)); restored=$((restored + m))
    }
    map_backlog_files _protect_one_file

    local total=$((restored + deleted_restored))
    if [[ "$total" -gt 0 ]]; then
        log_warning "Groomer protection: restored $total pre-existing item(s) ($deleted_restored deleted, $restored modified)"
    fi
}

# Capture a snapshot of backlog item counts/ready state for diff
snapshot_backlogs() {
    local backlog_file="$BACKLOG_DIR/backlog.json"
    local bugs_file="$BACKLOG_DIR/bugs.json"
    local ready_f=0 ready_b=0 total_f=0 total_b=0
    [[ -f "$backlog_file" ]] && { ready_f=$(count_ready_items "$backlog_file"); total_f=$(count_items "$backlog_file"); }
    [[ -f "$bugs_file" ]] && { ready_b=$(count_ready_items "$bugs_file"); total_b=$(count_items "$bugs_file"); }
    printf '%s\n' "$ready_f $ready_b $total_f $total_b"
}

# Enforce groom limits: max items and min priority.
# Removes new items that exceed the cap or fall below the priority threshold.
# Outputs "ADDED SKIPPED" counts to stdout for caller to capture.
enforce_groom_limits() {
    local snap_dir="$1" max_items="$GROOM_MAX_ITEMS" min_priority="$GROOM_MIN_PRIORITY"
    local -A prio_rank=([must]=0 [should]=1 [could]=2 [future]=3)
    local min_rank="${prio_rank[$min_priority]:-1}" global_kept=0 total_skipped=0

    _enforce_limits_one() {
        local f="$1"
        local snap_file="$snap_dir/$f" live_file="$BACKLOG_DIR/$f"
        [[ -f "$snap_file" && -f "$live_file" ]] || return 0

        # jq extracts new items (not in snapshot) with their priority
        local new_ids_with_prio
        new_ids_with_prio=$(jq -r --slurpfile snap "$snap_file" '
            {"must":0,"should":1,"could":2,"future":3} as $rank |
            ($snap[0].items | map(.id)) as $old |
            [.items[] | select(.id as $id | $old | index($id) | not)] |
            sort_by($rank[.priority // "could"] // 2) |
            .[] | "\(.id) \(.priority // "could")"
        ' "$live_file" 2>/dev/null || true)
        [[ -z "$new_ids_with_prio" ]] && return 0

        local removed_ids=() id prio
        while read -r id prio; do
            [[ -z "$id" ]] && continue
            local rank="${prio_rank[$prio]:-2}"
            if [[ "$rank" -gt "$min_rank" ]]; then
                removed_ids+=("$id")
                log_info "Groom limit: skipped $id (priority: $prio, below $min_priority threshold)" >&2
            elif [[ "$global_kept" -ge "$max_items" ]]; then
                removed_ids+=("$id")
                log_info "Groom limit: skipped $id (exceeded max $max_items items)" >&2
            else
                global_kept=$((global_kept + 1))
            fi
        done <<< "$new_ids_with_prio"

        total_skipped=$((total_skipped + ${#removed_ids[@]}))
        if [[ ${#removed_ids[@]} -gt 0 ]]; then
            local ids_json
            ids_json=$(printf '%s\n' "${removed_ids[@]}" | jq -R . | jq -s .)
            local _tmp_enforce
            _tmp_enforce="$(ensure_tmpdir)/enforce_limits_$(basename "$f").json"
            if ! jq --argjson rm "$ids_json" \
                '.items = [.items[] | select(.id as $id | $rm | index($id) | not)]' "$live_file" > "$_tmp_enforce"; then
                log_error "Failed to enforce groom limits for $f"
                rm -f "$_tmp_enforce"
                return 1
            fi
            mv "$_tmp_enforce" "$live_file"
        fi
    }
    map_backlog_files _enforce_limits_one

    printf '%s\n' "$global_kept $total_skipped"
}

# Show what changed after grooming
# Args: $1=before_snapshot $2=groom_items_added $3=groom_items_skipped
print_groom_diff() {
    local before="$1" added="${2:-0}" skipped="${3:-0}"
    local rf_b rb_b tf_b tb_b rf_a rb_a tf_a tb_a
    read -r rf_b rb_b tf_b tb_b <<< "$before"
    read -r rf_a rb_a tf_a tb_a <<< "$(snapshot_backlogs)"
    log_info "Ready: $((rf_b+rb_b)) → $((rf_a+rb_a))  |  Items: $((tf_b+tb_b)) → $((tf_a+tb_a))  |  Added: $added  Skipped: $skipped"
}

# Shared groom/populate pipeline: snapshot → agent → protect → enforce → diff → check
# Args: $1=agent $2=mode $3=context_args_array_name
run_groom_flow() {
    local agent="$1" mode="$2" _gf_ctx_name="$3"

    # Clean done items before grooming so agents see lean backlogs
    _load_module cmd-clean; cmd_clean 2>/dev/null || true

    # Build "Specs That Worked" section from archive so groomers see proven patterns
    local specs_that_worked_section=""
    if [[ -f "$ARCHIVE_DIR/sprints.jsonl" ]]; then
        local successful_entries
        successful_entries=$(tail -20 "$ARCHIVE_DIR/sprints.jsonl" 2>/dev/null \
            | jq -r 'select(.status == "complete")' 2>/dev/null \
            | jq -s '[ .[] ] | reverse | .[0:5]' 2>/dev/null || true)
        if [[ -n "$successful_entries" && "$successful_entries" != "[]" ]]; then
            # Build a lookup of item specs from archived backlogs
            local archive_lookup_jq='
                [.[] | {key: .id, value: {intent: (.intent // ""), ac_count: ((.acceptanceCriteria // []) | length)}}]
                | from_entries
            '
            local item_lookup="{}"
            for done_file in "$ARCHIVE_DIR"/backlog_done.json "$ARCHIVE_DIR"/bugs_done.json; do
                if [[ -f "$done_file" ]]; then
                    local partial
                    partial=$(jq "$archive_lookup_jq" "$done_file" 2>/dev/null || true)
                    [[ -n "$partial" && "$partial" != "{}" ]] && \
                        item_lookup=$(printf '%s\n%s' "$item_lookup" "$partial" | jq -s 'add' 2>/dev/null || echo "$item_lookup")
                fi
            done
            # Format each successful entry with intent, AC count, and attempts
            local formatted_specs
            formatted_specs=$(echo "$successful_entries" | jq -r --argjson lookup "$item_lookup" '
                .[] |
                .itemId as $id |
                ($lookup[$id] // {intent: "", ac_count: 0}) as $spec |
                if $spec.intent != "" then
                    "- \($id) (\(.attempts) attempt(s), \($spec.ac_count) AC): \($spec.intent)"
                else
                    "- \($id) (\(.attempts) attempt(s)): \(.title // $id)"
                end
            ' 2>/dev/null || true)
            if [[ -n "$formatted_specs" ]]; then
                specs_that_worked_section="## Specs That Worked
Recent completed items — these spec structures produced passing sprints. Emulate their patterns.
${formatted_specs}"
            fi
        fi
    fi

    local snap_before
    snap_before=$(snapshot_backlogs)

    local snap_dir
    snap_dir=$(mktemp -d)
    snapshot_backlog_files "$snap_dir"

    log_info "Running $agent agent..."
    echo ""

    GROOM_MONITOR=true run_agent "$agent" "$mode" "$MODEL_FAST" "$_gf_ctx_name" "" "$specs_that_worked_section"
    GROOM_MONITOR=

    protect_items_from_groom "$snap_dir"

    local counts added skipped
    counts=$(enforce_groom_limits "$snap_dir")
    read -r added skipped <<< "$counts"
    rm -rf "$snap_dir"

    print_groom_diff "$snap_before" "$added" "$skipped"

    if ! check_result; then
        return 1
    fi
}
