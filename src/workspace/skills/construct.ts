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
