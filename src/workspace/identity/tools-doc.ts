/**
 * TOOLS.md generator — auto-generates from installed CLI tools.
 */

import type { CronJobDefinition } from "../../config/schema.js";
import type { WizardAnswers } from "../../init/types.js";

export function generateToolsMd(
  answers: WizardAnswers,
  enabledTools: string[],
  cronJobs: CronJobDefinition[],
): string {
  const sections: string[] = [
    "# TOOLS.md — Agent Toolbelt",
    "",
    "> **Path warning:** `~` and `~/workspace/` don't expand reliably in exec. Always use full paths starting with `/home/node/.openclaw/workspace/`.",
    "",
    "---",
    "",
    "## Core Tools",
    "",
  ];

  // Document each enabled tool
  const toolDocs: Record<string, string[]> = {
    tasks: [
      "### tasks — Local Work Queue",
      "- Agent's own execution queue",
      "- `tasks next` — highest-priority actionable task",
      "- `tasks list [--channel X] [--autonomy do|do-tell|flag]`",
      "- `tasks add \"Title\" --channel X --autonomy do --priority 2`",
      "- `tasks done <id>` | `tasks block <id>` | `tasks flag <id>`",
      "- `tasks notify <id>` — stamp notified_at (4h cooldown for heartbeat dedup)",
      "- `tasks flaggable` — flag items NOT notified in last 4h",
      "- `tasks channels` — overview with counts",
      "- `tasks clean 7` — purge completed tasks >7 days old",
    ],
    email: [
      "### email — Email CLI",
      "- Wraps `himalaya` with clean UX",
      "- `email inbox` — unread only | `email all` — all recent | `email read <id>` | `email mark-read <id>` | `email delete <id>`",
      "- `email send <to> <subject>` | `email reply <id>` | `email search <query>`",
    ],
    todoist: [
      "### todoist — User's Tasks",
      "- `todoist today` | `todoist list` | `todoist projects`",
      "- `todoist add` / `todoist complete` — only when user asks",
      "- Priority: 4=high 3=medium 2=low 1=none",
    ],
    ical: [
      "### ical — Calendar",
      "- `ical today` | `ical events 7`",
      "- `ical create --title \"Meeting\" --start \"2026-03-10 14:00\" --end \"2026-03-10 15:00\"`",
      "- `ical calendars` | `ical delete <url>`",
    ],
    quote: [
      "### quote — Market Quotes",
      "- `quote AAPL MSFT` | `quote --detail QQQ` | `quote --json AAPL`",
      "- `quote --watch AAPL:200:300` — exits 2 if outside range",
      "- `quote --hours` — market status",
      "- No API key (Yahoo Finance, ~15min delay)",
    ],
    tavily: [
      "### tavily — Web Research",
      "- `tavily search \"query\"` | `tavily deep \"query\"` | `tavily news \"query\"`",
    ],
  };

  for (const tool of enabledTools) {
    if (tool === "todoist-sync") continue; // documented separately
    const docs = toolDocs[tool];
    if (docs) {
      sections.push(...docs, "");
    }
  }

  // Cron plumbing section
  if (enabledTools.includes("todoist-sync")) {
    sections.push(
      "---",
      "",
      "## Cron Plumbing (don't call manually)",
      "",
      "- **todoist-sync** — `todoist-sync poll` / `todoist-sync check` — used by heartbeat cron",
      "",
    );
  }

  // Skills section
  if (answers.template.skillsIncluded.length > 0) {
    sections.push(
      "---",
      "",
      "## Skills",
      "",
    );

    if (answers.template.skillsIncluded.includes("construct")) {
      sections.push(
        "- **construct** — self-improvement cycle: assess → propose → build → deploy",
      );
    }
    if (answers.template.skillsIncluded.includes("morning-brief")) {
      sections.push(
        "- **morning-brief** — daily briefing (tasks + calendar)",
      );
    }
    sections.push("");
  }

  // Cron schedule
  if (cronJobs.length > 0) {
    sections.push(
      "---",
      "",
      `## Cron Schedule (${cronJobs.length} jobs)`,
      "",
      "| Job | Schedule | What |",
      "|-----|----------|------|",
    );

    for (const job of cronJobs) {
      const schedule = job.kind === "cron" ? job.expr ?? "" : `every ${(job.everyMs ?? 0) / 1000}s`;
      sections.push(`| ${job.id} | ${schedule} | ${job.task} |`);
    }
    sections.push("");
  }

  // System binaries
  sections.push(
    "---",
    "",
    "## System Binaries",
    "",
    "- **git**, **curl**, **jq**, **rg**, **ffmpeg**, **python3**, **openssl** — baked into image",
    "",
  );

  return sections.join("\n");
}
