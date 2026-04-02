# document-draft

On-demand document drafting for structured written deliverables: proposals, SOWs,
specs, memos, reports, summaries. User describes the document; agent drafts; user reviews.

## Behavior

1. Intake — User requests a document type and provides context (bullets, notes, prior emails).
2. Clarify — If the request is under-specified (missing audience, purpose, or key facts), ask
   ONE clarifying question before drafting. Not multiple. If enough context exists, skip.
3. Draft — Generate a complete draft in the user's voice, formatted for the document type.
4. Queue — Place draft in the approval queue (category: publish_content). Never send or share directly.
5. Iterate — Accept revision instructions and update the draft. Store final in `content/drafts/`.

## Document Types

- Proposal / SOW — scoped deliverables, timeline, rate
- Technical spec — feature requirements, acceptance criteria
- Client memo — project status, decisions, next steps
- Executive summary — 1-page distillation of longer material
- Email (complex) — multi-part arguments, sensitive communications
- Meeting notes — structured output from raw conversation notes

## Boundaries

- Approval required before any external send or share.
- Never publish directly — always queue for review.
- Voice-match is essential — drafts must sound like the user, not like AI output.
- No hallucinated facts — if information is missing, flag it explicitly in the draft.

## Schedule

On-demand only.

## Prompts

- prompts/intake.md — Document intake and clarification
- prompts/draft.md — Document generation by type
- prompts/revise.md — Revision handling

## Model Requirements

Prefers cloud model for quality. Local fallback: llama3:70b minimum.
