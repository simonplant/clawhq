#!/usr/bin/env bash
# Module: cmd-scaffold — scaffold command (architect agent in groom mode)
# Lazy-loaded by _load_module; depends on cmd-groom for shared pipeline functions.
# Globals from main script: require_tool, acquire_lock, load_config, PROJECT_ROOT,
# _load_module, log_header, print_groom_summary, _build_groom_context, run_groom_flow.

cmd_scaffold() {
    require_tool jq

    acquire_lock
    load_config
    cd "$PROJECT_ROOT"

    _load_module cmd-groom

    log_header "Architect: Scaffolding Review"
    print_groom_summary

    local -a context_args
    mapfile -t context_args < <(_build_groom_context)

    run_groom_flow "architect" "groom" context_args
}
