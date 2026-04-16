# CRON_TRADING_PROMPTS.md — Required Trading Integration for Cron Jobs

These are the EXACT trading-related instructions that must be present in each cron job's payload in `~/.openclaw/cron/jobs.json`. If a cron prompt is missing these, update it.

**How to use:** Read this file, compare against your actual cron prompts, and update any that are stale. This is a Todoist task for Clawdius to execute.

---

## heartbeat — Trading Section (MUST be in prompt)

Add this to the heartbeat payload, under the Markets/Recon section:

```
**TRADING (Mon-Fri market hours, 6:30am-1pm PT / 9:30am-4pm ET):**

1. Read today's brief: `memory/trading-YYYY-MM-DD.md`
   - If it doesn't exist or is stale, note it and move on
   - Know the Mancini ranked setups (Rank 1-3) and DP levels if present

2. Check paper portfolio: `trade-journal positions`
   - If Pot B or C have open positions, note them
   - If all pots are flat, skip position monitoring

3. Fetch ES price: `quote ES=F`
   - Compare vs Mancini Rank 1-3 flush targets from the brief
   - Within 10 pts of flush target → log to daily memory (no Telegram)
   - Within 5 pts → alert Simon: "ES approaching Rank N zone at [price]"
   - Recovery confirmed above flush level → execute Pot C:
     `trade-journal log C buy <qty> SPY --notes "Mancini Rank N triggered" --execute`

4. Check Pot B positions vs DP targets/stops:
   - For each open Pot B position, `tradier quote <symbol>`
   - Alert on >2% move or approaching DP's stated target/stop from brief
   - If DP has posted "FLAT all" via VTF, close all Pot B positions

5. When nothing is near a level: skip trading section silently. Don't report noise.
```

---

## premarket-brief — DP Section (MUST be in prompt)

Add this to the premarket-brief gather section:

```
7. **DP/Inner Circle** — check if DP section exists in today's trading brief.
   If Simon pasted an AM Call transcription earlier, it should already be parsed.
   If DP section is missing, note it:
   "DP morning call: pending — Simon hasn't pasted yet."
   If DP section IS present, cross-reference DP levels with Mancini levels:
   - Flag alignment: "DP and Mancini both watching ES 5530 zone"
   - Flag divergence: "DP bearish (shorting QQQ 584) but Mancini sees FB setup for longs at 5530"
   Reference: `DP.md` for methodology, `MANCINI.md` for Mancini framework.
```

---

## x-scan — Brief Cross-Reference (MUST be in prompt)

Add this to the x-scan ACT section:

```
**TRADING CROSS-REF (weekdays only):**
Before delivering any trading-relevant tweet, read `memory/trading-YYYY-MM-DD.md`.
- If tweet mentions a level or ticker in the brief, add context:
  "[ALIGNS] @AdamMancini4: ES long above 5420 — matches brief Rank 2 target 5420"
  "[CONFLICTS] @epictrades1: bearish QQQ — but DP is long QQQ at 582"
- If the tweet is from @AdamMancini4, it may update or confirm the Substack brief.
- If no trading brief exists today, deliver the tweet without cross-ref.
```

---

## eod-review — Paper Account Reconciliation (ADD to prompt)

Add this to the eod-review payload after the level review:

```
**PAPER ACCOUNT (after level review):**
1. Mark to market: `trade-journal mark`
2. Compare pots: `trade-journal compare`
3. Reconcile vs Tradier: `trade-journal reconcile`
4. Include Pot comparison in EOD report to Simon:
   "Pot A: +$X (+Y%), Pot B: -$X (-Y%), Pot C: flat. SPY: +Z%."
5. If any pot has drawn down >10% from allocation, flag for halt review.
```

---

## How Clawdius Should Update These

1. Read this file (`CRON_TRADING_PROMPTS.md`)
2. Read current cron prompts from `~/.openclaw/cron/jobs.json`
3. For each cron job above, check if the trading section is present
4. If missing or stale, update the cron prompt payload in `jobs.json`
5. Verify by reading back the updated prompt
6. Log the update in `memory/YYYY-MM-DD.md`

**This is a one-time task.** Once the prompts are updated, they persist across restarts. Create a Todoist task: "Update cron prompts with trading pipeline integration (ref: CRON_TRADING_PROMPTS.md)"
