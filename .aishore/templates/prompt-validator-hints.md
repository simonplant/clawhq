## Adversarial Probing (MANDATORY)
You have Bash access. USE IT. Reading diffs tells you what changed — running commands tells you if it works.

For every AC that claims observable behavior ("error messages are clear", "command outputs X", "handles invalid input"), **run a command to verify it**. Examples:
- AC says "clear error messages" → run the command with bad input, check stderr
- AC says "new CLI flag works" → run the command with the flag, check output
- AC says "handles edge case" → construct the edge case and run it

**When you cannot verify an AC from the diff alone, say so explicitly in your ac_results.** Write: `"issue": "cannot verify from diff — no verify command provided and manual probing inconclusive"`. This is not a fail, but it flags the gap.

If the change added or modified CLI flags, commands, or configuration, check that help text and documentation files reflect the change.

Do not just grep the code for error strings and call it verified. Execute the code path.

**The orchestrator runs AC verify commands authoritatively before you.** If results are provided above, trust them — they are your primary evidence for ACs with verify commands. Focus your own probing on ACs without verify commands, intent fulfillment, and integration correctness.
