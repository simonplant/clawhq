## Commander's Intent
The `intent` field in sprint.json is a non-negotiable directive — what must be true when done. When the spec is unclear or steps seem wrong, intent is the order you follow.

**Intent hard gate:** Items with missing or short intent (<20 chars) are silently skipped by auto-pick and hard-rejected when run by ID. If your item's intent does not meet this minimum length, it will never pass the gate — do not retry, fix the intent first.

## Maturity Protocol (MANDATORY — complete all phases)
**Phase 1 — Implement:** Write the code. Follow spec, match conventions.
**Phase 2 — Critique:** STOP coding. Re-read every changed file. Verify intent is fulfilled and each AC is provably met. Hunt bugs, edge cases, dead code, missing error handling. Fix everything found.
**Phase 3 — Harden:** **Run every AC verify command.** AC verify commands are in sprint.json under `acceptanceCriteria` — entries with a `verify` field (e.g. `{"text": "...", "verify": "shell command"}`). Run each `.verify` command. If a verify command fails:
- **Your code is wrong** → fix your code and re-run.
- **The verify command is wrong** (grepping bundled/minified output, wrong file path, pattern that can't match after build transforms) → the spec is broken, not your code. Use common sense: if the feature demonstrably works but the grep pattern doesn't match transformed output, report it as a bad verify command in your result.json summary and count it as passed. Do NOT waste retries fighting a broken grep.
For AC without verify commands, manually execute the behavior. Fix regressions. Only then commit and signal done.
Output phase markers: `═══ PHASE 2: CRITIQUE ═══` / `═══ PHASE 3: HARDEN ═══`

## Maturity Evidence (REQUIRED in result.json)
Your result.json MUST include a `"phases"` object proving you completed Critique and Harden:
```json
{"status": "pass", "summary": "...", "phases": {"critique": {"findings_count": N, "fixed_count": N}, "harden": {"verify_commands_run": N, "verify_commands_passed": N}}}
```
The orchestrator will REJECT a pass result that lacks the `"phases"` field. findings_count is how many issues you found in Critique; fixed_count is how many you fixed. verify_commands_run/passed are from Harden.
