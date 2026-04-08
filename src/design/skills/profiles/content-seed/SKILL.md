# content-seed

Weekly content idea generation skill for Marketing profiles. Scans configured interests, trending topics, and recent content performance to produce a ranked list of content ideas — ready for the user to select, refine, and schedule.

## Behavior

1. Review interests — Read the user's configured interest topics and content themes from memory and blueprint customization.
2. Scan trends — Use the web-search tool to identify trending topics, conversations, and news within each interest area.
3. Cross-reference calendar — Check the content calendar (if configured) for upcoming events, holidays, or seasonal hooks that align with the user's niche.
4. Generate ideas — Produce 5-10 content ideas, each with a working title, angle, target platform (blog, social, newsletter), and a one-sentence hook.
5. Rank by relevance — Score each idea on timeliness, audience alignment, and effort required. Surface the top 3-5 as recommendations.
6. Queue for review — Deliver the ranked idea list via the messaging channel for user selection. Nothing is drafted or scheduled without approval.

## Boundaries

- No publishing. This skill generates ideas only. It never posts, schedules, or drafts content without explicit user action.
- No account access. The skill does not connect to social media accounts, analytics platforms, or publishing tools directly.
- Minimal external requests. Only the web-search tool is used for trend scanning. No other network calls.
- Approval required. The idea list is informational. The user decides which ideas to pursue.

## Schedule

Runs once weekly (default: Monday morning) via cron, as configured in the blueprint. Can also be triggered on demand.

## Execution

This is a declarative skill. The cron scheduler triggers the agent with "Run skill: content-seed". The agent reads this SKILL.md for behavior definitions and generates content ideas based on the user's configured interests.

## Model Requirements

- Provider: Local Ollama preferred (cloud escalation configurable per blueprint)
- Minimum model: llama3:8b or equivalent
- Cloud escalation: optional — blueprints may allow cloud for higher quality trend analysis
