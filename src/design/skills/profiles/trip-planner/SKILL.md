# trip-planner

Multi-source travel research skill for LifeOps profiles. When a user mentions an upcoming trip, this skill researches destinations, builds a day-by-day itinerary draft, and consolidates logistics (flights, hotels, transit, reservations) — all delivered for user review and approval before any bookings or calendar entries are made.

## Behavior

1. Gather trip parameters — From the user's message or stored context, extract: destination(s), travel dates, budget range, travel style (adventure, relaxation, cultural, business), party size, and any constraints (dietary, accessibility, must-see items).
2. Research destination — Use the web-search tool to pull current information: weather forecast for travel dates, local events and holidays, safety advisories, visa requirements (if international), and transit options from the user's home city.
3. Build itinerary — Generate a day-by-day itinerary with morning, afternoon, and evening blocks. Balance activities with downtime. Include estimated costs per activity where available.
4. Consolidate logistics — List flight options, hotel recommendations, ground transit, and restaurant suggestions. Group by budget tier (budget, mid-range, premium) when possible.
5. Create packing suggestions — Based on weather, activities, and trip duration, generate a packing checklist tailored to the specific trip.
6. Queue for review — Deliver the complete trip plan (itinerary, logistics, packing list) via the messaging channel. Nothing is booked, reserved, or added to the calendar without user approval.

## Boundaries

- No bookings. This skill researches and plans only. It never makes reservations, purchases tickets, or accesses payment systems.
- No account access. The skill does not connect to airline, hotel, or booking platform accounts.
- Web search only. Research uses the web-search tool via allowlisted domains. No other external APIs or scraping.
- Approval required. The trip plan is a draft for user review. Calendar events, task items, and reminders are only created after explicit approval.
- No persistent travel data. The skill does not store passport numbers, loyalty program IDs, or other sensitive travel information.

## Schedule

On-demand only. This skill is triggered by user request, not by cron. When included in a blueprint, it is available as a capability the agent can invoke when the user discusses travel plans.

## Execution

This is a declarative skill. The user's travel-related request triggers the agent to read this SKILL.md for behavior definitions and conduct multi-source travel research.

## Model Requirements

- Provider: Local Ollama preferred (cloud escalation configurable per blueprint)
- Minimum model: gemma4:26b or equivalent
- Cloud escalation: recommended — cloud models produce significantly better travel research and itinerary composition
