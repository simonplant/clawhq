#!/usr/bin/env bash
# Module: cmd-init — init command and helpers
# Lazy-loaded by _load_module; all globals (PROJECT_ROOT, AISHORE_ROOT, STATUS_DIR,
# LOGS_DIR, ARCHIVE_DIR, AGENTS_DIR, CONFIG_FILE, BACKLOG_DIR, CYAN, NC,
# log_header, log_subheader, log_success, log_error, log_warning, log_info,
# parse_opts, count_items, find_claude_md, _find_prd, get_claudemd_snippet)
# come from the main script.

_init_check_prereqs() {
    log_subheader "Step 1/6 — Prerequisites"

    if git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree &>/dev/null; then
        log_success "Git repository detected"
    else
        log_error "Not a git repository"
        echo "  aishore tracks work via git commits. Please initialize git first:"
        echo "    git init && git add -A && git commit -m 'initial commit'"
        return 1
    fi

    if command -v claude &>/dev/null; then
        log_success "Claude CLI found ($(claude --version 2>/dev/null || echo 'installed'))"
    else
        log_error "Claude CLI not found"
        echo "  Install it: https://docs.anthropic.com/en/docs/claude-code"
        return 1
    fi

    if command -v jq &>/dev/null; then
        log_success "jq found"
    else
        log_warning "jq not found — some features may be limited"
        echo "  Recommended: install jq (https://jqlang.github.io/jq/)"
    fi

    echo ""
}

# Detect project name, validation command, and existing docs.
# Sets outer-scope locals: project_name, validate_cmd, prd_found, arch_found, claude_md
_init_detect_project() {
    local auto_yes="${1:-false}"

    # ── Project info ──
    log_subheader "Step 2/6 — Project"

    local detected_name=""
    if [[ -f "$PROJECT_ROOT/package.json" ]] && command -v jq &>/dev/null; then
        detected_name=$(jq -r '.name // empty' "$PROJECT_ROOT/package.json" 2>/dev/null || true)
    fi
    if [[ -z "$detected_name" && -f "$PROJECT_ROOT/Cargo.toml" ]]; then
        detected_name=$(grep -m1 '^name' "$PROJECT_ROOT/Cargo.toml" 2>/dev/null | sed 's/.*= *"\(.*\)"/\1/' || true)
    fi
    [[ -z "$detected_name" ]] && detected_name=$(basename "$PROJECT_ROOT")

    if [[ "$auto_yes" == "true" ]]; then
        project_name="$detected_name"
        log_info "Project name: $project_name"
    else
        read -r -p "  Project name [$detected_name]: " project_name
        project_name="${project_name:-$detected_name}"
    fi

    echo ""

    # ── Validation command ──
    log_subheader "Step 3/6 — Validation"
    echo "  After each sprint, aishore runs a command to verify the code works."
    echo "  Examples: 'npm run build', 'cargo test', 'make check'"
    echo ""

    local detected_validate=""
    if [[ -f "$PROJECT_ROOT/package.json" ]]; then
        if command -v jq &>/dev/null; then
            local npm_script
            npm_script=$(jq -r '.scripts // {} | if .check then "check" elif .build and .test then "build+test" elif .build then "build" elif .test then "test" else empty end' "$PROJECT_ROOT/package.json" 2>/dev/null || true)
            case "$npm_script" in
                check)      detected_validate="npm run check" ;;
                build+test) detected_validate="npm run build && npm test" ;;
                build)      detected_validate="npm run build" ;;
                test)       detected_validate="npm test" ;;
            esac
        fi
    elif [[ -f "$PROJECT_ROOT/Cargo.toml" ]]; then
        detected_validate="cargo test"
    elif [[ -f "$PROJECT_ROOT/Makefile" ]]; then
        detected_validate="make test"
    elif [[ -f "$PROJECT_ROOT/pyproject.toml" || -f "$PROJECT_ROOT/setup.py" ]]; then
        detected_validate="python -m pytest"
    elif [[ -f "$PROJECT_ROOT/go.mod" ]]; then
        detected_validate="go test ./..."
    fi

    if [[ "$auto_yes" == "true" ]]; then
        validate_cmd="${detected_validate:-}"
        if [[ -n "$validate_cmd" ]]; then
            log_info "Validation command: $validate_cmd"
        else
            log_info "No validation command detected — skipping"
        fi
    elif [[ -n "$detected_validate" ]]; then
        read -r -p "  Validation command [$detected_validate]: " validate_cmd
        validate_cmd="${validate_cmd:-$detected_validate}"
    else
        read -r -p "  Validation command (or leave empty to skip): " validate_cmd
    fi

    echo ""

    # ── Product requirements ──
    log_subheader "Step 4/6 — Product requirements"
    echo "  aishore works best when agents have context about what you're building."
    echo ""

    prd_found=$(_find_prd)

    arch_found=""
    for _p in "$PROJECT_ROOT/ARCHITECTURE.md" "$PROJECT_ROOT/docs/ARCHITECTURE.md"; do
        [[ -f "$_p" ]] && { arch_found="$_p"; break; }
    done

    claude_md=$(find_claude_md)

    if [[ -n "$claude_md" ]]; then
        log_success "Found $claude_md — agents will use this automatically"
    else
        log_info "No CLAUDE.md found — will create one during scaffolding"
    fi

    if [[ -n "$prd_found" ]]; then
        log_success "Found requirements doc: $prd_found"
    else
        log_info "No product requirements doc found (PRODUCT.md, PRD.md, etc.)"
        echo "  Tip: a PRODUCT.md helps the product-owner agent prioritize features."
        echo "  Even a short description of what you're building is useful."
    fi

    echo ""
}

# Create directories, config, backlogs, templates, .gitignore, CLAUDE.md.
# Uses outer-scope locals: project_name, validate_cmd, claude_md, reinit, prd_found, arch_found
# Sets outer-scope locals: product_path, arch_path
_init_scaffold_files() {
    log_subheader "Step 5/6 — Scaffolding"

    mkdir -p "$STATUS_DIR" "$LOGS_DIR" "$ARCHIVE_DIR" "$AGENTS_DIR"
    log_success "Created directory structure"

    # Write config.yaml
    if [[ ! -f "$CONFIG_FILE" || "$reinit" == true ]]; then
        sed -e "s|\\\$PROJECT_NAME|$project_name|g" \
            -e "s|\\\$VALIDATE_CMD|$validate_cmd|g" \
            "$AISHORE_ROOT/templates/config.yaml.tmpl" > "$CONFIG_FILE"
        log_success "Wrote .aishore/config.yaml"
    else
        log_info "Kept existing .aishore/config.yaml"
    fi

    # Create backlogs (never overwrite existing)
    if [[ ! -f "$BACKLOG_DIR/backlog.json" ]]; then
        cp "$AISHORE_ROOT/templates/backlog.json" "$BACKLOG_DIR/backlog.json"
        log_success "Created backlog/backlog.json"
    else
        log_info "Kept existing backlog/backlog.json ($(count_items "$BACKLOG_DIR/backlog.json") items)"
    fi

    if [[ ! -f "$BACKLOG_DIR/bugs.json" ]]; then
        cp "$AISHORE_ROOT/templates/bugs.json" "$BACKLOG_DIR/bugs.json"
        log_success "Created backlog/bugs.json"
    else
        log_info "Kept existing backlog/bugs.json"
    fi

    if [[ ! -f "$BACKLOG_DIR/sprint.json" ]]; then
        echo '{"sprintId": null, "status": "idle", "item": null}' > "$BACKLOG_DIR/sprint.json"
        log_success "Created backlog/sprint.json"
    else
        log_info "Kept existing backlog/sprint.json"
    fi

    if [[ ! -f "$BACKLOG_DIR/DEFINITIONS.md" ]]; then
        cp "$AISHORE_ROOT/templates/DEFINITIONS.md" "$BACKLOG_DIR/DEFINITIONS.md"
        log_success "Created backlog/DEFINITIONS.md"
    else
        log_info "Kept existing backlog/DEFINITIONS.md"
    fi

    touch "$ARCHIVE_DIR/sprints.jsonl"

    # Scaffold project docs if missing
    local docs_dir="$PROJECT_ROOT/docs"

    # Product doc — use prd_found from detect phase (skip README for scaffolding)
    local prd_base=""
    [[ -n "$prd_found" ]] && prd_base=$(basename "$prd_found")
    if [[ -n "$prd_found" && "$prd_base" != "README.md" ]]; then
        product_path="$prd_found"
        log_info "Found existing product doc: $prd_found"
    else
        mkdir -p "$docs_dir"
        sed "s|\\\$PROJECT_NAME|$project_name|g" \
            "$AISHORE_ROOT/templates/PRODUCT.md.tmpl" > "$docs_dir/PRODUCT.md"
        log_success "Created docs/PRODUCT.md (fill in to help agents understand your product)"
        product_path="$docs_dir/PRODUCT.md"
    fi

    # Architecture doc — use arch_found from detect phase
    if [[ -n "$arch_found" ]]; then
        arch_path="$arch_found"
        log_info "Found existing architecture doc: $arch_found"
    else
        mkdir -p "$docs_dir"
        sed "s|\\\$PROJECT_NAME|$project_name|g" \
            "$AISHORE_ROOT/templates/ARCHITECTURE.md.tmpl" > "$docs_dir/ARCHITECTURE.md"
        log_success "Created docs/ARCHITECTURE.md (fill in to guide agent implementation)"
        arch_path="$docs_dir/ARCHITECTURE.md"
    fi

    # Update .gitignore
    local gitignore="$PROJECT_ROOT/.gitignore"
    local entries_file="$AISHORE_ROOT/gitignore-entries.txt"
    local gitignore_content=""
    if [[ -f "$entries_file" ]]; then
        gitignore_content=$(grep -v '^#' "$entries_file" | grep -v '^$' || true)
    else
        gitignore_content=".aishore/data/logs/
.aishore/data/status/result.json
.aishore/data/status/.item_source
.aishore/data/status/.aishore.lock"
    fi
    if [[ -f "$gitignore" ]]; then
        if ! grep -q ".aishore/data/logs/" "$gitignore" 2>/dev/null; then
            printf '\n# aishore runtime files\n%s\n' "$gitignore_content" >> "$gitignore"
            log_success "Updated .gitignore"
        else
            log_info ".gitignore already configured"
        fi
    else
        printf '# aishore runtime files\n%s\n' "$gitignore_content" > "$gitignore"
        log_success "Created .gitignore"
    fi

    # Add aishore section to CLAUDE.md
    local snippet
    snippet=$(get_claudemd_snippet)
    if [[ -n "$claude_md" ]]; then
        if grep -q "## Sprint Orchestration (aishore)" "$claude_md" 2>/dev/null; then
            log_info "CLAUDE.md already contains aishore section"
        else
            printf '%s\n' "$snippet" >> "$claude_md"
            log_success "Appended aishore section to CLAUDE.md"
        fi
    else
        claude_md="$PROJECT_ROOT/CLAUDE.md"
        printf '# %s\n%s\n' "$project_name" "$snippet" > "$claude_md"
        log_success "Created CLAUDE.md with aishore section"
    fi

    echo ""
}

cmd_init() {
    local auto_yes=false

    parse_opts "bool:auto_yes:-y|--yes" -- "$@" || return 1

    log_header "aishore setup wizard"
    echo ""
    if [[ "$auto_yes" == "true" ]]; then
        echo "  Running non-interactively — accepting all detected defaults."
    else
        echo "  This will walk you through setting up aishore for your project."
        echo "  Press Enter to accept defaults shown in [brackets]."
    fi
    echo ""

    local reinit=false
    if [[ -f "$BACKLOG_DIR/backlog.json" ]]; then
        log_warning "aishore already initialized (backlog.json exists)"
        if [[ "$auto_yes" == "true" ]]; then
            reinit=true
        else
            read -r -p "  Reinitialize? This preserves existing backlogs. [y/N] " c
            [[ $c != [yY] ]] && exit 0
            reinit=true
        fi
        echo ""
    fi

    # Shared state across init steps
    local project_name="" validate_cmd="" prd_found="" claude_md=""
    local arch_found="" product_path="" arch_path=""

    _init_check_prereqs
    _init_detect_project "$auto_yes"
    _init_scaffold_files

    # ── Summary & next steps ──
    log_subheader "Step 6/6 — Ready"
    echo ""
    log_success "aishore initialized for $project_name"
    echo ""

    echo "  Project:       $project_name"
    echo "  Validation:    ${validate_cmd:-<none>}"
    echo "  CLAUDE.md:     ${claude_md:-<not found>}"
    echo "  PRODUCT.md:    ${product_path:-<not found>}"
    echo "  ARCHITECTURE:  ${arch_path:-<not found>}"
    echo "  Definitions:   $BACKLOG_DIR/DEFINITIONS.md"
    echo ""

    echo -e "${CYAN}Next steps:${NC}"
    local step=1
    local prd_base=""
    [[ -n "$prd_found" ]] && prd_base=$(basename "$prd_found")

    if [[ -z "$prd_found" || "$prd_base" == "README.md" ]]; then
        echo "  $step. Fill in docs/PRODUCT.md with your product vision"
        step=$((step + 1))
    fi
    if [[ -z "$arch_found" ]]; then
        echo "  $step. Fill in docs/ARCHITECTURE.md with your tech stack and conventions"
        step=$((step + 1))
    fi

    local item_count=0
    if command -v jq &>/dev/null && [[ -f "$BACKLOG_DIR/backlog.json" ]]; then
        item_count=$(count_items "$BACKLOG_DIR/backlog.json")
    fi

    if [[ "$item_count" -eq 0 ]]; then
        echo "  $step. Add features: .aishore/aishore backlog add"
        step=$((step + 1))
        echo "  $step. Groom items for sprint readiness: .aishore/aishore groom"
        step=$((step + 1))
    fi

    echo "  $step. Run your first sprint: .aishore/aishore run"
    echo ""
}
