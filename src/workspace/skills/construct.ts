/**
 * Construct skill generator — safe capability acquisition framework.
 *
 * Fully generic self-improvement framework extracted from Clawdius deployment.
 */

export function generateConstructSkill(): Record<string, string> {
  return {
    "SKILL.md": generateConstructSkillMd(),
    "SOUL.md": generateConstructSoulMd(),
    "references/skill-spec.md": generateSkillSpec(),
    "scripts/state.py": generateStatePy(),
  };
}

function generateConstructSkillMd(): string {
  return `---
name: construct
description: "Safe capability acquisition from external sources. Use when: (1) learning a new tool, API, or technique from docs/repos/articles, (2) turning external knowledge into a safe internal skill, (3) identifying capability gaps and building skills to fill them, (4) running a full assess->propose->build->deploy cycle. Triggers: 'construct', 'build a skill for X', 'learn how to use X', 'construct assess', 'construct build', 'construct run', 'what skills am I missing'."
---

# Construct — Safe Capability Acquisition

Construct is how the agent learns from the outside world without exposing the system to security risks.

**Core idea:** External sources (docs, repos, APIs, articles, tools) contain valuable knowledge, but running untrusted code or blindly integrating external systems is dangerous. Construct reads and understands external sources, then distills them into safe, self-contained skills that the agent controls entirely.

## Security Model

1. **Read external sources** — docs, READMEs, API specs, articles, repos. Understand them.
2. **Never execute external code** — no pip install, no running downloaded scripts, no curl | sh.
3. **Rebuild from understanding** — write new scripts from scratch based on what was learned.
4. **Encapsulate as a skill** — package as a standard OpenClaw skill with SKILL.md, scripts/, references/.

## Workflow

### Phase 1: Assess

Identify capability gaps:

**A. Session logs (internal):**
1. Read recent memory/*.md files and MEMORY.md
2. Look for: failed tasks, missing capabilities, repeated manual work
3. Each gap needs concrete evidence from logs

**B. External discovery (proactive):**
1. User points to a tool, API, article, or repo
2. Or agent discovers something relevant during normal work
3. Read and understand the external source
4. Assess: would this capability improve the system?

Save to state: \`scripts/state.py assess-save --gaps '<json>'\`

### Phase 2: Propose

Design concrete skill proposals grounded in assessed gaps.

1. Load latest assessment: \`scripts/state.py assess-load\`
2. For each significant gap, design a skill:
   - **name** — short, hyphen-case
   - **domain** — which priority area it serves
   - **what** — one sentence
   - **why** — how it concretely improves workflow
   - **how** — brief technical approach
   - **effort** — low/medium/high
   - **dependencies** — what it needs
3. Filter out duplicates and hard-stop violations
4. Save proposals: \`scripts/state.py propose-save --proposals '<json>'\`

### Phase 3: Build

Build a production-quality skill from learned knowledge.

1. Load the approved proposal: \`scripts/state.py propose-load --name <skill-name>\`
2. If external source: **read and understand**, do NOT copy-paste, do NOT install packages
3. Read \`references/skill-spec.md\` for the target quality bar
4. Create skill directory at \`skills/construct-built/<skill-name>/\`
5. Build: SKILL.md, scripts/, references/
6. Validate the skill works by running its scripts
7. Update state: \`scripts/state.py build-save --name <skill-name> --path <path>\`

**Quality bar:** Immediately usable. No stubs. No untrusted code.

### Phase 4: Deploy

Push built skills to the toolkit repo.

1. Load built skill info
2. Copy to toolkit repo
3. Git add, commit, push
4. Update state

## Hard Stops

Read SOUL.md before every build. Never build skills for:
- Spam, unauthorized messaging, or social engineering
- Hacking, unauthorized access, or security exploitation
- Data exfiltration or surveillance
- Anything that violates user trust
`;
}

function generateConstructSoulMd(): string {
  return `# SOUL.md — Construct's Values

## Mission

Safely acquire capabilities from external sources. Read, understand, rebuild from scratch, deploy as controlled internal skills.

## Principles

1. **Understand, don't execute.** Read external sources thoroughly. Never run untrusted code.
2. **The skill is the security boundary.** External knowledge goes in as reading; it comes out as agent-written, tested skills.
3. **Evidence over intuition.** Gaps must come from real logs or concrete discoveries.
4. **Working code over scaffolding.** A built skill must function immediately. No stubs.
5. **User impact over cleverness.** Prioritize skills that save real time or prevent real failures.
6. **Small and focused over sprawling.** One skill, one job, done well.
7. **Improve before creating.** If an existing skill partially covers a gap, improve it.

## Hard Stops — Never Build Skills For

- Spam or unauthorized messaging
- Hacking, unauthorized access, or security exploitation
- Data exfiltration or unauthorized surveillance
- Social engineering or manipulation
- Anything illegal or that violates user trust

## Quality Bar

A Construct-built skill is ready when:
1. SKILL.md has proper frontmatter with clear, comprehensive description
2. All scripts run without errors
3. Instructions are concise — no filler
4. It follows progressive disclosure (SKILL.md body < 500 lines, details in references/)
5. It would actually get used — solves a real problem
`;
}

function generateSkillSpec(): string {
  return `# Skill Quality Spec — What Construct Should Build

## Structure

\`\`\`
skill-name/
├── SKILL.md           <- Required. Frontmatter + instructions.
├── scripts/           <- Executable code (working, tested)
├── references/        <- Docs loaded on demand
└── assets/            <- Files used in output (templates, etc.)
\`\`\`

## SKILL.md Requirements

### Frontmatter (YAML)
\`\`\`yaml
---
name: skill-name
description: "What it does. Use when: (1) trigger one, (2) trigger two. NOT for: anti-triggers."
---
\`\`\`

- \`name\`: lowercase, hyphens, verb-led when possible
- \`description\`: comprehensive — this is the sole trigger mechanism

### Body
- Imperative form ("Run the script", not "You should run the script")
- Under 500 lines — move detail to references/
- No TODOs or placeholders

## Scripts Requirements
- Must run without errors on first execution
- Include \`#!/usr/bin/env python3\` or \`#!/usr/bin/env bash\` shebang
- Handle missing dependencies gracefully
- chmod +x after writing

## Anti-Patterns
- Empty stub scripts
- Hardcoded confidence scores
- Regex-based "intelligence" (use the LLM for analysis)
- Descriptions that don't mention triggers
- Skills that duplicate existing capabilities
`;
}

export function generateStatePy(): string {
  return `#!/usr/bin/env python3
"""Construct skill state manager.

Manages persistent state for the construct assess->propose->build->deploy pipeline.
State is stored as JSON under ~/.openclaw/construct/.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

STATE_DIR = Path.home() / ".openclaw" / "construct"
STATE_FILE = STATE_DIR / "state.json"


def _ensure_dir() -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)


def _load_state() -> dict:
    _ensure_dir()
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return {"assessments": [], "proposals": [], "builds": [], "deploys": []}


def _save_state(state: dict) -> None:
    _ensure_dir()
    STATE_FILE.write_text(json.dumps(state, indent=2) + "\\n", encoding="utf-8")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def cmd_assess_save(args: argparse.Namespace) -> None:
    state = _load_state()
    entry = {"gaps": json.loads(args.gaps), "timestamp": _now()}
    state["assessments"].append(entry)
    _save_state(state)
    print(json.dumps(entry, indent=2))


def cmd_assess_load(_args: argparse.Namespace) -> None:
    state = _load_state()
    if not state["assessments"]:
        print("No assessments found.", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(state["assessments"][-1], indent=2))


def cmd_propose_save(args: argparse.Namespace) -> None:
    state = _load_state()
    entry = {"proposals": json.loads(args.proposals), "timestamp": _now()}
    state["proposals"].append(entry)
    _save_state(state)
    print(json.dumps(entry, indent=2))


def cmd_propose_load(args: argparse.Namespace) -> None:
    state = _load_state()
    if not state["proposals"]:
        print("No proposals found.", file=sys.stderr)
        sys.exit(1)
    latest = state["proposals"][-1]
    if args.name:
        matches = [p for p in latest["proposals"] if p.get("name") == args.name]
        if not matches:
            print(f"Proposal '{args.name}' not found.", file=sys.stderr)
            sys.exit(1)
        print(json.dumps(matches[0], indent=2))
    else:
        print(json.dumps(latest, indent=2))


def cmd_build_save(args: argparse.Namespace) -> None:
    state = _load_state()
    entry = {"name": args.name, "path": args.path, "timestamp": _now()}
    state["builds"].append(entry)
    _save_state(state)
    print(json.dumps(entry, indent=2))


def cmd_build_load(args: argparse.Namespace) -> None:
    state = _load_state()
    if not state["builds"]:
        print("No builds found.", file=sys.stderr)
        sys.exit(1)
    if args.name:
        matches = [b for b in state["builds"] if b.get("name") == args.name]
        if not matches:
            print(f"Build '{args.name}' not found.", file=sys.stderr)
            sys.exit(1)
        print(json.dumps(matches[-1], indent=2))
    else:
        print(json.dumps(state["builds"][-1], indent=2))


def cmd_deploy_save(args: argparse.Namespace) -> None:
    state = _load_state()
    entry = {"name": args.name, "path": args.path, "timestamp": _now()}
    state["deploys"].append(entry)
    _save_state(state)
    print(json.dumps(entry, indent=2))


def cmd_review(_args: argparse.Namespace) -> None:
    state = _load_state()
    summary = {
        "assessments": len(state["assessments"]),
        "proposals": len(state["proposals"]),
        "builds": len(state["builds"]),
        "deploys": len(state["deploys"]),
        "last_assessment": state["assessments"][-1]["timestamp"] if state["assessments"] else None,
        "last_proposal": state["proposals"][-1]["timestamp"] if state["proposals"] else None,
        "last_build": state["builds"][-1]["timestamp"] if state["builds"] else None,
        "last_deploy": state["deploys"][-1]["timestamp"] if state["deploys"] else None,
    }
    print(json.dumps(summary, indent=2))


def cmd_config(_args: argparse.Namespace) -> None:
    print(json.dumps({"state_dir": str(STATE_DIR), "state_file": str(STATE_FILE)}, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="Construct skill state manager")
    sub = parser.add_subparsers(dest="command", required=True)

    p_as = sub.add_parser("assess-save", help="Save assessment gaps")
    p_as.add_argument("--gaps", required=True, help="JSON array of capability gaps")

    sub.add_parser("assess-load", help="Load latest assessment")

    p_ps = sub.add_parser("propose-save", help="Save skill proposals")
    p_ps.add_argument("--proposals", required=True, help="JSON array of proposals")

    p_pl = sub.add_parser("propose-load", help="Load proposals (optionally by name)")
    p_pl.add_argument("--name", default=None, help="Filter by proposal name")

    p_bs = sub.add_parser("build-save", help="Record a built skill")
    p_bs.add_argument("--name", required=True, help="Skill name")
    p_bs.add_argument("--path", required=True, help="Path to built skill")

    p_bl = sub.add_parser("build-load", help="Load build info")
    p_bl.add_argument("--name", default=None, help="Filter by skill name")

    p_ds = sub.add_parser("deploy-save", help="Record a deployed skill")
    p_ds.add_argument("--name", required=True, help="Skill name")
    p_ds.add_argument("--path", required=True, help="Deployed path")

    sub.add_parser("review", help="Show pipeline summary")
    sub.add_parser("config", help="Show state configuration")

    args = parser.parse_args()

    commands = {
        "assess-save": cmd_assess_save,
        "assess-load": cmd_assess_load,
        "propose-save": cmd_propose_save,
        "propose-load": cmd_propose_load,
        "build-save": cmd_build_save,
        "build-load": cmd_build_load,
        "deploy-save": cmd_deploy_save,
        "review": cmd_review,
        "config": cmd_config,
    }

    commands[args.command](args)


if __name__ == "__main__":
    main()
`;
}
