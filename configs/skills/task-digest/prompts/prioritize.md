# Task Digest — Prioritization Prompt

Given the full task list and today's calendar, produce a ≤5 item focus list.

## Scoring Criteria (rank by composite score)
1. Overdue: +3 points
2. Due today: +2 points
3. High priority flag: +2 points
4. Fits a free calendar window (>30 min): +1 point
5. Blocking other tasks: +2 points

## Output Format
Focus list (numbered, max 5):
1. [Task title] — [why it's #1, one sentence] — Est: [time]
2. ...

If a task is blocked: note the blocker inline.
If calendar is fully booked: note "No deep work windows today" at the top.
If fewer than 5 tasks qualify: list only those that do. Do not pad.
