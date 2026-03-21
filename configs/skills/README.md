# ClawHQ Skill Packages

Skills are composable units of agent behavior. Each skill handles one job well. Blueprints bundle skills together for a complete use case.

## Available Skills

| Skill | Description | Schedule | Approval |
|-------|-------------|----------|---------|
| [`morning-brief`](./morning-brief/) | Daily morning briefing — email summary, calendar preview, task priorities | Daily 8am | None (read-only) |
| [`email-digest`](./email-digest/) | Periodic inbox triage summary — categorize, summarize, propose responses | Every 15min | Required for replies |
| [`email-triage`](./email-triage/) | Smart inbox triage — classify, label, archive, extract action items | Every 15min | None (label/archive only) |
| [`auto-reply`](./auto-reply/) | Autonomous email replies in user's voice | Event-driven | Required (except routine) |
| [`calendar-sync`](./calendar-sync/) | Conflict detection, meeting prep, agenda digests, focus block protection | Daily 7am + event | Required for changes |
| [`schedule-guard`](./schedule-guard/) | Focus block enforcement and meeting conflict alerts | Event-driven | None (alerts only) |
| [`task-digest`](./task-digest/) | Daily task prioritization — overdue, due today, blockers | Daily 8am + midday | None (read-only) |
| [`market-scan`](./market-scan/) | Market data scan, price alerts, watchlist monitoring | Configurable | None (alerts) |
| [`investor-update`](./investor-update/) | Investor update drafting — MRR, KPIs, narrative summary | Weekly | Required |
| [`meal-plan`](./meal-plan/) | Weekly meal planning — nutrition-aware, grocery list generation | Weekly | Required |
| [`news-scanner`](./news-scanner/) | Interest-based news aggregation — scan, filter, surface signal | Twice daily | None (digest) |
| [`web-research`](./web-research/) | On-demand web research — Tavily-powered, cited, sanitized | Event-driven | None (research) |
| [`content-draft`](./content-draft/) | Content idea generation and first-draft writing | Weekly seed + on-demand | Required (always) |
| [`construct`](./construct/) | Safe capability acquisition — learn new tools, build new skills | On-demand | Required for deploys |

## Skill Structure

Each skill package contains:

```
skill-name/
  SKILL.md        # Human-readable description, usage, constraints
  config.yaml     # Machine-readable configuration
  prompts/        # Prompt templates used by the skill (optional)
```

## Security Model

All skills follow the same security contract:
- **External content** always routes through `sanitize` (ClawWall)
- **Write actions** (send email, post content, calendar changes) always require approval
- **Read actions** (triage, scan, research, digest) run autonomously
- **Approval gates** are declared in `config.yaml` and cannot be overridden at runtime

## Blueprints vs Skills

- **Skills** = single-purpose behavior units (do one thing well)
- **Blueprints** = complete agent configurations (bundle skills + identity + tools + cron)

Skills are the building blocks. Blueprints are the product.

## Adding a New Skill

1. Create `configs/skills/<skill-name>/`
2. Write `SKILL.md` (description, usage, constraints, tools required)
3. Write `config.yaml` (schedule, model, dependencies, approval, boundaries)
4. Add prompts to `prompts/` if the skill uses template-based prompting
5. Reference the skill in relevant blueprints under `skill_bundle.recommended` or `skill_bundle.included`
