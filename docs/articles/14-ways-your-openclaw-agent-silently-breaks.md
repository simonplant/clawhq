# 14 Ways Your OpenClaw Agent Silently Breaks

> Every item on this list was discovered running a production agent. None produces an error message. All of them will waste your weekend.

**Published:** 2026-03-29 · **Source:** Production operation of OpenClaw v0.8.6+, documented in [OPENCLAW-REFERENCE.md](../OPENCLAW-REFERENCE.md) and [PROBLEMS.md](../PROBLEMS.md)

---

## The Problem

OpenClaw is the most powerful open-source agent framework available — 250K+ GitHub stars, 2M+ monthly active users. But it has a configuration surface of ~13,500 tokens spread across 11+ files, and 14 of those configuration choices will silently break your agent without any error, warning, or log entry.

"Silently" is the key word. Your agent starts. Docker reports healthy. The Gateway accepts connections. Everything looks fine. But your tools don't execute, your cron jobs never fire, your firewall isn't filtering, or your agent is permanently locked out — and you won't know until you notice the absence of something that should have happened.

These aren't edge cases. They're the default outcome of following OpenClaw's documentation without deep knowledge of its internals.

---

## The 14 Landmines

### 1. Missing `dangerouslyDisableDeviceAuth: true`

**Symptom:** "Device signature invalid" loop. The agent becomes permanently inaccessible.

OpenClaw's device authentication system requires each client to register a device signature. In Docker deployments, container restarts generate new signatures, invalidating the previous registration. Without this flag, your agent locks you out after the first restart and there is no recovery path except wiping the auth state.

### 2. `allowedOrigins` stripped after onboarding

**Symptom:** CORS errors block the management UI. You can't manage your agent through the web interface.

OpenClaw's onboarding flow sets `allowedOrigins` correctly, then a subsequent config write strips it. The Gateway silently rejects cross-origin requests. Your agent works fine via messaging channels but the control UI is dead.

### 3. `trustedProxies` missing Docker bridge IP

**Symptom:** Gateway rejects every request through Docker NAT.

Docker's bridge network NATs all traffic through a gateway IP (typically `172.17.0.1`). If `trustedProxies` doesn't include this address, the Gateway sees every request as coming from an untrusted proxy and rejects it. The agent appears to be running but refuses all connections.

### 4. `tools.exec.host` set to wrong value

**Symptom:** Tool execution silently disabled. The agent can think but can't act.

Three possible values: `"node"`, `"sandbox"`, `"gateway"`. Only `"gateway"` works in a standard Docker deployment. `"node"` requires a companion Node.js process that doesn't exist. `"sandbox"` requires Docker-in-Docker. Neither produces an error — tools simply never execute.

### 5. `tools.exec.security` not set to `"full"`

**Symptom:** Tool execution silently restricted. Some tools work, others don't, with no indication why.

The security level controls which tool categories are available. Anything below `"full"` silently disables categories without telling the agent or the user.

### 6. Container user not UID 1000

**Symptom:** Permission errors on mounted volumes. The agent can't read its own workspace.

OpenClaw expects to run as UID 1000. If the container runs as root or a different UID, volume mounts created by the host won't have matching permissions. Some operations fail, others succeed, creating an inconsistent and confusing state.

### 7. ICC enabled on agent network

**Symptom:** No visible symptom — this is a security breach, not a functional failure.

Inter-container communication (ICC) allows any container on the same Docker network to communicate with your agent. In a default Docker configuration, this means any other container on the host can reach the Gateway. You won't notice until someone exploits it.

### 8. Identity files exceed `bootstrapMaxChars`

**Symptom:** Agent personality gradually degrades. It "forgets" who it is.

OpenClaw loads identity files (SOUL.md, AGENTS.md, etc.) into the prompt context at bootstrap. The default limit is 20,000 characters per file and 150,000 characters aggregate. Exceed either threshold and files are silently truncated. Your agent loses personality traits, operating rules, or tool knowledge — whichever happens to be at the end of the file.

### 9. Invalid cron stepping syntax

**Symptom:** Scheduled jobs silently never run.

Writing `5/15` (every 15 minutes starting at minute 5) seems logical but is invalid cron syntax. The correct form is `3-58/15`. OpenClaw's cron scheduler accepts the invalid syntax without error and simply never triggers the job. Your morning digest, inbox triage, and heartbeat all stop running with no indication.

### 10. External networks not created

**Symptom:** `docker compose up` fails, or containers can't reach external services.

If your compose file references external networks that don't exist, Docker either fails at startup (obvious) or creates isolated containers that can't reach the services they need (not obvious).

### 11. `.env` missing required variables

**Symptom:** Container starts, integrations silently fail.

Docker Compose substitutes missing environment variables with empty strings. The container starts. The Gateway initializes. But every integration that depends on an API key, token, or credential quietly does nothing.

### 12. Config and credentials not mounted read-only

**Symptom:** No visible symptom — until your agent modifies its own configuration.

If `openclaw.json` or `credentials.json` are mounted writable, the agent can modify them during execution. A model hallucination or prompt injection could rewrite security settings, change tool permissions, or leak credentials. You won't know until you diff the files.

### 13. Firewall not reapplied after network recreate

**Symptom:** Agent runs without egress filtering after any `docker compose down`.

Every `docker compose down` destroys the Docker bridge interface and all associated iptables rules. When you bring the stack back up, Docker creates a new bridge — but your firewall rules pointed at the old one. The agent runs completely unfiltered until someone manually reapplies the rules. This happens on every restart.

### 14. `fs.workspaceOnly` misconfigured

**Symptom:** Either the agent can't read files it needs, or it can read your entire host filesystem.

Too restrictive and the agent can't access media files, downloads, or shared directories. Too permissive and a prompt injection or tool misuse could read `/etc/passwd`, `~/.ssh`, or anything else on the host.

---

## What We Learned

These landmines share three properties: they're silent (no error messages), they're load-bearing (each one breaks a critical function), and they're invisible to testing (the agent appears healthy by every standard check). Standard Docker health checks, Gateway status endpoints, and container logs all report success while the agent is fundamentally broken.

The common root cause is that OpenClaw is designed as a framework for developers, not as a product for operators. Every configuration surface assumes the user understands the internal architecture — Docker networking, cron syntax, iptables lifecycle, bootstrap token budgets. When you don't, the failure mode is silence.

---

## How ClawHQ Handles This

ClawHQ prevents all 14 landmines by construction — the config generator cannot produce a broken config. Every blueprint compiles to flat runtime configuration that has already passed all 14 validation rules.

For deployments that drift over time, `clawhq doctor` checks every landmine on every run. `clawhq doctor --fix` auto-remediates any that have changed. The egress firewall chain (`CLAWHQ_FWD`) is automatically reapplied after every container restart.

The user never needs to know what `cap_drop` means, why `5/15` is invalid cron syntax, or that Docker destroys iptables rules on bridge recreation. The platform handles it.

**Related:**
- [PROBLEMS.md](../PROBLEMS.md) — full problem-solution breakdown
- [OPENCLAW-REFERENCE.md](../OPENCLAW-REFERENCE.md) — engineering reference with all 14 landmine details
- [Security Incident Tracker](../security/INCIDENTS.md) — CVE registry and threat tracking

---

*This article was generated from ClawHQ development work. Every bug fix, blueprint, and breaking change produces discoverable content. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the process.*
