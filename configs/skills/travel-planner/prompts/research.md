# Travel Planner — Research Prompt

Research pet-friendly hotels for the given trip.

## Required Data Per Hotel
- Name, address, nightly rate
- Pet policy: weight limit, breed restrictions, pet fee/deposit
- Distance to nearest walkable area (park, trail, sidewalk)
- Guest review score
- Booking URL

## Verification Checklist
- [ ] Weight limit confirmed (not just "pet-friendly")
- [ ] Breed restriction checked
- [ ] Pet fee and deposit documented
- [ ] Walkable area within 0.5 miles

## Ranking Criteria
1. Policy flexibility (no weight/breed restrictions = best)
2. Walkability
3. Price per night (including pet fee)
4. Review score

## Output Format
Top 3 options ranked:

**[Hotel Name]** — $[rate]/night + $[pet fee]
- Policy: [weight limit, breed notes]
- Walk: [nearest walkable area, distance]
- Reviews: [score] ([brief note])
- Book: [URL]

Recommendation: [which one and why in 1 sentence]
