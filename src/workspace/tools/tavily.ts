/**
 * Tavily CLI tool generator.
 *
 * Generates a bash CLI for Tavily web research API.
 * Integration: research → requires TAVILY_API_KEY.
 */

export function generateTavilyTool(): string {
  return `#!/bin/bash
# tavily — Web research API via curl
# Usage: tavily <command> [args]
#
# Commands:
#   search <query>                — quick web search (5 results + AI answer)
#   deep <query>                  — deep research (10 results, full content)
#   news <query>                  — search recent news only
#   raw <query>                   — full JSON response (no formatting)
#
# Environment:
#   TAVILY_API_KEY — API key (required, https://tavily.com)

set -euo pipefail

if [ -z "\${TAVILY_API_KEY:-}" ]; then
  echo "Error: TAVILY_API_KEY not set" >&2
  echo "Sign up at: https://tavily.com" >&2
  exit 1
fi

_search() {
  local query="$1"
  local depth="\${2:-basic}"
  local max_results="\${3:-5}"
  local topic="\${4:-general}"
  local include_raw="\${5:-false}"

  local body
  body=$(jq -n \\
    --arg q "$query" \\
    --arg d "$depth" \\
    --argjson m "$max_results" \\
    --arg t "$topic" \\
    '{
      query: $q,
      search_depth: $d,
      max_results: $m,
      topic: $t,
      include_answer: true,
      include_raw_content: false
    }')

  local resp
  resp=$(curl --silent --fail-with-body \\
    -X POST \\
    -H "Content-Type: application/json" \\
    -H "Authorization: Bearer \${TAVILY_API_KEY}" \\
    -d "$body" \\
    "https://api.tavily.com/search")

  if [ "$include_raw" = "true" ]; then
    echo "$resp" | jq '.'
    return
  fi

  local answer
  answer=$(echo "$resp" | jq -r '.answer // empty')
  if [ -n "$answer" ]; then
    echo "=== Answer ==="
    echo "$answer"
    echo
  fi

  echo "=== Sources ==="
  echo "$resp" | jq -r '.results[] | "[\\(.score | tostring | .[0:4])] \\(.title)\\n    \\(.url)\\n    \\(.content[:200])\\n"'
}

case "\${1:-help}" in
  search)
    shift
    _search "$*" basic 5 general false
    ;;
  deep)
    shift
    _search "$*" advanced 10 general false
    ;;
  news)
    shift
    _search "$*" basic 5 news false
    ;;
  raw)
    shift
    _search "$*" basic 5 general true
    ;;
  help|*)
    sed -n '2,13p' "$0" | sed 's/^# \\?//'
    ;;
esac
`;
}
