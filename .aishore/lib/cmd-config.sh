#!/usr/bin/env bash
# Module: cmd-config — validate config and show effective values
# Lazy-loaded by _load_module; all globals (CONFIG_FILE, BACKLOG_FILES, colors, jq, yq) come from the main script.

cmd_config_check() {
    # Schema: yaml_path | bash_var | env_var | default_value
    local -a _schema=(
        "validation.command|VALIDATE_CMD|AISHORE_VALIDATE_CMD|"
        "validation.timeout|VALIDATE_TIMEOUT|AISHORE_VALIDATE_TIMEOUT|120"
        "fix.command|FIX_CMD|AISHORE_FIX_CMD|"
        "models.primary|MODEL_PRIMARY|AISHORE_MODEL_PRIMARY|claude-opus-4-6"
        "models.fast|MODEL_FAST|AISHORE_MODEL_FAST|claude-sonnet-4-6"
        "agent.timeout|AGENT_TIMEOUT|AISHORE_AGENT_TIMEOUT|3600"
        "timeout_minutes|TIMEOUT_MINUTES|AISHORE_TIMEOUT_MINUTES|0"
        "notifications.on_complete|NOTIFY_CMD|AISHORE_NOTIFY_CMD|"
        "auto.groom_threshold|AUTO_GROOM_THRESHOLD|AISHORE_AUTO_GROOM_THRESHOLD|3"
        "auto.max_failures|AUTO_MAX_FAILURES|AISHORE_AUTO_MAX_FAILURES|5"
        "groom.max_items|GROOM_MAX_ITEMS|AISHORE_GROOM_MAX_ITEMS|10"
        "groom.min_priority|GROOM_MIN_PRIORITY|AISHORE_GROOM_MIN_PRIORITY|should"
        "streaming.enabled|STREAMING_ENABLED|AISHORE_STREAMING|true"
        "streaming.max_lines|STREAMING_MAX_LINES|AISHORE_STREAMING_MAX_LINES|20"
        "output.truncate_lines|OUTPUT_TRUNCATE_LINES|AISHORE_OUTPUT_TRUNCATE_LINES|50"
        "merge.strategy|MERGE_STRATEGY|AISHORE_MERGE_STRATEGY|merge"
        "pr.create|CREATE_PR|AISHORE_CREATE_PR|false"
        "run.auto_review|AUTO_REVIEW|AISHORE_AUTO_REVIEW|false"
        "run.no_summary|NO_SUMMARY|AISHORE_NO_SUMMARY|false"
        "run.retries|SESSION_RETRIES|AISHORE_RETRIES|0"
        "run.limit|SESSION_LIMIT|AISHORE_SESSION_LIMIT|"
        "run.category|SESSION_CATEGORY|AISHORE_SESSION_CATEGORY|"
        "permissions.developer|CFG_PERMS_DEVELOPER|.|"
        "permissions.validator|CFG_PERMS_VALIDATOR|.|"
        "permissions.reviewer|CFG_PERMS_REVIEWER|.|"
    )

    # Known top-level YAML keys (for unknown-key detection)
    local -a _known_top_keys=(
        validation fix models agent notifications auto groom
        streaming output merge pr permissions
        run project backlog_files
    )

    local has_config=false
    local has_warnings=false

    echo ""
    log_header "Configuration Check"
    echo ""

    # --- Check config.yaml ---
    if [[ -f "$CONFIG_FILE" ]]; then
        has_config=true
        echo -e "  ${CYAN}Config file:${NC} $CONFIG_FILE"

        # Validate YAML is parseable
        if command -v yq &> /dev/null; then
            if ! yq '.' "$CONFIG_FILE" &>/dev/null; then
                log_error "config.yaml is malformed — cannot parse YAML"
                echo ""
                echo "  Fix the syntax errors in $CONFIG_FILE and re-run."
                exit 1
            fi
        else
            # Without yq, attempt basic validation via python/ruby
            local _yaml_ok=true
            if command -v python3 &>/dev/null; then
                python3 -c "import sys, yaml; yaml.safe_load(open(sys.argv[1]))" "$CONFIG_FILE" &>/dev/null || _yaml_ok=false
            elif command -v ruby &>/dev/null; then
                ruby -ryaml -e "YAML.load_file(ARGV[0])" "$CONFIG_FILE" &>/dev/null || _yaml_ok=false
            fi
            if [[ "$_yaml_ok" == "false" ]]; then
                log_error "config.yaml is malformed — cannot parse YAML"
                echo "  Fix the syntax errors in $CONFIG_FILE and re-run."
                exit 1
            fi
        fi

        # Check for unknown top-level keys
        if command -v yq &> /dev/null; then
            local -A _known_set=()
            local _kk; for _kk in "${_known_top_keys[@]}"; do _known_set["$_kk"]=1; done
            local _k
            for _k in $(yq -r 'keys | .[]' "$CONFIG_FILE" 2>/dev/null); do
                if [[ -z "${_known_set[$_k]:-}" ]]; then
                    log_warning "Unknown config key: $_k"
                    has_warnings=true
                fi
            done
        fi
    else
        echo -e "  ${YELLOW}No config.yaml found${NC} — using all defaults"
    fi

    echo ""

    # --- Build effective values table ---
    # Load config so variables reflect actual state
    load_config

    echo -e "  ${CYAN}KEY                          EFFECTIVE VALUE              SOURCE${NC}"
    echo "  ─────────────────────────── ──────────────────────────── ──────"

    local _entry _yaml_key _bash_var _env_name _default_val
    local _effective _source _cfg_val _env_val
    for _entry in "${_schema[@]}"; do
        IFS='|' read -r _yaml_key _bash_var _env_name _default_val <<< "$_entry"

        _effective="${!_bash_var:-}"
        _source="default"

        # Determine source: env > config > default
        # Check env first (highest precedence)
        if [[ "$_env_name" != "." ]]; then
            _env_val="${!_env_name:-}"
            if [[ -n "$_env_val" ]]; then
                _source="env"
            fi
        fi

        # If not env, check if config.yaml provided a value
        if [[ "$_source" == "default" && "$has_config" == "true" ]]; then
            if command -v yq &> /dev/null; then
                _cfg_val=$(yq -r ".$_yaml_key // \"\"" "$CONFIG_FILE" 2>/dev/null) || _cfg_val=""
                if [[ -n "$_cfg_val" ]]; then
                    _source="config"
                fi
            fi
        fi

        # Display value (show (empty) for blank values)
        local _display_val="$_effective"
        [[ -z "$_display_val" ]] && _display_val="(empty)"

        printf "  %-28s %-28s %s\n" "$_yaml_key" "$_display_val" "$_source"
    done

    # Show backlog_files separately (it's an array)
    local _bf_source="default"
    if [[ -n "${AISHORE_BACKLOG_FILES:-}" ]]; then
        _bf_source="env"
    elif [[ "$has_config" == "true" ]] && command -v yq &>/dev/null; then
        local _bf_count
        _bf_count=$(yq -r '.backlog_files // [] | length' "$CONFIG_FILE" 2>/dev/null || echo "0")
        [[ "$_bf_count" -gt 0 ]] && _bf_source="config"
    fi
    local _bf_display
    _bf_display=$(printf '%s' "${BACKLOG_FILES[*]}")
    [[ -z "$_bf_display" ]] && _bf_display="(empty)"
    printf "  %-28s %-28s %s\n" "backlog_files" "$_bf_display" "$_bf_source"

    echo ""

    if [[ "$has_warnings" == "true" ]]; then
        echo -e "  ${YELLOW}⚠ Warnings found — review unknown keys above${NC}"
    else
        log_success "Configuration is valid"
    fi
    echo ""
}
