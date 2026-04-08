# .aishore/

This directory contains the aishore sprint orchestration tool. It is self-contained and can be updated independently of your project code.

## Contents

| Path | Purpose |
|------|---------|
| `aishore` | CLI entry point (Bash) |
| `VERSION` | Version (single source of truth) |
| `checksums.sha256` | SHA-256 checksums for update verification |
| `agents/` | Agent prompt files (developer, validator, groomer, architect) |
| `config.yaml` | Optional overrides (preserved across updates) |
| `templates/` | Init wizard templates |
| `lib/` | Lazy-loaded command modules |
| `data/` | Runtime files — logs, status, lock (not version-controlled) |

## Quick Reference

```bash
.aishore/aishore help               # Full usage
.aishore/aishore run [N|ID|scope]   # Run sprints (scope: done, p0, p1, p2)
.aishore/aishore groom              # Groom backlog items
.aishore/aishore review             # Architecture review
.aishore/aishore status             # Backlog overview
.aishore/aishore clean              # Archive done items
.aishore/aishore update             # Self-update from GitHub
```

## Docs

Full documentation: https://github.com/simonplant/aishore

- [Quickstart](../docs/QUICKSTART.md) — install, configure, first sprint
- [Configuration](../docs/CONFIGURATION.md) — all settings and flags
- [Architecture](../docs/ARCHITECTURE.md) — pipeline, agents, design decisions
