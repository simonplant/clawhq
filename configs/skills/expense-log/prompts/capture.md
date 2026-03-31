# Expense Capture

User input: "{{raw_input}}"

Parse:
- Amount: extract number (handle $, , etc.)
- Vendor/description: what was it?
- Category: map to [{{categories}}]. If unclear, ask once.
- Date: today unless specified.

Confirm back: one line. Example: "Logged: $185 — storage unit (housing) — March 31"
If ambiguous category, ask: "Is that [food] or [other]?"
