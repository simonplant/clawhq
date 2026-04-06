#!/usr/bin/env bash
# Module: cmd-backlog-write — backlog write commands (add, edit)
# Lazy-loaded by _load_module; all globals (BACKLOG_DIR, BACKLOG_FILES, ARCHIVE_DIR,
# PROJECT_ROOT, jq, log_*, parse_opts, validate_arg, validate_priority, validate_status,
# next_id, add_item, update_item, find_item, resolve_backlog_file, _build_ac_json,
# check_readiness_gates) come from the main script.
# Read commands (list, show, check, rm) remain in cmd-backlog-read.sh.

cmd_backlog_add() {
    local item_type="feat" title="" intent="" desc="" priority="should" category="" ready=false
    local -a ac_entries=()
    local -a step_entries=()
    local -a scope_entries=()
    local -a depends_entries=()

    parse_opts \
        "val:item_type:--type" "val:title:--title" "val:intent:--intent" \
        "val:desc:--desc" "val:priority:--priority" "val:category:--category" \
        "bool:ready:--ready" "arr:depends_entries:--depends-on" \
        "arr:step_entries:--steps" "arr:scope_entries:--scope" \
        "passval:--ac" "passval:--ac-verify" \
        -- "$@" || return 1

    # Process --ac / --ac-verify from _PARSE_REMAINING (order-dependent)
    set -- "${_PARSE_REMAINING[@]}"
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --ac)
                validate_arg "$1" "${2:-}" || return 1
                ac_entries+=("$(printf '%s' "$2" | jq -Rs .)")
                shift 2 ;;
            --ac-verify)
                validate_arg "$1" "${2:-}" || return 1
                if [[ ${#ac_entries[@]} -eq 0 ]]; then
                    log_error "--ac-verify must follow --ac"
                    return 1
                fi
                local last_text="${ac_entries[-1]}"
                ac_entries[-1]="$(jq -n --argjson text "$last_text" --arg verify "$2" '{text: $text, verify: $verify}')"
                shift 2 ;;
            *) log_error "Unknown option: $1"; return 1 ;;
        esac
    done

    # Title is required
    if [[ -z "$title" ]]; then
        log_error "Missing required --title flag"
        echo "  Example: .aishore/aishore backlog add --title \"Fix login timeout\" --type bug --intent \"Login no longer times out after 30s\"" >&2
        return 1
    fi

    # Validate
    case "$item_type" in
        feat|feature) item_type="feat" ;;
        bug) ;;
        *) log_error "Invalid type: $item_type (must be: feat, bug)"; return 1 ;;
    esac
    validate_priority "$priority" || return 1

    # Determine prefix and target file
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

    # Build AC array
    local ac_json="[]"
    if [[ ${#ac_entries[@]} -gt 0 ]]; then
        ac_json=$(_build_ac_json "${ac_entries[@]}")
    fi

    # Build steps array
    local steps_json="[]"
    if [[ ${#step_entries[@]} -gt 0 ]]; then
        steps_json=$(printf '%s\n' "${step_entries[@]}" | jq -R . | jq -s .)
    fi

    # Build scope array
    local scope_json="[]"
    if [[ ${#scope_entries[@]} -gt 0 ]]; then
        scope_json=$(printf '%s\n' "${scope_entries[@]}" | jq -R . | jq -s .)
    fi

    # Build dependsOn array (expand comma-separated entries for compat)
    local depends_json="[]"
    if [[ ${#depends_entries[@]} -gt 0 ]]; then
        local -a expanded_deps=()
        local _dep_entry
        for _dep_entry in "${depends_entries[@]}"; do
            while IFS= read -r _dep; do
                [[ -n "$_dep" ]] && expanded_deps+=("$_dep")
            done < <(printf '%s\n' "$_dep_entry" | tr ',' '\n')
        done
        depends_json=$(printf '%s\n' "${expanded_deps[@]}" | jq -R . | jq -s .)
    fi

    # Create item and append
    if ! add_item "$target_file" \
        --arg id "$new_id" \
        --arg title "$title" \
        --arg intent "$intent" \
        --arg desc "$desc" \
        --arg priority "$priority" \
        --arg category "$category" \
        --argjson ready "$ready" \
        --argjson ac_arr "$ac_json" \
        --argjson deps "$depends_json" \
        --argjson steps_arr "$steps_json" \
        --argjson scope_arr "$scope_json" \
        '.items += [{
            id: $id,
            title: $title,
            intent: (if $intent == "" then null else $intent end),
            description: $desc,
            priority: $priority,
            category: (if $category == "" then null else $category end),
            steps: $steps_arr,
            acceptanceCriteria: $ac_arr,
            scope: $scope_arr,
            dependsOn: (if ($deps | length) > 0 then $deps else [] end),
            status: "todo",
            passes: false,
            readyForSprint: $ready
        }]'; then
        log_error "Failed to add item"
        return 1
    fi

    log_success "Created $new_id: $title"

    # Advisory warning for short intent (hard gate is at sprint time, but warn early)
    if [[ -n "$intent" && ${#intent} -lt 20 ]]; then
        log_warning "Intent is only ${#intent} chars — items with intent <20 chars are skipped at sprint time"
    fi

    # Run readiness gates when setting --ready (warn but don't block)
    if [[ "$ready" == "true" ]]; then
        local gates_warnings
        if ! gates_warnings=$(check_readiness_gates "$new_id"); then
            log_warning "Readiness warnings for $new_id:"
            printf '%b\n' "$gates_warnings"
        fi
    fi
}

cmd_backlog_edit() {
    local id="${1:-}"
    [[ -z "$id" ]] && { log_error "Usage: backlog edit <ID> [--title ...] [--intent ...] [--priority ...] [--status ...] [--desc ...] [--category ...] [--steps ...] [--ac ...] [--ac-verify ...] [--scope ...] [--depends-on ...] [--clear-depends] [--ready] [--no-ready] [--groomed-at ...] [--groomed-notes ...]"; return 1; }
    shift

    # Verify item exists
    find_item "$id" >/dev/null || return 1

    local file
    file=$(resolve_backlog_file "$id") || return 1

    # Parse update flags
    local _e_title="" _e_intent="" _e_desc="" _e_priority="" _e_status="" _e_category="" _e_gnotes=""
    local _e_ready=false _e_no_ready=false
    local -a scope_vals=() step_vals=() ac_entries=() deps_vals=()

    local _e_clear_deps=false
    parse_opts \
        "val:_e_title:--title" "val:_e_intent:--intent" "val:_e_desc:--desc" \
        "val:_e_priority:--priority" "val:_e_status:--status" "val:_e_category:--category" \
        "bool:_e_ready:--ready" "bool:_e_no_ready:--no-ready" "bool:_e_clear_deps:--clear-depends" \
        "arr:scope_vals:--scope" "arr:step_vals:--steps" \
        "arr:deps_vals:--depends-on" \
        "passval:--ac" "passval:--ac-verify" "passval:--groomed-at" "passval:--groomed-notes" \
        -- "$@" || return 1

    # Build jq updates from parsed values
    local updates=() jq_updates="" setting_ready=false
    [[ -n "$_e_title" ]] && { jq_updates+=" | .title = \$title"; updates+=("--arg" "title" "$_e_title"); }
    [[ -n "$_e_intent" ]] && { jq_updates+=" | .intent = \$intent"; updates+=("--arg" "intent" "$_e_intent"); }
    [[ -n "$_e_desc" ]] && { jq_updates+=" | .description = \$desc"; updates+=("--arg" "desc" "$_e_desc"); }
    if [[ -n "$_e_priority" ]]; then
        validate_priority "$_e_priority" || return 1
        jq_updates+=" | .priority = \$priority"; updates+=("--arg" "priority" "$_e_priority")
    fi
    if [[ -n "$_e_status" ]]; then
        validate_status "$_e_status" || return 1
        jq_updates+=" | .status = \$status"; updates+=("--arg" "status" "$_e_status")
        if [[ "$_e_status" == "done" ]]; then
            local resolved_ts
            resolved_ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
            jq_updates+=" | .resolved_at = \$resolved_at"
            updates+=("--arg" "resolved_at" "$resolved_ts")
        elif [[ "$_e_status" == "todo" ]]; then
            jq_updates+=" | del(.resolved_at)"
        fi
    fi
    [[ -n "$_e_category" ]] && { jq_updates+=" | .category = \$category"; updates+=("--arg" "category" "$_e_category"); }
    [[ "$_e_ready" == "true" ]] && { jq_updates+=" | .readyForSprint = true"; setting_ready=true; }
    [[ "$_e_no_ready" == "true" ]] && jq_updates+=" | .readyForSprint = false"
    # Process custom flags from _PARSE_REMAINING (order-dependent)
    set -- "${_PARSE_REMAINING[@]}"
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --ac)
                validate_arg "$1" "${2:-}" || return 1
                ac_entries+=("$(printf '%s' "$2" | jq -Rs .)")
                shift 2 ;;
            --ac-verify)
                validate_arg "$1" "${2:-}" || return 1
                if [[ ${#ac_entries[@]} -eq 0 ]]; then
                    log_error "--ac-verify must follow --ac"
                    return 1
                fi
                local last_text="${ac_entries[-1]}"
                ac_entries[-1]="$(jq -n --argjson text "$last_text" --arg verify "$2" '{text: $text, verify: $verify}')"
                shift 2 ;;
            --groomed-at)
                local gdate
                if [[ -n "${2:-}" && "${2:-}" != --* ]]; then
                    gdate="$2"
                    if ! [[ "$gdate" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
                        log_error "Invalid date format: $gdate (expected YYYY-MM-DD)"
                        return 1
                    fi
                    shift 2
                else
                    gdate=$(date +%Y-%m-%d)
                    shift
                fi
                jq_updates+=" | .groomedAt = \$gdate"
                updates+=("--arg" "gdate" "$gdate")
                ;;
            --groomed-notes)
                if [[ -n "${2:-}" && "${2:-}" != --* ]]; then
                    jq_updates+=" | .groomingNotes = \$gnotes"
                    updates+=("--arg" "gnotes" "$2")
                    shift 2
                else
                    jq_updates+=" | del(.groomingNotes)"
                    shift
                fi
                ;;
            *) log_error "Unknown option: $1"; return 1 ;;
        esac
    done

    # Build array field updates (replace-entire-array semantics)
    if [[ ${#scope_vals[@]} -gt 0 ]]; then
        local scope_json
        scope_json=$(printf '%s\n' "${scope_vals[@]}" | jq -R . | jq -s .)
        jq_updates+=" | .scope = \$newscope"
        updates+=("--argjson" "newscope" "$scope_json")
    fi
    if [[ ${#step_vals[@]} -gt 0 ]]; then
        local steps_json
        steps_json=$(printf '%s\n' "${step_vals[@]}" | jq -R . | jq -s .)
        jq_updates+=" | .steps = \$newsteps"
        updates+=("--argjson" "newsteps" "$steps_json")
    fi
    if [[ "$_e_clear_deps" == "true" ]]; then
        jq_updates+=" | .dependsOn = []"
    elif [[ ${#deps_vals[@]} -gt 0 ]]; then
        # Expand comma-separated entries for backward compat
        local -a expanded_deps=()
        local _dep_entry
        for _dep_entry in "${deps_vals[@]}"; do
            while IFS= read -r _dep; do
                [[ -n "$_dep" ]] && expanded_deps+=("$_dep")
            done < <(printf '%s\n' "$_dep_entry" | tr ',' '\n')
        done
        local deps_json
        deps_json=$(printf '%s\n' "${expanded_deps[@]}" | jq -R . | jq -s .)
        jq_updates+=" | .dependsOn = \$newdeps"
        updates+=("--argjson" "newdeps" "$deps_json")
    fi
    if [[ ${#ac_entries[@]} -gt 0 ]]; then
        local ac_json
        ac_json=$(_build_ac_json "${ac_entries[@]}")
        jq_updates+=" | .acceptanceCriteria = \$newac"
        updates+=("--argjson" "newac" "$ac_json")
    fi

    if [[ -z "$jq_updates" ]]; then
        log_error "No updates specified. Use --title, --intent, --priority, --status, --desc, --category, --steps, --ac, --ac-verify, --scope, --depends-on, --ready, --no-ready, --groomed-at, --groomed-notes"
        return 1
    fi

    # Capture old status before update (for transition message)
    local old_status=""
    if [[ -n "$_e_status" ]]; then
        old_status=$(jq -r --arg id "$id" \
            '[.items[] | select(.id == $id)][0].status // "todo"' \
            "$BACKLOG_DIR/$file")
    fi

    if ! update_item "$file" "$id" "$jq_updates" "${updates[@]}"; then
        log_error "Failed to update item"
        return 1
    fi

    # Print status transition if --status was used
    if [[ -n "$_e_status" ]]; then
        echo "$id: $old_status → $_e_status"
    fi

    log_success "Updated $id"

    # Run readiness gates when setting --ready (warn but don't block)
    if [[ "$setting_ready" == "true" ]]; then
        local gates_warnings
        if ! gates_warnings=$(check_readiness_gates "$id"); then
            log_warning "Readiness warnings for $id:"
            printf '%b\n' "$gates_warnings"
        fi
    fi
}
