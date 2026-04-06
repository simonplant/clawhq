
<!-- This section is managed by aishore and will be overwritten on `aishore update`. -->
<!-- Customizations here will be lost. Add project-specific instructions above this section. -->
## Sprint Orchestration (aishore)

This project uses aishore for autonomous sprint execution. Backlog lives in `backlog/`, tool lives in `.aishore/`. Run `.aishore/aishore help` for full usage.

**How it works:** aishore picks items from the backlog by priority, implements each on a feature branch, validates against commander's intent and executable acceptance criteria, and merges. Quality comes from execution — code must run and prove it works, not just pass review or hit coverage numbers.

**What this means for you (if you're an AI agent in this project):**
- **Intent is the north star.** Every item has a commander's intent field. When steps or AC are ambiguous, follow intent.
- **Prove it runs.** Wire code to real entry points. If the build command exists, run it. If a verify command exists, execute it. Working code that's reachable beats tested code that's isolated.
- **No mocks or stubs.** Never use mocks or stubs unless the item explicitly requests them. Connect to the real system.
- **Stay in scope.** Implement the item you're assigned. Don't fix unrelated code, add unrequested features, or refactor surrounding code.

```bash
.aishore/aishore run [N|ID]         # Run sprints (branch, commit, merge, push per item)
.aishore/aishore groom              # Groom bugs, features, and tech debt
.aishore/aishore scaffold           # Scaffolding review
.aishore/aishore review             # Architecture review
.aishore/aishore status             # Backlog overview
```
