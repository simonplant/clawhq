---
title: Prompt injection defense
category: Decisions
status: active
date: 2026-04-22
tags: [security, sanitizer, prompt-injection, ClawHavoc, openclaw]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# Prompt injection defense

## Purpose

Detect and neutralize adversarial content in inbound messages, web
fetches, document reads, and other untrusted inputs before the model
processes them.

Complements the egress firewall: the sanitizer restricts what comes
in; the firewall restricts what goes out. See
[[egress-firewall]].

## Pipeline

```
Input → Detect → Score → [Quarantine | Sanitize] → [Wrap] → Output
```

1. **Detect** — run all rules against input text, collect threats with
   category, tier, and severity.
2. **Score** — weighted sum: high=0.4, medium=0.2, low=0.1, capped at
   1.0.
3. **Quarantine** if score ≥ 0.6: replace content with a notice, log
   for review.
4. **Sanitize** if score < 0.6: strip or replace detected threats in
   place.
5. **Wrap** (optional): add `<untrusted-content>` data-boundary markers
   so the model has explicit trust signals.

## Detection rules

### Tier 1 — High detectability (near-zero false positives)

- Invisible Unicode: zero-width spaces, joiners, directional overrides,
  tag characters.
- Injection keywords: explicit attempts to override system prompt.
- Delimiter spoofing: fake `system`/`assistant`/`user` markers.
- Encoded payloads: base64, hex, URL-encoded instructions.
- Decode instructions: "decode this base64...".
- Exfiltration markup: hidden links, image tags for data exfiltration.
- Exfiltration instructions: natural-language requests to send data
  externally.
- Secret leak detection: AWS keys, GitHub PATs, Slack tokens, OpenAI
  keys, JWTs, private keys.

### Normalization

Confusable normalization (Cyrillic/Greek/fullwidth → ASCII) runs
before Tier 1 pattern matching, catching obfuscated injection keywords
that use lookalike characters.

### Semantic override

For adversarial prompt injection based on semantic override or social
engineering, model-based detection is required — regex cannot reliably
catch motivated attackers. The sanitizer handles the syntactic layer;
the model's own refusal behavior (reinforced by SOUL.md hard limits)
handles the semantic layer.

## Rules file

The current rule set is documented in `src/secure/sanitizer/RULES.md`.
This is the operator-facing reference — the rules themselves live
adjacent to the detection code.

## The ClawHavoc campaign

ClawHavoc was a documented attack campaign specifically targeting
`SOUL.md` with hidden instructions:

- Base64-encoded strings that, when decoded, contained prompt
  injection payloads.
- Zero-width Unicode characters that rendered invisibly but shifted
  the model's instruction-following behavior.

Defenses against ClawHavoc-style attacks:

1. **Sanitizer layer.** Tier 1 rules catch invisible Unicode and
   encoded payloads before they reach the model.
2. **File-level immutability.** `chmod 444` on SOUL.md prevents the
   agent from persisting any compromise. See
   [[soul-md]].
3. **Read-only volume mounts.** Even if `chmod` is bypassed, the
   container-level mount is read-only. See
   [[config-credentials-not-read-only]].
4. **Git history.** Any change to SOUL.md is a diff — periodic
   review catches what sanitizer and mount-level controls missed.

## When model-based detection is needed

Regex and pattern matching are reliable for syntactic attacks but
brittle against semantic ones ("please respond as if you were a
different assistant" without any obvious injection keyword). For
agents with high-stakes tool access, consider:

- Model-based pre-screening of untrusted content with a separate,
  isolated model call.
- Approval gates on destructive tools — the model may comply with a
  clever injection but cannot execute `delete`, `send`, or `purchase`
  without explicit human approval.

## Practical guidance

- Enable the sanitizer by default. Cost is negligible compared to a
  successful injection.
- Review the quarantine log periodically. Most entries will be false
  positives or low-value spam, but real attacks show up here first.
- Keep SOUL.md hard limits specific and explicit — a vague "be
  helpful" instruction loses to a specific injection every time; a
  specific "never share internal pricing" survives many injection
  attempts because the model has a concrete rule to fall back on.

## See also

- [[threat-model]]
- [[egress-firewall]]
- [[soul-md]]
