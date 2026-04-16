#!/usr/bin/env python3
"""journal.py — append-only event log for the trading system.

Every signal, risk check, order, fill, and governor block is recorded.
One JSONL file per day in markets/journal/.

Usage:
  journal append <type> <json_data>    — append an entry
  journal read [--date YYYY-MM-DD]     — read today's or specified date's journal
  journal summary [--date YYYY-MM-DD]  — aggregate stats for a date
  journal signal <symbol> <action> <source> [--notes '...']  — log a signal
  journal risk_check <symbol> <verdict> [--reason '...']     — log a risk check
  journal order <symbol> <side> <qty> <price> [--type limit] [--pot P]  — log an order
  journal fill <symbol> <side> <qty> <price> [--order_id X]  — log a fill

Output: JSONL entries to stdout, summary as formatted text.
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

MARKETS_DIR = Path(os.environ.get("MARKETS_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "markets")))
JOURNAL_DIR = MARKETS_DIR / "journal"


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def today_str():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def journal_path(date_str=None):
    date_str = date_str or today_str()
    return JOURNAL_DIR / f"{date_str}.jsonl"


def append_entry(entry):
    """Append a journal entry. Adds timestamp if not present."""
    if "ts" not in entry:
        entry["ts"] = now_iso()
    JOURNAL_DIR.mkdir(parents=True, exist_ok=True)
    path = journal_path()
    with open(path, "a") as f:
        f.write(json.dumps(entry, separators=(",", ":")) + "\n")
    return entry


def read_journal(date_str=None):
    """Read all entries for a date."""
    path = journal_path(date_str)
    if not path.exists():
        return []
    entries = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return entries


def summarize(date_str=None):
    """Aggregate stats for a date."""
    entries = read_journal(date_str)
    if not entries:
        return {"date": date_str or today_str(), "entries": 0, "message": "No journal entries"}

    stats = {
        "date": date_str or today_str(),
        "entries": len(entries),
        "signals": 0,
        "risk_checks": 0,
        "approved": 0,
        "blocked": 0,
        "reduced": 0,
        "orders": 0,
        "fills": 0,
        "total_realized_pnl": 0.0,
        "symbols_traded": set(),
        "by_type": {},
        "by_source": {},
        "by_pot": {},
    }

    for e in entries:
        etype = e.get("type", "unknown")
        stats["by_type"][etype] = stats["by_type"].get(etype, 0) + 1

        if etype == "signal":
            stats["signals"] += 1
            src = e.get("source", "unknown")
            stats["by_source"][src] = stats["by_source"].get(src, 0) + 1

        elif etype == "risk_check":
            stats["risk_checks"] += 1
            v = e.get("verdict", "")
            if v == "APPROVED":
                stats["approved"] += 1
            elif v == "BLOCKED":
                stats["blocked"] += 1
            elif v == "REDUCED":
                stats["reduced"] += 1

        elif etype == "order":
            stats["orders"] += 1
            sym = e.get("symbol", "")
            if sym:
                stats["symbols_traded"].add(sym)
            pot = e.get("pot", "")
            if pot:
                stats["by_pot"][pot] = stats["by_pot"].get(pot, 0) + 1

        elif etype == "fill":
            stats["fills"] += 1
            if "realized_pnl" in e:
                stats["total_realized_pnl"] += e["realized_pnl"]

    stats["symbols_traded"] = sorted(stats["symbols_traded"])
    return stats


def format_summary(stats):
    """Human-readable summary."""
    lines = []
    lines.append(f"=== Journal: {stats['date']} ===")
    lines.append(f"Entries: {stats['entries']}")
    if stats["entries"] == 0:
        lines.append("No activity recorded.")
        return "\n".join(lines)

    lines.append(f"Signals: {stats['signals']}")
    lines.append(f"Risk checks: {stats['risk_checks']} "
                 f"({stats['approved']} approved, {stats['blocked']} blocked, "
                 f"{stats['reduced']} reduced)")
    lines.append(f"Orders: {stats['orders']}")
    lines.append(f"Fills: {stats['fills']}")
    lines.append(f"Realized P&L: ${stats['total_realized_pnl']:.2f}")

    if stats["symbols_traded"]:
        lines.append(f"Symbols: {', '.join(stats['symbols_traded'])}")
    if stats["by_source"]:
        src_str = ", ".join(f"{k}: {v}" for k, v in stats["by_source"].items())
        lines.append(f"Signal sources: {src_str}")
    if stats["by_pot"]:
        pot_str = ", ".join(f"Pot {k}: {v}" for k, v in sorted(stats["by_pot"].items()))
        lines.append(f"Orders by pot: {pot_str}")

    return "\n".join(lines)


def parse_kv_args(args):
    """Parse --key value pairs from args list."""
    kv = {}
    i = 0
    while i < len(args):
        if args[i].startswith("--") and i + 1 < len(args):
            key = args[i][2:]
            kv[key] = args[i + 1]
            i += 2
        else:
            i += 1
    return kv


def main():
    if len(sys.argv) < 2:
        print(__doc__.strip())
        sys.exit(2)

    cmd = sys.argv[1]

    if cmd == "append":
        if len(sys.argv) < 4:
            print("Usage: journal append <type> <json_data>")
            sys.exit(2)
        etype = sys.argv[2]
        try:
            data = json.loads(sys.argv[3])
        except json.JSONDecodeError:
            data = {"raw": sys.argv[3]}
        data["type"] = etype
        entry = append_entry(data)
        print(json.dumps(entry))

    elif cmd == "signal":
        if len(sys.argv) < 5:
            print("Usage: journal signal <symbol> <action> <source> [--notes '...']")
            sys.exit(2)
        kv = parse_kv_args(sys.argv[5:])
        entry = append_entry({
            "type": "signal",
            "symbol": sys.argv[2].upper(),
            "action": sys.argv[3].lower(),
            "source": sys.argv[4],
            "notes": kv.get("notes", ""),
        })
        print(json.dumps(entry))

    elif cmd == "risk_check":
        if len(sys.argv) < 4:
            print("Usage: journal risk_check <symbol> <verdict> [--reason '...']")
            sys.exit(2)
        kv = parse_kv_args(sys.argv[4:])
        entry = append_entry({
            "type": "risk_check",
            "symbol": sys.argv[2].upper(),
            "verdict": sys.argv[3].upper(),
            "reason": kv.get("reason", ""),
        })
        print(json.dumps(entry))

    elif cmd == "order":
        if len(sys.argv) < 6:
            print("Usage: journal order <symbol> <side> <qty> <price> "
                  "[--type limit] [--pot P] [--loop L]")
            sys.exit(2)
        kv = parse_kv_args(sys.argv[6:])
        entry = append_entry({
            "type": "order",
            "symbol": sys.argv[2].upper(),
            "side": sys.argv[3].lower(),
            "qty": int(sys.argv[4]),
            "price": float(sys.argv[5]),
            "order_type": kv.get("type", "limit"),
            "pot": kv.get("pot", ""),
            "loop": kv.get("loop", ""),
        })
        print(json.dumps(entry))

    elif cmd == "fill":
        if len(sys.argv) < 6:
            print("Usage: journal fill <symbol> <side> <qty> <price> [--order_id X]")
            sys.exit(2)
        kv = parse_kv_args(sys.argv[6:])
        entry = append_entry({
            "type": "fill",
            "symbol": sys.argv[2].upper(),
            "side": sys.argv[3].lower(),
            "qty": int(sys.argv[4]),
            "price": float(sys.argv[5]),
            "order_id": kv.get("order_id", ""),
        })
        print(json.dumps(entry))

    elif cmd == "read":
        kv = parse_kv_args(sys.argv[2:])
        entries = read_journal(kv.get("date"))
        for e in entries:
            print(json.dumps(e))

    elif cmd == "summary":
        kv = parse_kv_args(sys.argv[2:])
        stats = summarize(kv.get("date"))
        if "--json" in sys.argv:
            # Convert set to list for JSON
            print(json.dumps(stats, indent=2, default=list))
        else:
            print(format_summary(stats))

    else:
        print(f"Unknown command: {cmd}")
        print(__doc__.strip())
        sys.exit(2)


if __name__ == "__main__":
    main()
