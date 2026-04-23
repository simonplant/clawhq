# ClawHQ Investigation Brief — Identity Forge Gaps

**Date:** 2026-04-23
**Author:** Claude (main session, Simon's recon pass)
**Revised:** 2026-04-23 — scope cut from 7 bugs to 3 after final critique; schema additions deferred until baseline is verified.
**Scope:** Three bugs that must be fixed before any further platform work lands. All three affect baseline correctness — schemas, blueprints, and the scoring model all rest on these being resolved first.

**What is NOT in scope (settled, do not touch):**

- Persona direction — plain, non-abrasive, high-agency, direct is validated by the scoring model. Canonical personality vector in `src/design/blueprints/personality-presets.ts` (`directness=5, warmth=3, verbosity=2, proactivity=4, caution=2, formality=2, analyticalDepth=5`) is the target. Elaborate personas (Stoic/Buddhist guardian framing) scored worse and were dropped deliberately.
- `soul_overrides` free-text as the only user customization path for SOUL.md. Do not add a full-replacement SOUL slot.

---

## Critical prerequisite — verify what the agent actually reads

Before declaring any fix done, run this verification in a live clawdius session:

```
/context list
```

Confirm which `SOUL.md`, `AGENTS.md`, `TOOLS.md`, and `USER.md` paths appear in the loaded context. If they are at `workspace/` root, the scoring model validated that content. If they are at `workspace/identity/`, the scoring result may apply to an unknown input (see Bug 2). Report the observed paths in your findings before applying any fix.

This is not paranoia. Every downstream decision — persona verdict, blueprint schemas, MEMORY/USER additions — rests on knowing which file the agent actually loads.

---

## Bug 1 (P0 — safety) — Runbooks are silently invisible to the agent

**Symptom.** Blueprints declare `runbooks:` entries (e.g. `stock-trading-assistant.yaml:154` ships `RISK-GUARDRAILS.md` with "never recommends specific trades, never predicts prices"). These get written to the workspace. But per `docs/OPENCLAW-REFERENCE.md` §"The 8 Auto-Loaded Files Constraint," OpenClaw only auto-injects 8 basenames. `RISK-GUARDRAILS.md` is not one of them. **The trading blueprint's hard-rule safety file is never loaded into the agent's context.**

**Severity.** P0. A trading agent whose "don't recommend trades" rules are invisible is a safety gap, not a cosmetic issue.

**Evidence.** `src/design/identity/index.ts:91-100` writes runbooks with arbitrary basenames. `docs/OPENCLAW-REFERENCE.md` §"The 8 Auto-Loaded Files Constraint" is explicit that only the 8 standard basenames get injected.

**Investigate.**

- Read `src/agents/prompt-builder.ts` (or equivalent) in the OpenClaw source at `~/dev/clawdius/engine/source` to confirm the basename allowlist is hardcoded.
- Check which existing blueprints declare runbooks and what basenames they use.

**Fix.** Two acceptable options — pick per runbook size:

- **(A) Inline small runbooks into AGENTS.md.** Add a `## Runbooks` section rendered by `agents.ts`. Loses discoverability as separate files; guarantees the content is actually loaded. Preferred for rule-sets like `RISK-GUARDRAILS.md` where omission is unsafe.
- **(B) Move reference-material runbooks to `workspace/docs/`.** Explicit "the agent must read these on demand" semantics. Update generator to write there, update blueprint documentation to explain the read-on-demand contract.

For `stock-trading-assistant.yaml` specifically: use (A). The hard rules must load on every session.

**Validate.** After fix, run `/context list` in a trading-agent session. Confirm `RISK-GUARDRAILS` content appears in the loaded AGENTS.md (option A) or is documented as read-on-demand (option B). No runbook should sit at workspace root with a non-allowlisted basename.

---

## Bug 2 — `workspace/identity/` vs `workspace/` path drift

**Symptom.** `src/design/identity/index.ts:66-98` writes identity files to `workspace/identity/SOUL.md`, `workspace/identity/AGENTS.md`, `workspace/identity/TOOLS.md`, `workspace/identity/USER.md`. OpenClaw only auto-loads the 8 basenames from **workspace root**. Anything under `workspace/identity/` is never loaded unless the agent opens it with a tool call.

**Why this is critical, not cosmetic.** If the running clawdius is reading `workspace/SOUL.md` (root) but clawhq is writing to `workspace/identity/SOUL.md` (subdir), then the content clawhq generates is not the content the agent loads. Which means the scoring model result — "plain persona wins" — validated *whatever is at workspace root*, which may not be what clawhq generated. Every downstream verdict about persona depends on this being resolved.

**Evidence.** In the current clawdius deployment both sets exist with *different content*:

- `/home/simon/dev/clawdius/workspace/SOUL.md` (root, 54 lines)
- `/home/simon/dev/clawdius/workspace/identity/SOUL.md` (subdir, 54 lines, differs per `diff -q`)

**Investigate (before touching any code).**

- What wrote `/home/simon/dev/clawdius/workspace/SOUL.md`? (Check mtime vs. the subdir copy. Check git blame if the file is tracked. Check whether it is a regular file, symlink, or hardlink.)
- Search for any code in clawhq that mirrors `workspace/identity/*` → `workspace/*` (grep for "workspace/SOUL" write paths across clawhq source).
- Determine whether there is an apply/deploy step that copies from subdir to root, or whether the root files predate clawhq and were never overwritten.

**Do not apply the fix until Investigate is complete.** Report findings first.

**Fix (after investigation confirms the write path).** Preferred: change `IdentityFileContent.relativePath` in `src/design/identity/index.ts` to `workspace/SOUL.md` etc. Delete any `identity/` subdir writes. Add a `doctor` check that fails if `workspace/identity/*.md` exists.

**Validate.** After `clawhq apply` in a test deployment, `workspace/identity/` should not contain SOUL/AGENTS/TOOLS/USER. Run `/context list` in the live session — the loaded files should match what clawhq just wrote (verify by byte-level comparison of the generated content against what the agent reports reading).

---

## Bug 3 — `gateway.bind: "loopback"` default breaks Docker

**Symptom.** `/home/simon/dev/sterling/config/openclaw.json` has `gateway.bind: "loopback"`. clawdius-manual's `CLAUDE.md` documents this as a hard-won lesson: *"gateway must bind `0.0.0.0` inside the container for Docker bridge port forwarding to work; `loopback` (the default) binds `127.0.0.1` inside the container, making the gateway unreachable from the host."*

**Severity.** Sterling cannot deploy to Docker today. One-line config fix.

**Investigate.** Check `clawhq install` / `clawhq init` / config generation in `src/design/configure/` — what determines the `bind` value written to `openclaw.json`? Confirm sterling's deploy target is Docker (if it's host-process only, `loopback` is correct and this bug is void).

**Fix.** When the agent is being deployed to Docker (the default install path per README), default `gateway.bind` to `"lan"`. This is one of the 14 landmines per `docs/OPENCLAW-REFERENCE.md` §"The 14 Configuration Landmines" and should auto-handle.

**Validate.** `clawhq init` in a fresh dir with Docker as deploy target, inspect emitted `openclaw.json`, expect `"bind": "lan"`.

---

## Deferred — explicitly out of scope for this pass

The following were considered and intentionally cut. Do not address unless instructed in a future handoff:

- **Non-allowlisted `.md` basename doctor warning.** Dependent on Bug 1's resolution — if runbooks get relocated to `workspace/docs/`, the doctor warning logic changes accordingly.
- **BOOT.md vs BOOTSTRAP.md separation + BOOT.md generator.** Real issue, but not blocking. Revisit after Bugs 1–3.
- **HEARTBEAT.md empty + cron-inlined prompts.** Cost optimization, not correctness. Defer.
- **Model tier default (Ollama vs Anthropic).** Possibly user-intentional on Simon's current deployment. Do not change defaults without confirming user intent.
- **MEMORY.md stub generator.** Deferred until the baseline is verified per Bug 2.
- **Five Zone C blueprint schema additions** (`user_profile_schema`, `role_routing`, `operational_boundaries`, delegated-send rules, enriched USER.md). These are personalization-layer primitives; baseline must be rock-solid first per project direction. Revisit after Bugs 1–3 land and scoring is re-verified against the known input.

---

## Reporting format

When done, produce a short report:

1. Findings from Bug 2 `Investigate` — which process writes `workspace/SOUL.md`, and what the `/context list` check shows in the live clawdius session. Include this even if no fix is applied.
2. Per bug: file paths changed, before/after, doctor output diff.
3. Test-deployment verification: `/context list` output confirming the generated content is what the agent loads.

Do not widen scope beyond these 3 bugs without asking.
