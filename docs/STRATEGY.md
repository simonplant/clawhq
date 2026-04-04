# ClawHQ Strategy

> Contribute first. Build reputation. Let the product follow the community.

**Updated:** 2026-04-03

---

## Strategic Position

ClawHQ is a community-first project in the OpenClaw ecosystem. The position is **contributor and authority**, not alternative platform. The tools, blueprints, and knowledge help the community directly. Reputation and trust built through contribution create optionality for revenue — consulting, monitoring services, premium blueprints — when demand is proven, not before.

**What converged across all analysis and research:**
- The durable value is in composition, coherence, and lifecycle — things the upstream framework structurally can't do
- Bridge value (landmine fixes, hardening guides, basic config tooling) earns credibility but has a 12-24 month shelf life as upstream matures
- `openclaw onboard`, `openclaw configure`, and the Control UI already exist — the basic guided config gap is narrowing
- Community conventions are forming (soul.md repo, OpenAgents.mom, skill manifest.json proposal) — the window for standards influence is open but not indefinite
- Revenue requires reputation. Reputation requires contribution. Contribution comes first.

---

## Four Execution Priorities

### 1. Lead with Contribution

**Problem:** Positioning as a "platform" for OpenClaw creates an adversarial dynamic with the upstream project. Every feature you ship, they can absorb. Every release they make can break your abstractions.

**Fix:** Lead with contributions that help the ecosystem. Upstream issues with production evidence. Published blueprints that work with stock OpenClaw. The configuration reference as a community resource. Content that documents what nobody else is documenting. The reputation this builds is the foundation for everything else.

**What this looks like:**
- Join the OpenClaw Discord and engage with existing discussions first — a stranger appearing with 14 issues in a batch lands as noise, not contribution. Help a few people, build recognized presence, then contribute from that position.
- 14 landmines filed as GitHub issues with reproduction steps — spaced out, not batched
- OPENCLAW-REFERENCE.md published as the community's configuration bible
- The Persona Schema published as a standalone spec — 17 dimensions across five research-grounded layers for agent personality design. This is the most original intellectual contribution in the project, applicable beyond OpenClaw, and the foundation that makes personality presets rigorous instead of "You are warm and helpful"
- Blueprints published as standalone configs, no ClawHQ CLI dependency
- Security findings contributed upstream (context pruning default, bootstrapMaxChars warnings, identity sync)
- Content from production experience: what breaks, what works, what the docs don't tell you

**What this doesn't mean:** Stop building tools. The config generator, doctor, deploy pipeline, and hardening scripts are real tools that help real people. Keep building them — just don't frame them as a competing platform. Frame them as community tools from someone who runs agents in production and publishes what they learn.

### 2. Development-as-Content

**Problem:** One-time launch events decay in 72 hours. Competitors publish compounding content weekly. The ecosystem has dozens of generic "how to set up OpenClaw" guides but nobody publishing production operations knowledge.

**Fix:** Every development action produces content. Bug fix → postmortem. New blueprint → tutorial. OpenClaw breaking change → "what broke and how we fixed it." Content is a byproduct of development, not a separate activity.

**The content angle nobody else has:** The community guides are all "how to set up." Nobody is telling the production stories — 14 silent landmines, the 208K-token death spiral, the ClawHavoc malware campaign, the Snyk sandbox bypasses, what 120 days of memory management actually looks like, why your agent introduces itself by the wrong name. ClawHQ is the only project with months of production data to draw from. That's the content moat.

**Distribution channels (content that nobody finds doesn't compound):**
- **OpenClaw Discord** — #showcase and #development channels. Post blueprints, reference doc, and production findings directly where the community lives.
- **Reddit** — r/openclaw. Long-form postmortems and landmine discoveries perform well here.
- **X/Twitter** — Thread format for production stories. Tag @steipete and relevant community members.
- **Hacker News** — The "14 ways my agent silently broke" article is HN-native content. One submission, not repeated.
- **Personal website** — Home for the full content series. Each article published here first, then distributed to channels.
- **GitHub Discussions** — On the blueprint repo. For ongoing conversation and community feedback.

Content publishes to the personal website, then gets distributed through community channels. The website accumulates; the channels amplify.

### 3. Publish the Blueprint Specification

**Problem:** ClawHQ's blueprint format exists only in TypeScript — it can't travel without documentation. Meanwhile, community conventions are forming: `aaronjmars/soul.md` defines a multi-file soul spec, OpenAgents.mom generates workspace bundles, the proposed skill `manifest.json` creates a permission declaration format. If ClawHQ doesn't formalize and publish its spec, competing conventions will harden.

**Fix:** Publish the blueprint spec as a human-readable document. The architectural clarity that makes it tight: OpenClaw auto-loads exactly 8 files at boot. A blueprint is a complete specification of those 8 files + runtime config + cron + tool policy + security posture. That's a bounded, well-defined compilation target. The spec encodes a key design insight: mission profiles (what the agent does) and personality presets (how it delivers) are independent, composable axes — 10 a-la-carte profiles that users stack freely, not 177 role-personality fusions.

**Why this is the foundation defense:** `openclaw onboard` and `openclaw configure` already handle basic guided config. The gap is blueprint-level composition — specifying an entire agent from intent. If that spec becomes the community standard, ClawHQ owns the reference implementation regardless of what the upstream project ships.

### 4. Test Revenue Behind Traction

**Problem:** Open-source infrastructure monetization takes 2-4 years. Solo founder following the same playbook without funding is volunteering for unpaid work. But building paid services before demand exists is building for a hypothesis.

**Fix:** Earn reputation first. Test revenue when there's an audience to test with. The Sentinel monitoring experiment, premium blueprints, and consulting all stay on the table — but gated behind community traction signals, not launched into silence.

**Sentinel design constraint (when the time comes):** Must do something a local cron job can't. `clawhq doctor --watch` in cron is free, and `openclaw doctor --fix` exists upstream. Sentinel's value is upstream intelligence — pre-computing config breakage against incoming commits, CVE mapping against your blueprint, skill reputation tracking, sandbox bypass alerts. ~$19/month. Only build when the community is asking for it.

---

## Maintenance Sustainability

The 67K-line codebase is real and valuable. The question is what maintenance patterns scale for a solo developer.

**Sustainable — generate, don't wrap:**
- Config generation: produces files once. If OpenClaw changes config schema, update the generator. Not a runtime dependency.
- Blueprint compilation: YAML → workspace files + config. Static output, no wrapper.
- Doctor checks: additive health verification. Doesn't intercept upstream operations.
- Container hardening: Docker Compose generation. Produces files, doesn't maintain a runtime.

**Unsustainable — don't do these:**
- Wrapping upstream CLI commands (breaks on every release)
- Reimplementing the Control UI (OpenClaw maintains their own)
- Runtime interception of agent operations (tight coupling to internals)
- Tracking every upstream config schema change on release day

**The test:** If OpenClaw ships a new release tomorrow, does ClawHQ break? Config generators and doctor checks tolerate upstream changes gracefully. CLI wrappers and runtime hooks don't. Build the first kind.

---

## Kill List

These are dead. Do not resurrect.

- **"Community contributes blueprints at scale"** — Power law says no. Build 10 a-la-carte mission profiles and 4 personality presets yourself. Composable and production-tested beats 177 untested SOUL.md-only templates.
- **"Managed hosting as primary business"** — 10+ funded competitors. Different game entirely.
- **"One-time launch event as growth strategy"** — Content compounds. Launch events decay.
- **"Skills marketplace"** — ClawHub exists and already has a malware problem. Curated beats open.
- **"Reimplementing OpenClaw's built-in config UI"** — They ship a Control UI. Compete on composition and lifecycle, not forms.

---

## Risks

| # | Risk | Severity | Response |
|---|---|---|---|
| 1 | **Upstream ships blueprint composition** — `openclaw onboard` and `openclaw configure` already exist. If they ship template-based agent configuration, the gap narrows further. | CRITICAL | Published spec becomes the standard. Contribution credibility means ClawHQ shapes what upstream builds, not races against it. Review: biweekly. |
| 2 | **2M users ≠ addressable demand** — each filter cuts 80-90% | CRITICAL | Test: measure engagement with published blueprints and content. Pass: meaningful GitHub stars + article traction in 90 days. |
| 3 | **Revenue timing vs. runway** — solo, unfunded | HIGH | Revenue experiments gated behind traction, not launched speculatively. Hard check: any inbound revenue signal by month 9. |
| 4 | **Trust paradox** — security-focused project with security bug is brand-killing | HIGH | End-to-end smoke test before any public claims. Published test matrix. Scope alpha explicitly. |
| 5 | **Upstream security catches up** — `--allow-tools` per skill exists, `manifest.json` sandboxing proposed, sandbox bypasses patched within weeks | MEDIUM | ClawHQ's value is the compound problem (composition + security + lifecycle), not any single security feature. If upstream closes a gap, celebrate — that's contribution working. |
| 6 | **Bridge value depreciates** — the 14 landmines get fixed upstream eventually | MEDIUM | Timeline uncertain — open-source projects are slow on config UX even at scale. Bridge value may persist for years, not months. Either way, durable value (composition, coherence, lifecycle, intent preservation) doesn't depend on upstream gaps. |
| 7 | **Content doesn't gain traction** | MEDIUM | Go deeper, not wider. Security and operational niches over generic guides. Quality over cadence. |

---

## Assumption Tests

### Test 1: Community Engagement
- **Assumption:** The OpenClaw community values production-tested blueprints and operational knowledge
- **Test:** Publish 3 blueprints + configuration reference + Persona Schema + first article. Measure GitHub stars, article reads, community references.
- **Pass:** 100+ stars, 3K+ article reads in 90 days
- **Fail:** <25 stars, <500 reads — thesis needs revision
- **Deadline:** 90 days after first publication
- **Note:** Starting from zero community presence. aaronjmars/soul.md hit 310 stars with active promotion; that's a ceiling reference, not a baseline. Be honest about cold-start reality.

### Test 2: Upstream Receptivity
- **Assumption:** OpenClaw project welcomes substantive contributions from power users
- **Test:** File 5+ issues with production evidence, submit 2+ documentation PRs
- **Pass:** Issues engaged by maintainers, PRs reviewed
- **Fail:** Issues ignored, PRs rejected — contribution model doesn't work with this project
- **Deadline:** 90 days

### Test 3: Revenue Potential
- **Assumption:** Reputation built through contribution creates revenue opportunities
- **Test:** After 6 months of contribution, assess inbound inquiries (consulting, advisory, or monitoring interest)
- **Pass:** Any paying engagement or 10+ expressed interest in Sentinel
- **Fail:** Zero inbound after 6 months of active contribution — monetization thesis is wrong
- **Deadline:** Month 9
- **Fallback if all three tests fail:** The body of work (blueprints, reference docs, Persona Schema, security patterns, production knowledge) becomes a portfolio of deep technical work in AI agent infrastructure. This has value for job applications, advisory roles, and speaking opportunities even if ClawHQ itself never generates direct revenue. The work is not wasted — it's repositioned as credentialing, not product.

---

## Decision Framework

**Settled:** Community-first contribution model. Blueprint compiler approach. Composition + coherence + lifecycle as the durable layer. Don't wrap upstream, generate and check.

**Open (decided by traction):**
- Sentinel monitoring — build if community asks, not before
- Premium blueprints — offer if free blueprints prove valued
- Consulting — pursue if inbound materializes
- Blueprint spec as RFC — propose when reference blueprints demonstrate the concept
- Web dashboard — only if it does something the Control UI doesn't, and demand exists
