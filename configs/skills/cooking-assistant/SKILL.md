# cooking-assistant

Recipe selection and cooking guidance skill. Matches recipes to what's in the pantry, dietary constraints, and available time. Provides step-by-step cooking guidance on request. Respects clinical nutrition constraints — not optional.

## Behavior

1. Check pantry — Read current pantry inventory to understand available ingredients.
2. Check constraints — Load nutrition guidelines (calories, macros, dietary restrictions from NUTRITION.md).
3. Match recipes — Find recipes from the recipe database that fit: pantry items, nutrition targets, available time.
4. Suggest — Present 2-3 recipe options with ingredient overlap and nutrition summary.
5. Guide — If asked, provide step-by-step cooking guidance with timing.

## Boundaries

- Nutrition constraints are clinical and non-negotiable. Never suggest recipes that violate them.
- Pantry-first approach — prefer recipes that use what's already stocked.
- No substitutions that change the nutrition profile without re-checking targets.

## Nutrition Constraints

Loaded from NUTRITION.md at runtime. Include:
- Calorie target
- Macro ratios
- Dietary restrictions (MASLD, pre-diabetes, Mediterranean diet)

## Execution

Declarative skill. Trigger: "Run skill: cooking-assistant [optional: what to cook]". Load this SKILL.md, execute prompts.

### Prompts

- prompts/match.md — Recipe matching against pantry and constraints
- prompts/guide.md — Step-by-step cooking guidance

## Model Requirements

- Provider: Local Ollama preferred
- Minimum model: llama3:8b
