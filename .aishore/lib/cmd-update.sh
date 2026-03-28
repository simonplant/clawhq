#!/usr/bin/env bash
# Module: cmd-update — update and checksums commands
# Lazy-loaded by _load_module; all globals (PROJECT_ROOT, AISHORE_ROOT, AGENTS_DIR,
# AISHORE_VERSION, _HASH_CMD, log_header, log_info, log_success, log_error, log_warning,
# parse_opts, verify_checksum, ensure_tmpdir) come from the main script.

cmd_update() {
    local dry_run=false force=false no_verify=false
    parse_opts "bool:dry_run:--dry-run" "bool:force:--force" "bool:no_verify:--no-verify" -- "$@" || return 1

    if [[ "$no_verify" == "true" && "$force" != "true" ]]; then
        log_error "--no-verify requires --force"
        return 1
    fi

    log_header "aishore Update"
    echo "Current version: $AISHORE_VERSION"
    echo ""

    # Check for curl or wget
    local fetch_cmd=""
    if command -v curl &> /dev/null; then
        fetch_cmd="curl -fsSL"
    elif command -v wget &> /dev/null; then
        fetch_cmd="wget -qO-"
    else
        log_error "curl or wget required for update"
        return 1
    fi

    # Resolve latest release tag
    local api_url="https://api.github.com/repos/simonplant/aishore/releases/latest"
    log_info "Checking for updates..."
    local release_tag=""
    release_tag=$($fetch_cmd "$api_url" 2>/dev/null | jq -r '.tag_name // empty') || true

    if [[ -z "$release_tag" ]]; then
        log_warning "Could not resolve latest release — falling back to main"
        release_tag="main"
    fi

    local repo_url="https://raw.githubusercontent.com/simonplant/aishore/$release_tag"

    # Fetch remote version from VERSION file
    local remote_version
    remote_version=$($fetch_cmd "$repo_url/.aishore/VERSION" 2>/dev/null | tr -d '[:space:]') || {
        log_error "Failed to fetch remote version from $repo_url/.aishore/VERSION"
        return 1
    }

    if [[ -z "$remote_version" ]]; then
        log_error "Could not determine remote version"
        return 1
    fi

    echo "Remote version: $remote_version (tag: $release_tag)"
    echo ""

    if [[ "$AISHORE_VERSION" == "$remote_version" ]] && [[ "$force" != "true" ]]; then
        log_success "Already up to date"
        return 0
    fi

    # Fetch checksums manifest (needed for file discovery and verification)
    log_info "Fetching checksums..."
    local checksums_content=""
    checksums_content=$($fetch_cmd "$repo_url/.aishore/checksums.sha256" 2>/dev/null) || {
        log_error "Cannot fetch checksums manifest — check connectivity and try again"
        return 1
    }

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
        if ! $fetch_cmd "$repo_url/$remote_path" > "$local_path" 2>/dev/null; then
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
    if [[ "$all_verified" != "true" ]]; then
        log_error "Verification failed — no files were modified"
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

    echo ""
    log_success "Updated to $remote_version ($file_count files)"
}

cmd_checksums() {
    cd "$PROJECT_ROOT"

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
