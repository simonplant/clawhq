---
title: IDENTITY.md
category: Features
status: active
date: 2026-04-22
tags: [identity, persona, metadata, openclaw, component]
sources:
  - raw/compiled/openclaw-reference-v2026.4.14.md
---

# IDENTITY.md

## Purpose

The agent's name, emoji, avatar path, and presentation metadata.
Created or updated during the bootstrap ritual or via
`openclaw agents set-identity`.

This is the "what users see" layer. SOUL.md is the "what the model
embodies" layer. See [[soul-md]] for the
distinction — they are deliberately separable.

## Fields (from official templates)

- **Name:** Pick something you like
- **Creature:** AI? Robot? Familiar? Ghost in the machine? Something
  weirder?
- **Vibe:** How do you come across? Sharp? Warm? Chaotic? Calm?
- **Emoji:** Your signature — pick one that feels right
- **Avatar:** Workspace-relative path, `http(s)` URL, or data URI

The official template notes: "This isn't just metadata" — it's
designed for the agent to fill in during its first conversation,
making it a collaborative identity-building exercise.

## Best practices

- **This is metadata, not personality.** Personality goes in
  `SOUL.md`. If you find yourself writing paragraphs of behavioral
  description here, move them to SOUL.md.
- **Read-only alongside SOUL.md.** `chmod 444` both. IDENTITY.md
  defines how the agent presents; letting the agent rewrite its own
  name or emoji in response to untrusted input is a small but real
  attack surface.
- **`set-identity --from-identity`** reads from the workspace root.

## Debugging tip

If the agent introduces itself using the config agent ID (like
`"main"` or `"clawdius"`) instead of its persona name, the most common
cause is **boot files not loading**. This is often the symlink-escape
issue — see [[workspace-as-agent]]. The agent isn't
broken; it just doesn't have IDENTITY.md in its context.

Check with `/context list` to confirm.

## See also

- [[soul-md]]
- [[system-prompt-assembly]]
