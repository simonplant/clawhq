# Cooking Assistant — Recipe Match Prompt

Given current pantry contents and nutrition constraints, find 2-3 suitable recipes.

## Matching Criteria
1. Ingredient overlap: prefer recipes using ≥60% pantry items
2. Nutrition fit: within ±10% of calorie target, respects all dietary restrictions
3. Time: under 45 minutes unless user specified longer

## Output Per Recipe
**[Recipe Name]**
- Time: [prep + cook]
- Pantry match: [X/Y ingredients on hand]
- Missing: [items needed if any]
- Nutrition: [cal] kcal | [P]g protein | [C]g carbs | [F]g fat
- Why: [one sentence on why this fits]

Present 2-3 options. Ask which one to proceed with.
