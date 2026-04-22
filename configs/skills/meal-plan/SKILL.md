# meal-plan

Weekly meal planning skill for the Meal Planner and Family Hub agents. Generates a weekly meal plan based on dietary preferences, creates a consolidated shopping list, and schedules prep reminders — all queued for user approval before finalizing.

## Behavior

1. Review preferences — Read stored dietary preferences, restrictions, household size, and budget constraints from memory.
2. Plan meals — Generate a 7-day meal plan with breakfast, lunch, and dinner, respecting dietary restrictions and variety.
3. Generate shopping list — Consolidate ingredients across all planned meals into a deduplicated, categorized shopping list.
4. Schedule prep — Create calendar reminders for meals requiring advance preparation (marinades, slow cooking, thawing).
5. Queue for approval — The complete plan and shopping list are delivered for user review. Nothing is finalized until approved.
6. Report — Deliver the weekly plan summary via the messaging channel.

## Boundaries

- No purchases. This skill plans and lists only. It never places orders or accesses payment systems.
- No data leaves the machine. All meal planning uses the local Ollama model. No cloud API calls unless cloud escalation is explicitly configured.
- No account changes. The skill reads calendar and task state but only writes after user approval.
- Approval required. The weekly plan and shopping list must be approved before calendar events or task items are created.

## Schedule

Runs once weekly on Sunday evening via cron, as configured in the Meal Planner or Family Hub blueprint.

## Execution

This is a declarative skill. The cron scheduler triggers the agent with "Run skill: meal-plan". The agent reads this SKILL.md for behavior definitions and loads the prompt templates from prompts/ to guide each step.

### Prompts

- prompts/plan.md — Weekly meal plan generation prompt template
- prompts/shopping-list.md — Shopping list generation prompt template

## Approval Integration

The weekly plan is enqueued with:
- Category: meal_plan
- Source: meal-plan
- Metadata: week start date, meal count, dietary profile

The user reviews the plan via their messaging channel and approves, modifies, or rejects it.

## Model Requirements

- Provider: Local Ollama only (cloud escalation configurable per blueprint)
- Minimum model: any tool-capable local model (runtime uses the deployment default)
- Cloud escalation: optional — blueprints may allow cloud for higher quality meal planning
