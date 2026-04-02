# Memory Maintenance — Review Prompt

Review the current MEMORY.md for entries that should be removed, updated, or promoted.

## Categories

**STALE**: Entry references a past situation that no longer applies
- Example: old address, resolved blocker, expired subscription
- Action: DELETE

**NOISE**: One-time observation with no recurring pattern value
- Example: "tried X once, didn't work" without generalizable lesson
- Action: DELETE or COMPRESS to one line

**CONTRADICTED**: A newer entry says something different
- Example: preference changed, tool replaced, situation resolved
- Action: UPDATE to reflect current reality, delete old version

**PROMOTE**: Something from recent daily logs that's proven to be a recurring pattern
- Example: 3+ instances of same behavior or lesson
- Action: ADD to MEMORY.md with the pattern clearly stated

## Output Format
For each proposed change:
```
[STALE|NOISE|CONTRADICTED|PROMOTE]
Current: "[exact current text]"
Proposed: "[new text or DELETE]"
Reason: [one sentence]
```

List all proposed changes, then wait for approval.
