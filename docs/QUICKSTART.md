# ClawHQ Quickstart

> From zero to a working AI agent in under 10 minutes.

> **Development Preview.** ClawHQ is in active development. The CLI commands below are implemented but the end-to-end flow (from init to a working agent responding on Telegram) requires agent runtime integration that is still in progress. See [Known Limitations](ROADMAP.md#known-limitations).

This guide walks you through installing ClawHQ and forging your first agent — an **Email Manager** that triages your inbox, delivers morning digests, and guards your calendar.

---

## 1. Prerequisites

| Requirement | Minimum | Check |
|---|---|---|
| **Docker** | 20.10+ | `docker --version` |
| **Node.js** | 22+ | `node --version` |
| **Ollama** (optional) | Latest | `ollama --version` |

Ollama provides local AI models so nothing leaves your machine. Without it, you'll need a cloud model API key during setup. If Ollama is installed, pull a starter model:

```
$ ollama pull llama3:8b
pulling manifest... done
pulling 6a0746a1ec1a... 100% 4.7 GB
success
```

---

## 2. Install ClawHQ

**From source** (current install method):

```
$ git clone https://github.com/clawhq/clawhq
$ cd clawhq
$ npm install
$ npm run build
$ npm link          # makes `clawhq` available globally

  Run: clawhq init --guided
```

> A one-command installer (`curl -fsSL https://clawhq.com/install | sh`) is planned but not yet available. See [Roadmap](ROADMAP.md#next).

---

## 3. Initialize — Pick the Email Manager Blueprint

Run the guided setup wizard:

```
$ clawhq init --guided

  Welcome to ClawHQ — let's forge your agent.

  ? Choose a blueprint:
    ❯ Email Manager — inbox zero, triage, auto-reply, morning digest
      Stock Trading Assistant — market monitoring, research, alerts
      Meal Planner — nutrition, shopping lists, weekly plans
      Replace Google Assistant — email + calendar + tasks + daily brief
      Founder's Ops — inbox zero, investor updates, hiring pipeline

  ✔ Selected: Email Manager
```

The wizard asks three customization questions:

```
  ? How should your agent communicate?
    ❯ Brief and direct — bullet points, no fluff
      Warm and conversational — friendly, approachable
      Professional and formal — polished, corporate tone

  ? What emails should always be flagged as high priority?
    (Emails from my manager, clients, or containing 'urgent')

  ? How comfortable are you with auto-replies?
    ❯ Auto-reply to routine messages only (meeting confirmations, acknowledgments)
      Never auto-reply — always ask me first
      Auto-reply freely — I trust the agent's judgment
```

---

## 4. Connect Integrations

The wizard prompts for each integration the Email Manager needs:

```
  Email (required)
  ─────────────────
  ? Email provider:
    ❯ Gmail (IMAP)
      iCloud Mail
      Custom IMAP/SMTP

  ? IMAP server: imap.gmail.com
  ? IMAP port: 993
  ? SMTP server: smtp.gmail.com
  ? SMTP port: 587
  ? Email address: you@gmail.com
  ? App password: ••••••••••••••••
  ✔ IMAP connected — 1,204 messages in inbox
  ✔ SMTP verified — test email sent

  Calendar (recommended)
  ──────────────────────
  ? CalDAV server: caldav.icloud.com
  ? Username: you@icloud.com
  ? App-specific password: ••••••••••••••••
  ✔ Calendar connected — 3 calendars found

  Messaging channel (required)
  ────────────────────────────
  ? Channel:
    ❯ Telegram
      Signal
      Discord

  ? Telegram bot token: ••••••••••••••••
  ✔ Telegram connected
```

> **Gmail users:** Generate an App Password at myaccount.google.com → Security → App Passwords. Regular passwords won't work with IMAP.

---

## 5. Launch Your Agent

```
$ clawhq up

  ✔ Pre-flight checks passed (14/14)
  ✔ Docker build complete (Stage 1: engine, Stage 2: tools + skills)
  ✔ Container started — hardened (cap_drop ALL, read-only rootfs, UID 1000)
  ✔ Egress firewall applied — imap.gmail.com, smtp.gmail.com, caldav.icloud.com
  ✔ Health check passed
  ✔ Smoke test passed — agent responding

  Your agent is running.
  Dashboard: clawhq status
  Logs:      clawhq logs
```

---

## 6. Verify

Run the health check:

```
$ clawhq status

  ClawHQ Status
  ─────────────
  Agent:        ● Running (uptime 2m)
  Blueprint:    Email Manager v1.0.0
  Engine:       OpenClaw v4.2.1
  Container:    Hardened (cap_drop ALL, read-only rootfs)
  Model:        llama3:8b (local via Ollama)

  Integrations
  ─────────────
  Email (IMAP):   ● Connected — imap.gmail.com
  Email (SMTP):   ● Connected — smtp.gmail.com
  Calendar:       ● Connected — caldav.icloud.com
  Telegram:       ● Connected

  Skills
  ─────────────
  email-digest:   ● Active — every 15 min
  morning-brief:  ● Active — daily at 8:00am
```

Run diagnostics:

```
$ clawhq doctor

  ClawHQ Doctor — 14 checks
  ──────────────────────────
  ✔ Container health
  ✔ Config validation (14 landmine rules)
  ✔ Credential health (IMAP, SMTP, CalDAV, Telegram)
  ✔ Egress firewall active
  ✔ Identity files read-only
  ✔ Memory within limits (12KB / 120KB)
  ✔ Cron jobs registered
  ✔ Skills installed
  ✔ Workspace permissions
  ✔ Docker resources
  ✔ Engine version
  ✔ Backup configuration
  ✔ Audit trail active
  ✔ Security posture: hardened

  All checks passed.
```

---

## 7. Your First Interaction

Open Telegram and message your bot:

```
You:   What's in my inbox?
Agent: Morning. 52 emails overnight — 7 need you:

       🔴 Sarah Chen — Contract review due tomorrow
       🔴 Mark Davis — Investor update request
       🟡 AWS — Billing alert ($142.50)
       🟡 Jira — 3 tickets assigned to you
       🟢 Newsletter — TechCrunch daily (archived)
       🟢 Newsletter — Morning Brew (archived)
       🟢 Promo — 45 messages auto-archived

       12 routine messages auto-replied. 33 archived.
       Want me to draft replies to the flagged items?
```

Your agent checks email every 15 minutes and delivers a morning digest at 8:00am. All processing happens locally — zero data leaves your machine unless you configured a cloud model.

---

## What's Next

| Command | What It Does |
|---|---|
| `clawhq skill install schedule-guard` | Protect your focus blocks |
| `clawhq status --watch` | Live health dashboard |
| `clawhq backup create` | Encrypted snapshot |
| `clawhq doctor --fix` | Auto-repair common issues |
| `clawhq evolve` | Add integrations, skills, capabilities |

Deep dives: [Architecture](ARCHITECTURE.md) | [Product Design](PRODUCT.md)
