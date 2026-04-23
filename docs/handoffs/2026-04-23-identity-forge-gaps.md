# ClawHQ Investigation Brief — Identity Forge Gaps

**Date:** 2026-04-23
**Author:** Claude (main session, Simon's recon pass)
**Scope:** Gaps found when comparing three OpenClaw instances (clawdius-manual prototype, clawdius current, sterling future) against `docs/OPENCLAW-REFERENCE.md` and the clawhq identity generators.

**What is NOT in scope (settled, do not touch):**

- Persona direction — plain, non-abrasive, high-agency, direct is validated by the scoring model. Canonical personality vector in `src/design/blueprints/personality-presets.ts` (`directness=5, warmth=3, verbosity=2, proactivity=4, caution=2, formality=2, analyticalDepth=5`) is the target. Elaborate personas (Stoic/Buddhist guardian framing) scored worse and were dropped deliberately.
- `soul_overrides` free-text as the only user customization path for SOUL.md. Do not add a full-replacement SOUL slot.

---

## Bug 1 — `workspace/identity/` vs `workspace/` path drift

**Symptom.** `src/design/identity/index.ts:66-98` writes identity files to `workspace/identity/SOUL.md`, `workspace/identity/AGENTS.md`, `workspace/identity/TOOLS.md`, `workspace/identity/USER.md`. But per `docs/OPENCLAW-REFERENCE.md` §"The 8 Auto-Loaded Files Constraint," OpenClaw only auto-injects the 8 basenames from **workspace root** (`resolveAgentWorkspaceFilePath`). Anything under `workspace/identity/` is never loaded unless the agent opens it with a tool call.

**Evidence.** In the current clawdius deployment both sets exist with *different content*:

- `/home/simon/dev/clawdius/workspace/SOUL.md` (root, 54 lines)
- `/home/simon/dev/clawdius/workspace/identity/SOUL.md` (subdir, 54 lines, differs per `diff -q`)

Something is copying between them and drifting. The agent reads whichever one is at root — the subdir copy is dead weight.

**Investigate.**

- Search for any code that mirrors `workspace/identity/*` → `workspace/*` (deploy, apply, bootstrap paths).
- Decide: write directly to `workspace/` root and stop using the `identity/` subdir, OR formalize a mirror step with checksum-based drift detection in `clawhq doctor`.

**Fix.** Preferred: change `IdentityFileContent.relativePath` in `src/design/identity/index.ts` to `workspace/SOUL.md` etc. Delete any `identity/` subdir writes. Add a `doctor` check that fails if `workspace/identity/*.md` exists.

**Validate.** After `clawhq apply`, `workspace/identity/` should not contain SOUL/AGENTS/TOOLS/USER. `clawhq doctor` should pass. Running agent should see the generated content in its bootstrap (verify via `/context list` in-session).

---

## Bug 2 — Non-standard workspace `.md` basenames silently ignored

**Symptom.** Reference §"The 8 Auto-Loaded Files Constraint" is explicit: OpenClaw auto-loads exactly 8 basenames (`SOUL.md`, `AGENTS.md`, `USER.md`, `TOOLS.md`, `IDENTITY.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, `MEMORY.md`). Any other `.md` in workspace root is invisible to the agent unless opened by tool call. The `bootstrap-extra-files` hook also only accepts these basenames.

**Evidence.** clawdius current has `TRADING_PIPELINE.md`, `TRADING_SOP.md`, `CRON_TRADING_PROMPTS.md` at workspace root. clawdius-manual had 11 such files (HYGIENE.md, INBOX_MANAGER.md, MANCINI.md, RECIPE_DB_SPEC.md, etc.). A user writing `KNOWLEDGE.md` today silently loses all of it.

**Investigate.** Confirm the 8-basename rule is still current in upstream OpenClaw (check `src/agents/prompt-builder.ts` or equivalent).

**Fix.** Add a check to `clawhq doctor` that walks `workspace/*.md` and warns on any basename not in the allowlist, with guidance ("inline into AGENTS.md, or reference by name from AGENTS.md and document that the agent must read it on demand"). Also add a blueprint-compile-time warning in `src/design/catalog/validate-compiled.ts` if a blueprint declares a workspace file with a non-allowlisted name.

**Validate.** Place a `FOO.md` in a test workspace, run `clawhq doctor`, expect warning.

---

## Bug 3 — `BOOTSTRAP.md` semantically collides with `BOOT.md`

**Symptom.** Per reference, `BOOTSTRAP.md` is a **first-run interview** (delete after use), `BOOT.md` is a **gateway-restart hook** (runs on every cold start via the `boot-md` bundled hook). They serve different purposes.

**Evidence.** `/home/simon/dev/clawdius/workspace/BOOTSTRAP.md` contents are semantically a BOOT.md (startup sequence: load identity, check tools, sync memory, check heartbeat). The `boot-md` hook is enabled in the config but has no file to run because BOOT.md doesn't exist; meanwhile BOOTSTRAP.md will be re-triggered every time the "first-run" detector fires, which is wrong for an already-bootstrapped deployment.

**Investigate.** 

- Where does `clawhq init` write the startup checklist? Is it BOOTSTRAP.md (wrong) or BOOT.md (right)?
- Does clawhq have a `boot-md` generator at all?

**Fix.** Add a BOOT.md generator to `src/design/identity/`. Stop writing startup-checklist content to BOOTSTRAP.md. Use BOOTSTRAP.md only for the one-time first-run interview, and delete it after init succeeds (per reference best practice).

---

## Bug 4 — `gateway.bind: "loopback"` default breaks Docker

**Symptom.** `/home/simon/dev/sterling/config/openclaw.json` has `gateway.bind: "loopback"`. clawdius-manual's `CLAUDE.md` documents this as a hard-won lesson: *"gateway must bind `0.0.0.0` inside the container for Docker bridge port forwarding to work; `loopback` (the default) binds `127.0.0.1` inside the container, making the gateway unreachable from the host."*

**Investigate.** Check `clawhq install` / `clawhq init` / config generation in `src/design/configure/` — what determines the `bind` value written to `openclaw.json`?

**Fix.** When the agent is being deployed to Docker (which is the default install path per README), default `gateway.bind` to `"lan"`. This is one of the 14 landmines and should auto-handle per `docs/OPENCLAW-REFERENCE.md` §"The 14 Configuration Landmines."

**Validate.** `clawhq init` in a fresh dir, inspect emitted `openclaw.json`, expect `"bind": "lan"` if Docker is the deploy target.

---

## Bug 5 — `HEARTBEAT.md` populated instead of empty + cron-inlined

**Symptom.** Reference §"HEARTBEAT.md" warns: *"Native heartbeat can become a major token sink. Heartbeat turns frequently run with the full main-session context (170k–210k input tokens per run has been observed). Best practice is to disable native heartbeat and use isolated cron-driven heartbeats instead."* clawdius-manual's pattern (per its `CLAUDE.md`): empty `HEARTBEAT.md`, heartbeat behavior inlined in `cron/jobs.json`.

**Evidence.** Current clawdius has a 7-line HEARTBEAT.md with a checklist. Sterling has an empty HEARTBEAT.md template but no cron-inlined prompts either.

**Investigate.** Does any blueprint declare cron-inlined heartbeat prompts? What does `clawhq init` generate for HEARTBEAT.md today?

**Fix.** Default HEARTBEAT.md to empty. In blueprints that want periodic checks, compile them into `cron/jobs.json` entries with inline prompts + `lightContext: true` + `isolatedSession: true` (per reference recommended defaults). Add a `doctor` check that warns if HEARTBEAT.md is populated AND native heartbeat is enabled.

---

## Bug 6 — Model tier may be silently defaulting to local Ollama

**Symptom.** Both clawdius current and sterling have `ollama/gemma4:26b` as primary, subagent, and heartbeat model. clawdius-manual ran `anthropic/claude-opus-4-6` primary, `claude-sonnet-4-6` subagents, `claude-haiku-4-5` heartbeat, with `qwen3.5:27b` as emergency fallback.

**Investigate.** What drives the `agents.defaults.model.primary` value in generated `openclaw.json`? Is it blueprint-declared, user-prompted during init, or a hardcoded default? If hardcoded, what does it default to when `ANTHROPIC_API_KEY` / `CLAUDE_AI_SESSION_KEY` is present in `.env`?

**Fix.** If an Anthropic key is detected, default to the Claude tier. If not, default to Ollama. Make the choice visible during `clawhq init`. Add a `clawhq doctor` warning when primary=ollama but an Anthropic key is present in the environment — likely a misconfig.

---

## Bug 7 — No generator for MEMORY.md

**Symptom.** Reference §"MEMORY.md" describes it as *"curated long-term memory"* — the file the agent reads on main sessions for persistent wisdom. No clawhq generator exists. In current clawdius it is empty (0 lines).

**Investigate.** Should blueprints declare seed MEMORY entries? Is curation expected to be user-maintained post-init?

**Fix.** At minimum, `clawhq init` should write a stub `MEMORY.md` with the expected structure (## Lessons Learned, ## Patterns to Watch, ## Operational Notes, ## Blocking Items) so the agent has a place to accumulate. Optionally support blueprint-declared seed lessons.

---

## Out of scope / defer pending Simon's input

These are gaps vs. clawdius-manual that may be intentional stripdowns (pending Simon confirmation), so do **not** act on them yet:

- USER.md expanded schema (family, finances, health, timeline)
- Delegated-email rules (`--delegated <category>` with audit logging)
- Cron→role mapping table in AGENTS.md
- `simonplant/*` repo boundary rule

Wait for blueprint-level direction before adding generator support.

---

## Reporting format

When done, produce a short report (file paths changed, before/after for each bug, doctor output diff). Do not widen scope beyond these 7 bugs without asking.
