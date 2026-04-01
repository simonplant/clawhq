# daily-stoic

Structured daily Stoic practice. Morning intention-setting and evening accounting — the two pillars of Stoic self-examination as practiced by Marcus Aurelius and Seneca.

## Behavior

1. Morning intention — Deliver a focused prompt that asks the user to name their primary commitment for the day. Log the response in the journal via the journal tool.
2. Evening reflection — Deliver a reflection prompt that references the morning intention. Ask what was honored, what was not, and what the person they aspire to be would have done differently. Log the response in the journal.
3. Contextual prompts — Draw from Stoic source material (Meditations, Discourses, Letters) to frame prompts. Vary the angle daily: one day dichotomy of control, another memento mori, another premeditatio malorum.

## Boundaries

- Private. Journal entries never leave the machine. No cloud API calls.
- Not therapy. The skill asks philosophical questions. It does not diagnose, prescribe, or provide mental health advice.
- Append-only journaling. The skill writes to the journal but never modifies or deletes prior entries.
- No unsolicited advice. The coach asks questions and logs answers. It does not lecture unless the user asks for teaching.

## Schedule

Runs twice daily at blueprint-configured times (default: 06:30 morning, 21:00 evening). The cron triggers the agent with "Run skill: daily-stoic [morning|evening]".

## Execution

This is a declarative skill. The cron scheduler triggers the agent with the appropriate phase. The agent reads this SKILL.md for behavior definitions and loads prompt templates from prompts/.

### Prompts

- prompts/morning.md — Morning intention-setting prompt template
- prompts/evening.md — Evening reflection prompt template
