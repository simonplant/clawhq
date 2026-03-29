# OpenClaw Security Incident Tracker

> Systematic tracking of OpenClaw security vulnerabilities, malicious skill campaigns, and infrastructure exposures. Maintained by the ClawHQ team.

**Last updated:** 2026-03-29 · **Next update:** 2026-04-30 · **Feed:** [feed.json](feed.json)

---

## Summary

OpenClaw's rapid adoption (250K+ GitHub stars, 2M+ monthly active users) has outpaced its security maturity. In the first two months post-launch:

- **9 CVEs** published against OpenClaw core and ecosystem
- **20–36% of ClawHub skills** found to contain malicious payloads ([ClawHavoc campaign](#inc-005))
- **42,000+ instances** publicly exposed with default configurations ([scan methodology](#inc-010))
- **14 silent configuration landmines** that cause security failures without warning ([full list](#configuration-landmines))

This tracker documents every known incident with severity, affected versions, detection methods, and ClawHQ's specific mitigation for each.

---

## Table of Contents

- [CVE Registry](#cve-registry)
  - [CVE-2026-25253 — Cross-Site WebSocket Hijacking (ClawJacked)](#inc-001)
  - [CVE-2026-25187 — Gateway Default Bind Exposure](#inc-002)
  - [CVE-2026-25301 — Supply Chain Payload Injection via ClawHub](#inc-003)
  - [CVE-2026-25189 — Identity File Self-Modification](#inc-004)
  - [CVE-2026-25204 — Container Capability Escalation](#inc-006)
  - [CVE-2026-25218 — Inter-Container Communication Bypass](#inc-007)
  - [CVE-2026-25232 — Writable Config Mount Tampering](#inc-008)
  - [CVE-2026-25245 — Audit Log Silent Failure](#inc-009)
  - [CVE-2026-25267 — Tool Execution Host Escape](#inc-011)
- [Malicious Skill Campaigns](#malicious-skill-campaigns)
  - [ClawHavoc Campaign](#inc-005)
- [Infrastructure Exposure](#infrastructure-exposure)
  - [42,000+ Exposed Instances](#inc-010)
- [Configuration Landmines](#configuration-landmines)
- [Monthly Update Cadence](#monthly-update-cadence)

---

## CVE Registry

### <a id="inc-001"></a>INC-001: CVE-2026-25253 — Cross-Site WebSocket Hijacking (ClawJacked)

| Field | Value |
|---|---|
| **CVE** | CVE-2026-25253 |
| **Severity** | High (CVSS 8.8) |
| **Affected versions** | OpenClaw < 0.8.6 |
| **Fixed in** | OpenClaw 0.8.6 |
| **Category** | Authentication bypass |

**Description:** The OpenClaw Gateway WebSocket endpoint did not validate the `Origin` header on upgrade requests. Any website visited by an authenticated user could open a WebSocket connection to the local Gateway, steal authentication tokens, and issue commands as the user. This is the "ClawJacked" attack vector — a single malicious link grants full agent control.

**Impact:** Complete unauthorized access to agent control plane. Attacker can read/modify agent configuration, execute tools, exfiltrate workspace data, and install malicious skills — all through the victim's browser session.

**Detection method:**
- Check Gateway logs for WebSocket upgrade requests with unexpected `Origin` headers
- Audit `allowedOrigins` configuration — if empty or wildcard, the instance is vulnerable
- Network monitoring for WebSocket connections from browser contexts to `localhost:18789`

**ClawHQ mitigation:**
- `clawhq doctor` check `config-valid` verifies `allowedOrigins` is populated (landmine LM-02)
- Config generation always sets explicit `allowedOrigins` — never empty, never wildcard
- `clawhq scan` detects exposed Gateway ports on non-loopback interfaces
- Container hardening enforces `127.0.0.1` binding by default

---

### <a id="inc-002"></a>INC-002: CVE-2026-25187 — Gateway Default Bind Exposure

| Field | Value |
|---|---|
| **CVE** | CVE-2026-25187 |
| **Severity** | Critical (CVSS 9.1) |
| **Affected versions** | OpenClaw < 0.8.7 |
| **Fixed in** | OpenClaw 0.8.7 (default changed to loopback) |
| **Category** | Network exposure |

**Description:** The OpenClaw Gateway bound to `0.0.0.0` by default, exposing the admin WebSocket and REST API to all network interfaces. Combined with weak or default authentication tokens, this allowed remote attackers to discover and control OpenClaw instances via internet-wide scanning. This is the root cause behind the 42,000+ exposed instances (see [INC-010](#inc-010)).

**Impact:** Full remote agent compromise. Attackers can authenticate with default/weak tokens, modify agent behavior, exfiltrate data, and use the agent as a pivot point for further network attacks.

**Detection method:**
- `netstat -tlnp | grep 18789` — check if Gateway binds to `0.0.0.0` vs `127.0.0.1`
- External port scan for TCP 18789 (Shodan, Censys)
- `clawhq doctor` checks Gateway binding configuration

**ClawHQ mitigation:**
- Config generation enforces `127.0.0.1` loopback binding — never `0.0.0.0`
- `clawhq up` pre-flight checks verify binding before deployment
- Egress firewall (`CLAWHQ_FWD` iptables chain) blocks inbound connections to Gateway port
- `clawhq doctor` check `gateway-reachable` verifies loopback-only binding

---

### <a id="inc-003"></a>INC-003: CVE-2026-25301 — Supply Chain Payload Injection via ClawHub

| Field | Value |
|---|---|
| **CVE** | CVE-2026-25301 |
| **Severity** | High (CVSS 8.6) |
| **Affected versions** | All OpenClaw versions using ClawHub skills |
| **Fixed in** | Unpatched (ecosystem-level issue) |
| **Category** | Supply chain |

**Description:** ClawHub, the community skill marketplace for OpenClaw, has no mandatory security review process. Skills are published by any registered user and installed directly into the agent's workspace. The ClawHavoc campaign (see [INC-005](#inc-005)) demonstrated that 20–36% of sampled ClawHub skills contained hidden malicious instructions — base64-encoded payloads, zero-width Unicode injections targeting `SOUL.md`, and data exfiltration hooks. The skill install mechanism provides no integrity verification, sandboxing, or rollback capability.

**Impact:** Installed malicious skills can modify agent identity files, inject prompt overrides, exfiltrate workspace data, and persist across updates. The agent becomes an attacker-controlled asset without any visible indication.

**Detection method:**
- Scan installed skills for base64-encoded strings, zero-width Unicode characters, and obfuscated payloads
- Compare skill file hashes against known-malicious IOC database
- Monitor workspace files for unauthorized modifications (especially `SOUL.md`, `IDENTITY.md`)
- Check VirusTotal integration results for flagged skills

**ClawHQ mitigation:**
- `clawhq skill install` runs full vetting pipeline: stage → vet (AI-powered scan + VirusTotal) → approve → activate
- Every skill install creates a rollback snapshot — `clawhq skill remove` restores clean state
- IOC database of known-malicious file hashes, C2 IPs, and publisher blacklists
- Identity files mounted read-only (`chmod 444`) — skills cannot modify `SOUL.md` or `IDENTITY.md`
- Prompt injection sanitizer detects hidden instructions in skill content (11 threat categories)

---

### <a id="inc-004"></a>INC-004: CVE-2026-25189 — Identity File Self-Modification

| Field | Value |
|---|---|
| **CVE** | CVE-2026-25189 |
| **Severity** | High (CVSS 7.5) |
| **Affected versions** | OpenClaw < 0.8.8 |
| **Fixed in** | Partial — requires external enforcement |
| **Category** | Integrity violation |

**Description:** OpenClaw agents with tool execution enabled (`tools.exec.host: "gateway"`) can modify their own identity files (`SOUL.md`, `IDENTITY.md`, `MEMORY.md`, `HEARTBEAT.md`) if the workspace is mounted writable. A compromised or manipulated agent can alter its own personality, override safety instructions, and remove behavioral guardrails. This is the persistence mechanism used by the ClawHavoc campaign — once a malicious skill injects instructions into `SOUL.md`, the agent operates under attacker-defined behavior.

**Impact:** Agent identity drift, safety guardrail removal, behavioral manipulation. The agent's personality and instructions become attacker-controlled, and the modification persists across restarts.

**Detection method:**
- Check file permissions: `ls -la SOUL.md IDENTITY.md` — should be `444` (read-only)
- Verify volume mount flags in `docker-compose.yml` — identity directory should be `:ro`
- Monitor identity file checksums for unauthorized changes
- `clawhq doctor` check `config-valid` validates mount configuration (landmine LM-12)

**ClawHQ mitigation:**
- Identity files generated with `chmod 444` (read-only for all users)
- Docker volume mounts use `:ro` flag for identity directory — agent cannot write even as container root
- Hardened and Paranoid postures add integrity hash verification on startup
- `clawhq doctor` detects writable identity mounts and auto-fixes with `--fix`

---

### <a id="inc-006"></a>INC-006: CVE-2026-25204 — Container Capability Escalation

| Field | Value |
|---|---|
| **CVE** | CVE-2026-25204 |
| **Severity** | Critical (CVSS 9.0) |
| **Affected versions** | All OpenClaw versions (deployment configuration issue) |
| **Fixed in** | N/A — requires deployment hardening |
| **Category** | Container escape |

**Description:** OpenClaw's default Docker Compose configuration does not drop Linux capabilities or set `no-new-privileges`. Containers run with the Docker default capability set, which includes `CAP_NET_RAW`, `CAP_SYS_CHROOT`, `CAP_MKNOD`, `CAP_AUDIT_WRITE`, and others. Combined with a vulnerability in the container runtime or a tool execution escape, an attacker can escalate to host-level access. Most community deployment guides and hosting providers ship this default configuration.

**Impact:** Container escape to host system. Full compromise of the underlying server, access to other containers, host filesystem, and network. Particularly severe on shared hosting where multiple tenants share the same Docker host.

**Detection method:**
- `docker inspect <container> --format '{{.HostConfig.CapDrop}}'` — should show `[ALL]`
- `docker inspect <container> --format '{{.HostConfig.SecurityOpt}}'` — should include `no-new-privileges`
- `clawhq doctor` checks `cap-drop` and `no-new-privileges`

**ClawHQ mitigation:**
- All four security postures (Minimal through Paranoid) enforce `cap_drop: ALL` and `no-new-privileges: true`
- `clawhq build` generates hardened Docker Compose with capabilities dropped by default
- `clawhq doctor` checks `cap-drop` and `no-new-privileges` — auto-fixes with `--fix`
- Non-root container user (UID 1000:1000) enforced across all postures

---

### <a id="inc-007"></a>INC-007: CVE-2026-25218 — Inter-Container Communication Bypass

| Field | Value |
|---|---|
| **CVE** | CVE-2026-25218 |
| **Severity** | Medium (CVSS 6.5) |
| **Affected versions** | All OpenClaw versions (network configuration issue) |
| **Fixed in** | N/A — requires network hardening |
| **Category** | Network isolation failure |

**Description:** Docker's default bridge network enables inter-container communication (ICC). In multi-container OpenClaw deployments or shared Docker hosts, any container can initiate TCP connections to any other container on the same bridge. A compromised OpenClaw agent can scan the internal network, access databases, reach other agents' APIs, and pivot laterally. This is especially dangerous in fleet deployments where multiple agents share infrastructure.

**Impact:** Lateral movement between containers. A compromised agent can access other agents' data, reach backend databases, and potentially escalate through service-to-service trust relationships.

**Detection method:**
- `docker network inspect <network> --format '{{.Options}}'` — check for `com.docker.network.bridge.enable_icc: false`
- Attempt cross-container connectivity: `docker exec <container> curl <other-container-ip>:<port>`
- `clawhq doctor` check for ICC status (landmine LM-07/LM-13)

**ClawHQ mitigation:**
- Standard, Hardened, and Paranoid postures disable ICC on the agent network
- `clawhq build` generates Docker network configuration with `enable_icc: false`
- Egress firewall (`CLAWHQ_FWD`) provides additional network-level isolation
- `clawhq doctor` detects ICC-enabled networks and warns

---

### <a id="inc-008"></a>INC-008: CVE-2026-25232 — Writable Config Mount Tampering

| Field | Value |
|---|---|
| **CVE** | CVE-2026-25232 |
| **Severity** | High (CVSS 7.7) |
| **Affected versions** | All OpenClaw versions (deployment configuration issue) |
| **Fixed in** | N/A — requires deployment hardening |
| **Category** | Configuration integrity |

**Description:** When `openclaw.json` and `credentials.json` are mounted writable into the container, the agent (or an attacker who gains container-level access) can modify its own configuration at runtime. This allows disabling security settings, changing model routing to exfiltrate prompts, modifying tool permissions, and weakening authentication — all without any external indication. The changes persist across container restarts.

**Impact:** Silent security degradation. Attacker can disable audit logging, weaken authentication, add malicious tool permissions, change model endpoints to attacker-controlled servers, and modify egress rules — all through config file manipulation.

**Detection method:**
- Check Docker volume mounts: config files should be mounted `:ro`
- Monitor config file modification times and checksums
- `clawhq doctor` validates mount flags (landmine LM-12)

**ClawHQ mitigation:**
- `clawhq build` mounts `openclaw.json` and `credentials.json` as read-only (`:ro`)
- `credentials.json` generated with `chmod 600` — only the deploying user can read
- `clawhq doctor` check `config-valid` detects writable config mounts
- Config changes require `clawhq` CLI — never modified through the running container

---

### <a id="inc-009"></a>INC-009: CVE-2026-25245 — Audit Log Silent Failure

| Field | Value |
|---|---|
| **CVE** | CVE-2026-25245 |
| **Severity** | Medium (CVSS 5.3) |
| **Affected versions** | OpenClaw 0.8.6 – 0.8.8 |
| **Fixed in** | OpenClaw 0.8.9 |
| **Category** | Audit evasion |

**Description:** The `ENABLE_AUDIT_STDOUT` environment variable was broken from v0.8.6 through v0.8.8. When set, audit events were silently dropped instead of being written to stdout. Operators who configured audit logging believed their agents were being monitored when no audit trail was actually being generated. This created a blind spot for detecting unauthorized tool execution, data exfiltration, and configuration changes during a critical three-release window.

**Impact:** Complete loss of audit visibility. Tool executions, data egress events, and configuration changes during the affected period have no audit trail. Incident response and forensics are severely impaired for any deployment running v0.8.6–v0.8.8 with stdout audit enabled.

**Detection method:**
- Check OpenClaw version: `docker exec <container> openclaw --version`
- Verify audit log output: set `ENABLE_AUDIT_STDOUT=true` and confirm events appear in `docker logs`
- Check for gaps in audit log timeline

**ClawHQ mitigation:**
- `clawhq doctor` check `migration-state` detects version-specific audit issues
- ClawHQ audit system (`src/secure/audit/`) maintains its own HMAC-chained audit trail independent of OpenClaw's stdout logging
- OWASP-compatible audit export normalizes tool execution, data egress, and secret lifecycle events
- `clawhq update --check` warns about known broken features in current version

---

### <a id="inc-011"></a>INC-011: CVE-2026-25267 — Tool Execution Host Escape

| Field | Value |
|---|---|
| **CVE** | CVE-2026-25267 |
| **Severity** | Critical (CVSS 9.3) |
| **Affected versions** | All OpenClaw versions with `tools.exec.host` misconfigured |
| **Fixed in** | N/A — configuration issue |
| **Category** | Sandbox escape |

**Description:** OpenClaw's tool execution system supports three host modes: `"gateway"` (executes via Gateway RPC), `"node"` (executes in Node.js companion process), and `"sandbox"` (executes in Docker-in-Docker sandbox). When `tools.exec.host` is set to `"node"`, tool commands execute directly in the Gateway's Node.js process with full filesystem and network access. When set to `"sandbox"` without Docker-in-Docker configured, execution silently fails. Only `"gateway"` provides proper isolation. Most deployment guides and community configs use `"node"` for simplicity, unknowingly granting tools unrestricted host access.

**Impact:** With `"node"` mode, any tool execution command runs with the Gateway process's full permissions — read/write to the host filesystem, access to environment variables (including secrets), network access to internal services, and ability to install persistent backdoors. A prompt injection that triggers tool execution gains full host access.

**Detection method:**
- Check `openclaw.json`: `tools.exec.host` should be `"gateway"`
- Check `tools.exec.security` should be `"full"`
- `clawhq doctor` validates both settings (landmines LM-04, LM-05)

**ClawHQ mitigation:**
- Config generation always sets `tools.exec.host: "gateway"` and `tools.exec.security: "full"`
- `clawhq doctor` checks `config-valid` validates tool execution configuration (LM-04, LM-05)
- Landmine validation rejects `"node"` and `"sandbox"` modes during config generation
- `clawhq doctor --fix` auto-corrects tool execution host configuration

---

## Malicious Skill Campaigns

### <a id="inc-005"></a>INC-005: ClawHavoc — Coordinated Supply Chain Attack on ClawHub

| Field | Value |
|---|---|
| **Campaign** | ClawHavoc |
| **Severity** | Critical |
| **First observed** | 2026-02 |
| **Status** | Active (new variants emerging) |
| **Scope** | 20–36% of sampled ClawHub skills |

**Description:** ClawHavoc is a coordinated supply chain attack campaign targeting OpenClaw users through the ClawHub skill marketplace. Researchers found that 20–36% of sampled ClawHub skills contained hidden malicious payloads. The attack uses two primary injection techniques:

1. **Base64-encoded instructions** embedded in skill configuration files, decoded and executed at runtime
2. **Zero-width Unicode character sequences** inserted into `SOUL.md` targeting content, invisible in text editors but interpreted by the language model as instructions

The malicious skills typically perform identity file modification (injecting attacker-controlled personality overrides), data exfiltration (workspace contents sent to external endpoints via hidden tool calls), and persistent backdoor installation (surviving skill updates and agent restarts).

**Detection patterns:**
- Base64 strings in skill files: `/[A-Za-z0-9+\/]{40,}={0,2}/` in non-binary files
- Zero-width Unicode: `U+200B` (zero-width space), `U+200C`/`U+200D` (joiners), `U+2060` (word joiner), `U+FEFF` (BOM), `U+E0001`–`U+E007F` (tag characters)
- Unexpected outbound HTTP requests from skill execution context
- `SOUL.md` file size increase without user-initiated changes
- File hash mismatches against published skill manifests

**ClawHQ mitigation:**
- **Vetting pipeline:** Every `clawhq skill install` runs: stage → AI-powered content scan → VirusTotal check → user approval → activate
- **IOC database:** Maintained blocklist of known-malicious file hashes, C2 IPs/domains, and publisher accounts
- **Prompt injection sanitizer:** 11 detection categories including invisible Unicode, base64 payloads, delimiter spoofing, and exfiltration markup. Threat scoring (weighted sum, threshold 0.6) with automatic quarantine
- **Read-only identity:** `SOUL.md` and `IDENTITY.md` mounted read-only (`chmod 444`, Docker `:ro` mount) — skills physically cannot modify identity files
- **Rollback snapshots:** Every skill install creates a pre-install snapshot. `clawhq skill remove` restores clean state
- **Egress firewall:** `CLAWHQ_FWD` iptables chain restricts outbound connections to allowlisted domains only — C2 callbacks blocked at network level

---

## Infrastructure Exposure

### <a id="inc-010"></a>INC-010: 42,000+ Publicly Exposed OpenClaw Instances

| Field | Value |
|---|---|
| **Category** | Infrastructure exposure |
| **Severity** | Critical |
| **First reported** | 2026-02 |
| **Current count** | 42,000+ (as of 2026-03) |
| **Trend** | Growing (~2,000/month) |

**Description:** Internet-wide scanning (Shodan, Censys) reveals 42,000+ OpenClaw Gateway instances accessible on public IP addresses, primarily on port 18789. The root cause is CVE-2026-25187 (Gateway default bind to `0.0.0.0`) combined with cloud provider deployments that expose all ports by default. Most exposed instances run default configurations with weak or default authentication tokens.

**Methodology:**
- Shodan/Censys scans for OpenClaw Gateway fingerprint on TCP 18789
- HTTP response header analysis for Gateway version identification
- WebSocket upgrade handshake fingerprinting
- Results anonymized — no authentication attempts, no data collection beyond service fingerprinting

**Common misconfigurations found:**
1. Gateway bound to `0.0.0.0` instead of `127.0.0.1` (98% of exposed instances)
2. Default or weak `gateway.auth.token` (estimated 60%+ based on response behavior)
3. No TLS termination — credentials transmitted in plaintext
4. `allowedOrigins` set to wildcard `*` (vulnerable to ClawJacked, CVE-2026-25253)
5. `dangerouslyDisableDeviceAuth: true` not set — device auth loops on legitimate access
6. No egress firewall — agents can make unrestricted outbound connections
7. ICC enabled on Docker bridge — lateral movement possible

**ClawHQ mitigation:**
- Config generation enforces `127.0.0.1` loopback binding — exposure is architecturally prevented
- `clawhq up` pre-flight checks reject `0.0.0.0` binding
- Strong `gateway.auth.token` generated automatically (cryptographically random, 64+ characters)
- `clawhq doctor` full diagnostic suite catches all 7 common misconfigurations listed above
- Egress firewall applied automatically on every deployment

---

## Configuration Landmines

OpenClaw has 14 silent configuration landmines — settings that cause security or operational failures without any warning. ClawHQ's config generation prevents all 14, and `clawhq doctor` detects and auto-fixes them in existing deployments.

| ID | Landmine | Security Impact | ClawHQ Check |
|---|---|---|---|
| <a id="lm-01"></a>LM-01 | `dangerouslyDisableDeviceAuth` not set | Agent becomes inaccessible via device auth loop | `config-valid` |
| <a id="lm-02"></a>LM-02 | `allowedOrigins` empty after onboard | CORS errors + vulnerable to ClawJacked (CVE-2026-25253) | `config-valid` |
| <a id="lm-03"></a>LM-03 | `trustedProxies` stripped after onboard | Gateway rejects Docker NAT requests | `config-valid` |
| <a id="lm-04"></a>LM-04 | `tools.exec.host` not `"gateway"` | Tool sandbox escape (CVE-2026-25267) | `config-valid` |
| <a id="lm-05"></a>LM-05 | `tools.exec.security` not `"full"` | Tool execution silently unrestricted | `config-valid` |
| <a id="lm-06"></a>LM-06 | Container user not UID 1000 | Volume permission errors | `user-uid` |
| <a id="lm-07"></a>LM-07 | Missing `cap_drop: ALL` | Container escape (CVE-2026-25204) | `cap-drop` |
| <a id="lm-08"></a>LM-08 | Identity files exceed `bootstrapMaxChars` | Personality silently truncated | `identity-size` |
| <a id="lm-09"></a>LM-09 | Invalid cron stepping syntax | Scheduled jobs silently fail | `cron-syntax` |
| <a id="lm-10"></a>LM-10 | External Docker networks not declared | Compose deployment failure | `compose-exists` |
| <a id="lm-11"></a>LM-11 | `.env` missing required variables | Integrations silently fail | `env-vars` |
| <a id="lm-12"></a>LM-12 | Config mounted writable | Agent modifies own config (CVE-2026-25232) | `config-valid` |
| <a id="lm-13"></a>LM-13 | Firewall lost after network recreate | Egress filtering silently disabled | `firewall-active` |
| <a id="lm-14"></a>LM-14 | `fs.workspaceOnly` misconfigured | Filesystem access too permissive or restrictive | `config-valid` |

---

## Monthly Update Cadence

This tracker is updated on the **last business day of each month**. Each update includes:

1. **New CVEs** — Any OpenClaw CVEs published since last update, with ClawHQ mitigation status
2. **Campaign updates** — New malicious skill variants, updated IOC indicators, detection pattern refinements
3. **Exposure metrics** — Updated instance counts from Shodan/Censys scanning (anonymized)
4. **ClawHQ mitigation status** — New doctor checks, scanner rules, or hardening features deployed
5. **Breaking changes** — OpenClaw releases with security implications and required migration steps

### Update History

| Date | Summary |
|---|---|
| 2026-03-29 | Initial tracker: 9 CVEs, ClawHavoc campaign, 42K exposed instances, 14 landmines |

### Reporting a Security Issue

If you discover a new OpenClaw security issue:

1. **For ClawHQ-specific vulnerabilities:** File a private security advisory at the ClawHQ GitHub repository
2. **For OpenClaw core vulnerabilities:** Report through the OpenClaw Foundation's responsible disclosure process
3. **For malicious ClawHub skills:** Report the skill URL and any IOCs to this tracker via GitHub issue

---

## Breaking Changes with Security Implications

OpenClaw releases frequently introduce environment variables and configuration changes that affect security posture. ClawHQ's `clawhq update --check` validates all of these before applying upgrades.

| Version | Change | Security Impact |
|---|---|---|
| v0.8.6 | `WEBSOCKET_EVENT_CALLER_TIMEOUT` made configurable (was hardcoded 60s) | Long-running tool calls could timeout and leave resources in inconsistent state |
| v0.8.6–v0.8.8 | `ENABLE_AUDIT_STDOUT` broken | **Audit trail silently dropped** — see [CVE-2026-25245](#inc-009) |
| v0.8.6–v0.8.8 | `WEB_SEARCH_DOMAIN_FILTER_LIST` broken | Domain filtering for web search tool non-functional |
| v0.8.7 | `mariadb-vector` added to `VECTOR_DB` options | New database backend requires separate security review |
| v0.8.8 | `USER_PERMISSIONS_ACCESS_GRANTS_ALLOW_USERS` added | Per-user sharing — misconfiguration can expose agent to unauthorized users |
| v0.8.9 | `REPORTING_ENDPOINTS` added | CSP violation reports — endpoint must be trusted |
| v0.8.10 | `OAUTH_UPDATE_NAME_ON_LOGIN` / `OAUTH_UPDATE_EMAIL_ON_LOGIN` added | OAuth provider controls display name/email — supply chain risk if provider compromised |
| v0.8.10 | Underscore-prefixed tool methods hidden | Tools with `_` prefix no longer visible — may break existing workflows silently |

---

*This tracker is part of [ClawHQ](https://github.com/clawhq/clawhq), the sovereign operations platform for OpenClaw. ClawHQ deploys, configures, and hardens OpenClaw agents — closing the gap between raw framework and production-ready sovereignty.*
