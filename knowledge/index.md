# Index

## Features

- [[agents-md]] — AGENTS.md (openclaw/component)
- [[auto-reply-router]] — Auto-reply router (openclaw/component)
- [[blueprint-system]] — Blueprint system (clawhq/architecture)
- [[bootstrap-md]] — BOOTSTRAP.md (openclaw/component)
- [[doctor-diagnostics]] — Doctor preventive diagnostics (openclaw/operation)
- [[gateway-process]] — Gateway process (openclaw/component)
- [[golden-config-pattern]] — Golden config pattern (openclaw/operation)
- [[heartbeat-md]] — HEARTBEAT.md (openclaw/component)
- [[identity-md]] — IDENTITY.md (openclaw/component)
- [[integration-layer]] — Integration layer (openclaw/operation)
- [[managed-mode]] — Managed mode architecture (clawhq/architecture)
- [[memory-search]] — Memory search configuration (openclaw/configuration)
- [[memory-md]] — MEMORY.md (openclaw/component)
- [[openclaw-json-schema]] — openclaw.json schema (openclaw/configuration)
- [[soul-md]] — SOUL.md (openclaw/component)
- [[tools-md]] — TOOLS.md (openclaw/component)
- [[two-stage-docker-build]] — Two-stage Docker build (openclaw/operation)
- [[user-md]] — USER.md (openclaw/component)

## Personas


## Decisions

- [[env-missing-required-variables]] — .env missing required variables causes silent integration failures (openclaw/landmine)
- [[allowed-origins-stripped]] — allowedOrigins stripped after onboard breaks Control UI (openclaw/landmine)
- [[config-credentials-not-read-only]] — Config and credentials not mounted read-only lets agent modify itself (openclaw/landmine)
- [[container-hardening]] — Container hardening (openclaw/security)
- [[container-user-not-uid-1000]] — Container user not UID 1000 causes volume permission errors (openclaw/landmine)
- [[credential-health-probes]] — Credential health probes (openclaw/security)
- [[egress-firewall]] — Egress firewall (openclaw/security)
- [[firewall-not-reapplied-after-network-recreate]] — Egress firewall not reapplied after Docker network recreate (openclaw/landmine)
- [[external-networks-not-created]] — External Docker networks not created before compose up (openclaw/landmine)
- [[files-are-the-agent]] — Files are the agent (openclaw/concept)
- [[fs-workspace-only-misconfigured]] — fs.workspaceOnly misconfigured either blocks media or leaks host FS (openclaw/landmine)
- [[icc-enabled-on-agent-network]] — ICC enabled on agent network breaches container isolation (openclaw/landmine)
- [[identity-files-exceed-bootstrap-max-chars]] — Identity files exceed bootstrapMaxChars and silently truncate (openclaw/landmine)
- [[cron-stepping-syntax-invalid]] — Invalid cron stepping syntax causes jobs to silently never run (openclaw/landmine)
- [[lifecycle-management-gap]] — Lifecycle management gap (clawhq/concept)
- [[memory-system]] — Memory system (openclaw/concept)
- [[dangerously-disable-device-auth-missing]] — Missing dangerouslyDisableDeviceAuth causes device signature invalid loop (openclaw/landmine)
- [[prompt-injection-defense]] — Prompt injection defense (openclaw/security)
- [[rotating-heartbeat]] — Rotating heartbeat pattern (openclaw/pattern)
- [[system-prompt-assembly]] — System prompt assembly (openclaw/concept)
- [[cpanel-analogy]] — The cPanel analogy (clawhq/concept)
- [[threat-model]] — Threat model (openclaw/security)
- [[tools-exec-host-wrong-value]] — tools.exec.host wrong value breaks tool execution (openclaw/landmine)
- [[tools-exec-security-not-full]] — tools.exec.security not full silently restricts tool execution (openclaw/landmine)
- [[trusted-proxies-stripped]] — trustedProxies stripped after onboard rejects Docker NAT requests (openclaw/landmine)
- [[workspace-as-agent]] — Workspace as agent (openclaw/concept)

## Competitors

- [[clawhq-vs-alternatives]] — ClawHQ vs. alternatives (clawhq/comparison)

## Metrics

- [[key-principles]] — Key principles (openclaw/finding)
- [[heartbeat-token-sink]] — Native heartbeat is a token sink (openclaw/finding)
- [[production-discoveries]] — Production discoveries (openclaw/finding)

## Sources

- [[openclaw-reference-v2026-4-14]] — openclaw-reference-v2026.4.14
