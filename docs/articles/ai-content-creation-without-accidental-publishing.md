# AI Content Creation Without Accidental Publishing

> How to use an AI agent for research, drafting, and editorial workflow — without it ever publishing on your behalf without permission.

**Published:** 2026-03-29 · **Source:** FEAT-126 Content Creator blueprint

---

## The Problem

Content creators are adopting AI tools faster than any other professional group. But the failure modes are uniquely embarrassing: an AI-generated draft published before review, a hallucinated quote attributed to a real person, plagiarized passages that slip past the author, or an unfinished newsletter sent to 10,000 subscribers because the agent interpreted "schedule for review" as "schedule for publish."

For self-hosted AI agents, the risk is structural. If your agent has API credentials to your CMS, blog platform, or email service with publish permissions, the distance between "draft ready" and "published to the world" is one misinterpreted instruction. Unlike a SaaS tool with undo buttons and human review queues, a self-hosted agent's publish action is immediate and permanent.

## Context

The editorial workflow has a natural checkpoint: the moment content moves from private (draft) to public (published). Every professional editorial process — newspapers, magazines, publishing houses — enforces this checkpoint with human review. But most AI content tools blur this boundary because seamless automation is a better demo than approval gates.

The deeper risk is data leakage during research. When an agent searches the web for a topic, its search queries can reveal unpublished editorial strategy. "Write article about competitor X weakness in market Y" as a Tavily query tells anyone monitoring API traffic exactly what you're working on. Draft content included in research queries is even worse.

## The Fix

The Content Creator blueprint enforces editorial discipline architecturally:

1. **Mandatory publish approval** — `public_posts` is in the `requires_approval` list. The agent cannot publish, send, or share any content without explicit user confirmation. This is a structural constraint in the autonomy model, not a soft preference.

2. **Draft isolation** — Unpublished content never appears in egress traffic. Research queries use topic keywords extracted from the editorial calendar, not draft text. The agent searches for "AI agent security best practices 2026," not "here is my draft about AI agent security, find me more sources."

3. **Hardened egress** — Only `api.tavily.com` is permitted for outbound research. No CMS, no email service, no social media API. Publishing requires a deliberate integration addition with its own credential and approval configuration.

4. **Conservative memory retention** — 200KB hot memory with 30-day retention ensures research context persists through the editorial cycle, but old drafts and abandoned topics don't accumulate indefinitely.

## What We Learned

The principle is **draft-as-default**: in an AI-assisted editorial workflow, every piece of content should be private until explicitly promoted to public. This seems obvious, but most AI tools default to the opposite — they optimize for frictionless publishing because that's what engagement metrics reward. For a sovereign agent operating on your behalf, the default must be privacy, and publishing must require an affirmative action.

The research query leakage problem is more subtle and often overlooked. Your agent's search queries are your editorial strategy. Treating them as public data — sending draft content or detailed topic descriptions to search APIs — undermines the sovereignty model.

## How ClawHQ Handles This

`clawhq blueprint preview content-creator` shows the editorial workflow constraints: approval gates on all public actions, draft isolation from egress, and research query sanitization. The blueprint supports the full content pipeline — research, outline, draft, edit, publish — with the human as the final gate.

The `clawhq audit` command shows every outbound research query, so you can verify that draft content isn't leaking into API calls. `clawhq doctor` checks that egress rules haven't expanded beyond the research API.

**Related:**
- [Content Creator blueprint](../../configs/blueprints/content-creator.yaml)
- [14 Ways Your OpenClaw Agent Silently Breaks](./14-ways-your-openclaw-agent-silently-breaks.md)

---

*This article was generated from ClawHQ development work. Every bug fix, blueprint, and breaking change produces discoverable content. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the process.*
