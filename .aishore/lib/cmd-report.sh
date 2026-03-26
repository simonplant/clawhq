#!/usr/bin/env bash
# Module: cmd-report — report and metrics commands
# Lazy-loaded by _load_module; all globals (ARCHIVE_DIR, BACKLOG_DIR, JQ_PRIO_RANK,
# count_ready_items, count_items, portable_date_iso, colors) come from the main script.

_compute_metrics_json() {
    local sprints_file="$ARCHIVE_DIR/sprints.jsonl"
    local backlog_file="$BACKLOG_DIR/backlog.json"
    local bugs_file="$BACKLOG_DIR/bugs.json"

    local ready_backlog ready_bugs backlog_total bugs_total completed
    ready_backlog=$(count_ready_items "$backlog_file")
    ready_bugs=$(count_ready_items "$bugs_file")
    backlog_total=$(count_items "$backlog_file")
    bugs_total=$(count_items "$bugs_file")
    completed=$([[ -f "$sprints_file" ]] && jq -s 'length' "$sprints_file" 2>/dev/null || echo 0)

    local trends="{}"
    if [[ -f "$sprints_file" && -s "$sprints_file" ]]; then
        trends=$(jq -s '
            def safe_div(a; b): if b == 0 then 0 else (a / b * 100 | round) / 100 end;
            . as $all |
            {
                avgAttempts: safe_div([$all[] | .attempts // 1] | add; $all | length),
                itemsPerDay: safe_div($all | length; [$all[] | .date] | unique | length),
                byPriority: ([$all[] | {priority: (.priority // "unknown")}] | group_by(.priority) | map({key: .[0].priority, value: length}) | from_entries),
                byCategory: ([$all[] | {category: (.category // "uncategorized")}] | group_by(.category) | map({key: .[0].category, value: length}) | from_entries)
            } + (
                if ($all | length) > 10 then
                    ($all | [.[length-10:][]] ) as $recent |
                    {
                        recentAvgAttempts: safe_div([$recent[] | .attempts // 1] | add; $recent | length),
                        recentAvgDuration: safe_div([$recent[] | .duration // 0] | add; $recent | length),
                        overallAvgDuration: safe_div([$all[] | .duration // 0] | add; $all | length)
                    }
                else {} end
            )
        ' "$sprints_file" 2>/dev/null || echo "{}")
    fi

    cat <<EOF
{
  "timestamp": "$(portable_date_iso)",
  "sprints": {"completed": $completed},
  "backlog": {"total": $backlog_total, "ready": $ready_backlog},
  "bugs": {"total": $bugs_total, "ready": $ready_bugs},
  "trends": $trends
}
EOF
}

cmd_metrics() {
    require_tool jq

    local json_output=false
    parse_opts "bool:json_output:--json" -- "$@" || return 1

    load_config

    local metrics_json
    metrics_json=$(_compute_metrics_json)

    if [[ "$json_output" == "true" ]]; then
        printf '%s\n' "$metrics_json"
    else
        log_header "aishore Metrics"
        echo ""
        # Extract basic metrics in one jq pass
        local sprints_completed backlog_total backlog_ready bugs_total bugs_ready trends_empty
        IFS=$'\t' read -r sprints_completed backlog_total backlog_ready bugs_total bugs_ready trends_empty < <(
            jq -r '[
                (.sprints.completed | tostring),
                (.backlog.total | tostring),
                (.backlog.ready | tostring),
                (.bugs.total | tostring),
                (.bugs.ready | tostring),
                ((.trends == {}) | tostring)
            ] | @tsv' <<< "$metrics_json"
        )

        echo "Completed Sprints: $sprints_completed"
        echo ""
        echo "Backlog:"
        echo "  Total items: $backlog_total"
        echo "  Ready for sprint: $backlog_ready"
        echo ""
        echo "Bugs/Tech Debt:"
        echo "  Total items: $bugs_total"
        echo "  Ready for sprint: $bugs_ready"

        # Trends section — extract all trend fields in one jq pass
        if [[ "$trends_empty" != "true" ]]; then
            echo ""
            log_subheader "Trends"
            jq -r '
                "  Avg attempts/item: \(.trends.avgAttempts)",
                "  Items/day: \(.trends.itemsPerDay)",
                (if (.trends.byPriority | length) > 0 then
                    "  By priority: \(.trends.byPriority | to_entries | map("\(.key): \(.value)") | join(", "))"
                else empty end),
                (if (.trends.byCategory | length) > 0 then
                    "  By category: \(.trends.byCategory | to_entries | map("\(.key): \(.value)") | join(", "))"
                else empty end),
                (if .trends | has("recentAvgAttempts") then
                    "  Recent trend (last 10): avg attempts \(.trends.recentAvgAttempts) (overall: \(.trends.avgAttempts))",
                    "  Recent trend (last 10): avg duration \(.trends.recentAvgDuration | round)s (overall: \(.trends.overallAvgDuration | round)s)"
                else empty end)
            ' <<< "$metrics_json"
        fi
    fi
}

cmd_report() {
    require_tool jq

    local since="" output_file="" format="markdown"
    parse_opts "val:since:--since" "val:output_file:--output" "val:format:--format" -- "$@" || return 1

    local sprints_file="$ARCHIVE_DIR/sprints.jsonl"
    if [[ ! -f "$sprints_file" || ! -s "$sprints_file" ]]; then
        echo "No completed items found"
        return 0
    fi

    # Build jq filter for complete items with optional --since
    local jq_filter='[ .[] | select(.status == "complete") ]'
    if [[ -n "$since" ]]; then
        jq_filter="[ .[] | select(.status == \"complete\" and .date >= \"$since\") ]"
    fi

    local items
    items=$(jq -s "$jq_filter" "$sprints_file" 2>/dev/null)

    local count
    count=$(printf '%s' "$items" | jq 'length')

    if [[ "$count" -eq 0 ]]; then
        echo "No completed items found"
        return 0
    fi

    local result
    if [[ "$format" == "json" ]]; then
        result=$(printf '%s' "$items" | jq '.')
    else
        # Generate markdown grouped by date descending, within each date by priority
        result=$(printf '%s' "$items" | jq -r "$JQ_PRIO_RANK"'
            group_by(.date) | sort_by(.[0].date) | reverse |
            map(
                "## " + .[0].date + "\n" +
                (sort_by(.priority // "unknown" | prio_rank) |
                 map("- " + (.itemId // "???") + ": " + (.title // "untitled") + " (" + (.priority // "unknown") + ")") |
                 join("\n"))
            ) | join("\n\n")
        ')
    fi

    if [[ -n "$output_file" ]]; then
        printf '%s\n' "$result" > "$output_file"
        echo "Report written to $output_file" >&2
    else
        printf '%s\n' "$result"
    fi
}
