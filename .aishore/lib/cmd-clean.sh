#!/usr/bin/env bash
# Module: cmd-clean — clean done items from backlogs
# Lazy-loaded by _load_module; all globals (BACKLOG_DIR, BACKLOG_FILES, ARCHIVE_DIR,
# jq, log_*, parse_opts, require_tool, count_by_status, remove_items_by_status,
# ensure_tmpdir, _load_module) come from the main script.

cmd_clean() {
    require_tool jq

    local dry_run=false no_archive=false
    parse_opts "bool:dry_run:--dry-run" "bool:no_archive:--no-archive" -- "$@" || return 1

    local total=0
    local -A file_counts=()

    local f
    for f in "${BACKLOG_FILES[@]}"; do
        [[ -f "$BACKLOG_DIR/$f" ]] || continue
        local cnt
        cnt=$(count_by_status "$BACKLOG_DIR/$f" "done")
        file_counts["$f"]="$cnt"
        total=$((total + cnt))
    done

    if [[ "$total" -eq 0 ]]; then
        echo "Nothing to clean"
    elif [[ "$dry_run" == "true" ]]; then
        echo "Would remove $total done items across ${#file_counts[@]} file(s)"
        for f in "${!file_counts[@]}"; do
            [[ "${file_counts[$f]}" -gt 0 ]] && echo "  $f: ${file_counts[$f]}"
        done
    else
        local cleaned=0
        for f in "${!file_counts[@]}"; do
            if [[ "${file_counts[$f]}" -gt 0 ]]; then
                # Archive done items before removing (unless --no-archive)
                if [[ "$no_archive" != "true" ]]; then
                    _archive_done_items "$f" || { log_error "Failed to archive $f"; return 1; }
                fi
                remove_items_by_status "$f" "done" || { log_error "Failed to clean $f"; return 1; }
                cleaned=$((cleaned + ${file_counts[$f]}))
            fi
        done
        if [[ "$no_archive" == "true" ]]; then
            echo "Cleaned $cleaned done items ($total total removed, not archived)"
        else
            echo "Cleaned $cleaned done items ($total total archived and removed)"
        fi
    fi
}

# Archive done items from a backlog file to archive/<basename>_done.json
_archive_done_items() {
    local file="$1"
    local basename="${file%.json}"
    local archive_file="$ARCHIVE_DIR/${basename}_done.json"
    local tmp

    mkdir -p "$ARCHIVE_DIR"
    tmp="$(ensure_tmpdir)/archive_done.json"

    # Extract done items from the source file
    local done_items
    done_items=$(jq '[.items[] | select((.status // "todo") == "done")]' "$BACKLOG_DIR/$file") || return 1
    [[ "$done_items" == "[]" ]] && return 0

    if [[ -f "$archive_file" ]]; then
        # Merge new done items into existing archive, dedup by id
        jq --argjson new "$done_items" \
            '. + $new | unique_by(.id)' "$archive_file" > "$tmp" || return 1
    else
        printf '%s\n' "$done_items" > "$tmp"
    fi

    jq empty "$tmp" || { log_error "Archive file validation failed"; rm -f "$tmp"; return 1; }
    mv "$tmp" "$archive_file"
}
