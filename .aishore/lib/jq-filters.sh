#!/usr/bin/env bash
# jq-filters.sh — Shared jq filter constants for backlog operations.
# Loaded once at startup; used by the main script and cmd modules.

# Project an item to sprint-relevant fields with defaults
ITEM_PROJECTION='{id, title, intent, description, steps, acceptanceCriteria, priority, scope, category, track: (.track // "feature"), status: (.status // "todo"), passes: (.passes // false)}'

# Priority ordering function — used inline via string interpolation in jq expressions
JQ_PRIO_RANK='def prio_rank: {"must":0,"should":1,"could":2}[.] // 3;'

# Filter for pickable items — used by pick_item() and list_pickable_ids()
# Expects $skip (JSON array of IDs to skip), $done_ids (JSON array of completed IDs),
# and $core_healthy ("true"/"false") for track gating
PICKABLE_ITEMS_FILTER='[.items[] |
            select(.readyForSprint == true and (.passes == false or .passes == null) and (.status == "todo" or .status == null)) |
            select(.intent != null and .intent != "" and (.intent | length) >= 20) |
            select(.id as $id | $skip | index($id) | not) |
            select(.dependsOn == null or (.dependsOn | length == 0) or (.id as $self | .dependsOn | all(. != $self) and all(. as $dep | $done_ids | index($dep) != null))) |
            select($core_healthy == "true" or (.track // "feature") == "core")]'
