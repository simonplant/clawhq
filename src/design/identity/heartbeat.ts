/**
 * HEARTBEAT.md generator — auto-populates recon phases from enabled integrations.
 */

import type { WizardAnswers } from "../configure/types.js";

export function generateHeartbeatMd(answers: WizardAnswers): string {
  const { basics, template } = answers;
  const enabledCategories = new Set(
    answers.integrations
      .filter((i) => i.credential)
      .map((i) => i.category),
  );
  const checks = template.monitoring.checks;

  const sections: string[] = [
    `# HEARTBEAT.md — Unified ${template.monitoring.heartbeatFrequency} Cycle`,
    "",
    `Every ${template.monitoring.heartbeatFrequency} during waking hours (${basics.wakingHoursStart}–${basics.wakingHoursEnd} ${basics.timezone}). Recon inputs, do quick wins, flag what matters.`,
    "",
    "---",
    "",
    "## Phase 1: RECON — Scan inputs, generate tasks",
    "",
  ];

  // Email recon
  if (enabledCategories.has("email") || checks.includes("email")) {
    sections.push(
      "### Email",
      "- `email inbox` — unread emails",
      "- `email read <id>` — read important ones",
      "- `email mark-read <id>` — mark as seen",
      "- Skip spam, newsletters, routine system emails.",
      "- Reply if within scope. Delete after reading per policy.",
      "- Anything requiring follow-up → `tasks add \"...\" --channel pa --autonomy do-tell`",
      "",
    );
  }

  // Tasks/Todoist recon
  if (enabledCategories.has("tasks") || checks.includes("tasks")) {
    sections.push(
      "### Tasks (Todoist)",
      "- `todoist-sync poll` — detect new/completed/changed tasks",
      "- `todoist-sync check` — alert on overdue tasks (has built-in cooldown)",
      "- Forward any alerts to the user.",
      "",
    );
  }

  // Calendar recon
  if (enabledCategories.has("calendar") || checks.includes("calendar")) {
    sections.push(
      "### Calendar",
      "- `ical today` — flag anything <2h away",
      "- `ical events 2` — upcoming 2 days for context",
      "",
    );
  }

  // Markets recon
  if (checks.includes("markets")) {
    sections.push(
      "### Markets (Mon–Fri only)",
      "",
      "**Pre-market / Futures:**",
      "1. `quote ES=F NQ=F YM=F RTY=F` — US Futures",
      "2. `quote QQQ SPY` — Key indices",
      "3. Check positions/watchlist from trading logs",
      "",
      "**Regular session:**",
      "- `quote --watch TICKER:LOW:HIGH` — notify ONLY if triggered (exit code 2)",
      "- Do NOT report unless a watch level triggers.",
      "",
      "**After-hours:**",
      "- Quote active positions silently — flag ONLY moves >5%",
      "",
      "Skip markets entirely on weekends.",
      "",
    );
  }

  // Research recon
  if (checks.includes("research")) {
    sections.push(
      "### Research",
      "- `tavily news \"<relevant topic>\"` — check for breaking news if relevant",
      "",
    );
  }

  sections.push(
    "### Discovered items → local task queue",
    "Anything found during recon that needs action:",
    "```",
    "tasks add \"Reply to email from X\" --channel pa --autonomy do-tell --priority 2",
    "tasks add \"Review PR #12\" --channel developer --autonomy do --priority 2",
    "```",
    "",
    "---",
    "",
    "## Phase 2: EXECUTE — Quick wins only",
    "",
    "- `tasks next` — any task completable in <5 min? Do it now.",
    "- `tasks done <id> --notes \"what you did\"`",
    "- Leave bigger items for the work-session.",
    "",
    "---",
    "",
    "## Phase 3: FLAG — Surface what needs the user (with dedup)",
    "",
    "- `tasks flaggable` — shows flag items NOT already notified in the last 4 hours.",
    "- After flagging an item, run `tasks notify <id>` to set the cooldown.",
  );

  if (enabledCategories.has("tasks")) {
    sections.push(
      "- `todoist-sync check` alerts — forward overdue items (has its own built-in cooldown).",
    );
  }

  sections.push(
    "",
    "---",
    "",
    "## When to Message vs Stay Silent",
    "",
    "**Message ONLY if one of these is true:**",
  );

  if (enabledCategories.has("email")) {
    sections.push("- A NEW email arrived that requires attention or your reply");
  }
  if (enabledCategories.has("tasks")) {
    sections.push("- A Todoist task is OVERDUE");
  }
  if (enabledCategories.has("calendar")) {
    sections.push("- A calendar event is <2 hours away and hasn't been flagged before");
  }
  if (checks.includes("markets")) {
    sections.push("- A market alert triggered (price hit a watch level)");
  }
  sections.push(
    "- You completed a task the user should know about",
    "- A flag item needs user input",
    "",
    "## If Nothing Actionable",
    "",
    "Respond with ONLY the text: HEARTBEAT_OK",
    "",
    "Do NOT summarize what you checked. Do NOT report \"all clear\". Just HEARTBEAT_OK.",
    "",
  );

  return sections.join("\n");
}
