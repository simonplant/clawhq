/**
 * Market quote CLI tool generator.
 *
 * Generates a bash CLI for Yahoo Finance quotes.
 * Integration: markets → no API key needed.
 */

export function generateQuoteTool(): string {
  return `#!/bin/bash
# quote — Market quotes via Yahoo Finance
# Usage: quote [options] <TICKER...>
#
# Commands:
#   quote AAPL MSFT              — current price, change, volume
#   quote --detail AAPL          — include day range, 52-week range
#   quote --watch AAPL:200:210   — alert if price outside 200-210 range
#   quote --json AAPL            — machine-readable JSON output
#   quote --hours                — show market hours status
#
# Options:
#   --json       output raw JSON (one object per ticker)
#   --detail     show extended info (day range, 52w range, exchange)
#   --watch      TICKER:LOW:HIGH — check if price is outside range
#   --quiet      suppress headers (useful for scripting)
#   --hours      show US market hours and exit
#
# No API key required. Data from Yahoo Finance (delayed ~15min for some exchanges).

set -euo pipefail

API="https://query1.finance.yahoo.com/v8/finance/chart"
UA="Mozilla/5.0 (compatible; quote-cli/1.0)"

_market_status() {
  local utc_hour utc_min dow
  utc_hour=$(date -u +%H | sed 's/^0//')
  utc_min=$(date -u +%M | sed 's/^0//')
  dow=$(date -u +%u)

  if [ "$dow" -ge 6 ]; then
    echo "CLOSED (weekend)"
    return 1
  fi

  local utc_mins=$((utc_hour * 60 + utc_min))

  if [ "$utc_mins" -ge 480 ] && [ "$utc_mins" -lt 810 ]; then
    echo "PRE-MARKET"
    return 0
  fi

  if [ "$utc_mins" -ge 810 ] && [ "$utc_mins" -lt 1200 ]; then
    echo "OPEN"
    return 0
  fi

  if [ "$utc_mins" -ge 1200 ] || [ "$utc_mins" -lt 60 ]; then
    echo "AFTER-HOURS"
    return 0
  fi

  echo "CLOSED"
  return 1
}

_awk_cmp() { awk "BEGIN { exit !($1) }"; }

JSON=false
DETAIL=false
WATCH=false
QUIET=false
HOURS=false
TICKERS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)   JSON=true; shift;;
    --detail) DETAIL=true; shift;;
    --watch)  WATCH=true; shift;;
    --quiet)  QUIET=true; shift;;
    --hours)  HOURS=true; shift;;
    --help|-h) sed -n '2,18p' "$0" | sed 's/^# \\?//'; exit 0;;
    -*)        echo "Unknown option: $1" >&2; exit 1;;
    *)         TICKERS+=("$1"); shift;;
  esac
done

if $HOURS; then
  status=$(_market_status) && echo "US Markets: $status ($(date -u +'%H:%M UTC'))" || echo "US Markets: $status ($(date -u +'%H:%M UTC'))"
  exit 0
fi

if [ \${#TICKERS[@]} -eq 0 ]; then
  sed -n '2,18p' "$0" | sed 's/^# \\?//'
  exit 0
fi

_fetch() {
  local ticker="\${1^^}"
  local resp
  resp=$(curl --silent --max-time 10 \\
    -H "User-Agent: \${UA}" \\
    "\${API}/\${ticker}?range=1d&interval=1d" 2>/dev/null) || {
    echo "{\\"error\\": \\"network error fetching \${ticker}\\"}"
    return 1
  }

  local err
  err=$(echo "$resp" | jq -r '.chart.error.description // empty' 2>/dev/null)
  if [ -n "$err" ]; then
    echo "{\\"error\\": \\"\${ticker}: \${err}\\"}"
    return 1
  fi

  echo "$resp" | jq --arg t "$ticker" '.chart.result[0].meta | {
    symbol: .symbol,
    name: (.shortName // .longName // .symbol),
    price: .regularMarketPrice,
    previousClose: .chartPreviousClose,
    change: ((.regularMarketPrice // 0) - (.chartPreviousClose // 0)),
    changePercent: (((.regularMarketPrice // 0) - (.chartPreviousClose // 0)) / (.chartPreviousClose // 1) * 100),
    dayHigh: .regularMarketDayHigh,
    dayLow: .regularMarketDayLow,
    volume: .regularMarketVolume,
    fiftyTwoWeekHigh: .fiftyTwoWeekHigh,
    fiftyTwoWeekLow: .fiftyTwoWeekLow,
    currency: .currency,
    exchange: .fullExchangeName,
    marketTime: .regularMarketTime
  }' 2>/dev/null
}

_fmt_vol() {
  local v="$1"
  if [ -z "$v" ] || [ "$v" = "null" ]; then
    echo "-"
  elif [ "$v" -ge 1000000000 ] 2>/dev/null; then
    awk "BEGIN { printf \\"%.1fB\\", $v / 1000000000 }"
  elif [ "$v" -ge 1000000 ] 2>/dev/null; then
    awk "BEGIN { printf \\"%.1fM\\", $v / 1000000 }"
  elif [ "$v" -ge 1000 ] 2>/dev/null; then
    awk "BEGIN { printf \\"%.1fK\\", $v / 1000 }"
  else
    echo "$v"
  fi
}

_sign() {
  local val="$1"
  local num
  num=$(echo "$val" | sed 's/[^0-9.-]//g')
  if _awk_cmp "$num >= 0" 2>/dev/null; then
    echo "+\${val}"
  else
    echo "\${val}"
  fi
}

if $WATCH; then
  exit_code=0
  for spec in "\${TICKERS[@]}"; do
    IFS=':' read -r ticker low high <<< "$spec"
    if [ -z "$ticker" ] || [ -z "$low" ] || [ -z "$high" ]; then
      echo "Error: --watch format is TICKER:LOW:HIGH (e.g. AAPL:200:210)" >&2
      exit 1
    fi

    data=$(_fetch "$ticker") || { echo "$data" | jq -r '.error' >&2; exit_code=1; continue; }
    price=$(echo "$data" | jq -r '.price')
    name=$(echo "$data" | jq -r '.name')
    change_pct=$(echo "$data" | jq -r '.changePercent | . * 100 | round / 100')

    if _awk_cmp "$price < $low"; then
      echo "ALERT: \${ticker} (\${name}) at \\\$\${price} -- BELOW \\\$\${low} floor (\${change_pct}%)"
      exit_code=2
    elif _awk_cmp "$price > $high"; then
      echo "ALERT: \${ticker} (\${name}) at \\\$\${price} -- ABOVE \\\$\${high} ceiling (\${change_pct}%)"
      exit_code=2
    else
      if ! $QUIET; then
        echo "OK: \${ticker} at \\\$\${price} -- within \\\$\${low}-\\\$\${high} (\${change_pct}%)"
      fi
    fi
  done
  exit $exit_code
fi

results=()
errors=()

for ticker in "\${TICKERS[@]}"; do
  data=$(_fetch "$ticker") || { errors+=("$(echo "$data" | jq -r '.error // "unknown error"')"); continue; }
  results+=("$data")
done

if $JSON; then
  if [ \${#results[@]} -eq 1 ]; then
    echo "\${results[0]}" | jq '.'
  else
    printf '%s\\n' "\${results[@]}" | jq -s '.'
  fi
  for e in "\${errors[@]+"\${errors[@]}"}"; do
    echo "Error: $e" >&2
  done
  exit 0
fi

if [ \${#results[@]} -gt 0 ]; then
  if ! $QUIET; then
    status=$(_market_status 2>/dev/null) || status=$(_market_status 2>/dev/null || true)
    echo "Market: \${status} ($(date -u +'%H:%M UTC'))"
    echo ""

    if $DETAIL; then
      printf "%-7s  %-22s  %10s  %10s  %8s  %10s  %15s  %20s  %s\\n" \\
        "TICKER" "NAME" "PRICE" "CHANGE" "CHG%" "VOLUME" "DAY RANGE" "52W RANGE" "EXCHANGE"
    else
      printf "%-7s  %-22s  %10s  %10s  %8s  %10s\\n" \\
        "TICKER" "NAME" "PRICE" "CHANGE" "CHG%" "VOLUME"
    fi
  fi

  for data in "\${results[@]}"; do
    symbol=$(echo "$data" | jq -r '.symbol')
    name=$(echo "$data" | jq -r '.name // .symbol' | cut -c1-22)
    price=$(echo "$data" | jq -r '.price | . * 100 | round / 100')
    change=$(echo "$data" | jq -r '.change | . * 100 | round / 100')
    change_pct=$(echo "$data" | jq -r '.changePercent | . * 100 | round / 100')
    volume=$(echo "$data" | jq -r '.volume // 0')

    change_str=$(_sign "$change")
    pct_str=$(_sign "\${change_pct}%")
    vol_str=$(_fmt_vol "$volume")

    if $DETAIL; then
      day_low=$(echo "$data" | jq -r '.dayLow | . * 100 | round / 100')
      day_high=$(echo "$data" | jq -r '.dayHigh | . * 100 | round / 100')
      w52_low=$(echo "$data" | jq -r '.fiftyTwoWeekLow | . * 100 | round / 100')
      w52_high=$(echo "$data" | jq -r '.fiftyTwoWeekHigh | . * 100 | round / 100')
      exchange=$(echo "$data" | jq -r '.exchange // "-"')

      printf "%-7s  %-22s  %10s  %10s  %8s  %10s  %7s-%-7s  %9s-%-9s  %s\\n" \\
        "$symbol" "$name" "$price" "$change_str" "$pct_str" "$vol_str" \\
        "$day_low" "$day_high" "$w52_low" "$w52_high" "$exchange"
    else
      printf "%-7s  %-22s  %10s  %10s  %8s  %10s\\n" \\
        "$symbol" "$name" "$price" "$change_str" "$pct_str" "$vol_str"
    fi
  done
fi

for e in "\${errors[@]+"\${errors[@]}"}"; do
  echo "Error: $e" >&2
done

[ \${#errors[@]} -gt 0 ] && [ \${#results[@]} -eq 0 ] && exit 1
exit 0
`;
}
