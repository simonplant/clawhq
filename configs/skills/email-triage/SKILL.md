# email-triage

Smart inbox triage — runs every 15 minutes, classifies every email, extracts action items.

## What It Does

- **Classifies** every new email into: urgent / action-required / fyi / newsletter / receipt
- **Labels** emails with appropriate flags for visual scanning
- **Archives** non-actionable emails automatically (newsletters, receipts, FYI)
- **Extracts** action items and creates tasks with deadlines when detected
- **Notifies** on urgent or action-required emails via messaging channel

## Categories

| Category | Auto-action | Notification |
|----------|-------------|--------------|
| `urgent` | Label red | Yes — immediate |
| `action_required` | Label orange, create task | Yes |
| `fyi` | Label blue, archive | No |
| `newsletter` | Label grey, archive | No |
| `receipt` | Label green, archive | No |

## Approval Gates

Triage (read + label + archive) runs autonomously — no approval needed.

Approval **is required** for:
- Unsubscribe actions
- Mark as spam
- Permanent deletion

## Tools Required

- `email` — IMAP access for reading, labeling, archiving
- `tasks` — create action items from email content

## Difference from email-digest

- `email-triage` runs continuously (every 15min), processes every email, no output unless notable
- `email-digest` produces a summary digest you read — triage is the engine, digest is the report

## Customization

Set `action_extraction.create_tasks: false` to disable automatic task creation.  
Set per-category `auto_archive: false` to keep emails in inbox longer.
