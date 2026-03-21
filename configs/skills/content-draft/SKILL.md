# content-draft

Content idea generation and first-draft writing — always requires approval before publishing.

## What It Does

- Generates content ideas from user's interests, recent work, and trending topics
- Writes first drafts of blog posts, social copy, newsletters, and threads
- Researches topics via `web-research` before writing
- Matches the user's established voice and style
- Saves drafts to `content/` directory for review
- **Never publishes without explicit approval** — always a two-step process

## Content Types

| Type | Output | Approval |
|------|--------|----------|
| Blog post | `content/blog/` | Outline → Draft → Final |
| Social post | `content/social/` | Draft → Final |
| Newsletter | `content/newsletters/` | Outline → Draft → Final |
| Thread | `content/threads/` | Draft → Final |

## Workflow

1. **Seed** (weekly or on-demand): generate 3-5 content ideas based on recent activity
2. **Outline** (on approval): expand selected idea into structured outline
3. **Draft** (on approval): write full draft matching user's voice
4. **Polish** (on approval): refine based on feedback
5. **Publish**: user handles final publish step (or uses platform integration)

## Hard Limits

- **Never auto-publishes** to any platform
- **Never impersonates** the user to other people (only generates content for their review)
- All research through `sanitize` before use in drafts
- No fabricated quotes, statistics, or claims

## Tools Required

- `tavily` — topic research (budget-managed)
- `sanitize` — ClawWall filter for research sources
- `tasks` — track content pipeline

## Customization

- `voice.tone` — populated from blueprint personality config
- `content_types` — enable/disable types per blueprint
- `weekly_seed.cron` — adjust the weekly content seed schedule
