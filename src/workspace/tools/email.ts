/**
 * Email CLI tool generator.
 *
 * Generates a bash wrapper around himalaya for email operations.
 * Integration: email -> requires himalaya binary in Dockerfile.
 */

export interface EmailToolOptions {
  configPath?: string;
  accounts?: string[];
}

export function generateEmailTool(options: EmailToolOptions = {}): string {
  const configPath = options.configPath ?? "/home/node/.openclaw/workspace/himalaya.toml";
  const accounts = options.accounts ?? ["icloud"];
  const accountList = accounts.join(", ");

  return [
    "#!/usr/bin/env bash",
    "# email — Email CLI (wraps himalaya)",
    "# Usage: email <command> [args]",
    "#",
    "# Commands:",
    "#   inbox                — list unread emails",
    "#   all                  — list all recent emails",
    "#   read <id>            — read email body",
    "#   send <to> <subject>  — compose and send (reads body from stdin)",
    "#   reply <id>           — reply to email (reads body from stdin)",
    "#   mark-read <id>       — mark as read (flag seen)",
    "#   delete <id>          — delete email",
    "#   search <query>       — search emails",
    "#",
    `# Accounts: ${accountList}`,
    "#   email --account gmail inbox",
    "",
    "set -euo pipefail",
    "",
    'HIMALAYA="himalaya"',
    `CONFIG="${configPath}"`,
    'ACCOUNT=""',
    "",
    "# Parse global flags",
    "while [[ $# -gt 0 ]]; do",
    "  case \"$1\" in",
    "    --account|-a) ACCOUNT=\"-a $2\"; shift 2;;",
    "    *) break;;",
    "  esac",
    "done",
    "",
    "_h() {",
    '  $HIMALAYA -c "$CONFIG" $ACCOUNT "$@"',
    "}",
    "",
    'cmd="${1:-help}"',
    "shift 2>/dev/null || true",
    "",
    'case "$cmd" in',
    "  inbox)",
    '    _h envelope list not flag seen "$@"',
    "    ;;",
    "  all)",
    '    _h envelope list "$@"',
    "    ;;",
    "  read)",
    '    _h message read "$@"',
    "    ;;",
    "  send)",
    '    to="${1:?Usage: email send <to> <subject>}"',
    '    subject="${2:?Usage: email send <to> <subject>}"',
    "    shift 2",
    '    _h message write --to "$to" --subject "$subject" "$@"',
    "    ;;",
    "  reply)",
    '    _h message reply "$@"',
    "    ;;",
    "  mark-read)",
    '    _h flag add "$1" seen',
    '    echo "Marked read: $1"',
    "    ;;",
    "  delete)",
    '    _h message delete "$1"',
    '    echo "Deleted: $1"',
    "    ;;",
    "  search)",
    '    _h envelope list subject "$*"',
    "    ;;",
    "  help|--help|-h|*)",
    "    sed -n '2,14p' \"$0\" | sed 's/^# \\\\?//'",
    "    ;;",
    "esac",
    "",
  ].join("\n");
}
