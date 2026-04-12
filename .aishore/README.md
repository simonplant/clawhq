# .aishore/

Autonomous sprint orchestration for Claude Code. You write a backlog with intent. AI implements, validates, and merges — hands-off.

## Workflow

```bash
.aishore/aishore backlog populate           # Create items from PRODUCT.md
.aishore/aishore groom                      # Groom items for sprint readiness
.aishore/aishore run done                   # Drain the backlog autonomously
```

Each item needs **intent** (what must be true when done), **steps**, and **executable AC** (verify commands that prove behavior). The verify commands compound into a regression suite — every future sprint proves prior work still holds.

## Commands

```bash
.aishore/aishore run [N|ID|done|p0|p1|p2]  # Run sprints
.aishore/aishore backlog populate            # Create items from PRODUCT.md
.aishore/aishore backlog add --json '{...}'   # Add item manually
.aishore/aishore groom                       # Groom backlog items
.aishore/aishore scaffold                    # Detect fragment risk
.aishore/aishore review [--update-docs]      # Architecture review
.aishore/aishore status                      # Backlog overview
.aishore/aishore clean                       # Archive done items
.aishore/aishore update [--ref main]         # Self-update
.aishore/aishore help [command]              # Help
```

## Directory Contents

| Path | Purpose |
|------|---------|
| `aishore` | CLI entry point (Bash) |
| `VERSION` | Current version |
| `checksums.sha256` | SHA-256 checksums for update verification |
| `config.yaml` | Optional overrides (preserved across updates) |
| `agents/` | Agent prompts (developer, validator, groomer, architect) |
| `lib/` | Lazy-loaded command modules |
| `templates/` | Init wizard templates |
| `data/` | Runtime — logs, status, lock (not version-controlled) |

## Docs

- [Quickstart](../docs/QUICKSTART.md) — install, configure, first sprint
- [Configuration](../docs/CONFIGURATION.md) — config file, env vars, all flags
- [Architecture](../docs/ARCHITECTURE.md) — pipeline, agents, quality model
- [Full README](../README.md) — intent-based development, comparison, examples
