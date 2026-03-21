# calendar-sync

Proactive calendar awareness — conflict detection, meeting prep, and agenda digests.

## What It Does

- **Morning agenda**: 7am daily digest of today's meetings and commitments
- **Conflict detection**: flags scheduling conflicts and double-bookings
- **Focus block protection**: warns when new meetings encroach on protected time
- **Meeting prep notes**: generates context summaries for upcoming external meetings
- **Invite handling**: surfaces new meeting invites from email with proposed accept/decline

## Cadence

| Trigger | Action |
|---------|--------|
| 7:00am daily | Full day agenda digest |
| Email invite received | Surface for accept/decline with conflict check |
| Heartbeat (via dependency) | Flag any meetings starting <30min |
| On-demand | `calendar today`, `calendar week` |

## Hard Limits

- **Never** creates, modifies, or deletes calendar events without approval
- **Never** auto-accepts or declines meeting invites
- Focus block protection is advisory — user always decides

## Tools Required

- `ical` — CalDAV calendar read/write
- `email` — detect meeting invites
- `tasks` — create prep notes as tasks

## Output Format

Meeting prep notes are added as tasks with tag `meeting-prep` and due date = 1 hour before meeting start.

Agenda digest is delivered via the configured messaging channel (Telegram, Discord, etc.).
