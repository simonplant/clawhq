# cron-doctor

Platform skill that diagnoses cron job failures using the cron/runs/ execution logs. Every agent gets this skill automatically — it keeps scheduled tasks healthy without user intervention.

## Behavior

1. Scan logs — Read `cron/runs/` for recent execution results, focusing on failed or timed-out runs.
2. Classify failures — Categorize each failure: timeout, crash, model error, tool unavailable, permission denied.
3. Identify patterns — Detect recurring failures (same job failing 3+ times), cascading failures (one job's failure causing others), and degradation trends (increasing duration before timeout).
4. Diagnose root cause — For each failure pattern, determine the most likely root cause: stale credentials, unreachable integration, model quota exhausted, memory pressure, or misconfigured schedule.
5. Recommend fixes — Propose actionable fixes: retry now, adjust schedule, refresh credentials, disable degraded job, or escalate to user.
6. Report — Deliver a concise diagnostic summary via the messaging channel only when failures are found. Silent when all jobs are healthy.

## Boundaries

- Read-only. This skill reads cron execution logs but never modifies schedules, retries jobs, or changes configuration.
- No external requests. All analysis is local — no cloud APIs, no network calls.
- No content access. The skill reads execution metadata (status, duration, error messages) but never reads the content of what cron jobs produced.
- No auto-fix. Recommendations are delivered to the user. The skill does not execute fixes without explicit approval.

## Schedule

Runs on the work-session schedule as configured in the blueprint. Typically every 15-30 minutes during waking hours.

## Execution

This is a declarative skill. The cron scheduler triggers the agent with "Run skill: cron-doctor". The agent reads this SKILL.md for behavior definitions and analyzes the cron/runs/ directory.

## Model Requirements

- Provider: Any configured provider (local or cloud)
- Minimum model: any tool-capable local model (runtime uses the deployment default)
- Low token usage — log analysis is structured data, not free-form text
