/**
 * iCal CLI tool generator.
 *
 * Generates a CalDAV client for iCloud/Google Calendar via curl.
 * Integration: calendar → requires ICAL_USER, ICAL_PASS, ICAL_SERVER.
 */

export function generateIcalTool(): string {
  return `#!/bin/bash
# ical — Calendar CLI via CalDAV
# Usage: ical <command> [args]
#
# Commands:
#   discover          — find calendar URLs
#   calendars         — list all calendars
#   events [N]        — list events for next N days (default 7)
#   today             — list today's events
#   create <args>     — create an event
#   delete <url>      — delete an event by URL
#
# Create args:
#   --title "Meeting"
#   --date 2026-03-10            (all-day event)
#   --start "2026-03-10 14:00"   (timed event)
#   --end "2026-03-10 15:00"
#   --location "Office"
#   --description "Notes"
#   --invite "email@example.com" (can repeat)

set -euo pipefail

ICAL_USER="\${ICAL_USER:?ICAL_USER env var required}"
ICAL_PASS="\${ICAL_PASS:?ICAL_PASS env var required}"
ICAL_SERVER="\${ICAL_SERVER:?ICAL_SERVER env var required}"
ICAL_CACHE="\${HOME}/.openclaw/workspace/.ical_cache"

_curl() {
  curl --silent --user "\${ICAL_USER}:\${ICAL_PASS}" "$@"
}

cmd_discover() {
  echo "Discovering CalDAV principal..."
  local resp
  resp=$(_curl -X PROPFIND \\
    -H "Depth: 0" \\
    -H "Content-Type: application/xml; charset=utf-8" \\
    -d '<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:current-user-principal/>
  </d:prop>
</d:propfind>' \\
    "https://\${ICAL_SERVER}/")

  local principal server_prefix
  read -r principal server_prefix < <(echo "$resp" | python3 -c "
import sys, xml.etree.ElementTree as ET
tree = ET.parse(sys.stdin)
for href in tree.iter('{DAV:}href'):
    if href.text and href.text != '/' and 'principal' in href.text:
        print(href.text, end=' ')
        break
print('https://\${ICAL_SERVER}')
")

  if [ -z "$principal" ]; then
    echo "Error: Could not find principal URL" >&2
    return 1
  fi

  local redirect_url
  redirect_url=$(curl --silent --user "\${ICAL_USER}:\${ICAL_PASS}" -o /dev/null -w '%{redirect_url}' \\
    -X PROPFIND -H "Depth: 0" -H "Content-Type: application/xml; charset=utf-8" \\
    -d '<?xml version="1.0" encoding="UTF-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>' \\
    "https://\${ICAL_SERVER}\${principal}")

  if [ -n "$redirect_url" ]; then
    server_prefix=$(echo "$redirect_url" | grep -oP 'https://[^/]+')
  else
    server_prefix="https://\${ICAL_SERVER}"
  fi

  echo "Principal: \${server_prefix}\${principal}"

  resp=$(_curl -L -X PROPFIND \\
    -H "Depth: 0" \\
    -H "Content-Type: application/xml; charset=utf-8" \\
    -d '<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-home-set/>
  </d:prop>
</d:propfind>' \\
    "\${server_prefix}\${principal}")

  local cal_home_raw
  cal_home_raw=$(echo "$resp" | python3 -c "
import sys, xml.etree.ElementTree as ET
tree = ET.parse(sys.stdin)
for href in tree.iter('{DAV:}href'):
    if href.text and 'calendars' in href.text:
        print(href.text)
        break
")

  if [ -z "$cal_home_raw" ]; then
    echo "Error: Could not find calendar home" >&2
    return 1
  fi

  local cal_home
  if [[ "$cal_home_raw" == https://* ]]; then
    server_prefix=$(echo "$cal_home_raw" | grep -oP 'https://[^/]+')
    cal_home=$(echo "$cal_home_raw" | sed "s|\${server_prefix}||")
  else
    cal_home="$cal_home_raw"
  fi

  echo "Calendar home: \${server_prefix}\${cal_home}"
  mkdir -p "$(dirname "$ICAL_CACHE")"
  echo "SERVER_PREFIX=\${server_prefix}" > "$ICAL_CACHE"
  echo "CAL_HOME=\${cal_home}" >> "$ICAL_CACHE"
  echo "Cached to \${ICAL_CACHE}"
}

_load_cache() {
  if [ ! -f "$ICAL_CACHE" ]; then
    echo "No cached config. Run: ical discover" >&2
    return 1
  fi
  source "$ICAL_CACHE"
}

cmd_calendars() {
  _load_cache
  local resp
  resp=$(_curl -X PROPFIND \\
    -H "Depth: 1" \\
    -H "Content-Type: application/xml; charset=utf-8" \\
    -d '<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:x="http://apple.com/ns/ical/">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <x:calendar-color/>
  </d:prop>
</d:propfind>' \\
    "\${SERVER_PREFIX}\${CAL_HOME}")

  echo "$resp" | python3 -c "
import sys, xml.etree.ElementTree as ET
tree = ET.parse(sys.stdin)
for resp in tree.findall('.//{DAV:}response'):
    href = resp.find('{DAV:}href')
    name = resp.find('.//{DAV:}displayname')
    cal = resp.find('.//{DAV:}resourcetype/{urn:ietf:params:xml:ns:caldav}calendar')
    if cal is not None and name is not None:
        print(f'{name.text}: {href.text}')
"
}

cmd_events() {
  _load_cache
  local days="\${1:-7}"
  local start end
  start=$(date -u +%Y%m%dT000000Z)
  end=$(date -u -d "+\${days} days" +%Y%m%dT235959Z)

  local cal_resp
  cal_resp=$(_curl -X PROPFIND \\
    -H "Depth: 1" \\
    -H "Content-Type: application/xml; charset=utf-8" \\
    -d '<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>' \\
    "\${SERVER_PREFIX}\${CAL_HOME}")

  local cal_urls
  cal_urls=$(echo "$cal_resp" | python3 -c "
import sys, xml.etree.ElementTree as ET
tree = ET.parse(sys.stdin)
for resp in tree.findall('.//{DAV:}response'):
    href = resp.find('{DAV:}href')
    cal = resp.find('.//{DAV:}resourcetype/{urn:ietf:params:xml:ns:caldav}calendar')
    if cal is not None and href is not None:
        print(href.text)
")

  for cal_url in $cal_urls; do
    local resp
    resp=$(_curl -X REPORT \\
      -H "Depth: 1" \\
      -H "Content-Type: application/xml; charset=utf-8" \\
      -d "<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?>
<c:calendar-query xmlns:d=\\"DAV:\\" xmlns:c=\\"urn:ietf:params:xml:ns:caldav\\">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name=\\"VCALENDAR\\">
      <c:comp-filter name=\\"VEVENT\\">
        <c:time-range start=\\"\${start}\\" end=\\"\${end}\\"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>" \\
      "\${SERVER_PREFIX}\${cal_url}" 2>/dev/null) || continue

    echo "$resp" | python3 -c "
import sys, xml.etree.ElementTree as ET, re
try:
    tree = ET.parse(sys.stdin)
except:
    sys.exit(0)
for resp in tree.findall('.//{DAV:}response'):
    href = resp.find('{DAV:}href')
    caldata = resp.find('.//{urn:ietf:params:xml:ns:caldav}calendar-data')
    if caldata is not None and caldata.text:
        text = caldata.text
        summary = re.search(r'SUMMARY:(.*)', text)
        dtstart = re.search(r'DTSTART[^:]*:(.*)', text)
        dtend = re.search(r'DTEND[^:]*:(.*)', text)
        location = re.search(r'LOCATION:(.*)', text)
        s = summary.group(1).strip() if summary else '(no title)'
        ds = dtstart.group(1).strip() if dtstart else '?'
        de = dtend.group(1).strip() if dtend else ''
        loc = location.group(1).strip() if location else ''
        url = href.text if href is not None else ''
        parts = [f'{ds}', f'{s}']
        if de: parts.append(f'-> {de}')
        if loc: parts.append(f'@ {loc}')
        parts.append(f'[{url}]')
        print(' | '.join(parts))
" 2>/dev/null
  done | sort
}

cmd_today() {
  cmd_events 1
}

cmd_create() {
  _load_cache
  local title="" date="" start="" end="" location="" description="" calendar=""
  local -a invitees=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --title) title="$2"; shift 2;;
      --date) date="$2"; shift 2;;
      --start) start="$2"; shift 2;;
      --end) end="$2"; shift 2;;
      --location) location="$2"; shift 2;;
      --description) description="$2"; shift 2;;
      --calendar) calendar="$2"; shift 2;;
      --invite) invitees+=("$2"); shift 2;;
      *) echo "Unknown arg: $1" >&2; return 1;;
    esac
  done

  if [ -z "$title" ]; then
    echo "Error: --title is required" >&2
    return 1
  fi

  local uid
  uid="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || date +%s)-ical@agent"
  local now
  now=$(date -u +%Y%m%dT%H%M%SZ)

  local dtstart_line dtend_line
  if [ -n "$date" ]; then
    local ds de
    ds=$(date -d "$date" +%Y%m%d)
    de=$(date -d "$date + 1 day" +%Y%m%d)
    dtstart_line="DTSTART;VALUE=DATE:\${ds}"
    dtend_line="DTEND;VALUE=DATE:\${de}"
  elif [ -n "$start" ]; then
    dtstart_line="DTSTART:$(date -u -d "$start" +%Y%m%dT%H%M%SZ)"
    if [ -n "$end" ]; then
      dtend_line="DTEND:$(date -u -d "$end" +%Y%m%dT%H%M%SZ)"
    else
      dtend_line="DTEND:$(date -u -d "$start + 1 hour" +%Y%m%dT%H%M%SZ)"
    fi
  else
    echo "Error: --date or --start is required" >&2
    return 1
  fi

  if [ -z "$calendar" ]; then
    calendar=$(_curl -X PROPFIND \\
      -H "Depth: 1" \\
      -H "Content-Type: application/xml; charset=utf-8" \\
      -d '<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:resourcetype/></d:prop>
</d:propfind>' \\
      "\${SERVER_PREFIX}\${CAL_HOME}" | python3 -c "
import sys, xml.etree.ElementTree as ET
tree = ET.parse(sys.stdin)
for resp in tree.findall('.//{DAV:}response'):
    href = resp.find('{DAV:}href')
    cal = resp.find('.//{DAV:}resourcetype/{urn:ietf:params:xml:ns:caldav}calendar')
    if cal is not None and href is not None:
        print(href.text)
        break
")
  fi

  local ics="BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//ClawHQ//iCal//EN
BEGIN:VEVENT
UID:\${uid}
DTSTAMP:\${now}
\${dtstart_line}
\${dtend_line}
SUMMARY:\${title}"

  [ -n "$location" ] && ics="\${ics}
LOCATION:\${location}"
  [ -n "$description" ] && ics="\${ics}
DESCRIPTION:\${description}"

  for email in "\${invitees[@]}"; do
    ics="\${ics}
ATTENDEE;RSVP=TRUE;ROLE=REQ-PARTICIPANT:mailto:\${email}"
  done

  ics="\${ics}
ORGANIZER:mailto:\${ICAL_USER}
END:VEVENT
END:VCALENDAR"

  local event_url="\${SERVER_PREFIX}\${calendar}\${uid}.ics"

  _curl -X PUT \\
    -H "Content-Type: text/calendar; charset=utf-8" \\
    --data-binary "$ics" \\
    "$event_url"

  echo "Event created: \${title}"
  echo "URL: \${event_url}"
}

cmd_delete() {
  local url="$1"
  if [ -z "$url" ]; then
    echo "Usage: ical delete <event-url>" >&2
    return 1
  fi
  _load_cache
  if [[ "$url" == /* ]]; then
    url="\${SERVER_PREFIX}\${url}"
  fi
  _curl -X DELETE "$url"
  echo "Event deleted."
}

case "\${1:-help}" in
  discover)   cmd_discover;;
  calendars)  cmd_calendars;;
  events)     shift; cmd_events "$@";;
  today)      cmd_today;;
  create)     shift; cmd_create "$@";;
  delete)     shift; cmd_delete "$@";;
  help|*)
    sed -n '2,16p' "$0" | sed 's/^# \\?//'
    ;;
esac
`;
}
