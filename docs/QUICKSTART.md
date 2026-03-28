# ClawHQ Quickstart

> **Status:** Early development. The CLI is buildable from source. The one-command installer and guided setup wizard are in progress — see the [Roadmap](ROADMAP.md).

This guide walks you through building ClawHQ from source and exploring what's available today.

---

## Prerequisites

| Requirement | Minimum | Check |
|---|---|---|
| **Docker** | 20.10+ | `docker --version` |
| **Node.js** | 22+ | `node --version` |
| **Git** | any | `git --version` |

---

## Build from Source

```bash
git clone https://github.com/simonplant/clawhq
cd clawhq
npm install
npm run build
```

Then either install globally:

```bash
npm install -g .
clawhq --version
```

Or run directly from the build output:

```bash
node dist/cli/index.js --version
```

---

## What's Available Today

The CLI has 59 commands across all major subsystems. You can explore what's built:

```bash
clawhq --help                    # top-level command list
clawhq blueprint list            # browse built-in blueprints
clawhq skill list                # available skills
clawhq doctor                    # run diagnostics (11 checks + auto-fix)
clawhq status                    # agent health dashboard
```

Run diagnostics against an existing OpenClaw deployment:

```bash
clawhq doctor
# Checks container health, config validation, credential health,
# egress firewall, identity file permissions, memory limits,
# cron jobs, skill installation, workspace permissions,
# Docker resources, and engine version.
```

---

## What's In Progress

The following are implemented in the source but require a running OpenClaw instance to use end-to-end:

- `clawhq init` — blueprint selection and agent configuration
- `clawhq up` / `clawhq down` — deploy and teardown
- `clawhq backup create` / `clawhq backup restore` — encrypted snapshots
- `clawhq skill install <name>` — add skills to a running agent

The **one-command installer** (`curl -fsSL https://clawhq.com/install | sh`) and the **guided setup wizard** (`clawhq init --guided`) are on the near-term roadmap. See [ROADMAP.md](ROADMAP.md) for current status.

---

## What's Planned (Not Yet Built)

The walkthrough below shows the intended experience when the installer and wizard are complete. It is aspirational — included here so you know where the project is headed.

<details>
<summary>Planned: One-command install + guided setup</summary>

```bash
# Install (not yet available)
curl -fsSL https://clawhq.com/install | sh

# Guided setup wizard (CLI exists; wizard not yet wired)
clawhq init --guided

# Deploy
clawhq up

# Health check
clawhq status
clawhq doctor
```

The wizard will ask three questions per blueprint (communication style, priority rules, auto-reply preferences), prompt for integration credentials, and configure everything automatically — including applying all 14 known OpenClaw failure modes ("landmines") as guardrails.

</details>

---

## Documentation

| Document | Description |
|---|---|
| [Architecture](ARCHITECTURE.md) | Three layers, six modules, zero-trust remote admin |
| [Configuration](CONFIGURATION.md) | Blueprint schema, skill schema, every config option |
| [Problems](PROBLEMS.md) | Why OpenClaw is hard and what ClawHQ fixes |
| [Roadmap](ROADMAP.md) | What's built, what's next, honest limitations |
| [Contributing](CONTRIBUTING.md) | How to contribute blueprints, skills, and code |
