---
title: Doctor preventive diagnostics
category: Features
status: active
date: 2026-04-22
tags: [diagnostics, doctor, health, operations, openclaw, operation]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# Doctor preventive diagnostics

## Purpose

18 preventive checks covering all known failure modes. Every check
runs in parallel — the operator gets a complete health picture in one
pass, not a serial "first failure stops the run" report.

Most checks map to a specific landmine or hardening control. `clawhq
doctor` is the tool layer's continuous enforcement of the rules the
generator applied at build time.

## Check categories

| Category | Checks |
|---|---|
| **Config validation** | config-exists, config-valid, compose-exists |
| **Secrets & permissions** | secrets-perms (.env mode 0600), creds-perms (credentials.json mode 0600) |
| **Docker runtime** | docker-running, container-running, cap-drop, no-new-privileges, user-uid |
| **Agent health** | identity-size (vs. `bootstrapMaxChars`), cron-syntax, env-vars, workspace-exists, gateway-reachable |
| **Infrastructure** | firewall-active, disk-space, air-gap-active |

## Auto-fix

`doctor --fix` handles:

- **File permissions** (`chmod`) — auto-corrects `.env` and credential
  file modes.
- **Critical landmine violations** in `openclaw.json` — restores
  missing fields from the golden config if present.
- **Container hardening issues** — rewrites compose file fragments
  that drifted from the declared posture.

Auto-fix never modifies identity files (SOUL.md, USER.md, etc.) —
those are the operator's responsibility. It only corrects
infrastructure-level drift.

## Landmine coverage

The 18 checks collectively cover the 14 landmines:

| Landmine | Check |
|---|---|
| 1: dangerouslyDisableDeviceAuth missing | config-valid |
| 2: allowedOrigins stripped | config-valid |
| 3: trustedProxies stripped | config-valid |
| 4: tools.exec.host wrong | config-valid |
| 5: tools.exec.security not full | config-valid |
| 6: Container user not UID 1000 | user-uid |
| 7: ICC enabled | firewall-active (bridge inspect) |
| 8: Identity files exceed `bootstrapMaxChars` | identity-size |
| 9: Cron stepping syntax invalid | cron-syntax |
| 10: External networks not created | container-running (fails on missing net) |
| 11: .env missing required vars | env-vars |
| 12: Config/credentials not read-only | compose-exists + validation |
| 13: Firewall not reapplied | firewall-active |
| 14: fs.workspaceOnly misconfigured | config-valid |

Every landmine has a probe. A landmine without a probe is a regression
in the tooling, not an excusable oversight.

## Usage

```bash
# Run all checks
clawhq doctor

# Run all checks and auto-fix what can be auto-fixed
clawhq doctor --fix

# Watch mode — re-run on interval
clawhq doctor --watch

# JSON output for programmatic consumption
clawhq doctor --json
```

## Related commands

Adjacent operational commands for a complete health picture:

| Command | Purpose |
|---|---|
| `clawhq doctor` | 18-check diagnostics with auto-fix |
| `clawhq status` | Single-pane dashboard |
| `clawhq creds` | Credential health probes. See [[credential-health-probes]] |
| `clawhq scan` | Secret scanning via gitleaks |
| `clawhq audit` | Tool execution + egress audit trail (append-only JSONL) |
| `clawhq verify` | End-to-end integration test from inside container |

And OpenClaw's native diagnostics:

| Command | Purpose |
|---|---|
| `openclaw doctor` | Basic diagnostics (structured output with `--json`) |
| `openclaw security audit` | Security checks |
| `openclaw security audit --deep` | Comprehensive security check |
| `openclaw security audit --fix` | Auto-fix flagged issues |
| `openclaw status` | Overall system status |
| `openclaw channels status --probe` | Channel health check |
| `openclaw models status --probe` | Model auth status |
| `/context list` (in session) | See exactly what's loaded, truncated, or missing |
| `/compact` (in session) | Proactively compact context before overflow |

`clawhq doctor` wraps `openclaw doctor` as a subset and adds its own
infrastructure-level checks.

## See also

- [[container-hardening]]
- [[credential-health-probes]]
- [[two-stage-docker-build]]
