---
title: tools.exec.security not full silently restricts tool execution
subject: openclaw
type: landmine
status: active
severity: high
affects: "All deployments using the exec tool with non-default security mode"
openclaw_version: ">=v2026.4.12"
last_verified: 2026-04-22
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
source_types: [compiled-reference]
see_also:
  - openclaw/configuration/openclaw-json-schema.md
  - openclaw/landmine/tools-exec-host-wrong-value.md
  - openclaw/security/threat-model.md
tags: [exec, tools, security, silent-failure]
landmine_number: 5
---

# `tools.exec.security` not `"full"` silently restricts tool execution

## What breaks

Tool execution succeeds for some commands but silently fails for others
depending on the security mode. The agent may report success for simple
commands and get blocked on commands that require capabilities removed by
the restricted mode — often without a clear error surface.

## How to detect

Check the config:

```bash
jq '.tools.exec.security' ~/.openclaw/openclaw.json
# Expected: "full"
```

Compare against the expected mode for your deployment posture. Partial
command failures (some exec calls succeed, others return opaque errors) are
the telltale symptom.

## Root cause

OpenClaw's exec tool has a `security` setting that controls which system
calls and filesystem operations the tool can perform. Values below `"full"`
restrict capabilities silently at the runtime layer, which manifests as
unpredictable per-command failures rather than an explicit denial.

The right mode depends on the deployment posture:

- Containerized deployments with Docker-level hardening → `"full"` at the
  tool layer, restrictions enforced by the container.
- Host deployments without container isolation → restricted modes may be
  appropriate, but this is a non-default deployment shape.

## Fix or workaround

For standard ClawHQ-style containerized deployments, set `"full"`:

```json5
{
  tools: {
    exec: {
      host: "gateway",
      security: "full",
    },
  },
}
```

Container-level hardening (cap_drop, read-only rootfs, non-root user, ICC
disabled) is what actually constrains what exec can do. See
[[openclaw/security/container-hardening]] for the full matrix.

## Provenance

Documented in the 14-landmine table of the v2026.4.14 compiled reference.
ClawHQ sets this to `"full"` by construction because its container
hardening provides the actual security boundary.
