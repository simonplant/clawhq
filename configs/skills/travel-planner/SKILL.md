# travel-planner

Pet-friendly travel research skill. Plans trips with the constraint that the dog comes along. Searches for pet-friendly hotels, checks policies, compares options, and adds logistics to the suggestions calendar.

## Behavior

1. Receive trip details — Dates, destination, pet details (breed, weight).
2. Search hotels — Query pet-friendly hotel sources (BringFido, GoPetFriendly, aggregators).
3. Verify policies — Check weight limits, breed restrictions, pet fees, walkable proximity.
4. Compare — Rank options by: policy flexibility, location walkability, price, reviews.
5. Suggest — Add top 2-3 options to the Suggestions calendar with enough detail to act without context-switching.
6. Report — Deliver comparison summary via messaging channel.

## Boundaries

- Never books directly — presents options for user decision.
- Always checks pet policy details — don't assume "pet-friendly" means no restrictions.
- Weight limit check is mandatory for large dogs (>50 lbs).

## Pet Requirements

- Pet must be accommodated. No exceptions.
- Walkable area required (dog needs outdoor access).
- Pet fees and deposits are noted but not disqualifying.

## Execution

Declarative skill. Trigger: "Run skill: travel-planner [destination] [dates]". Load this SKILL.md, execute prompts.

### Prompts

- prompts/research.md — Hotel research, policy verification, and comparison

## Model Requirements

- Provider: Cloud preferred for multi-source synthesis
- Minimum model: llama3:8b
