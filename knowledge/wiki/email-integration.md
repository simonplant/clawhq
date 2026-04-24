---
title: Email integration
category: Features
status: active
date: 2026-04-23
tags: [email, integration, himalaya, imap, smtp, openclaw, tool]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# Email integration

The default behaviour, permissions, and lifecycle controls that apply
when a blueprint declares the `email` category. Consolidates defaults
otherwise scattered across [[integration-layer]], the Email Manager
blueprint, [[credential-health-probes]], and [[egress-firewall]].

## Tool surface

| Aspect | Default |
|---|---|
| Binary | `himalaya` — static musl IMAP/SMTP client, installed in Stage 2 of [[two-stage-docker-build]] when email is selected |
| Agent CLI | `workspace/email` bash wrapper, `chmod +x`, generated from [[integration-layer]] template |
| Commands | `email inbox`, `email send`, `email search` |
| Providers | Gmail, iCloud, Outlook, Fastmail, ProtonMail (all via IMAP+SMTP — interface does not change with provider) |
| Credential storage | `.env` at mode 0600; never inlined in config files |

The wrapper's provider-agnostic interface is the load-bearing design
choice: a blueprint that works against Gmail works against ProtonMail
by changing only env vars.

## Permissions (Email Manager blueprint defaults)

From the reference Email Manager blueprint:

```yaml
autonomy_model:
  default: medium
  requires_approval: [sending_messages, account_changes, public_posts]

personality:
  boundaries: "never sends without approval on first contact"

security_posture:
  posture: hardened
  identity_mount: read-only
```

What this buys:

- **`email send` is gated.** Routes through the `approve-action`
  platform tool (see [[integration-layer]]) before hitting SMTP. Read
  and search operations run without approval.
- **First-contact rule.** Even once autonomy is granted, the agent
  does not send to a recipient it has not corresponded with before
  without explicit approval.
- **Read-only identity mount.** The agent cannot mutate its own
  SOUL.md / AGENTS.md / TOOLS.md while handling mail. Prompt
  injection buried in an email body cannot rewrite the agent's
  personality or tool inventory. See [[prompt-injection-defense]].

## Network posture

Email inherits the blueprint's `hardened` posture and the
[[egress-firewall]]:

- `egress: allowlist-only` — default deny; only declared domains are
  reachable from the agent container.
- Default allowlist for an email-only blueprint:
  `imap.gmail.com`, `smtp.gmail.com` (substituted per provider at
  compile time). Additional categories (calendar, tasks) add their
  own hosts.
- Port-aware rules — 993 for IMAPS, 587/465 for SMTP submission.

Any attempt by the agent to exfiltrate mail to an arbitrary host is
dropped by the `CLAWHQ_FWD` iptables chain.

## Health & lifecycle

- **Credential probe:** `himalaya account check` on schedule —
  verifies IMAP + SMTP auth and server reachability. 7-day-advance
  warning on expiry where the protocol supports it. See
  [[credential-health-probes]].
- **Heartbeat:** The Email Manager default triages inbox every 15
  minutes (driven from `workspace/HEARTBEAT.md` — see
  [[heartbeat-md]]).
- **Default skill:** `email-digest` — summarize and triage incoming
  email. Installed automatically when a blueprint declares the email
  category alongside a digest cadence.

## Landmines adjacent to email

- `.env` must contain `EMAIL_ADDRESS`, `EMAIL_PASSWORD` (or provider-
  specific OAuth vars) — see [[env-missing-required-variables]].
- If `fs.workspaceOnly` is misconfigured, `himalaya` can escape the
  workspace sandbox on local IMAP — see
  [[fs-workspace-only-misconfigured]].
- Egress firewall must be reapplied after Docker network recreation,
  or SMTP will hang — see
  [[firewall-not-reapplied-after-network-recreate]].

## Known gaps (2026-04-23)

Corrects an earlier claim that the himalaya config generator was
missing — it isn't. `src/design/catalog/compiler.ts:180-185` emits
`workspace/config/himalaya/config.toml` via `clawhq apply`, and the
file is present on Clawdius. The real gaps are smaller and more
specific:

1. **Wizard doesn't iterate numbered slots.** On Clawdius the
   generated `config.toml` has populated hosts but empty `email = ""`
   and `backend.login = ""` because `integrationFields()` in
   `src/design/configure/wizard.ts:387-446` collects credentials for
   the primary `email` slot only. The `email-2` (secondary) slot
   inherits host defaults from the provider catalog but never prompts
   for user/pass. Fix is a loop, not a layer.

2. **No `probeEmail`.** Every other integration in
   `src/secure/credentials/probes.ts` has a credential probe; email
   doesn't. Invalid IMAP/SMTP creds fail silent rather than surfacing
   in `clawhq creds`.

3. **Wizard ignores the provider catalog.** `providers.ts:74-146`
   declares per-provider hosts/ports, but `integrationFields()`
   prompts generic IMAP_HOST/SMTP_HOST regardless of provider pick.
   Catalog data is compiler-only today; wizard could read it for
   prompt defaults.

4. **No triage cadence customization.** `*/15 waking` is blueprint-
   fixed in `configs/blueprints/email-manager.yaml`. No
   `customization_question` exposes it to the init wizard.

5. **Compiler emits empty fields on missing credentials.**
   `himalaya-config.ts:44` falls back via `defaultFor()` for
   *everything*, producing a technically-valid TOML with empty
   login strings. Compiler should fail loud on missing required
   credentials — the fall-back is correct for hosts (provider
   catalog defaults exist) but wrong for user/pass.

See [[provider-profile-layer]] for why the obvious
"promote provider catalog to a first-class layer" response to these
gaps is **not** the right intervention today — each gap has an
independent, smaller fix.

## See also

- [[integration-layer]]
- [[credential-health-probes]]
- [[egress-firewall]]
- [[env-missing-required-variables]]
- [[prompt-injection-defense]]
- [[two-stage-docker-build]]
