# news-scanner

Interest-based news aggregation skill. Scans configured sources twice daily, deduplicates results, filters ruthlessly for signal over noise, and delivers only items the user would genuinely stop for. Silent when nothing clears the bar.

## Behavior

1. Load interests — Read the user's interest graph (topics, sources, priorities) from the workspace.
2. Scan sources — Query configured news sources (RSS, web-search) for recent items matching interests.
3. Sanitize — All external content passes through ClawWall (sanitize tool) before processing.
4. Deduplicate — Skip items already seen in the last 48 hours.
5. Filter — Apply the signal test: is this actionable, specific, from a source with skin in the game? If not, discard.
6. Deliver — Send a concise digest via the messaging channel. If nothing clears the bar, stay silent.

## Boundaries

- Read-only. No modifications to email, tasks, or calendar.
- All external content sanitized through ClawWall before any processing.
- No storing raw external content in memory files — store summaries only.
- Silent when nothing warrants attention. No padding with low-signal items.

## Schedule

Twice daily: morning (07:30) and afternoon (15:00) via blueprint cron config.

## Execution

Declarative skill. Trigger: "Run skill: news-scanner". Load this SKILL.md, execute prompts in sequence.

### Prompts

- prompts/scan.md — Source scanning and deduplication prompt
- prompts/filter.md — Signal filtering and digest composition prompt

## Model Requirements

- Provider: Local Ollama preferred; cloud opt-in for quality-sensitive summaries
- Minimum model: llama3:8b or equivalent
