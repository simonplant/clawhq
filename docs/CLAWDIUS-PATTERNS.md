# Clawdius Security Pattern Catalog

Clawdius is a production-hardened OpenClaw agent that has been running daily since early 2026. Every security pattern listed here was discovered or validated in real operation — not theoretical.

This document serves two purposes: it tracks which patterns ClawHQ automates (for development reference), and it's a publishable catalog of production security practices for anyone hardening OpenClaw agents (community resource). Each category is a potential standalone article or guide.

**Last updated:** 2026-04-03

---

## Status Legend

| Status | Meaning |
|---|---|
| **Done** | ClawHQ generates/enforces this automatically |
| **Planned** | Backlog item exists — build if demand validates, otherwise publish as guide |
| **Upstream** | OpenClaw provides this natively (noted where applicable) |
| **N/A** | Doesn't apply (see rationale) |

---

## 1. Container Hardening

**Upstream context:** OpenClaw provides native sandboxing (`agents.defaults.sandbox.mode`) with Docker isolation, but the sandbox has been bypassed twice (Snyk Labs, Feb 2026 — policy merge gap on `/tools/invoke` + TOCTOU symlink race). The patterns below harden the host container itself, independent of OpenClaw's sandbox layer.

| Pattern | Clawdius Reference | ClawHQ Status | Notes |
|---|---|---|---|
| Drop all Linux capabilities (`cap_drop: ["ALL"]`) | Dockerfile / compose | **Done** | `src/build/docker/posture.ts` — all 4 postures enforce this |
| `no-new-privileges: true` | compose security_opt | **Done** | `src/build/docker/posture.ts` |
| Read-only root filesystem | compose `read_only: true` | **Done** | Standard posture and above |
| Non-root container user (UID 1000) | Dockerfile USER directive | **Done** | `src/build/docker/posture.ts` |
| Disable inter-container communication | compose network config | **Done** | `src/build/docker/posture.ts` — ICC disabled |
| Resource limits (CPU, memory, PIDs) | compose deploy.resources | **Done** | Posture-scaled limits |
| tmpfs with `noexec,nosuid` | compose tmpfs mounts | **Done** | `src/build/docker/posture.ts` |
| Custom seccomp profile (block ptrace, mount, keyctl, bpf) | seccomp.json | **Planned** ([FEAT-142](../backlog/backlog.json)) | Needs syscall audit of Node.js + Python workloads first |
| Immutable sanitizer baked into image (`/opt/clawwall/`) | Dockerfile COPY + chmod 444 | **Planned** ([FEAT-139](../backlog/backlog.json)) | Currently sanitizer runs host-side only; in-container copy needed for inline tool scanning |

---

## 2. Network Egress Control

| Pattern | Clawdius Reference | ClawHQ Status | Notes |
|---|---|---|---|
| Domain-based egress allowlist via iptables + ipset | iptables CLAWHQ_FWD chain | **Done** | `src/build/launcher/firewall.ts` (774 lines) |
| DNS-resolved ipsets with periodic refresh | cron re-resolve | **Done** | 5-minute refresh cycle via `startIpsetRefresh()` |
| Air-gap mode (block all egress) | iptables DROP all | **Done** | `firewall.ts` air-gap mode |
| IPv4 + IPv6 dual-stack rules | ip6tables rules | **Done** | `clawhq_egress` and `clawhq_egress_v6` ipsets |
| Integration-aware allowlist (auto-add API domains) | per-integration domains | **Done** | `collectIntegrationDomains()` in firewall.ts |
| Firewall verification (live rules vs expected) | manual audit | **Done** | `verifyFirewall()` compares iptables state |
| DNS tunneling mitigation (restrict port 53 to specific resolvers) | restrict port 53 to 1.1.1.1/8.8.8.8 | **Planned** ([FEAT-141](../backlog/backlog.json)) | Currently allows port 53 to 0.0.0.0/0 — last unfiltered egress path |
| Egress firewall test suite (prove rules work from inside container) | docker exec test script | **Planned** ([FEAT-147](../backlog/backlog.json)) | Tests allowed + blocked destinations after every apply |

---

## 3. Credential Isolation

| Pattern | Clawdius Reference | ClawHQ Status | Notes |
|---|---|---|---|
| Host-side credential proxy sidecar | cred-proxy container | **Done** | `src/secure/credentials/proxy-server.ts` — secrets never enter agent container |
| Per-route credential injection (header, body-json-field) | proxy routes config | **Done** | `src/secure/credentials/proxy-routes.ts` — 5 built-in integrations |
| Proxy audit logging (every request logged) | proxy-audit.jsonl | **Done** | Route ID, method, upstream, status, duration, credential injection flag |
| `.env` file permissions enforcement (0600) | manual chmod | **Done** | `src/secure/credentials/env-store.ts` — atomic writes with 0600 |
| `credentials.json` permissions enforcement (0600) | manual chmod | **Done** | `src/secure/credentials/credential-store.ts` |
| 1Password integration for secret fetch | op CLI + service account | **Done** | `src/secure/credentials/claw-secret.ts` |
| Live credential validation probes | manual API test | **Done** | `src/secure/credentials/probes.ts` — Anthropic, OpenAI, Telegram |
| Proxy body size limit (reject oversized requests) | max_body_size config | **Planned** ([FEAT-143](../backlog/backlog.json)) | Default 10MB, per-route overrides for CalDAV |
| Proxy request timeout (reject slow upstreams) | timeout config | **Planned** ([FEAT-143](../backlog/backlog.json)) | Default 30s, per-route overrides |
| Anti-SSRF validation (block private IP ranges, path canonicalization) | path + host validation | **Planned** ([FEAT-144](../backlog/backlog.json)) | Prevent proxy from being tricked into hitting internal endpoints |

---

## 4. Prompt Injection Defense (ClawWall)

**Upstream context:** OpenClaw has no native content sanitization pipeline. The model's own instruction-following is the only defense. ClawWall sits between external content ingestion and LLM context assembly — everything below is additive to OpenClaw.

| Pattern | Clawdius Reference | ClawHQ Status | Notes |
|---|---|---|---|
| Injection keyword detection (50+ patterns) | sanitize.py | **Done** | `src/secure/sanitizer/detect.ts` — Tier 1 high-confidence |
| Delimiter spoofing detection (`<\|im_start\|>`, `[INST]`, etc.) | sanitize.py | **Done** | `src/secure/sanitizer/patterns.ts` |
| Encoded payload detection (base64, hex, URL-encoded) | sanitize.py | **Done** | Flagged if >40 chars or decode keyword present |
| Invisible Unicode stripping (zero-width, directional overrides) | sanitize.py | **Done** | U+200B–U+202F, U+2060–U+2069, U+FE00–U+FE0F, U+E0000–U+E007F |
| Secret leak detection in content (AWS keys, GitHub PATs, JWTs, etc.) | sanitize.py | **Done** | 11 secret patterns in sanitizer, 15+ in scanner |
| Homoglyph normalization (Cyrillic/Greek/Fullwidth confusables) | sanitize.py | **Done** | Tier 2 — normalize then re-check injection patterns |
| Exfiltration markup detection (image tags, iframes embedding data) | sanitize.py | **Done** | Tier 1 high-confidence |
| Few-shot conversation spoofing detection | sanitize.py | **Done** | Detects injected User/Assistant or Q/A patterns |
| Semantic override detection ("from now on", "your new task") | sanitize.py | **Done** | Tier 2 medium-confidence |
| Leetspeak normalization + re-check | sanitize.py | **Done** | 0→o, 1→i, 3→e, etc. |
| Quarantine system (score-based, threshold 0.6) | sanitize.py | **Done** | Content replaced with notice, full text logged to quarantine file |
| Audit trail for all sanitization events | sanitizer-audit.jsonl | **Done** | `src/secure/sanitizer/audit.ts` |
| Multilingual injection (8 languages) | sanitize.py | **Done** | French, Spanish, German, Japanese, Chinese, Korean, Russian, Arabic |
| Multilingual injection expansion (15+ languages) | FEAT-068 | **Planned** ([FEAT-146](../backlog/backlog.json)) | Add Hindi, Turkish, Portuguese, Vietnamese, Thai, Indonesian, Italian |

---

## 5. Egress Content Scanning

**Sustainability note:** This is the most complex category — MITM TLS proxies, self-signed CAs, curl wrappers, request smuggling hardening. These are deep runtime integrations that couple tightly to the agent's execution environment and break when upstream changes transport or channel internals. Each item is significant engineering with ongoing maintenance cost. Under the sustainability test ("if OpenClaw ships a new release, does this break?"), these are the highest-risk items. **Recommendation:** Document as patterns first (high content value — "How to Inspect Your Agent's Outbound Traffic"). Build selectively if community demand validates the investment.

| Pattern | Clawdius Reference | ClawHQ Status | Notes |
|---|---|---|---|
| Telegram egress proxy (MITM TLS, scan sendMessage payloads) | telegram-egress-proxy.py | **Planned** ([FEAT-136](../backlog/backlog.json)) | Primary exfiltration channel — currently zero content inspection |
| Self-signed CA for Telegram proxy (NODE_EXTRA_CA_CERTS) | gen-telegram-certs.sh | **Planned** ([FEAT-136](../backlog/backlog.json)) | Part of FEAT-136 delivery |
| Post-hoc Telegram monitor (host-side, agent cannot disable) | telegram-egress-monitor.py | **Planned** ([FEAT-137](../backlog/backlog.json)) | Defense-in-depth: catches what proxy misses |
| Curl egress wrapper (scan POST/PUT/PATCH bodies at PATH level) | curl-egress-wrapper | **Planned** ([FEAT-138](../backlog/backlog.json)) | Shadows /usr/bin/curl, blocks secret-containing bodies |
| HTTP request smuggling hardening for Telegram proxy | proxy hardening | **Planned** ([FEAT-145](../backlog/backlog.json)) | Depends on FEAT-136; reject dual CL+TE, limit headers |

---

## 6. Monitoring and Alerting

**Upstream context:** OpenClaw provides `openclaw doctor` (basic config validation, `--fix` for invalid keys), `openclaw security audit` (security posture checks), and `openclaw status` (gateway health). The patterns below go deeper — HMAC-chained audit trails, PII scanning, CVE polling, and auto-recovery are not available upstream.

| Pattern | Clawdius Reference | ClawHQ Status | Notes |
|---|---|---|---|
| Health monitoring daemon | systemd service | **Done** | `src/operate/monitor/` — health trends, auto-recovery |
| Audit logging with HMAC chaining (tamper-evident) | audit logs | **Done** | `src/secure/audit/logger.ts` — tool, egress, secret lifecycle streams |
| HMAC chain verification | audit verification | **Done** | `src/secure/audit/reader.ts` — cryptographic event ordering |
| OWASP-compatible audit export | compliance export | **Done** | `src/secure/audit/owasp.ts` |
| PII + secret file scanning | manual scan | **Done** | `src/secure/scanner/` — file content + git history scanning |
| GitHub Security Advisory polling | cron job | **Done** | `ops-security-monitor` doctor check verifies it's active |
| Auto-update systemd timer | systemd timer | **Done** | `ops-autoupdate-active` doctor check verifies it's active |
| Backup rsync snapshots | cron job | **Done** | `ops-backup-recent` doctor check verifies recency |
| Trivy image scanning in build pipeline | manual trivy run | **Planned** ([FEAT-140](../backlog/backlog.json)) | Scan after docker build, gate on HIGH/CRITICAL CVEs |

---

## 7. Operational Tooling (Doctor)

| Pattern | Clawdius Reference | ClawHQ Status | Notes |
|---|---|---|---|
| 14 configuration landmine checks (LM-01 through LM-14) | manual config review | **Done** | `src/config/validate.ts` — all 14 auto-checked |
| Container security posture verification (cap_drop, no-new-privileges, UID) | manual docker inspect | **Done** | `src/operate/doctor/checks.ts` — 5 Docker runtime checks |
| Gateway bind address verification (loopback only) | manual check | **Done** | `gateway-reachable` doctor check |
| Firewall state verification | manual iptables audit | **Done** | `firewall-active` + `firewall-rules-match` doctor checks |
| Ipset staleness detection | manual check | **Done** | `ipset-egress-current` doctor check |
| Credential proxy health check | manual curl | **Done** | `cred-proxy-healthy` doctor check |
| Secret permissions audit (.env, credentials.json) | manual ls -la | **Done** | `secrets-perms` + `creds-perms` doctor checks |
| Disk space monitoring | manual df | **Done** | `disk-space` doctor check |
| Auto-fix for common issues | manual remediation | **Done** | `runDoctorWithFix()` — permissions, firewall, identity files |
| Identity file size budget enforcement | manual check | **Done** | `identity-size` doctor check against `bootstrapMaxChars` |

---

## 8. Identity and Agent Integrity

| Pattern | Clawdius Reference | ClawHQ Status | Notes |
|---|---|---|---|
| Read-only identity files (agent cannot modify own personality) | file permissions | **Done** | Architectural constraint — identity files generated at build time |
| SOUL.md generation with personality dimensions | hand-written SOUL.md | **Done** | `src/design/identity/soul.ts` — 7-axis dimension sliders |
| Silence-is-competence execution philosophy in SOUL.md | SOUL.md operational section | **Planned** ([FEAT-135](../backlog/backlog.json)) | `generateSoul()` lacks execution philosophy layer |
| SHA256 integrity verification of sanitizer at runtime | hash check on invocation | **Planned** ([FEAT-139](../backlog/backlog.json)) | Part of immutable sanitizer layer |

---

## 9. Incident Response and Documentation

| Pattern | Clawdius Reference | ClawHQ Status | Notes |
|---|---|---|---|
| CVE tracking with detection + mitigation mapping | incident log | **Done** | `docs/security/INCIDENTS.md` — 9 CVEs, 1 campaign, 42K exposed instances |
| Configuration landmine documentation | operational notes | **Done** | `docs/OPENCLAW-REFERENCE.md` — 14 landmines with security impact |
| Threat model documentation | operational knowledge | **Planned** ([FEAT-148](../backlog/backlog.json)) | Threat actors, attack surface, defense mapping, residual risks |
| Security architecture diagram (Mermaid) | mental model | **Planned** ([FEAT-148](../backlog/backlog.json)) | Visual of container boundary, network flows, defense layers |
| Operational runbook (per-alert remediation) | tribal knowledge | **Planned** ([FEAT-148](../backlog/backlog.json)) | Trigger → check → remediate for each alert type |

---

## Summary

| Category | Total Patterns | Done | Planned | N/A |
|---|---|---|---|---|
| Container Hardening | 9 | 7 | 2 | 0 |
| Network Egress Control | 8 | 6 | 2 | 0 |
| Credential Isolation | 10 | 7 | 3 | 0 |
| Prompt Injection Defense | 14 | 13 | 1 | 0 |
| Egress Content Scanning | 5 | 0 | 5 | 0 |
| Monitoring and Alerting | 9 | 8 | 1 | 0 |
| Operational Tooling | 10 | 10 | 0 | 0 |
| Identity and Agent Integrity | 4 | 2 | 2 | 0 |
| Incident Response and Documentation | 5 | 2 | 3 | 0 |
| **Total** | **74** | **55** | **19** | **0** |

**Replication rate: 74% done, 26% planned.**

### Gap Assessment

The biggest gap is **egress content scanning** (0/5 done) — Telegram proxy, curl wrapper, and request smuggling hardening. This is also the highest-maintenance category, tightly coupled to upstream transport internals. These patterns are documented in Clawdius and have high value as published security guides, but building them as automated ClawHQ features should be gated behind community demand.

The **incident response and documentation** gap (2/5 done) is the highest-leverage gap to close — threat model, architecture diagram, and operational runbook are pure knowledge artifacts with zero maintenance burden and high content value. These should be published as community resources regardless of product direction.

### Content Opportunity

Each category in this catalog maps to a publishable article or guide:
- "74 Security Patterns for Production OpenClaw" (the full catalog)
- "Container Hardening for OpenClaw: Drop ALL Capabilities and Survive" (§1)
- "Domain-Based Egress Firewalls for AI Agents" (§2)
- "Why Your Agent's Credentials Should Never Touch the Container" (§3)
- "Building a Prompt Injection Defense Pipeline" (§4)
- "Monitoring a Production OpenClaw Agent" (§6)
- "The 10 Doctor Checks That Keep My Agent Alive" (§7)

This is the production security content nobody else in the ecosystem is publishing.

---

## Backlog Coverage

All planned patterns map to existing backlog items. Categorized by sustainability: **Publish** items are pure knowledge with zero maintenance. **Build** items are sustainable (generate, don't wrap). **Gate** items are high-maintenance and should wait for demand signal.

| FEAT | Pattern Category | Priority | Sustainability |
|---|---|---|---|
| [FEAT-148](../backlog/backlog.json) | Documentation — threat model + runbook | should | **Publish** — zero maintenance, high content value |
| [FEAT-146](../backlog/backlog.json) | Injection defense — multilingual | should | **Build** — extends existing sanitizer, low coupling |
| [FEAT-147](../backlog/backlog.json) | Network — firewall test suite | should | **Build** — validates existing firewall, low coupling |
| [FEAT-141](../backlog/backlog.json) | Network — DNS tunneling | should | **Build** — iptables rule addition, low coupling |
| [FEAT-143](../backlog/backlog.json) | Credential — proxy limits | should | **Build** — extends existing proxy, moderate coupling |
| [FEAT-144](../backlog/backlog.json) | Credential — anti-SSRF | should | **Build** — extends existing proxy, moderate coupling |
| [FEAT-140](../backlog/backlog.json) | Monitoring — Trivy scanning | should | **Build** — build-time only, no runtime coupling |
| [FEAT-139](../backlog/backlog.json) | Container — immutable sanitizer | should | **Build** — Dockerfile change, low coupling |
| [FEAT-135](../backlog/backlog.json) | Identity — execution philosophy | could | **Build** — extends soul generator, low coupling |
| [FEAT-142](../backlog/backlog.json) | Container — seccomp profiles | could | **Build** — needs syscall audit first |
| [FEAT-136](../backlog/backlog.json) | Egress scanning — Telegram proxy | should | **Gate** — MITM TLS, high coupling to upstream transport |
| [FEAT-137](../backlog/backlog.json) | Egress scanning — Telegram monitor | should | **Gate** — depends on FEAT-136 |
| [FEAT-138](../backlog/backlog.json) | Egress scanning — curl wrapper | should | **Gate** — PATH-level intercept, breaks on upstream changes |
| [FEAT-145](../backlog/backlog.json) | Egress scanning — request smuggling | should | **Gate** — depends on FEAT-136 |

No Clawdius pattern is untracked.
