# auto-reply

Writes email replies in the user's voice with approval gates.

## What It Does

- Reads incoming emails flagged by `email-digest` as reply-candidates
- Drafts replies matching the user's tone and communication style
- Presents drafts for approval before sending (always, except routine confirmations)
- Never replies to first-contact or unknown senders without approval
- Calendar-aware: checks availability before confirming meeting times

## Autonomy Levels

| Level | What auto-sends |
|-------|----------------|
| `none` | Everything queued for approval |
| `routine-only` | Meeting confirmations, read receipts, unsubscribes |
| `medium` | Routine + simple acknowledgments from known contacts |
| `high` | Most replies from contacts list; flags unknowns |

Set via blueprint `auto_reply_comfort` customization question.

## Hard Limits

- **Never** auto-sends to first-contact (sender not in contacts)
- **Never** auto-sends if email contains financial, legal, or medical content
- **Never** fabricates facts, dates, or commitments
- **Always** uses calendar to verify availability before confirming meetings

## Tools Required

- `email` — read, draft, send
- `contacts` — trust boundary (known vs unknown senders)

## Configuration

See `config.yaml` for full options. Key fields:
- `auto_approve_categories` — what can be sent without user review
- `never_auto_approve` — hard overrides (never auto-send these)
- `voice_profile` — populated from blueprint personality (tone, directness, warmth)
