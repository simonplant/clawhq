#!/usr/bin/env bash
# Module: cmd-populate — populate backlog from a product requirements document
# Lazy-loaded by _load_module; all globals (BACKLOG_DIR, BACKLOG_FILES, ARCHIVE_DIR,
# PROJECT_ROOT, jq, log_*, parse_opts, acquire_lock, load_config, _find_prd,
# run_groom_flow, _build_groom_context, print_groom_summary, count_items,
# map_backlog_files) come from the main script.

cmd_backlog_populate() {
    require_tool jq

    acquire_lock
    load_config
    cd "$PROJECT_ROOT" || { log_error "Cannot cd to $PROJECT_ROOT"; return 1; }

    if [[ ! -f "$BACKLOG_DIR/backlog.json" ]]; then
        log_error "aishore not initialized — run '.aishore/aishore init' first"
        return 1
    fi

    # Find product requirements doc
    local prd_file
    prd_file=$(_find_prd)
    if [[ -z "$prd_file" ]]; then
        log_error "No product requirements doc found (PRODUCT.md, PRD.md, README.md, etc.)"
        echo "  Create a PRODUCT.md or docs/PRODUCT.md describing what you're building."
        return 1
    fi

    # Guard against empty scaffold templates
    local content_lines
    content_lines=$(grep -cvE '^\s*$|^\s*#|^\s*<!--|^\s*-->|^\s*- \[ \]' "$prd_file" 2>/dev/null || echo 0)
    if [[ "$content_lines" -lt 3 ]]; then
        log_error "Product doc appears to be an empty template: $prd_file"
        echo "  Fill in your product vision, target users, and core features before populating."
        return 1
    fi

    _load_module cmd-groom

    log_header "Populate Backlog from $prd_file"
    print_groom_summary
    log_info "Using requirements from: $prd_file"

    local -a context_args=("@$prd_file")
    local _pf
    for _pf in "${BACKLOG_FILES[@]}"; do
        [[ -f "$BACKLOG_DIR/$_pf" ]] && context_args+=("@$BACKLOG_DIR/$_pf")
    done
    [[ -f "$BACKLOG_DIR/DEFINITIONS.md" ]] && context_args+=("@$BACKLOG_DIR/DEFINITIONS.md")

    run_groom_flow "groomer" "populate" context_args
}
