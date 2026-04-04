# Assumption Tracking

> Strategy without validation is fiction. These are the 3 tests that tell us whether to continue, pivot, or accelerate.

**Owner:** Simon Plant · **Source:** [STRATEGY.md](STRATEGY.md) § Assumption Tests · **Data:** [backlog/assumptions.json](../backlog/assumptions.json)

---

## The 3 Assumptions

| # | Assumption | Risk | Pass | Fail | Deadline |
|---|---|---|---|---|---|
| 1 | **Community Engagement** — The OpenClaw community values production-tested blueprints and operational knowledge enough to engage with it | CRITICAL | 200+ GitHub stars on blueprint repo, 5K+ article reads, upstream issues engaged | <50 stars, <1K reads, issues ignored | 90 days after first publication |
| 2 | **Willingness to Pay** — sovereignty audience will pay for monitoring or premium services | CRITICAL | 10+ Sentinel signups or any consulting inbound | <3 signups and zero inbound | 60 days after Sentinel offered (gated behind Assumption 1 passing) |
| 3 | **Foundation Composition Gap** — OpenClaw won't ship blueprint-level composition within 12 months. Note: `openclaw onboard`, `openclaw configure`, and the Control UI already ship. The remaining gap is use-case-level composition, not basic guided config. | CRITICAL | 0-1 PRs targeting template/blueprint composition in 6 months | 2+ PRs targeting template composition or a `blueprints/` directory in repo | Biweekly review, 12-month horizon |

---

## Measurement Methods

### Assumption 1: Community Engagement

**What to measure:** Does the OpenClaw community engage with published blueprints, reference docs, and content?

**Data sources:**
- GitHub: stars, forks, issues on blueprint repo
- Article analytics: reads, shares, inbound links (Plausible or similar)
- Upstream engagement: responses to filed issues and PRs on `openclaw/openclaw`
- Community references: mentions in Discord, Reddit, other guides

**Signals:**
```
Blueprint repo stars/forks → Article reads/shares → Upstream issue engagement → Community citations
```

**How to set up:**
1. Publish blueprint repo, configuration reference, and first article
2. File 5+ upstream issues with production evidence
3. Track weekly in `assumptions.json` → `latestData`

**Decision thresholds:**
- **Strong signal:** 200+ stars, 5K+ reads, upstream issues engaged. Continue and invest more.
- **Weak signal:** 50-200 stars, 1-5K reads, some engagement. Extend to 6 months, adjust content angle.
- **No signal:** <50 stars, <1K reads, issues ignored. The community doesn't value this contribution. Reassess thesis.

### Assumption 2: Willingness to Pay

**Gated behind Assumption 1.** Don't test willingness to pay until community engagement is established. Offering paid services to an audience that doesn't exist yet produces a false negative.

**What to measure:** Sentinel landing page signups and/or consulting inbound.

**Data sources:**
- Landing page analytics (visits, time on page)
- Signup form submissions (email + commitment signal)
- Inbound inquiries from content or contributions

**Funnel:**
```
Community engagement (Assumption 1 passed) → Sentinel announcement → Landing page visit → Signup/inquiry
```

**How to set up:**
1. **Wait for Assumption 1 to pass** — meaningful community engagement established
2. Create Sentinel landing page with value proposition and pricing
3. Announce through channels built during Assumption 1 phase
4. Track signups and inbound weekly in `assumptions.json` → `latestData`

**Decision thresholds:**
- **10+ signups or any consulting engagement:** Revenue model validated. Build Sentinel.
- **3-9 signups:** Weak signal. Extend 30 days, add direct user interviews.
- **<3 signups and zero inbound after 60 days:** Monitoring isn't the revenue model. Explore premium blueprints or consulting.

### Assumption 3: Foundation Composition Gap

**Current status: partially materialized.** `openclaw onboard` (full onboarding flow), `openclaw configure` (config wizard), and the Control UI (form-driven config editing with raw JSON escape hatch) already exist. Community conventions are forming: `aaronjmars/soul.md` defines a composable multi-file soul spec, OpenAgents.mom generates workspace bundles, and the proposed skill `manifest.json` (issue #28298) creates a permission declaration format.

The remaining gap is **blueprint-level composition** — specifying an entire agent from a use-case intent across all 8 workspace files + runtime config + cron + tool policy + security posture simultaneously. Nobody ships this yet.

**What to measure:** OpenClaw GitHub activity related to template/blueprint composition tooling.

**Data sources:**
- OpenClaw GitHub: PRs, issues, RFCs
- OpenClaw Discord: #development channel
- Foundation meeting notes (if public)
- Community projects: soul.md repo, OpenAgents.mom, other workspace generators

**Search terms:** `blueprint`, `template`, `compose`, `scaffold`, `init --template`, `agent template`, `workspace bundle`, `config generator`

**How to set up:**
1. Watch OpenClaw repo on GitHub (custom notifications for PRs/issues)
2. Set a **biweekly** calendar reminder to search for composition-related activity
3. Monitor community workspace generator projects for convergence with upstream
4. Record findings in `assumptions.json` → `latestData`

**Decision thresholds:**
- **0-1 composition PRs in 6 months:** Gap remains. Continue blueprint development and spec publication.
- **1 PR with limited scope:** Monitor closely. Accelerate blueprint spec publication to establish prior art.
- **2+ PRs or a `blueprints/` directory in the repo:** Gap closing. Accelerate spec publication, propose upstream collaboration from position of having reference implementation and published blueprints.
- **Community convention hardens around a competing format:** Evaluate compatibility. Adapt if the competing format is better. Contribute if it's worse.

---

## Monthly Review Process

**When:** First Monday of each month, starting 30 days after repo goes public.

**Process:**
1. Pull latest data for each assumption (GitHub analytics, landing page metrics, OpenClaw repo search)
2. Update `backlog/assumptions.json` → each assumption's `latestData` field
3. Compare against pass/fail thresholds
4. If any assumption hits FAIL threshold, document the pivot decision
5. Add a review entry to each assumption's `reviewLog` array:
   ```json
   {
     "date": "2026-MM-DD",
     "data": "summary of latest metrics",
     "assessment": "on_track | at_risk | failed | passed",
     "action": "what to do next"
   }
   ```
6. Update `meta.nextReviewDate` in assumptions.json

**First review date:** 30 days after repo goes public.

---

## What Happens When an Assumption Fails

| Assumption | Fail Signal | Response |
|---|---|---|
| Community Engagement | <50 stars, <1K reads, issues ignored | The community doesn't value this work in its current form. Reassess: wrong audience, wrong content angle, or wrong thesis entirely. |
| Willingness to Pay | <3 signups and zero inbound | Monitoring isn't the revenue model. Explore premium blueprints, consulting, or accept this is a reputation-building project with indirect returns. |
| Foundation Composition Gap | 2+ composition PRs or competing convention hardening | Good — means the concept was right. Accelerate spec publication, propose upstream collaboration. Contribute, don't compete. |

Failure of one assumption doesn't kill the project — it redirects it. Failure of assumptions 1 AND 2 together means the thesis that this body of work creates professional opportunities needs fundamental rethinking.
