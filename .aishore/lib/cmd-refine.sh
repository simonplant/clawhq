#!/usr/bin/env bash
# Module: cmd-refine — refine PRODUCT.md through interactive interview
# Lazy-loaded by _load_module; all globals (BACKLOG_DIR, BACKLOG_FILES, ARCHIVE_DIR,
# PROJECT_ROOT, MODEL_PRIMARY, jq, log_*, parse_opts, load_config, _find_prd,
# _file_hash, recent_sprints_file, run_agent_interactive, check_result) come from
# the main script.

cmd_refine() {
    local from_sprints=false
    parse_opts "bool:from_sprints:--from-sprints" -- "$@" || return 1

    load_config
    cd "$PROJECT_ROOT" || { log_error "Cannot cd to $PROJECT_ROOT"; return 1; }

    # Find product requirements doc
    local prd_file
    prd_file=$(_find_prd)
    if [[ -z "$prd_file" ]]; then
        log_error "No product requirements doc found (PRODUCT.md, PRD.md, README.md, etc.)"
        echo "  Create a PRODUCT.md or docs/PRODUCT.md describing what you're building." >&2
        return 1
    fi

    local mode="refine"
    [[ "$from_sprints" == "true" ]] && mode="feedback"

    log_header "Refine: $prd_file"
    log_info "Mode: $mode (interactive)"

    # Build context
    local -a context_args=("@$prd_file")
    local _pf
    for _pf in "${BACKLOG_FILES[@]}"; do
        [[ -f "$BACKLOG_DIR/$_pf" ]] && context_args+=("@$BACKLOG_DIR/$_pf")
    done
    [[ -f "$BACKLOG_DIR/DEFINITIONS.md" ]] && context_args+=("@$BACKLOG_DIR/DEFINITIONS.md")

    # In feedback mode, include sprint history and done archives
    if [[ "$mode" == "feedback" ]]; then
        local recent
        recent=$(recent_sprints_file 30)
        [[ -n "$recent" ]] && context_args+=("$recent")
        [[ -f "$ARCHIVE_DIR/backlog_done.json" ]] && context_args+=("@$ARCHIVE_DIR/backlog_done.json")
        [[ -f "$ARCHIVE_DIR/bugs_done.json" ]] && context_args+=("@$ARCHIVE_DIR/bugs_done.json")
    fi

    # Snapshot PRODUCT.md for post-refine diff
    local prd_hash_before
    prd_hash_before=$(_file_hash "$prd_file")

    # Run interactively (foreground — user answers questions in terminal)
    run_agent_interactive "refiner" "$mode" "$MODEL_PRIMARY" context_args

    # Show what changed
    local prd_hash_after
    prd_hash_after=$(_file_hash "$prd_file")
    if [[ "$prd_hash_before" != "$prd_hash_after" ]]; then
        echo ""
        log_success "PRODUCT.md updated"
        log_info "Tip: run '.aishore/aishore backlog populate' to generate backlog items from the updated doc."
    else
        echo ""
        log_info "PRODUCT.md unchanged"
    fi

    if ! check_result; then
        return 1
    fi
}
