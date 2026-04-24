---
title: Provider profile layer (deferred)
category: Decisions
status: deferred
date: 2026-04-23
tags: [providers, integrations, wizard, compiler, architecture, deferred, clawhq]
sources:
  - session 2026-04-23 email audit
---

# Provider profile layer (deferred)

## Decision

**Do not promote the provider catalog at `src/design/catalog/providers.ts`
to a first-class "provider profile layer" between blueprint and
compiler. Fix the five email gaps individually.** Re-visit this
decision when the 5th genuinely-different integration provider is
added (OAuth, JMAP, Bridge-mediated, or similar non-IMAP shape).

## Context

An audit of email handling on [[email-integration]] surfaced five
gaps: empty credentials in the generated himalaya config on Clawdius,
no credential probe for email, wizard ignores provider catalog for
prompt defaults, no cadence customization question, approval category
name drift.

The obvious architectural response: promote `providers.ts` to a
`ProviderProfile` type that the wizard drives off (for
provider-specific prompts and validation) and the compiler reads from
(for computed defaults). Three moves: extend the type, refactor
wizard, refactor compiler.

## Why deferred

**The five gaps don't share a root cause.** Treating them as
symptoms of a missing layer inflates five independent omissions — a
loop bug, missing code, unused catalog data, missing YAML, cosmetic
naming — into a structural narrative that justifies a refactor they
don't require. See [[key-principles]] principle against premature
abstraction.

**The most concrete gap is a bug.** The empty-credentials issue on
Clawdius traces to `integrationFields()` in
`src/design/configure/wizard.ts:387-446` not iterating numbered
slots. A 20-line loop fix solves it. No layer required.

**The abstraction would fit today's shape and bend tomorrow's.**
Current integrations are four IMAP providers (Gmail, iCloud, Outlook,
Fastmail — all same shape) plus a handful of HTTP-API integrations
with distinct shapes. A `ProviderProfile` type modelled on IMAP-with-
app-password locks in today's shape; the next provider (OAuth Gmail,
JMAP Fastmail, ProtonMail Bridge) likely doesn't fit it.

**Cost-benefit is inverted.** ~500 lines of refactor with test
updates and atomic migration risk, versus ~135 lines of targeted
fixes that each address one specific gap.

## What to do instead

Each gap gets its smallest fix:

| Gap | Fix | LoC |
|---|---|---|
| Empty credentials (slot-2) | Iterate numbered slots in `integrationFields()` | ~20 |
| Silent emission of empty fields | `generateHimalayaConfig` throws on missing IMAP_USER/SMTP_USER; keep host fallback | ~10 |
| No email probe | Add `probeEmail()` to probes.ts, shell to `himalaya account check` via docker exec | ~50 |
| Wizard ignores catalog | `integrationFields()` reads `providers.ts` for host/port defaults per provider pick | ~50 |
| No cadence customization | `customization_question` in `email-manager.yaml` | ~5 YAML |
| Approval name drift | Leave unless causing confusion | 0 |

Total: ~135 lines, zero new types, zero new layers, all reversible.

## When to revisit

Promote the catalog to a layer when **at least three** of the
following are true:

1. A new provider is added with an auth flow that can't be modelled
   as `{ imap_host, smtp_host, user, password }` — e.g., OAuth with
   refresh, JMAP, Bridge-mediated local service, or per-provider
   token exchange.
2. The wizard's provider-specific branching in `integrationFields()`
   exceeds ~100 lines of conditional logic.
3. Multiple integrations need structured setup instructions
   (Gmail app-password + 2FA requirement, ProtonMail Bridge install
   flow, etc.) that a prompt list can't express.
4. Credential probes diverge enough in shape that a registry is
   clearly preferable to a per-integration function in `probes.ts`.

At that point the abstraction pays for itself. Until then, the
catalog stays a compiler-side data file, the wizard stays minimal,
and each integration brings its own small shape.

## Related

- [[email-integration]] — the five gaps that motivated the proposal
- [[integration-layer]] — category × provider model as it stands
- [[credential-health-probes]] — where `probeEmail` would live
- [[key-principles]] — least-privilege, fail-loud, avoid premature
  abstraction
