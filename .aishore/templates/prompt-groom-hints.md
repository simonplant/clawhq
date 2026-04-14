## CLI Commands

Use CLI commands to manage items — do NOT edit JSON directly:

```bash
.aishore/aishore backlog list
.aishore/aishore backlog show <ID>
{{CLI_ROLE_LINES}}
.aishore/aishore backlog rm <ID> --force
```

## Commander's Intent
Every item should have an `intent` field — a non-negotiable directive stating what must be true when done. Use `--intent "..."` when adding/editing items. Write it like an order, not a description.

**Intent quality bar:** Intent must NOT be a restatement of the title. It must describe an observable outcome a user or system can verify. Bad: "Implement error handling." Good: "Every CLI command that fails must print a human-readable error message to stderr and exit non-zero — no stack traces, no silent failures."

## Executable Acceptance Criteria (MANDATORY)
Every AC you write MUST have an `--ac-verify` command wherever the outcome is testable by a shell command. This is what separates an eval from an opinion. Verify commands must **execute the behavior and check the result**, not grep for code existence in source files.

```bash
# Good: test behavior, exit codes, file existence
--ac "CLI prints usage on --help" --ac-verify ".aishore/aishore help | head -1 | grep -qi usage"
--ac "Invalid input exits non-zero" --ac-verify "! .aishore/aishore backlog show NONEXISTENT"
--ac "Build succeeds" --ac-verify "npm run build"
--ac "New page exists after build" --ac-verify "test -f dist/new-page/index.html"

# BAD: greps built/bundled output (will fail after minification/bundling)
# --ac "Page has subscribe form" --ac-verify "grep -qi subscribe dist/index.html"  ← WRONG
# --ac "Function exists" --ac-verify "grep -q 'myFunc' src/app.js"  ← tests structure, not behavior
```

**CRITICAL: verify commands must survive build transforms.** If the project uses a build tool (Astro, Vite, Next.js, webpack, etc.), NEVER grep built output for content strings — they are bundled, hashed, and minified. Test file existence, exit codes, HTTP responses, or run the code directly. Every broken verify command wastes an entire developer retry cycle.

## Grooming Limits
- **Maximum items per session:** {{GROOM_MAX_ITEMS}} — stop adding new items after this cap. Focus on the highest-value items first.
- **Minimum priority threshold:** {{GROOM_MIN_PRIORITY}} — only add items at `{{GROOM_MIN_PRIORITY}}` priority or higher. Skip lower-priority items (log them in your summary but do not add them).
- When you reach the cap or run out of items above the threshold, stop and signal completion. Do not generate busywork.
