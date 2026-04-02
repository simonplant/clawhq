# auto-reply

Routine email reply skill. Handles pre-approved categories of email replies autonomously — appointment confirmations, vendor acknowledgements, unsubscribes. Drafts in the user's voice. Always approval-gated before sending.

## Behavior

1. Scan inbox — Identify emails that match delegated reply categories.
2. Classify — Determine which category applies (appointment-confirm, vendor-reply, unsubscribe).
3. Draft — Compose a reply in the user's voice, matching the tone and brevity appropriate for the category.
4. Gate — Present the draft for approval. Never send autonomously.
5. Send — Once approved, send via the email tool with the delegated category flag.

## Boundaries

- Approval required before every send. Auto-send is never enabled for this skill.
- Only handles pre-approved delegated categories. Never initiates new conversations.
- Never commits to spending, new services, or obligations.
- Never replies to automated/noreply senders.

## Delegated Categories

- `appointment-confirm` — Appointments, bookings, reservations, rescheduling, cancellations
- `vendor-reply` — Service providers, bills, invoices, account notices
- `unsubscribe` — Cancel subscriptions, opt out of mailing lists

## Execution

Declarative skill. Trigger: "Run skill: auto-reply". Load this SKILL.md, execute prompts.

### Prompts

- prompts/classify.md — Category classification and eligibility check
- prompts/draft.md — Reply drafting in user's voice

## Model Requirements

- Provider: Local Ollama preferred; cloud opt-in for nuanced tone matching
- Minimum model: llama3:8b
