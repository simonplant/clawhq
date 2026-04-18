# Operational Knowledge Base

Hard-won lessons from running OpenClaw agents in production. Each entry is something that cost debugging time and wasn't obvious from docs or source code.

**Entry format** — each entry should include whichever of these apply:
- **Symptom:** What you observe (the thing that sends you looking)
- **Cause:** Why it happens
- **Fix:** What to do about it
- **Ref:** Upstream issue, commit, or doc if relevant

Not every entry needs all four. Facts and gotchas just need a clear statement. Bugs need symptom + fix at minimum.

---

## Telegram

**Approval callback deadlock**
- Symptom: Bot shows "typing" but never responds. Zero errors in logs — just silence after the last successful message. Easy to misattribute to model slowness.
- Cause: Deadlock in Telegram approval callback handling.
- Fix: Update OpenClaw to v2026.4.11+.
- Ref: openclaw/openclaw#64979

**Menu budget overflow**
- Symptom: Log warning about exceeding 5700-character payload budget.
- Cause: Tool count exceeds ~56, hitting Telegram's command menu size limit. OpenClaw auto-shortens descriptions.
- Fix: None needed — cosmetic warning only.

---

## Media Understanding

**Not enabled by default**
- Symptom: Shared screenshots and images are silently ignored — no error, no warning, agent just doesn't acknowledge the image.
- Cause: `tools.media.image.enabled` defaults to false. Requires explicit config even when model supports vision.
- Fix: Set `tools.media.image.enabled: true` with model list in `openclaw.json`. ClawHQ compiler now handles this automatically.

**Gemma4:26b is vision-capable**
- Works as `tools.media.image.models` provider for screenshots, charts, PDFs.
- Fix: Set `timeoutSeconds: 120` for local inference — default 30s is too aggressive for 26B parameters on mixed CPU/GPU.

**Media staging vs. workspace restriction**
- `tools.fs.workspaceOnly: true` does NOT block media understanding. The staging pipeline copies inbound attachments from `~/.openclaw/media/` into `workspace/media/inbound/` before the agent sees them. The fs restriction only governs the agent's file read/write tools.

---

## Local Models (Ollama)

**Session-memory hook timeout**
- Symptom: Every new session hangs for 15s then the response is blocked or delayed.
- Cause: LLM slug generator has a hardcoded 15s timeout that large local models can't meet.
- Fix: `hooks.internal.entries.session-memory.enabled: false`

**Vector memory VRAM conflict**
- Symptom: Rate limit loops, timeouts during memory search.
- Cause: Embedding model competes with main model for VRAM.
- Fix: `agents.defaults.memorySearch.store.vector.enabled: false` until running a dedicated embedding server.

**Model reload latency**
- Symptom: First request after idle takes 5-6s (visible as `load_duration` in Ollama response).
- Cause: Ollama evicts models after the configured keep-alive window. Not a bug.

**Host Ollama vs. container Ollama**
- Running Ollama on the host via `ollama serve` works but forces container→host traffic through the Docker bridge gateway, which UFW can block (symptom: `ollama-reachable` doctor fail with a UFW fix suggestion).
- Running Ollama as a sibling container on the same user-defined Docker network (e.g., `engine_clawhq_net`) is faster — benchmarked at ~195 t/s on gemma4:26b vs. ~110 t/s over host — and skips the bridge round trip entirely. The container must be named `ollama` so openclaw's config (`baseUrl: http://ollama:11434`) resolves via Docker's internal DNS.
- The generated docker-compose no longer adds `ollama:host-gateway` to `extra_hosts`; that entry would shadow Docker DNS and route to the host where nothing listens unless Ollama also publishes port 11434.

---

## Docker / Container

**Read-only filesystem + tmpfs**
- Container runs `read_only: true`. Writable paths are explicit tmpfs mounts (`/tmp`, `/home/node/.local`, `/home/node/.cache`) and volume mounts. New writable paths require docker-compose changes.

**ACP/Codex probe failure**
- Symptom: `embedded acpx runtime backend probe failed` on every startup.
- Cause: Container can't mkdir `/home/node/.npm` due to read-only filesystem.
- Fix: None needed — non-blocking, core functionality unaffected.

---

## Config

**Hot reload scope**
- OpenClaw hot-reloads some config changes (e.g., `channels.telegram.linkPreview`) without restart. Model changes, tool config, and hooks require container restart via `clawhq restart`.

**Config clobbering backups**
- Symptom: Multiple `.clobbered.*` backup files appearing alongside `openclaw.json`.
- Cause: OpenClaw's integrity system tracks config changes. Normal when ClawHQ writes config.

**`clawhq install` preserves an existing `clawhq.yaml` that has a composition**
- Ordering matters: if you run `clawhq init --guided --reset` first, it writes `clawhq.yaml` with `composition.profile` + `composition.personality`. `clawhq install` then skips overwriting that file so `clawhq apply` can still regenerate per-tool configs (e.g. himalaya). On a truly fresh host with no prior `clawhq.yaml`, `install` writes a minimal default.
- Symptom of the old behaviour: `clawhq apply` failed with "No composition.profile in clawhq.yaml" after `init → install`, and tool configs (himalaya.toml) could not be regenerated. Fix is in `src/build/installer/scaffold.ts`.

---

## Updates

**`clawhq update` preserves custom layers**
- For from-source installs: git pull, two-stage Docker build (base + custom), restart, doctor verification. Clawwall, sanitizer, and cred-proxy survive updates because they're baked into the stage-2 Dockerfile.
