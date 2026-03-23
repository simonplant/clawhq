# FIRST-RUN.md — The One-Command First-Run Experience

> **Question this document answers:** What does someone see in the first 60 seconds with ClawHQ?

**Owner:** ClawHQ Product · **Status:** Design Spec · **Updated:** 2026-03-20

---

## The North Star

Someone who just heard about ClawHQ should be able to run one command, see a working AI agent in 60 seconds, and understand why they'd want the real thing. No Docker. No API keys. No configuration. Just:

```bash
curl -fsSL https://clawhq.com/install | sh && clawhq demo
```

Or if they already have Node:

```bash
npx clawhq demo
```

---

## Two Paths

### Path A: Demo (Today's User)
**Goal:** Trust + wow. No friction.
**Time to value:** < 60 seconds
**Command:** `clawhq demo`
**What they get:** A working agent in the browser. Local. No data leaves. No account.

### Path B: Real Install (Committed User)
**Goal:** Working personal agent, properly configured.
**Time to value:** < 5 minutes
**Command:** `clawhq install` → `clawhq init --guided` → `clawhq up`
**What they get:** Their actual agent, configured for their use case, running on their hardware.

Both paths start from the same binary. Demo converts to real install without re-entering anything.

---

## Path A: Demo — Frame by Frame

### T+0s — One Command

```bash
clawhq demo
```

No args. Nothing to configure. User doesn't need to know what a blueprint is.

### T+0–3s — Warm Boot

```
╔═══════════════════════════════════════════╗
║                 ClawHQ                    ║
║     Your agent. Your hardware. Your data. ║
║   ─────── Working agent in 60 seconds ──── ║
╚═══════════════════════════════════════════╝

  ✓ Creating ephemeral demo environment
  ✓ Checking for local Ollama...
```

Two visual states:
- **Ollama found:** "Using your local models (llama3:8b)" — privacy cred established immediately
- **No Ollama:** "Starting demo agent (no setup needed)"

### T+3–8s — Blueprint Load + Config Forge

```
  ✓ Loading "Replace ChatGPT Plus" blueprint
  ✓ Forging agent configuration...
```

No user input. Blueprint is pre-selected for demo. The verb "forging" is intentional — we want it to feel like something real was built.

### T+8–15s — Chat Server Ready

```
  ✓ Agent ready

  Open this URL in your browser:

    → http://localhost:3838

  (or we opened it for you)

  This demo is local-only. Nothing leaves your machine.
  Press Ctrl+C to stop.
```

Browser opens automatically. If it can't, the URL is prominent and copyable.

### T+15s → Open-ended — The Chat

The browser shows a clean chat interface. One pre-seeded question in the input field to remove blank-page paralysis:

> *"What can you help me with?"*

The agent's first response introduces itself and names 3–4 concrete things it can do:

> **Agent:** I'm a general-purpose assistant running entirely on your machine — no data leaves. In this demo I can:
>
> - Answer questions and help with research
> - Draft emails, summaries, and documents  
> - Explain technical concepts
> - Walk you through how ClawHQ works
>
> What would you like to work on?

Below the chat: a single, non-intrusive banner:

```
This is a demo. → Get your real agent (takes 5 min)
```

### T+Ctrl+C — Clean Exit

```
  Stopping demo agent...
  ✓ Cleaned up

  Ready to set up your real agent?

    clawhq install    ← Full setup (~5 min)
    clawhq demo       ← Run demo again

  Everything you need: https://clawhq.com/start
```

No lingering processes. No Docker volumes left behind. One CTA.

---

## Path B: Real Install — The Full Flow

### Step 1: Install

```bash
curl -fsSL https://clawhq.com/install | sh
```

What this does:
1. Detects OS (macOS, Linux, WSL)
2. Checks prerequisites (Docker, Node)
3. Downloads the ClawHQ binary (signed, hash-verified)
4. Adds `clawhq` to PATH
5. Prints: `clawhq installed. Run: clawhq install`

**Alternative (zero-trust):**
```bash
git clone https://github.com/simonplant/clawhq && cd clawhq && ./install --from-source --verify
```

### Step 2: `clawhq install`

Pre-req detection and engine setup. Interactive.

```
ClawHQ Setup

Checking prerequisites...
  ✓ Docker Desktop 4.28.0
  ✓ Port 18789 available
  ✗ Ollama not found

  Ollama runs AI models locally (recommended).
  Install it? [Y/n]
```

If yes: downloads Ollama + pulls default model in background while wizard continues.
If no: routes all AI calls to cloud (user chooses provider in next step).

```
Setting up deployment directory...
  ✓ /home/user/.clawhq created
  ✓ Engine acquired (v2026.3.20, verified)
  ✓ Security hardening applied

Ready to configure your agent.
Run: clawhq init --guided
```

### Step 3: `clawhq init --guided`

Blueprint selection + customization. 5–7 questions max.

```
What do you want your agent to do?

  1. Manage my email (inbox zero, triage, morning digest)
  2. Help with stock trading (market data, research, alerts)
  3. Plan meals (nutrition, shopping lists, dietary preferences)
  4. Maintain a blog (research, writing, editorial workflow)
  5. Replace my Google Assistant (email + calendar + tasks)
  6. Build your own (advanced)

→ 1

Great. "Email Manager" blueprint selected.

A few quick questions:

  Email provider? [iCloud / Gmail / FastMail / Other]: iCloud
  Telegram username (for Telegram channel)? @simonplant
  Morning digest time? [8:00 AM]: ↵

Validating iCloud connection...
  ✓ iCloud email connected

Forging your agent...
  ✓ Identity configured
  ✓ Tools generated (email, calendar)
  ✓ Skills installed (email-digest, auto-reply)
  ✓ Cron configured (inbox check every 15min, digest at 8am)
  ✓ Security hardened (local-only by default)
  ✓ Config validated (0 landmines)

Agent ready. Run: clawhq up
```

### Step 4: `clawhq up`

```
Launching your agent...
  ✓ Docker build complete
  ✓ Container started
  ✓ Firewall rules applied
  ✓ Health check passed
  ✓ Smoke tests passed

Your agent is running.

Connect on Telegram: @clawhq_bot (link your instance)
Dashboard: http://localhost:18789

  clawhq status      — Agent health
  clawhq doctor      — Run diagnostics
  clawhq evolve      — Add capabilities
```

Total time from `clawhq install` to running agent: **< 5 minutes** (assuming iCloud, no Ollama download wait).

---

## Demo → Real Install Conversion

The demo should prime for conversion without being pushy.

**In demo chat** (non-intrusive banner, not a pop-up):
```
⚡ Running in demo mode — data is ephemeral
Get your real agent → clawhq install
```

**On Ctrl+C:**
The exit screen is the primary conversion moment. Clean, one CTA, no pressure.

**No email required.** No account required. No cloud required. The entire product is local.

---

## What the Demo Is NOT

| Not this | Why |
|---|---|
| A wizard that asks questions | Questions create friction. Demo = zero friction. |
| A tutorial | Tutorials are for people who've already decided. Demo is for people deciding. |
| A toy | Uses the real blueprint engine. The agent genuinely works. |
| Persistent | Ephemeral by default. No residue. Trust is built by proving we leave no mess. |
| Fake | No mocked responses (unless Ollama is unavailable — then mock LLM, but labeled as such). |

---

## Technical Requirements

### Demo command

- **Start-to-browser:** < 60 seconds on a 2023 laptop with no Ollama
- **No Docker required** for demo
- **No API key required** for demo
- **Clean exit:** no lingering processes, no Docker volumes
- **Auto-open browser** (fallback: print URL prominently)
- **Ollama probe:** 3s timeout, graceful fallback to mock LLM

### Mock LLM (fallback)

- Runs on port 11435 (avoids collision with real Ollama on 11434)
- Responds fast (< 500ms) — demo should feel snappy
- Labeled clearly in chat: "Running with demo AI (no Ollama detected)"
- Canned responses for common first-message patterns ("what can you do", "hello", etc.)
- Gracefully handles unexpected input with honest "I'm a demo agent" response

### Real install

- **Pre-req check** surfaces missing Docker/Node with install links, not just errors
- **Ollama install** is offered inline (downloads in background)
- **Engine download** is hash-verified before any execution
- **Config validation** runs before `clawhq up` — zero silent landmines
- **Smoke tests** confirm agent responds before marking install complete

---

## Success Criteria

| Metric | Target |
|---|---|
| Demo start → browser open | < 60 seconds |
| Demo → real install conversion rate | > 20% |
| Real install time (email blueprint, iCloud) | < 5 minutes |
| Config-related failures at install | 0 silent landmines |
| Data leaving machine (demo) | 0 bytes |
| Data leaving machine (real, default) | 0 bytes |
| Processes left behind after demo exit | 0 |

---

## Open Questions

1. **npx support:** Should `npx clawhq demo` work without installing? Lower friction for discovery, but requires publishing to npm. Recommend: yes, publish early.

2. **Demo persistence option:** Should `clawhq demo --keep` persist the demo session? Could let people poke around longer before committing to install. Risk: leaves residue. Recommendation: defer until after v1.

3. **Demo → init handoff:** Can `clawhq init --guided` pick up the blueprint used in demo, skipping re-selection? Would make the conversion flow feel seamless. Recommend: yes, store demo blueprint choice in a temp file and offer to continue.

4. **First message:** Should the agent's first message be pre-canned or LLM-generated? Pre-canned is faster and more reliable in demo mode. Recommend: pre-canned for demo, LLM for real install.

5. **Telegram pairing during install:** Should `clawhq init --guided` offer to pair Telegram immediately? Pairing during init means the agent is reachable from the phone the moment `clawhq up` finishes. Recommend: yes, make it the default channel choice.

---

## Related

- [PRODUCT.md](PRODUCT.md) — Full product design, personas, build order
- [ARCHITECTURE.md](ARCHITECTURE.md) — Solution architecture
- `src/demo/` — Demo implementation (already built for `clawhq demo`)
- `src/build/installer/` — Installer scaffolding (Track B)
