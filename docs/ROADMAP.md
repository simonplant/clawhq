# ClawHQ Roadmap

> Where the project is, where it's going, and what's honest aspiration vs shipped reality. See [STRATEGY.md](STRATEGY.md) for strategic context.

**Updated:** 2026-03-28

---

## What's Built

ClawHQ has a working CLI with 78 commands, ~67,000 lines of TypeScript, and 77 test files across all major subsystems. Built with AI-assisted development (Claude Code).

- **Blueprint engine** — 7 use-case blueprints (Email Manager, Family Hub, Founder's Ops, Replace Google Assistant, Replace ChatGPT Plus, Replace my PA, Research Co-pilot) with guided and AI-powered setup, blueprint-specific customization questions
- **Config generation** — all 14 known failure modes ("landmines") auto-prevented during setup
- **Full deploy pipeline** — two-stage Docker build, pre-flight checks, firewall, health verification, smoke tests
- **Container security** ��� hardened by default: `cap_drop: ALL`, read-only rootfs, non-root user, egress firewall with per-integration domain allowlists
- **Diagnostics** — `clawhq doctor` with 14+ checks and auto-fix, predictive health alerts, self-healing
- **Skill system** — 6 built-in skills (email digest, morning brief, market scan, meal plan, schedule guard, investor update) with sandboxed vetting and rollback
- **Workspace tools** — 7 CLI tool generators (email, tasks, todoist, iCal, market quotes, web search, todoist-sync)
- **Operational tooling** — encrypted backup/restore, safe updates with rollback, status dashboard, audit trail (tool execution + egress + secrets), log streaming
- **Agent lifecycle** — portable export with PII masking, verified destruction, approval queue, multi-channel notifications
- **AI-powered setup** — `clawhq init --smart` uses local Ollama to infer configuration from a natural-language description
- **Credential management** — separate `credentials.json` (mode 0600), health probes with expiry tracking
- **Memory lifecycle** — hot/warm/cold tiers, LLM-powered summarization, PII masking
- **Decision trace** — "why did you do that?" explanation system with preference learning
- **Cloud provisioning** — 4 provider adapters (DigitalOcean, AWS, GCP, Hetzner), trust modes (Paranoid/Zero-Trust/Managed), health heartbeat, signed command queue
- **Migration import** — ChatGPT and Google Assistant data export parsing with PII masking

---

## Now — Launch Sequence

Strategy is locked. See [STRATEGY.md](STRATEGY.md). Active focus is the launch sequence:

### Gate 0: Ship-Ready (current sprint focus)

- **FEAT-108** — Decompose 4,320-line CLI into per-command modules (unblocks everything)
- **BUG-125** — Doctor auto-fix: YAML parser instead of regex (Gate 0 blocker for John)
- **BUG-113** — SSH host key collection at provision time (security must)
- **FEAT-110** — Multi-instance support (Gate 0 blocker for John's deploy)
- **FEAT-018** — End-to-end smoke test (**THE LAUNCH GATE** — security tool with security bug is dead on arrival)

### Gate 1: Standards + Security

- **FEAT-121** — Blueprint Specification document (standards capture, foundation absorption defense)
- **FEAT-111** — ClawWall content sanitization (security-by-default requirement)
- **FEAT-115** — SHA256 binary pinning in Docker build (supply chain security)

### Gate 2: Discovery + Revenue

- **FEAT-123** — OpenClaw Security Incident Tracker (authority building, SEO)
- **FEAT-124** — Development-as-content pipeline (discovery fix)
- **FEAT-122** — Sentinel monitoring service design (day-one revenue experiment)
- **FEAT-125** — Assumption validation framework (strategic hypothesis tracking)

---

## Next

Committed direction — immediate priorities after launch gates:

- **10 curated blueprints** — expand from 7 to 10 masterclass blueprints; "small and secure" positioning vs ClawHub's 1,000+ (200+ malicious)
- **Extended identity files** — USER.md, TOOLS.md, domain-specific runbooks (FEAT-118)
- **Model routing per cron job** — cost-efficient model selection per task (FEAT-113)
- **1Password integration** — zero-trust credential vault (FEAT-109)
- **Distro installer** — `curl -fsSL https://clawhq.com/install | sh` one-command install

---

## Later

Vision — directionally committed but data-dependent:

- **Sentinel monitoring service** — upstream intelligence (config breakage prediction, CVE mapping). Pricing and scope depend on willingness-to-pay signal from FEAT-125.
- **Construct meta-skill** — autonomous self-improvement loop (FEAT-112). The "agent grows" differentiator.
- **Operational automation** — auto-update, security monitoring, workspace backup generation (FEAT-120)
- **Domain-based egress firewall** — DNS-resolved allowlists via ipset (FEAT-116)
- **Web dashboard UI** — Hono server scaffolded, UI components not yet built out

**Kill list** (decisions made, do not revisit):
- ~~Community blueprint marketplace~~ — replaced by 10 curated masterclass blueprints
- ~~Managed hosting as primary business~~ — 10+ funded competitors own this; sovereignty is the position
- ~~Revenue deferred until adoption~~ — test from day one via Sentinel
- ~~One-time launch events as growth strategy~~ — development-as-content instead

---

## Known Limitations

- **No distro installer yet** — users must clone the repo and build from source
- **Single machine only** — no multi-machine or cluster deployment
- **Linux and macOS only** — Windows requires WSL
- **Docker required** — no bare-metal option
- **Cloud provisioning exists, managed hosting deprioritized** — 4 provider adapters work
- **Web dashboard is scaffolded** — Hono server runs but UI components not built out
- **Agent runtime integration pending** — memory, learning, autonomy, trace subsystems work standalone

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Foundation absorbs features** — OpenClaw ships guided config | CRITICAL | Blueprint spec as adopted standard + upstream contribution |
| **2M users ≠ addressable demand** — conversion funnel too narrow | CRITICAL | Measure clone→install conversion; pivot if <2% |
| **Trust paradox** — security tool with security bug | HIGH | FEAT-018 launch gate, published test matrix |
| **Revenue timing vs. runway** — solo founder, no funding | HIGH | Sentinel experiment from day one |
| **Local model quality** — small models not good enough | MEDIUM | Intelligent routing escalates to cloud APIs |
| **OpenClaw breaking changes** — upstream updates break integration | MEDIUM | Pinned versions, compatibility shims, rollback |
