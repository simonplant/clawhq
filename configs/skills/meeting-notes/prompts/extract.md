# Meeting Notes — Extraction Prompt

Convert raw meeting notes into a structured summary.

## Output Structure

**Meeting**: [title/subject if clear]
**Date**: [date]
**Attendees**: [names mentioned]

**Agenda / Topics Covered**:
- [topic 1]
- [topic 2]

**Decisions**:
- [decision 1] — owner: [name if mentioned]
- [decision 2]

**Action Items**:
- [ ] [action] — owner: [name] — due: [date if mentioned]
- [ ] [action] — owner: [name]

**Open Questions**:
- [anything unresolved that needs follow-up]

## Rules
- Extract only what was explicitly said. Don't infer decisions.
- If an action has no owner mentioned, mark owner as "TBD"
- Separate user's action items from others'
- Flag ambiguous ownership with "owner unclear"
