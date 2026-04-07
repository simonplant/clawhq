#!/usr/bin/env bash
# Module: cmd-update — update and checksums commands
# Lazy-loaded by _load_module; all globals (PROJECT_ROOT, AISHORE_ROOT, AGENTS_DIR,
# AISHORE_VERSION, _HASH_CMD, log_header, log_info, log_success, log_error, log_warning,
# parse_opts, verify_checksum, ensure_tmpdir) come from the main script.

cmd_update() {
    local dry_run=false force=false no_verify=false pin_ref=""
    parse_opts "bool:dry_run:--dry-run" "bool:force:--force" "bool:no_verify:--no-verify" "val:pin_ref:--ref" -- "$@" || return 1

    if [[ "$no_verify" == "true" && "$force" != "true" ]]; then
        log_error "--no-verify requires --force"
        return 1
    fi

    log_header "aishore Update"
    echo "Current version: $AISHORE_VERSION"
    echo ""

    # Check for curl or wget
    local _update_use_curl=false
    if command -v curl &> /dev/null; then
        _update_use_curl=true
    elif ! command -v wget &> /dev/null; then
        log_error "curl or wget required for update"
        return 1
    fi

    # Detect GitHub auth token for authenticated access
    local _update_gh_token=""
    if command -v gh &> /dev/null; then
        _update_gh_token=$(gh auth token 2>/dev/null) || true
    fi
    if [[ -z "$_update_gh_token" && -n "${GITHUB_TOKEN:-}" ]]; then
        _update_gh_token="$GITHUB_TOKEN"
    fi
    [[ -n "$_update_gh_token" ]] && log_info "Using authenticated GitHub access"

    local _update_repo="simonplant/aishore"

    # Low-level fetch — handles auth header injection for any URL
    _update_fetch() {
        if [[ "$_update_use_curl" == "true" ]]; then
            if [[ -n "$_update_gh_token" ]]; then
                curl -fsSL -H "Authorization: token $_update_gh_token" "$@"
            else
                curl -fsSL "$@"
            fi
        else
            if [[ -n "$_update_gh_token" ]]; then
                wget --header="Authorization: token $_update_gh_token" -qO- "$@"
            else
                wget -qO- "$@"
            fi
        fi
    }

    # Fetch a repo file and save directly to disk.
    # Downloads to file (not shell variable) to preserve trailing newlines.
    # Usage: _update_fetch_file_to <relative_path> <dest_path>
    _update_fetch_file_to() {
        local file_path="$1" dest="$2"
        local raw_url="https://raw.githubusercontent.com/$_update_repo/$release_tag/$file_path"

        # Route 1: raw.githubusercontent.com (fast, no rate limit)
        if _update_fetch "$raw_url" > "$dest" 2>/dev/null; then
            return 0
        fi

        # Route 2: GitHub Contents API (base64-encoded)
        local api_url="https://api.github.com/repos/$_update_repo/contents/$file_path?ref=$release_tag"
        local json
        if json=$(_update_fetch "$api_url" 2>/dev/null); then
            printf '%s' "$json" | jq -r '.content' | base64 -d > "$dest"
            return 0
        fi

        return 1
    }

    # Resolve target ref
    local release_tag=""
    if [[ -n "$pin_ref" ]]; then
        release_tag="$pin_ref"
        log_info "Using ref: $release_tag"
    else
        local api_url="https://api.github.com/repos/$_update_repo/releases/latest"
        log_info "Checking for updates..."
        release_tag=$(_update_fetch "$api_url" 2>/dev/null | jq -r '.tag_name // empty') || true
        if [[ -z "$release_tag" ]]; then
            log_warning "Could not resolve latest release — falling back to main"
            release_tag="main"
        fi
    fi

    # Fetch remote version
    local _tmp_ver _tmp_ck
    _tmp_ver="$(ensure_tmpdir)/remote_version.txt"
    _tmp_ck="$(ensure_tmpdir)/remote_checksums.txt"

    if ! _update_fetch_file_to ".aishore/VERSION" "$_tmp_ver"; then
        log_error "Failed to fetch remote version"
        return 1
    fi
    local remote_version
    remote_version=$(tr -d '[:space:]' < "$_tmp_ver")
    rm -f "$_tmp_ver"

    if [[ -z "$remote_version" ]]; then
        log_error "Could not determine remote version"
        return 1
    fi

    echo "Remote: $remote_version (ref: $release_tag)"
    echo ""

    if [[ -z "$pin_ref" && "$AISHORE_VERSION" == "$remote_version" && "$force" != "true" ]]; then
        log_success "Already up to date"
        return 0
    fi

    # Fetch checksums manifest (needed for file discovery and verification)
    log_info "Fetching checksums..."
    if ! _update_fetch_file_to ".aishore/checksums.sha256" "$_tmp_ck"; then
        log_error "Cannot fetch checksums manifest — check connectivity and try again"
        return 1
    fi
    local checksums_content
    checksums_content=$(cat "$_tmp_ck")
    rm -f "$_tmp_ck"

    # Build file list from checksums manifest (with path validation)
    local update_files=()
    if [[ -n "$checksums_content" ]]; then
        while IFS= read -r line; do
            local fpath
            fpath=$(printf '%s\n' "$line" | awk '{print $2}')
            [[ -z "$fpath" ]] && continue
            # Validate: must be inside .aishore/, no traversal, no absolute paths
            if [[ "$fpath" != .aishore/* ]] || [[ "$fpath" == *..* ]] || [[ "$fpath" == /* ]]; then
                log_error "Unsafe path in checksums manifest: $fpath"
                return 1
            fi
            # Protect user config from overwrite
            if [[ "$fpath" == ".aishore/config.yaml" ]]; then
                continue
            fi
            update_files+=("$fpath")
        done <<< "$checksums_content"
    fi

    if [[ ${#update_files[@]} -eq 0 ]]; then
        log_error "No files found in checksums manifest"
        return 1
    fi

    # Show what will be updated
    echo "Files to update:"
    for f in "${update_files[@]}"; do
        echo "  $f"
    done
    echo ""
    echo "Not modified (your content):"
    echo "  .aishore/config.yaml"
    echo ""

    if [[ "$dry_run" == "true" ]]; then
        log_info "Dry run - no changes made"
        echo ""
        echo "To apply update:"
        echo "  .aishore/aishore update"
        return 0
    fi

    # Fetch a remote file into staging and verify its checksum.
    # Args: remote_path local_path label checksum_key [required]
    # Sets all_verified=false on failure. Exits on required file fetch failure.
    _fetch_and_stage() {
        local remote_path="$1" local_path="$2" label="$3" checksum_key="$4"
        local required="${5:-false}"
        if ! _update_fetch_file_to "$remote_path" "$local_path"; then
            if [[ "$required" == "true" ]]; then
                log_error "Failed to fetch $label"
                return 1
            fi
            log_error "Could not fetch $label"
            all_verified=false
            return
        fi
        # Inline checksum lookup and verification
        local expected=""
        if [[ -n "$checksums_content" ]]; then
            expected=$(printf '%s\n' "$checksums_content" | awk -v f="$checksum_key" '$2 == f {print $1; exit}') || true
        fi
        if [[ -n "$expected" ]]; then
            if verify_checksum "$local_path" "$expected"; then
                echo "$checksum_key=verified" >> "$checksum_status_file"
            else
                log_error "Checksum mismatch for $label — file may be corrupted or tampered"
                echo "$checksum_key=mismatch" >> "$checksum_status_file"
                all_verified=false
            fi
        elif [[ -n "$checksums_content" ]]; then
            if [[ "$no_verify" == "true" ]]; then
                log_warning "No checksum entry for $label — skipping (--no-verify)"
                echo "$checksum_key=skipped" >> "$checksum_status_file"
            else
                log_error "No checksum entry for $label — aborting (use --force --no-verify to skip)"
                echo "$checksum_key=missing" >> "$checksum_status_file"
                all_verified=false
            fi
        fi
    }

    # ── Phase 1: Fetch & verify all files into staging ──
    local staging_dir
    staging_dir="$(ensure_tmpdir)/update_staging"
    local all_verified=true
    local file_count=${#update_files[@]}
    local checksum_status_file
    checksum_status_file="$(ensure_tmpdir)/checksum_status.txt"
    : > "$checksum_status_file"

    # Create staging subdirectories for all files
    for f in "${update_files[@]}"; do
        mkdir -p "$staging_dir/$(dirname "$f")"
    done

    # Fetch and verify each file (quiet — results shown after install)
    local fetched=0
    for f in "${update_files[@]}"; do
        local basename_f
        basename_f=$(basename "$f")
        local required=false
        # VERSION and aishore CLI are required
        [[ "$f" == ".aishore/VERSION" || "$f" == ".aishore/aishore" ]] && required=true
        _fetch_and_stage "$f" "$staging_dir/$f" "$basename_f" "$f" "$required"
        ((fetched++)) || true
        printf "\r  Downloading... [%d/%d]" "$fetched" "$file_count"
    done
    printf "\r%40s\r" ""  # clear progress line

    # ── Phase 2: Install (only if all verified) ──
    _unlock_tool_files
    if [[ "$all_verified" != "true" ]]; then
        log_error "Verification failed — no files were modified"
        echo ""
        echo "This usually means GitHub's CDN is serving stale files after a release."
        echo "Try reinstalling via the authenticated API route:"
        echo ""
        echo "  gh api repos/simonplant/aishore/contents/install.sh --jq '.content' | base64 -d | bash -s -- --force"
        echo ""
        return 1
    fi

    # Install and show each file with checksum status
    echo "Installed:"
    for f in "${update_files[@]}"; do
        local dest="$PROJECT_ROOT/$f"
        mkdir -p "$(dirname "$dest")"
        mv "$staging_dir/$f" "$dest"
        # Look up checksum status for this file
        local ck_status=""
        ck_status=$(awk -F= -v key="$f" '$1 == key {print $2; exit}' "$checksum_status_file") || true
        case "$ck_status" in
            verified) log_success "$f  (sha256 ✓)" ;;
            skipped)  log_warning "$f  (checksum skipped)" ;;
            *)        log_success "$f" ;;
        esac
    done
    chmod +x "$AISHORE_ROOT/aishore"

    # ── Phase 3: Refresh CLAUDE.md aishore section ──
    local claude_md
    claude_md=$(find_claude_md)
    local section_template="$AISHORE_ROOT/templates/claude-section.md"
    if [[ -n "$claude_md" && -f "$section_template" ]]; then
        if grep -q "## Sprint Orchestration (aishore)" "$claude_md" 2>/dev/null; then
            local new_section
            new_section=$(cat "$section_template")
            local tmp_claude
            tmp_claude="$(ensure_tmpdir)/claude_md_refresh.md"
            # Replace everything from "## Sprint Orchestration (aishore)" to next "## " or EOF
            awk -v new="$new_section" '
                /^## Sprint Orchestration \(aishore\)/ { found=1; print new; next }
                found && /^## / { found=0 }
                !found { print }
            ' "$claude_md" > "$tmp_claude"
            if [[ -s "$tmp_claude" ]]; then
                mv "$tmp_claude" "$claude_md"
                log_success "Refreshed aishore section in CLAUDE.md"
            else
                rm -f "$tmp_claude"
                log_warning "CLAUDE.md refresh failed — file unchanged"
            fi
        else
            log_info "CLAUDE.md found but no aishore section — skipping refresh"
        fi
    fi

    echo ""
    log_success "Updated to $remote_version ($file_count files)"
}

cmd_checksums() {
    _unlock_tool_files
    cd "$PROJECT_ROOT" || { log_error "Cannot cd to $PROJECT_ROOT"; return 1; }

    local checksum_file="$AISHORE_ROOT/checksums.sha256"
    local files=()

    # Distributable files: VERSION, CLI, docs, and agent prompts
    local distributable=(
        .aishore/VERSION
        .aishore/aishore
        .aishore/README.md
        .aishore/gitignore-entries.txt
        .aishore/help.txt
    )
    for f in "$AGENTS_DIR"/*.md; do
        [[ -f "$f" ]] && distributable+=(".aishore/agents/$(basename "$f")")
    done
    for f in "$AISHORE_ROOT"/templates/*; do
        [[ -f "$f" ]] && distributable+=(".aishore/templates/$(basename "$f")")
    done
    for f in "$AISHORE_ROOT"/lib/*.sh; do
        [[ -f "$f" ]] && distributable+=(".aishore/lib/$(basename "$f")")
    done
    for f in "${distributable[@]}"; do
        [[ -f "$f" ]] && files+=("$f")
    done

    # Generate checksums
    [[ -z "$_HASH_CMD" ]] && { log_error "No sha256sum or shasum found"; return 1; }

    local tmp
    tmp="$(ensure_tmpdir)/checksums_gen.txt"
    for f in "${files[@]}"; do
        [[ -f "$f" ]] && $_HASH_CMD "$f" >> "$tmp"
    done

    if [[ ! -s "$tmp" ]]; then
        log_error "No checksums generated — aborting to protect $checksum_file"
        return 1
    fi

    mv "$tmp" "$checksum_file"
    log_success "Updated checksums.sha256 (${#files[@]} files)"
    cat "$checksum_file"
}
