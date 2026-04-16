# scanner-triage

Platform skill that deduplicates and triages security scanner alerts. Every agent gets this skill automatically — it prevents alert fatigue by consolidating repeated findings into actionable summaries.

## Behavior

1. Collect alerts — Read recent security scanner output from `ops/security/` scan results.
2. Deduplicate — Group identical or near-identical findings by type, source file, and severity. A single secret pattern appearing in 15 files is one finding, not 15.
3. Classify severity — Map scanner severity levels to operational priority: critical (credentials exposed, active CVE), high (PII detected, outdated dependency with known exploit), medium (configuration drift, informational warnings), low (style issues, false positives from scanner heuristics).
4. Track state — Compare current findings against previous triage results in `ops/security/triage-state.json`. Identify new findings, resolved findings, and persistent findings that have been open too long.
5. Summarize — Produce a concise triage report: new critical/high items requiring attention, resolved items since last scan, and persistent items with age.
6. Report — Deliver the triage summary via the messaging channel only when there are new or escalated findings. Silent when the security posture is unchanged.

## Boundaries

- Read-only. This skill reads scanner output but never modifies files, patches vulnerabilities, or changes configuration.
- No external requests. All analysis is local — no cloud APIs, no vulnerability database lookups.
- No content access. The skill reads finding metadata (type, severity, location) but does not read the content of flagged files.
- No auto-remediation. Triage results and recommendations are delivered to the user for decision.
- State file only. The skill writes only to `ops/security/triage-state.json` for deduplication tracking.

## Schedule

Runs on the work-session schedule as configured in the blueprint. Typically every 15-30 minutes during waking hours.

## Execution

This is a declarative skill. The cron scheduler triggers the agent with "Run skill: scanner-triage". The agent reads this SKILL.md for behavior definitions and analyzes the ops/security/ scan output.

## Model Requirements

- Provider: Any configured provider (local or cloud)
- Minimum model: gemma4:26b or equivalent
- Low token usage — scanner output is structured, not free-form text
