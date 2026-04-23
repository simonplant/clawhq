---
title: tools.exec.host wrong value breaks tool execution
category: Decisions
status: active
date: 2026-04-22
tags: [exec, tools, docker, silent-failure, openclaw, landmine]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# `tools.exec.host` wrong value breaks tool execution

## What breaks

- Value `"node"` fails because there is no companion Node runtime to host
  the exec.
- Value `"sandbox"` fails because there is no Docker-in-Docker available
  for sandboxed exec.

In either case, exec tool calls fail silently from the user's perspective —
the agent appears to hang or reports inability to run commands, with no
obvious error in normal logs.

## How to detect

Check the config:

```bash
jq '.tools.exec.host' ~/.openclaw/openclaw.json
# Expected: "gateway"
```

If the agent can read and write files but cannot run shell commands, this
is the most likely cause.

## Root cause

OpenClaw's exec tool can target three hosts: `gateway` (the Gateway
process), `node` (a separate companion Node.js runtime), or `sandbox`
(a Docker-in-Docker sandbox). Most deployments — certainly all ClawHQ
deployments — run exec on the gateway directly. The alternative hosts
require infrastructure that isn't provisioned by default.

## Fix or workaround

Set the value to `"gateway"`:

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

Also verify [[tools-exec-security-not-full]] — these two
failures often appear together.

## Provenance

Documented in the 14-landmine table of the v2026.4.14 compiled reference.
ClawHQ's config generator hardcodes `host: "gateway"` unless a blueprint
explicitly provisions an alternative.

## See also

- [[openclaw-json-schema]]
- [[tools-exec-security-not-full]]
