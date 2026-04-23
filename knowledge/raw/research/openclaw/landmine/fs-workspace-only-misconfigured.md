---
title: fs.workspaceOnly misconfigured either blocks media or leaks host FS
subject: openclaw
type: landmine
status: active
severity: medium
affects: "All deployments; choice depends on security posture"
openclaw_version: ">=v2026.4.12"
last_verified: 2026-04-22
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
source_types: [compiled-reference]
see_also:
  - openclaw/configuration/openclaw-json-schema.md
  - openclaw/concept/media-understanding.md
  - openclaw/security/threat-model.md
tags: [filesystem, tools, sandbox, security]
landmine_number: 14
---

# `fs.workspaceOnly` misconfigured either blocks media or leaks host FS

## What breaks

Two failure modes depending on the direction of the misconfiguration:

- **Too restrictive** (`workspaceOnly: true` on a deployment expecting
  host paths): The agent cannot read media files, attached documents,
  or host-scoped resources the operator intended it to access.
- **Too permissive** (`workspaceOnly: false` on a deployment expecting
  sandboxing): The agent can read files outside the workspace — session
  transcripts, credentials, anything else on the filesystem the container
  user can reach.

## How to detect

Check the current value:

```bash
jq '.tools.fs.workspaceOnly' ~/.openclaw/openclaw.json
```

Confirm it matches the expected value for the deployment's security
template. Most ClawHQ deployments expect `true`; development deployments
or specific integration configurations may expect `false`.

**Important:** `fs.workspaceOnly` does NOT govern media understanding.
The media staging pipeline runs before the agent's file tools are
invoked — it copies media into the workspace independently. If media
understanding is broken, look elsewhere; don't assume this setting is
the cause.

## Root cause

`tools.fs.workspaceOnly` controls whether the agent's `read`, `write`,
`edit`, and `apply_patch` tools are scoped to the workspace root. It
does not bound the media pipeline, subprocess execution, or memory
search's `extraPaths` — each of those has its own scoping.

The failure mode is specifically about the file tools: a too-tight value
confuses operators who expect the agent to read host-scoped files a tool
can technically reach; a too-loose value is a quiet security regression.

## Fix or workaround

Set the value explicitly to match the security template your deployment
is running under. For standard hardened deployments:

```json5
{
  tools: {
    fs: {
      workspaceOnly: true,
    },
  },
}
```

If a specific use case needs host paths, scope them via `memorySearch.extraPaths`
(read-only, indexed) rather than loosening the file tool scope globally.

## Provenance

Documented in the 14-landmine table of the v2026.4.14 compiled reference.
ClawHQ's config generator sets this based on the chosen security template
rather than a hardcoded default; `clawhq doctor` flags drift from the
template's expected value.
