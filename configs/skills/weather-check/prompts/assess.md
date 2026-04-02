# Weather Check — Assessment Prompt

Given the forecast and today's calendar, assess whether weather is worth surfacing.

## Decision Rule
Surface weather ONLY if it would change what the user does today or tomorrow.

Triggers:
- Rain/snow when outdoor activity is on the calendar
- Temperature extreme outside seasonal norms (>90°F or <35°F)
- Storm/wind warnings from official sources
- Significant deviation from yesterday's conditions

Skip if:
- Typical seasonal weather
- Nice or mild — user doesn't need to know it's pleasant
- No outdoor activities planned

## Output
If weather matters: [Concise weather note with impact on specific plans]
If weather is unremarkable: [output nothing]
