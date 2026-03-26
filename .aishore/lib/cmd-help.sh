#!/usr/bin/env bash
# Module: cmd-help — help and usage commands
# Lazy-loaded by _load_module; all globals (AISHORE_VERSION, AISHORE_ROOT,
# log_error) come from the main script.

cmd_usage() {
    _help_compact
}

cmd_help() {
    local arg="${1:-}"
    case "$arg" in
        --full) sed "s/__VERSION__/$AISHORE_VERSION/g" "$AISHORE_ROOT/help.txt" ;;
        run)    _help_run ;;
        auto)   _help_auto ;;
        backlog) _help_backlog ;;
        groom)  _help_groom ;;
        review) _help_review ;;
        report) _help_report ;;
        metrics) _help_metrics ;;
        status) _help_status ;;
        update) _help_update ;;
        clean)  _help_clean ;;
        config) _help_config ;;
        init)   _help_init ;;
        "")     _help_compact ;;
        *)      log_error "No help topic for: $arg"; _help_compact >&2; return 1 ;;
    esac
}

_help_compact() {
    cat <<EOF
aishore - AI Sprint Runner (v${AISHORE_VERSION})

Usage: aishore <command> [options]

Commands:
  run [N|ID|scope] Run sprints, or drain backlog with scope (done|p0|p1|p2)
  backlog <sub>    Manage backlog (list|add|show|edit|check|rm|history|populate)
  groom            Groom bugs/features/architecture
  review           Architecture review
  status           Backlog overview and sprint readiness
  init             Setup wizard
  help <command>   Show detailed help for a command
  help --full      Show complete reference

Other: report, metrics, clean, update, config, checksums, version
EOF
}

_help_run() {
    cat <<EOF
aishore run — Run sprint items

Usage: aishore run [<count>|<ID>|<scope>] [options]

  aishore run              Run 1 sprint (next ready item)
  aishore run 3            Run 3 sprints
  aishore run FEAT-001     Run specific item by ID
  aishore run done         Drain entire backlog (auto-grooms when ready items low)
  aishore run p0           Complete all P0 (must) items
  aishore run p1           Complete all P0+P1 (must + should) items
  aishore run p2           Complete all P0-P2 (must + should + could) items

When a scope (done/p0/p1/p2) is given, auto-grooming and the circuit breaker
activate automatically.

Options:
  --dry-run             Preview without running agents
  --no-merge            Keep feature branches for PR review
  --pr                  Create GitHub PR (implies --no-merge, requires gh)
  --retries N           Retry attempts on validation failure
  --parallel N          Run up to N items concurrently (1-4)

Session tuning (also settable in config.yaml under 'run:'):
  --max-failures, --timeout, --category,
  --auto-review, --limit, --no-summary
  See: aishore help --full

Examples:
  aishore run FEAT-001               # Run specific item
  aishore run --no-merge 3           # Keep branches for PR review
  aishore run --pr FEAT-001          # Create GitHub PR for review
  aishore run done                   # Drain entire backlog
  aishore run done --parallel 2      # Run 2 items concurrently
  aishore run p1 --retries 2         # Must + should, with retries
  aishore run done --category docs   # Only documentation items
EOF
}

_help_auto() {
    echo "'auto' is now part of 'run'. Use: aishore run <scope> [options]"
    echo ""
    _help_run
}

_help_backlog() {
    cat <<EOF
aishore backlog — Manage backlog items

Usage: aishore backlog <subcommand> [options]

Subcommands:
  list              List all items (features + bugs)
    --status <s>      Filter by status (todo, in-progress, done)
    --type <t>        Filter by type (feat, bug)
    --priority <p>    Filter by priority (must, should, could, future)
    --ready           Show only sprint-ready items
    --no-ready        Show only items not yet ready
  add               Add a new item
    --type <t>        Type: feat (default) or bug
    --title "..."     Item title (required)
    --intent "..."    Commander's intent
    --desc "..."      Description
    --priority <p>    must, should, could, or future (default: should)
    --category "..."  Category
    --ready           Mark as ready for sprint
    --ac "text"       Acceptance criterion (repeatable, replaces all AC)
    --ac-verify "cmd" Attach verify command to preceding --ac
    --steps "text"    Implementation step (repeatable, replaces all steps)
    --scope "glob"    Scope glob (repeatable, replaces all scope)
    --depends-on ID   Dependency (repeatable, replaces all deps)
  show <ID>         Show full detail of one item
  edit <ID>         Update fields on an item (same flags as add, plus --status,
                    --no-ready, --groomed-at, --groomed-notes)
  check <ID>        Check readiness gates for an item
    --all             Audit every non-done item
  rm <ID>           Remove an item (--force to skip confirmation)
  history           List recent completed sprint items (--limit N, --all)
  populate          AI-populate backlog from PRODUCT.md (--preview)

Examples:
  aishore backlog list --ready         # Show sprint-ready items
  aishore backlog add --title "Add auth" --intent "Users can log in" --ac "Login works"
  aishore backlog edit FEAT-001 --priority must --ready
  aishore backlog check --all          # Audit all items
EOF
}

_help_groom() {
    cat <<EOF
aishore groom — AI-assisted backlog grooming

Usage: aishore groom [options]

Modes:
  (default)         Tech Lead — groom bugs and tech debt
  --backlog         Product Owner — groom features, set priorities
  --architect       Architect — detect fragment risk, inject skeleton items

Examples:
  aishore groom                # Groom bugs (tech lead)
  aishore groom --backlog      # Groom features (product owner)
  aishore groom --architect    # Scaffolding review
EOF
}

_help_review() {
    cat <<EOF
aishore review — Architecture review

Usage: aishore review [options]

Options:
  --update-docs       Allow updates to documentation files
  --since <hash>      Review changes since specific commit

Examples:
  aishore review                       # Read-only review
  aishore review --update-docs         # Review and update docs
  aishore review --since abc123        # Review recent changes
EOF
}

_help_report() {
    cat <<EOF
aishore report — Sprint activity summary

Usage: aishore report [options]

Options:
  --since <date>      Only include items completed on or after YYYY-MM-DD
  --output <file>     Write report to file instead of stdout
  --format json       Emit JSON array instead of markdown

Examples:
  aishore report                           # Markdown to stdout
  aishore report --since 2026-03-01        # Filter by date
  aishore report --format json             # JSON output
  aishore report --output report.md        # Write to file
EOF
}

_help_metrics() {
    cat <<EOF
aishore metrics — Sprint metrics

Usage: aishore metrics [options]

Options:
  --json    Output as JSON instead of human-readable format
EOF
}

_help_status() {
    cat <<EOF
aishore status — Backlog overview and sprint readiness

Usage: aishore status [options]

Options:
  --watch           Live refresh until sprint completes or Ctrl-C
  --interval N      Refresh interval in seconds (default: 30)
EOF
}

_help_update() {
    cat <<EOF
aishore update — Update from upstream

Usage: aishore update [options]

Options:
  --dry-run     Check for updates without applying
  --force       Update even if already on latest version
EOF
}

_help_clean() {
    cat <<EOF
aishore clean — Archive and remove done items

Usage: aishore clean [options]

Options:
  --dry-run       Preview what would be removed
  --no-archive    Remove without archiving
EOF
}

_help_config() {
    cat <<EOF
aishore config — Configuration management

Usage: aishore config <subcommand>

Subcommands:
  check     Validate config.yaml and print effective settings with sources
EOF
}

_help_init() {
    cat <<EOF
aishore init — Setup wizard

Usage: aishore init [options]

Checks prerequisites, detects project settings, and configures aishore.

Options:
  -y, --yes     Accept all detected defaults (non-interactive)
EOF
}
