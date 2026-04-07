
<!-- This section is managed by aishore and will be overwritten on `aishore update`. -->
<!-- Customizations here will be lost. Add project-specific instructions above this section. -->
## Sprint Orchestration (aishore)

This project uses aishore for autonomous sprint execution. Backlog lives in `backlog/`, tool lives in `.aishore/`.

**Agent rules (mandatory):**
- **Intent is the north star.** Every item has a commander's intent field. When steps or AC are ambiguous, follow intent.
- **Prove it runs.** Wire code to real entry points. If the build command exists, run it. If a verify command exists, execute it. Working code that's reachable beats tested code that's isolated.
- **No mocks or stubs** in production code unless the item explicitly requests them.
- **Stay in scope.** Implement only the assigned item. Don't fix unrelated code, add unrequested features, or refactor surrounding code.
- **Commit before signaling.** Always commit with a meaningful message before writing result.json.

```bash
.aishore/aishore run [N|ID|scope]    # Run sprints (scope: done, p0, p1, p2)
.aishore/aishore groom              # Groom backlog items
.aishore/aishore scaffold           # Detect fragment risk
.aishore/aishore review             # Architecture review
.aishore/aishore status             # Backlog overview
```
