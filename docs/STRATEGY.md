# ClawHQ Strategy

> Direction is locked. Hypotheses are open. Execution starts now.

**Updated:** 2026-03-28

---

## One-Liner

Ship the self-hosted sovereignty tool with a published blueprint spec, 10 curated-not-crowdsourced blueprints, a monitoring revenue experiment, and content that emerges from development — not from a separate calendar.

---

## Strategic Position

ClawHQ is the operational intelligence layer for OpenClaw's 2M-user ecosystem — the compiler between the raw framework and a production-grade agent. The only position 10+ hosting providers can't occupy is sovereignty. ClawHQ owns that layer.

**What converged across all analysis:**
- Self-hosted sovereignty tool, shipped to the existing OpenClaw audience
- Positioned above hosting providers (picks and shovels, not gold mining)
- Standards capture via blueprint format is the durable moat
- Revenue must be tested from day one, not deferred

---

## Four Execution Fixes

The strategy survived all stress testing. Four wounds were identified — all in execution, all fixable, all complementary.

### 1. Discovery: Development-as-Content

**Problem:** One-time launch events (HN post, Discord announcement) decay in 72 hours. Competitors publish compounding SEO content weekly.

**Fix:** Every development action produces content. Bug fix → postmortem. New blueprint → tutorial. OpenClaw breaking change → "what broke and how we fixed it." Content is a byproduct of development, not a separate activity.

**Implementation:** CHANGELOG as narrative (not version list). Each landmine fix is a technical article. Each blueprint is a use-case walkthrough. The HN post is the first commit in a content stream, not a one-time event.

### 2. Community: 10 Curated, Not 1,000 Crowdsourced

**Problem:** Community blueprint contribution at scale is fantasy. 1,000:10:1 ratio (users:reporters:contributors). Terraform took 4+ years with full-time DevRel.

**Fix:** Kill the marketplace expectation. Build 10 reference blueprints, each a masterclass. Position "small and secure" as the differentiator — 10 vetted vs. 1,000 ClawHub items (200+ malicious).

**Implementation:** Current 7 blueprints → 10 reference blueprints. Each one demonstrates deep understanding of the use case. Quality bar: reading the Email Manager blueprint should make you think "this person understands how I actually use email."

### 3. Standards: Publish the Blueprint Specification

**Problem:** Standards require specs. ClawHQ's blueprint format exists only in TypeScript — it can't travel without documentation. A competing format from the foundation could split the ecosystem.

**Fix:** Publish the Blueprint Specification as a human-readable document alongside the repo. If the format becomes the community default, ClawHQ owns the reference implementation.

**Why this is also the foundation absorption defense:** If OpenClaw ships `openclaw configure --guided`, they'd need to be compatible with the adopted spec. The spec IS the hedge against absorption — not surveillance of their PRs.

**Implementation:** Formal spec document covering structure, fields, validation rules, security constraints. Not a weekend — estimate a week for something rigorous enough to drive third-party adoption.

### 4. Revenue: Sentinel Monitoring Experiment

**Problem:** Open-source infrastructure monetization takes 2-4 years. Every precedent required VC funding to bridge the gap. Solo founder following the same playbook without funding is volunteering for unpaid work.

**Fix:** Launch with a paid monitoring service from day one. Test revenue hypothesis in 30 days, not 18 months.

**Critical design constraint:** Must do something a local cron job can't. `clawhq doctor --watch` in cron is free. The value must be upstream intelligence — pre-computing whether your config will break against incoming OpenClaw commits before you update, tracking CVE impact across your specific blueprint, alerting on breaking changes in skills you depend on. That's genuinely useful. A WebSocket health check is not.

**Pricing:** ~$19/month. Low enough to be impulse, high enough to validate demand. If nobody pays in 30 days, signal received.

---

## Launch Sequence

```
1. Fix FEAT-018 (e2e smoke test)        — launch gate, no compromises
2. Fix remaining Gate 0 blockers         — BUG-125, FEAT-110, FEAT-108
3. Write Blueprint Specification         — highest-leverage documentation
4. Start OpenClaw Incident Tracker       — authority building, runs in parallel
5. Publish repo                          — GitHub public
6. Announce Sentinel experiment          — revenue hypothesis test
7. Write launch content                  — "14 ways my agent silently broke"
8. Every subsequent commit → content     — development-as-content begins
```

---

## Kill List

These are dead. Do not resurrect.

- **"Community contributes blueprints at scale"** — power law says no. Build 10 masterclass blueprints yourself.
- **"Revenue deferred indefinitely"** — test from day one or accept this is a hobby.
- **"One-time launch event as growth strategy"** — HN front page lasts 12 hours. Content compounds.
- **"Marketplace/hub for community skills"** — 20-36% of ClawHub skills are malicious. Curated beats open.

---

## Root Vulnerabilities

Ranked by blast radius. These are the things that could invalidate the strategy.

| # | Vulnerability | Severity | Mitigation |
|---|---|---|---|
| 1 | **Foundation absorbs features** — OpenClaw ships `openclaw configure --guided` | CRITICAL | Blueprint spec as adopted standard. Upstream contribution from position of credibility. |
| 2 | **2M users ≠ addressable demand** — each filter cuts 80-90% | CRITICAL | Test assumption: measure clone→install conversion in first 1,000 visitors. Pass/fail: >5%. |
| 3 | **Revenue timing vs. runway** — 2-4 year gap with no funding | HIGH | Sentinel experiment from day one. Hard deadline: 3+ willing payers by month 9. |
| 4 | **Trust paradox** — security tool with security bug is brand-killer | HIGH | FEAT-018 is the launch gate. Published test matrix. Alpha scoped explicitly. |
| 5 | **Community contribution is article of faith** — 1,000 users yields ~1 contributor | MEDIUM | Expectations reset to 10-15 developer-built, 5-10 community over 12 months. |

---

## Assumption Tests

Three highest-risk assumptions, with concrete pass/fail criteria.

### Test 1: Addressable Demand
- **Assumption:** OpenClaw's 2M+ users includes meaningful demand for a deployment tool
- **Test:** Measure GitHub clone → `clawhq install` conversion in first 1,000 unique visitors
- **Pass:** >5% conversion (50+ installs)
- **Fail:** <2% conversion — thesis is wrong, pivot to authority play
- **Deadline:** 30 days after repo goes public

### Test 2: Willingness to Pay
- **Assumption:** Sovereignty audience will pay for monitoring that enhances (not compromises) sovereignty
- **Test:** Sentinel landing page with pricing, measure signups
- **Pass:** 10+ signups in 60 days
- **Fail:** <3 signups — monitoring isn't the revenue model
- **Deadline:** 60 days after Sentinel announced

### Test 3: Foundation Absorption Risk
- **Assumption:** OpenClaw foundation won't ship guided configuration within 12 months
- **Test:** Monitor OpenClaw RFCs, PRs, and roadmap for configuration tooling
- **Signal:** 2+ PRs targeting guided config = assumption under attack
- **Response:** Accelerate spec publication, propose upstream collaboration
- **Review:** Monthly

---

## Decision Frame

**Settled:** Self-hosted sovereignty tool for OpenClaw's existing audience. Blueprint compiler model. Standards capture via spec.

**Open after launch (decided by data from first 1,000 users):**
- Managed hosting — build or partner?
- Vertical specialization — which use cases convert?
- Marketplace — if community contribution materializes
- Operations SaaS — if monitoring demand validated

**Execution gates:**
1. Is FEAT-018 fixable? → Launch gate
2. Is personal runway 12+ months? → Sentinel is experiment vs. survival
3. Can blueprint spec be written in ~1 week? → If compiler model is clear, yes
