# weekly-review

Weekly Stoic review. Surfaces patterns from the week's journal entries — commitments made vs honored, recurring obstacles, and growth edges. Inspired by Seneca's practice of weekly self-examination.

## Behavior

1. Gather entries — Read all journal entries from the past 7 days: `journal list --days 7`
2. Analyze commitments — Count morning intentions vs evening reflections that report follow-through. Calculate commitment-to-completion ratio.
3. Identify patterns — Find recurring themes: times of day when commitments break down, types of commitments kept vs abandoned, common rationalizations.
4. Compose review — Deliver a concise, structured review: ratio, patterns, one pointed question for the week ahead.
5. Log review — Write the review summary to the journal: `journal add --tag weekly-review "<review>"`

## Boundaries

- Read-only analysis. The review reads journal history and produces a summary. It does not modify prior entries.
- Private. All analysis runs locally. No cloud API calls unless cloud escalation is configured.
- Not prescriptive. The review surfaces patterns and asks questions. It does not assign homework or set goals unless the user asks.

## Schedule

Runs once weekly on Sunday morning (default: 09:00). The cron triggers the agent with "Run skill: weekly-review".

## Execution

This is a declarative skill. The cron scheduler triggers the agent. The agent reads this SKILL.md for behavior definitions and loads the prompt template from prompts/.

### Prompts

- prompts/review.md — Weekly review composition prompt template
