# Sprint Definitions

## Definition of Ready (DoR)

An item is ready for sprint when:

| # | Criteria              | Description                                        |
|---|-----------------------|----------------------------------------------------|
| 1 | **Commander's Intent** | The `intent` field states what must be true when done |
| 2 | **Actionable Steps**  | Steps are clear enough for implementation          |
| 3 | **Testable AC**       | Acceptance criteria can be verified                |
| 4 | **No Blockers**       | Dependencies are resolved                          |
| 5 | **Right Size**        | Can be completed in one sprint                     |
| 6 | **readyForSprint**    | Groomer has marked it ready                        |

## Definition of Done (DoD)

An item is done when:

| # | Criteria              | Description                                        |
|---|-----------------------|----------------------------------------------------|
| 1 | **Code Complete**     | Implementation matches acceptance criteria         |
| 2 | **Tests Pass**        | All tests pass (existing + new)                   |
| 3 | **Validation Pass**   | Type-check, lint, tests all pass                  |
| 4 | **AC Verified**       | Each AC met (verify commands pass, validator confirms) |
| 5 | **No Regressions**    | Regression suite passes (prior sprints' guarantees hold) |

## Priority Levels

| Priority | Code | Description                   |
|----------|------|-------------------------------|
| Must     | P0   | Critical, blocking other work |
| Should   | P1   | Important, not blocking       |
| Could    | P2   | Nice to have                  |
| Future   | P3   | Long-term consideration       |

## Size Estimates

| Size | Typical Scope                               |
|------|---------------------------------------------|
| XS   | Single file change, < 50 lines              |
| S    | Few files, < 200 lines, straightforward     |
| M    | Multiple files, new patterns, 200-500 lines |
| L    | Significant feature, multiple components    |
| XL   | Large feature, consider splitting           |

## Writing Commander's Intent

Intent is a non-negotiable directive — what must be true when the work is done.
Write it like an order, not a description. State the outcome, not the implementation.

| Good | Bad (and why) |
|------|---------------|
| "Ops must know instantly if the service is alive or dead." | "Add health check endpoint" (implementation, not outcome) |
| "Users authenticate securely or are told why not. Never a blank screen." | "Improve auth" (vague, no bar) |
| "Large uploads complete or give clear progress. No frozen screens." | "Make it faster" (no specific bar) |
| "Webhooks deliver or tell the user why not. Silent failure is unacceptable." | "Improve webhook reliability" (vague) |

## Backlog Item Structure

```json
{
  "id": "FEAT-001",
  "title": "Short title",
  "intent": "Users must get X or know exactly why not. Silent failure is not acceptable.",
  "description": "Full description — what to build, context, scope boundaries",
  "priority": "should",
  "category": "core",
  "steps": ["Step 1", "Step 2"],
  "acceptanceCriteria": [
    "Plain string AC (validated by judgment)",
    {"text": "CLI exits non-zero on bad input", "verify": "! ./app bad-input 2>/dev/null"}
  ],
  "scope": ["src/**", "tests/**"],
  "dependsOn": ["FEAT-000"],
  "status": "todo",
  "passes": false,
  "readyForSprint": false
}
```

### Field Reference

| Field | Type | Set by | Description |
|-------|------|--------|-------------|
| `id` | string | CLI (`backlog add`) | Unique item ID (e.g., `FEAT-001`, `BUG-042`) |
| `title` | string | User / groom agent | Short title |
| `intent` | string | User / groom agent | Commander's intent — what must be true when done. Hard gate: ≥20 chars required for sprint |
| `description` | string | User / groom agent | Full context and scope boundaries |
| `priority` | string | User / groom agent | `must` \| `should` \| `could` \| `future` |
| `category` | string | User / groom agent | Arbitrary tag for filtering (e.g., `api`, `docs`) |
| `steps` | string[] | User / groom agent | Implementation steps |
| `acceptanceCriteria` | (string \| object)[] | User / groom agent | Plain strings or `{text, verify}` objects. `verify` is a shell command (an eval) |
| `scope` | string[] | User / groom agent | File glob patterns constraining where changes should land |
| `dependsOn` | string[] | User / groom agent | Item IDs that must be done before this item can be picked |
| `status` | string | Orchestrator / CLI | `todo` \| `in-progress` \| `done` \| `skip` |
| `passes` | boolean | Orchestrator | `true` when sprint passed validation |
| `readyForSprint` | boolean | Groom agent / CLI | `true` when item passes readiness gates |
| `groomedAt` | string | Groom agent / CLI | Date of last grooming (`YYYY-MM-DD`) |
| `groomingNotes` | string | Groom agent / CLI | Free-text grooming notes |
| `completedAt` | string | Orchestrator | ISO timestamp when sprint completed |
| `lastFailReason` | string | Orchestrator | Reason for most recent sprint failure |
| `lastFailAt` | string | Orchestrator | ISO timestamp of most recent failure |
| `failCount` | integer | Orchestrator | Number of sprint failures |

## Executable AC (Verify Commands)

AC entries with a `verify` field are **evals** — shell commands that prove the criterion is met. They are:

1. **Run after each sprint** as part of validation (failures trigger retries)
2. **Saved to the regression suite** on sprint success (`backlog/archive/regression.jsonl`)
3. **Run before every future sprint** as pre-flight (protects prior work from regressions)

Prefer verify commands over plain-string AC wherever behavior is observable via shell command. Plain-string AC are validated by the Validator agent's judgment; verify commands are validated deterministically.

## Archive Schemas

### `backlog/archive/sprints.jsonl`

One JSON object per line, appended on each sprint completion:

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | Completion date (`YYYY-MM-DD`) |
| `sprintId` | string | Unique sprint ID |
| `itemId` | string | Backlog item ID |
| `status` | string | `complete` |
| `attempts` | integer | Number of attempts (including retries) |
| `filesChanged` | integer | Files modified |
| `linesAdded` | integer | Lines added |
| `linesRemoved` | integer | Lines removed |
| `duration` | integer | Wall-clock seconds |
| `priority` | string | Item priority at completion |
| `category` | string | Item category at completion |
| `title` | string | Item title |

### `backlog/archive/regression.jsonl`

Accumulated verify commands from completed sprints. Run as pre-flight before every sprint:

| Field | Type | Description |
|-------|------|-------------|
| `itemId` | string | Source backlog item ID |
| `date` | string | Date saved (`YYYY-MM-DD`) |
| `text` | string | AC description |
| `verify` | string | Shell command that must exit 0 |
