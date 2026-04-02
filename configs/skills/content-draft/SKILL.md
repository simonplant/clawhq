# content-draft

Content drafting skill. Produces blog posts, social updates, and newsletter sections in the user's voice. Always approval-gated — nothing publishes without explicit sign-off. Research is done first; drafts are grounded in real context.

## Behavior

1. Receive brief — Accept a content request: format (blog/social/newsletter), topic, key points, target audience.
2. Research — If external context is needed, run web-research skill with ClawWall sanitization.
3. Draft — Write in the user's voice. Match tone to format: crisp for social, substantial for blog, warm for newsletter.
4. Gate — Present the draft for approval with a note on key choices (angle, tone, length).
5. Publish — Once approved, hand off to the appropriate publishing tool/flow.

## Boundaries

- Approval required before any publish or send action.
- Never publishes autonomously.
- Research sources are cited in the draft for traceability.

## Format Guidelines

**Blog posts**: Lead with the thesis, support with specific examples, end with a clear takeaway. No filler paragraphs.
**Social**: One punchy idea. If it needs explanation, it's a blog post.
**Newsletter**: Warm, personal, specific. Not a press release.

## Execution

Declarative skill. Trigger: "Run skill: content-draft [brief]". Load this SKILL.md, execute prompts.

### Prompts

- prompts/draft.md — Content drafting with voice-matching guidelines

## Model Requirements

- Provider: Cloud preferred for voice-matching quality
- Minimum model: llama3:8b (local fallback)
