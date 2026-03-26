#!/usr/bin/env bash
# Module: cmd-review — architecture review command
# Lazy-loaded by _load_module; all globals (PROJECT_ROOT, DATA_DIR, MODEL_PRIMARY,
# PERMS_REVIEWER, PERMS_REVIEWER_DOCS, CFG_PERMS_REVIEWER, colors) come from the main script.
# _build_groom_context comes from cmd-groom module (loaded via _load_module cmd-groom).

cmd_review() {
    require_tool jq

    local update_docs=false
    local since=""
    parse_opts "bool:update_docs:--update-docs" "val:since:--since" -- "$@" || return 1

    acquire_lock
    load_config
    _load_module cmd-groom
    cd "$PROJECT_ROOT"

    log_header "Architecture Review"
    echo "Mode: $([[ "$update_docs" == "true" ]] && echo "Update docs" || echo "Read-only")"
    echo ""

    local -a context_args
    mapfile -t context_args < <(_build_groom_context)

    local extra_prompt
    extra_prompt="## Additional Context
$([[ -n "$since" ]] && echo "Review changes since commit: $since")
$([[ "$update_docs" == "true" ]] && echo "You may update documentation and add backlog items." || echo "Read-only review. Do not modify files.")"

    # Resolve permissions based on --update-docs flag, not output_file
    if [[ "$update_docs" == "true" ]]; then
        CFG_PERMS_REVIEWER="$PERMS_REVIEWER_DOCS"
    else
        CFG_PERMS_REVIEWER="$PERMS_REVIEWER"
    fi

    local output_file
    output_file="$(ensure_tmpdir)/review_output.txt"

    log_info "Running architect agent..."

    run_agent "architect" "review" "$MODEL_PRIMARY" context_args "$output_file" "$extra_prompt"

    # Save and print review output
    if [[ -s "$output_file" ]]; then
        local review_log
        review_log="$DATA_DIR/logs/review-$(date +%Y%m%dT%H%M%S).md"
        cp "$output_file" "$review_log"
        log_info "Review output saved to: $review_log"
        echo ""
        echo "═══════════════════════════════════════════"
        echo "  ARCHITECTURE REVIEW OUTPUT"
        echo "═══════════════════════════════════════════"
        echo ""
        cat "$output_file"
        echo ""
    fi

    if ! check_result; then
        return 1
    fi
}
