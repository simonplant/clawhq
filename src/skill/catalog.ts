/**
 * Built-in skill catalog — discoverable skills that ship with ClawHQ.
 *
 * These are skill definitions that can be installed via `clawhq skill install <name>`
 * without needing a URL or local path. Each entry describes the skill's purpose,
 * required integrations, cron schedule, and tags for search.
 */

export interface BuiltinSkillEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  tags: string[];
  requiredIntegrations: string[];
  cronSchedule: string | null;
  /** Files that make up this skill: relative-path → content */
  files: Record<string, string>;
}

/**
 * Search the built-in catalog by query string.
 * Matches against id, name, description, and tags (case-insensitive).
 */
export function searchCatalog(query: string): BuiltinSkillEntry[] {
  const q = query.toLowerCase();
  return BUILTIN_SKILLS.filter((skill) => {
    const haystack = [
      skill.id,
      skill.name,
      skill.description,
      ...skill.tags,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

/**
 * Look up a single skill by exact id.
 */
export function findCatalogSkill(id: string): BuiltinSkillEntry | undefined {
  return BUILTIN_SKILLS.find((s) => s.id === id);
}

/**
 * All built-in skills available for installation.
 */
export const BUILTIN_SKILLS: BuiltinSkillEntry[] = [
  {
    id: "morning-brief",
    name: "Morning Brief",
    version: "1.0.0",
    description:
      "Daily briefing combining overdue/today tasks from Todoist with upcoming calendar events",
    tags: ["daily", "briefing", "tasks", "calendar", "email", "productivity"],
    requiredIntegrations: ["todoist", "ical"],
    cronSchedule: "0 7 * * *",
    files: {
      "SKILL.md": `---
name: morning-brief
version: "1.0.0"
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
    },
  },
  {
    id: "email-digest",
    name: "Email Digest",
    version: "1.0.0",
    description:
      "Summarizes unread emails by priority, flags urgent items, and drafts quick replies",
    tags: ["email", "triage", "inbox", "digest", "productivity"],
    requiredIntegrations: ["email"],
    cronSchedule: "0 7 * * *",
    files: {
      "SKILL.md": `---
name: email-digest
version: "1.0.0"
description: "Summarizes unread emails by priority, flags urgent items, and drafts quick replies. Use when: (1) morning inbox triage, (2) email summary requests. NOT for: sending emails or managing folders."
---

# Email Digest

Scans your inbox for unread messages, categorizes by priority (urgent / action-needed / FYI / newsletter), and produces a concise summary.

## Usage

\`\`\`bash
email-digest              # default: last 24 hours
email-digest --hours 48   # extend window
\`\`\`

## Dependencies

- \`email\` CLI (himalaya) + mail account credentials
`,
    },
  },
  {
    id: "meal-planning",
    name: "Meal Planning",
    version: "1.0.0",
    description:
      "Weekly meal planner with grocery list generation based on dietary preferences",
    tags: ["meals", "food", "grocery", "planning", "health", "cooking"],
    requiredIntegrations: [],
    cronSchedule: "0 9 * * 0",
    files: {
      "SKILL.md": `---
name: meal-planning
version: "1.0.0"
description: "Weekly meal planner with grocery list generation. Use when: (1) planning meals for the week, (2) generating grocery lists, (3) suggesting recipes based on preferences. NOT for: ordering food or restaurant reservations."
---

# Meal Planning

Generates a weekly meal plan based on dietary preferences, budget, and household size. Produces a consolidated grocery list.

## Usage

\`\`\`bash
meal-planning                    # plan for the upcoming week
meal-planning --days 3           # plan for fewer days
meal-planning --dietary vegan    # apply dietary filter
\`\`\`

## Dependencies

None (standalone skill, uses agent's reasoning only).
`,
    },
  },
  {
    id: "meeting-prep",
    name: "Meeting Prep",
    version: "1.0.0",
    description:
      "Prepares briefing notes for upcoming meetings using calendar events and recent emails",
    tags: ["meetings", "calendar", "prep", "briefing", "email", "work"],
    requiredIntegrations: ["ical", "email"],
    cronSchedule: null,
    files: {
      "SKILL.md": `---
name: meeting-prep
version: "1.0.0"
description: "Prepares briefing notes for upcoming meetings using calendar events and recent email threads with attendees. Use when: (1) preparing for a specific meeting, (2) daily meeting prep batch. NOT for: scheduling or rescheduling meetings."
---

# Meeting Prep

Pulls upcoming meetings from your calendar, finds recent email threads with attendees, and produces a briefing doc with context, open items, and suggested talking points.

## Usage

\`\`\`bash
meeting-prep                 # prep for next meeting
meeting-prep --all-today     # prep for all of today's meetings
\`\`\`

## Dependencies

- \`ical\` CLI + calendar credentials
- \`email\` CLI (himalaya) + mail account credentials
`,
    },
  },
  {
    id: "expense-tracking",
    name: "Expense Tracking",
    version: "1.0.0",
    description:
      "Logs expenses from natural language, categorizes spending, and generates weekly reports",
    tags: ["finance", "expenses", "budget", "money", "tracking", "reports"],
    requiredIntegrations: [],
    cronSchedule: "0 18 * * 5",
    files: {
      "SKILL.md": `---
name: expense-tracking
version: "1.0.0"
description: "Logs expenses from natural language, categorizes spending, and generates weekly/monthly reports. Use when: (1) logging an expense, (2) asking for spending reports, (3) budget check-ins. NOT for: making payments or bank transfers."
---

# Expense Tracking

Track expenses through natural language (\"spent $45 on groceries\"). Categorizes automatically, stores locally, and generates summary reports.

## Usage

\`\`\`bash
expense-track log "Coffee $4.50"          # log single expense
expense-track report --period week         # weekly summary
expense-track report --period month        # monthly summary
expense-track budget --category food 400   # set budget
\`\`\`

## Dependencies

- \`python3\` (for data storage/reporting scripts)
`,
      "scripts/expense-store.py": [
        '#!/usr/bin/env python3',
        '"""Simple JSON-file expense store."""',
        'import json, os, sys',
        'from datetime import datetime',
        '',
        'STORE = os.path.expanduser("~/.openclaw/workspace/data/expenses.json")',
        '',
        'def load():',
        '    os.makedirs(os.path.dirname(STORE), exist_ok=True)',
        '    if os.path.exists(STORE):',
        '        with open(STORE) as f:',
        '            return json.load(f)',
        '    return {"entries": [], "budgets": {}}',
        '',
        'def save(data):',
        '    with open(STORE, "w") as f:',
        '        json.dump(data, f, indent=2)',
        '',
        'if __name__ == "__main__":',
        '    if len(sys.argv) < 2:',
        '        print("Usage: expense-store.py <add|list|report>")',
        '        sys.exit(1)',
        '    cmd = sys.argv[1]',
        '    data = load()',
        '    if cmd == "list":',
        '        for e in data["entries"][-20:]:',
        '            print(f"{e[\'date\']}  {e[\'category\']:>12}  ${e[\'amount\']:>8.2f}  {e[\'description\']}")',
        '    elif cmd == "add":',
        '        entry = {"date": datetime.now().isoformat()[:10], "amount": float(sys.argv[2]),',
        '                 "category": sys.argv[3] if len(sys.argv) > 3 else "uncategorized",',
        '                 "description": " ".join(sys.argv[4:]) if len(sys.argv) > 4 else ""}',
        '        data["entries"].append(entry)',
        '        save(data)',
        '        print(f"Logged: ${entry[\'amount\']:.2f} ({entry[\'category\']})")',
      ].join("\n") + "\n",
    },
  },
  {
    id: "journaling",
    name: "Journaling",
    version: "1.0.0",
    description:
      "Guided daily journaling with prompts, mood tracking, and weekly reflection summaries",
    tags: [
      "journal",
      "writing",
      "reflection",
      "mood",
      "wellbeing",
      "daily",
    ],
    requiredIntegrations: [],
    cronSchedule: "0 21 * * *",
    files: {
      "SKILL.md": `---
name: journaling
version: "1.0.0"
description: "Guided daily journaling with prompts, mood tracking, and weekly reflections. Use when: (1) evening journal prompt, (2) weekly reflection request, (3) mood check-in. NOT for: diary reading or sharing entries."
---

# Journaling

Evening journaling companion. Offers tailored prompts based on the day's events, tracks mood over time, and generates weekly reflection summaries.

## Usage

\`\`\`bash
journal prompt             # get today's prompt
journal entry "text..."    # save an entry
journal mood 7             # log mood (1-10)
journal reflect --week     # weekly reflection
\`\`\`

## Dependencies

None (standalone skill).
`,
    },
  },
  {
    id: "workout-planning",
    name: "Workout Planning",
    version: "1.0.0",
    description:
      "Generates workout plans based on fitness goals, tracks sessions, and adapts over time",
    tags: [
      "fitness",
      "workout",
      "exercise",
      "health",
      "planning",
      "training",
    ],
    requiredIntegrations: [],
    cronSchedule: null,
    files: {
      "SKILL.md": `---
name: workout-planning
version: "1.0.0"
description: "Generates workout plans based on fitness goals, tracks completed sessions, and adapts difficulty over time. Use when: (1) requesting a workout plan, (2) logging a completed workout, (3) asking for progress reports. NOT for: medical advice."
---

# Workout Planning

Creates personalized workout plans based on goals (strength, cardio, flexibility), available equipment, and schedule. Logs completed sessions and adjusts difficulty.

## Usage

\`\`\`bash
workout plan --goal strength --days 4     # weekly plan
workout log "bench press 3x8 @135lb"      # log session
workout progress --weeks 4                 # progress report
\`\`\`

## Dependencies

None (standalone skill).
`,
    },
  },
  {
    id: "research-brief",
    name: "Research Brief",
    version: "1.0.0",
    description:
      "Deep web research on a topic with source citations and summary synthesis",
    tags: ["research", "web", "search", "summary", "citations", "learning"],
    requiredIntegrations: ["research"],
    cronSchedule: null,
    files: {
      "SKILL.md": `---
name: research-brief
version: "1.0.0"
description: "Deep web research on a topic with source citations and summary synthesis. Use when: (1) researching a topic in depth, (2) compiling sources on a subject, (3) fact-checking claims. NOT for: casual web searches or quick lookups."
---

# Research Brief

Conducts multi-source web research using Tavily, synthesizes findings, and produces a structured brief with citations.

## Usage

\`\`\`bash
research-brief "impact of AI on healthcare diagnostics"
research-brief --depth deep "quantum computing timeline"
\`\`\`

## Dependencies

- \`tavily\` CLI + \`TAVILY_API_KEY\` env var
`,
    },
  },
  {
    id: "task-review",
    name: "Task Review",
    version: "1.0.0",
    description:
      "Reviews overdue and upcoming tasks, suggests reprioritization, and flags blockers",
    tags: ["tasks", "review", "productivity", "prioritization", "todoist"],
    requiredIntegrations: ["todoist"],
    cronSchedule: "0 17 * * 5",
    files: {
      "SKILL.md": `---
name: task-review
version: "1.0.0"
description: "Reviews overdue and upcoming tasks, suggests reprioritization, and flags potential blockers. Use when: (1) weekly task review, (2) checking for overdue items, (3) reprioritization request. NOT for: creating or completing tasks."
---

# Task Review

Weekly task review that identifies overdue items, upcoming deadlines, stale tasks, and suggests reprioritization based on urgency and importance.

## Usage

\`\`\`bash
task-review                     # full review
task-review --overdue-only      # just overdue items
task-review --next-week         # preview next week
\`\`\`

## Dependencies

- \`todoist\` CLI + \`TODOIST_API_KEY\` env var
`,
    },
  },
  {
    id: "focus-block",
    name: "Focus Block",
    version: "1.0.0",
    description:
      "Protects deep work time by analyzing calendar and suggesting optimal focus blocks",
    tags: [
      "focus",
      "calendar",
      "productivity",
      "deep-work",
      "time-management",
    ],
    requiredIntegrations: ["ical"],
    cronSchedule: "0 8 * * 1",
    files: {
      "SKILL.md": `---
name: focus-block
version: "1.0.0"
description: "Analyzes your calendar to find and protect deep work time. Use when: (1) planning focus blocks for the week, (2) checking if a time slot is safe to protect, (3) reviewing focus time stats. NOT for: scheduling meetings or modifying calendar events."
---

# Focus Block

Scans your calendar for the week, identifies gaps between meetings, and suggests optimal focus blocks. Tracks how much deep work time you actually get.

## Usage

\`\`\`bash
focus-block plan                    # suggest blocks for this week
focus-block stats --weeks 4         # focus time report
\`\`\`

## Dependencies

- \`ical\` CLI + calendar credentials
`,
    },
  },
  {
    id: "construct",
    name: "Construct",
    version: "1.0.0",
    description:
      "Self-improvement framework — assess capabilities, propose new skills, build and deploy them",
    tags: [
      "meta",
      "self-improvement",
      "skill-building",
      "automation",
      "construct",
    ],
    requiredIntegrations: [],
    cronSchedule: "0 2 * * *",
    files: {
      "SKILL.md": `---
name: construct
version: "1.0.0"
description: "Self-improvement framework for capability acquisition. Use when: (1) 'construct' or 'build a skill for X', (2) 'learn how to use X', (3) 'construct assess/build/run'. NOT for: one-off tasks that don't need a reusable skill."
---

# Construct

Framework for the agent to assess its own capabilities, identify gaps, propose new skills, and build them through a structured pipeline: assess -> propose -> build -> deploy.

## Usage

\`\`\`bash
construct assess              # evaluate current capabilities
construct propose <gap>       # propose a skill for a gap
construct build <proposal>    # build the proposed skill
construct deploy <skill>      # activate the built skill
\`\`\`

## Dependencies

None (meta-skill, uses agent reasoning).
`,
    },
  },
  {
    id: "weekly-report",
    name: "Weekly Report",
    version: "1.0.0",
    description:
      "Compiles a weekly activity report from tasks completed, meetings attended, and emails sent",
    tags: ["report", "weekly", "summary", "productivity", "review"],
    requiredIntegrations: ["todoist", "ical"],
    cronSchedule: "0 17 * * 5",
    files: {
      "SKILL.md": `---
name: weekly-report
version: "1.0.0"
description: "Compiles a weekly activity report from tasks completed, meetings attended, and notable emails. Use when: (1) end-of-week summary, (2) preparing status updates. NOT for: real-time status or daily digests."
---

# Weekly Report

Generates a structured weekly report covering: tasks completed, meetings attended, key decisions made, and priorities for next week.

## Usage

\`\`\`bash
weekly-report                        # this week
weekly-report --week 2026-W11        # specific week
\`\`\`

## Dependencies

- \`todoist\` CLI + \`TODOIST_API_KEY\` env var
- \`ical\` CLI + calendar credentials
`,
    },
  },
];
