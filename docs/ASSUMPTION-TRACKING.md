# Assumption Tracking

> Strategy without validation is fiction. These are the 3 tests that tell us whether to continue, pivot, or accelerate.

**Owner:** Simon Plant · **Source:** [STRATEGY.md](STRATEGY.md) § Assumption Tests · **Data:** [backlog/assumptions.json](../backlog/assumptions.json)

---

## The 3 Assumptions

| # | Assumption | Risk | Pass | Fail | Deadline |
|---|---|---|---|---|---|
| 1 | **Addressable Demand** — 2M users includes real demand for a deployment tool | CRITICAL | >5% clone→install conversion (50+ installs / 1,000 visitors) | <2% conversion | 30 days after public |
| 2 | **Willingness to Pay** — sovereignty audience will pay for sovereign monitoring | CRITICAL | 10+ Sentinel signups in 60 days | <3 signups | 60 days after Sentinel announced |
| 3 | **Foundation Absorption** — OpenClaw won't ship guided config within 12 months | CRITICAL | 0-1 config PRs in 6 months | 2+ PRs targeting guided config | Monthly review, 12-month horizon |

---

## Measurement Methods

### Assumption 1: Addressable Demand

**What to measure:** GitHub clone → `clawhq install` conversion funnel.

**Data sources:**
- GitHub repo traffic (Settings → Traffic): unique visitors, unique clones
- Install script hit counter: count `curl | bash` executions (count only, no PII)

**Funnel:**
```
Unique visitors → Unique clones → Install attempts → Successful installs → 7-day active
```

**How to set up:**
1. GitHub traffic analytics are automatic once repo is public
2. Add a lightweight counter to the install script endpoint (e.g., Plausible, or a simple Cloudflare Workers counter)
3. Record weekly snapshots in `assumptions.json` → `latestData`

**Decision thresholds:**
- **>5%:** Demand validated. Continue execution.
- **2-5%:** Inconclusive. Extend test to 2,000 visitors before deciding.
- **<2%:** Thesis is wrong. Pivot to authority play (content, upstream contribution).

### Assumption 2: Willingness to Pay

**What to measure:** Sentinel landing page signups.

**Data sources:**
- Landing page analytics (visits, time on page)
- Signup form submissions (email + commitment signal)

**Funnel:**
```
Landing page visit → Read pricing → Submit signup → Confirm email
```

**How to set up:**
1. Create Sentinel landing page with value proposition, pricing, and signup form
2. Announce Sentinel through existing channels (GitHub repo, OpenClaw Discord, content)
3. Track signups weekly in `assumptions.json` → `latestData`

**Decision thresholds:**
- **10+ signups:** Revenue model validated. Build Sentinel.
- **3-9 signups:** Weak signal. Extend 30 days, add direct user interviews.
- **<3 signups:** Monitoring isn't the revenue model. Explore premium blueprints or marketplace.

### Assumption 3: Foundation Absorption Risk

**What to measure:** OpenClaw GitHub activity related to configuration tooling.

**Data sources:**
- OpenClaw GitHub: PRs, issues, RFCs
- OpenClaw Discord: #development channel
- Foundation meeting notes (if public)

**Search terms:** `configure`, `guided`, `setup wizard`, `init`, `blueprint`, `template`, `config tool`

**How to set up:**
1. Watch OpenClaw repo on GitHub (custom notifications for PRs/issues)
2. Set a monthly calendar reminder to search for config-related activity
3. Record findings in `assumptions.json` → `latestData`

**Decision thresholds:**
- **0-1 PRs in 6 months:** Foundation not prioritizing this. Continue as planned.
- **1 PR, no follow-up:** Monitor closely, increase review to biweekly.
- **2+ PRs:** Assumption under attack. Accelerate spec publication, propose upstream collaboration.

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
| Addressable Demand | <2% conversion | Pivot to authority play: content, upstream contribution, reference implementation |
| Willingness to Pay | <3 signups | Explore premium blueprints, enterprise fleet, or marketplace model |
| Foundation Absorption | 2+ guided-config PRs | Accelerate spec publication, propose upstream collaboration |

Failure of one assumption doesn't kill the project — it redirects it. Failure of assumptions 1 AND 2 together means the product thesis needs fundamental rethinking.
