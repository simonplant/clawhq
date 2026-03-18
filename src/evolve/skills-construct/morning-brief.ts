/**
 * Morning brief skill generator.
 *
 * Daily briefing combining Todoist tasks + iCal calendar.
 * Depends on: todoist + ical integrations.
 */

export function generateMorningBriefSkill(): Record<string, string> {
  return {
    "SKILL.md": `---
name: morning-brief
description: "Daily briefing combining overdue/today tasks from Todoist with upcoming calendar events. Use when: (1) delivering the daily morning brief, (2) summarizing today's schedule and priorities. NOT for: mid-day status updates or individual task queries."
---

# Morning Brief

Daily briefing delivered at the configured morning brief time. Combines overdue/today tasks from Todoist with upcoming calendar events.

## Usage

\`\`\`bash
morning-brief          # today + tomorrow (default)
morning-brief --days 3 # extend lookahead
\`\`\`

## Output format

\`\`\`
Morning Brief — Monday, March 9

Tasks for today:
[high] Rebook flights to UK
[high] Help with company setup
[medium] Groceries restock

Calendar:
Today 10:00am — DMV appointment @ 4000 Calle Real
Tomorrow all day — Vet checkup
\`\`\`

## Dependencies

- \`todoist\` CLI + \`TODOIST_API_KEY\` env var
- \`ical\` CLI + \`ICAL_USER\`/\`ICAL_PASS\`/\`ICAL_SERVER\` env vars
- \`jq\`, \`python3\`, \`curl\`
`,
  };
}
