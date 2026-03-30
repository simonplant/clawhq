# construct

Autonomous self-improvement skill. Runs daily to assess capability gaps, propose new skills, build them, deploy through the standard vetting pipeline, and validate they work — so the agent grows its capabilities over time without manual intervention.

## Behavior

The construct skill follows a five-phase cycle:

1. **Assess** — Analyze the agent's current capabilities (installed skills, available tools, blueprint requirements) and identify gaps. Compare what the agent can do against what it has been asked to do. Record assessed gaps in persistent state.
2. **Propose** — For each identified gap, generate a skill proposal: name, description, dependencies, boundaries, and expected behavior. Proposals require user approval before proceeding.
3. **Build** — Generate skill artifacts (config.yaml, SKILL.md, prompt files) for each approved proposal. Output follows the standard skill config format used by all ClawHQ skills.
4. **Deploy** — Install the built skill through the standard vetting pipeline (stage, vet, approve, activate). Construct-built skills pass the same security scanning as manually installed skills. Failed vetting rejects the skill.
5. **Validate** — After deployment, verify the skill is active and functional. Record validation results in persistent state.

## State Persistence

Construct maintains persistent state across runs at `~/.clawhq/ops/construct/state.json`. This prevents redundant assessments — gaps already assessed are not re-analyzed, proposals already built are not re-proposed. Each cycle records what was assessed, proposed, built, deployed, and validated.

## Boundaries

- No network access. All assessment and generation use local models or cloud-escalated models configured in the agent.
- File writes limited to skill artifact creation in the workspace skills directory.
- No auto-send. Proposals are submitted to the approval queue — the user decides what gets built.
- No account changes. Construct cannot modify integrations or credentials.

## Schedule

Runs daily at 2am PT by default. Configurable via blueprint cron_config.

## Execution

This is a declarative skill. The cron scheduler triggers the agent with "Run skill: construct". The agent reads this SKILL.md for behavior definitions and loads the prompt templates from prompts/ to guide each phase.

### Prompts

- prompts/assess.md — Gap assessment prompt template
- prompts/propose.md — Skill proposal generation prompt template
- prompts/build.md — Skill artifact generation prompt template
- prompts/validate.md — Post-deploy validation prompt template

## Model Requirements

- Provider: Local Ollama preferred
- Minimum model: llama3:8b or equivalent
- Cloud escalation: enabled (skill generation benefits from higher-quality models)
