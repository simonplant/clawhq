# contact-follow-up

Relationship CRM for personal and professional contacts. Tracks when you last interacted
with key contacts, surfaces overdue follow-ups, and drafts outreach for approval.

## Behavior

1. Track — Log interactions as they happen (email sent, call made, meeting attended). User
   can also manually log: "talked to Mark today."
2. Schedule — Each contact has a configured follow-up cadence (e.g., monthly, quarterly).
3. Surface — Every morning, flag contacts overdue for follow-up (cadence exceeded + no recent touch).
4. Draft — On request, draft a personalized outreach message for a contact. Approval required before send.
5. Update — After a touchpoint, reset the follow-up timer.

## Boundaries

- Draft outreach only — never send without approval.
- Contact data stored locally in `memory/contacts-followup.json`.
- No access to contacts not explicitly registered in the follow-up list.
- Relationship context sourced from prior notes and conversation history — no inference beyond what's logged.

## Schedule

Daily surface at 09:00 (morning routine, alongside morning brief). On-demand for drafts.

## Prompts

- prompts/surface.md — Daily overdue follow-up digest
- prompts/draft-outreach.md — Personalized outreach draft

## Model Requirements

Prefers cloud model for outreach drafting. Local for surface/triage: llama3:8b.
