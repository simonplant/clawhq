# meal-planner

Calendar-based meal planning skill for Health and LifeOps profiles. Generates a weekly meal plan that respects dietary preferences, household size, and the user's calendar — then produces a shopping list and prep schedule, all queued for approval before any calendar or task entries are created.

## Behavior

1. Review preferences — Read stored dietary preferences, restrictions, allergies, household size, and budget constraints from memory.
2. Check calendar — Read the upcoming week's calendar for time constraints: busy evenings get quick meals, free weekends allow longer recipes.
3. Plan meals — Generate a 7-day meal plan with breakfast, lunch, and dinner. Respect dietary restrictions, balance variety, and match prep time to available time slots.
4. Generate shopping list — Consolidate ingredients across all planned meals into a deduplicated, aisle-categorized shopping list. Exclude pantry staples the user has marked as always-stocked.
5. Schedule prep reminders — Identify meals requiring advance preparation (marinades, slow cooking, thawing) and propose calendar reminders for the appropriate times.
6. Queue for approval — Deliver the complete plan, shopping list, and prep reminders via the messaging channel. Nothing is finalized until the user approves, modifies, or rejects.

## Boundaries

- No purchases. This skill plans and lists only. It never places orders, accesses payment systems, or interacts with grocery delivery services.
- No data leaves the machine. All planning uses the local model. No cloud API calls unless cloud escalation is explicitly configured.
- Calendar read-only until approved. The skill reads calendar events for scheduling context but only creates new entries after user approval.
- Approval required. The weekly plan, shopping list, and prep reminders must be approved before any calendar events or task items are created.

## Schedule

Runs once weekly (default: Sunday evening) via cron, as configured in the blueprint. Can also be triggered on demand.

## Execution

This is a declarative skill. The cron scheduler triggers the agent with "Run skill: meal-planner". The agent reads this SKILL.md for behavior definitions and generates the meal plan based on stored preferences and calendar state.

## Model Requirements

- Provider: Local Ollama preferred (cloud escalation configurable per blueprint)
- Minimum model: llama3:8b or equivalent
- Cloud escalation: optional — blueprints may allow cloud for higher quality meal planning
