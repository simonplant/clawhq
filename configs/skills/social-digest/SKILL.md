# social-digest

Social monitoring skill. Scans configured social accounts and interest-tagged content for genuine signal — not engagement bait, not trend aggregation. Surfaces mentions, responses to the user, and posts from specific tracked accounts worth reading. Silent otherwise.

## Behavior

1. Scan mentions — Check for direct mentions, replies, and DMs requiring response.
2. Scan tracked accounts — Pull recent posts from explicitly tracked accounts (configured in interests).
3. Sanitize — ALL social content passes through ClawWall before processing.
4. Filter — Apply signal test: is this genuine, specific, worth the user's time?
5. Deliver — Concise digest via messaging channel. Silent if nothing clears the bar.

## Boundaries

- Read-only. Never posts, likes, or replies autonomously.
- All content ClawWall-sanitized — social platforms are highest-risk injection vectors.
- Never surfaces content based on algorithmic popularity — only explicit interest graph.
- Silence is default. The digest runs when there's something worth reading.

## Schedule

Twice daily: 8:00 AM and 5:00 PM.

## Execution

Declarative skill. Trigger: "Run skill: social-digest". Load this SKILL.md, execute prompts.

### Prompts

- prompts/scan.md — Mention and account scan with signal filtering

## Model Requirements

- Provider: Local Ollama preferred
- Minimum model: llama3:8b
