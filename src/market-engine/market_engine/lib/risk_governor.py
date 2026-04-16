#!/usr/bin/env python3
"""risk_governor.py — hard constraint enforcement between signal and execution.

The LLM cannot override this. Every proposed trade passes through check_trade()
before any order is placed. If the governor says BLOCKED, the trade does not happen.

Usage:
  risk_governor check <side> <qty> <symbol> --price N [--pot P] [--sector S] [--loop L]
  risk_governor status
  risk_governor limits

Exit codes:
  0 = APPROVED (or REDUCED — check stdout)
  1 = BLOCKED (reason in stdout)
  2 = ERROR (bad input, missing state)
"""

import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

MARKETS_DIR = Path(os.environ.get("MARKETS_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "markets")))
CONFIG_PATH = MARKETS_DIR / "CONFIG.json"
STATE_PATH = MARKETS_DIR / "STATE.json"
JOURNAL_DIR = MARKETS_DIR / "journal"


def load_json(path):
    with open(path) as f:
        return json.load(f)


def load_config():
    return load_json(CONFIG_PATH)


def load_state():
    return load_json(STATE_PATH)


def today_str():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def count_today_trades(journal_dir, loop=None):
    """Count trades logged today from the journal."""
    today_file = journal_dir / f"{today_str()}.jsonl"
    if not today_file.exists():
        return 0
    count = 0
    with open(today_file) as f:
        for line in f:
            try:
                entry = json.loads(line)
                if entry.get("type") in ("order", "fill"):
                    if loop is None or entry.get("loop") == loop:
                        count += 1
            except (json.JSONDecodeError, KeyError):
                continue
    return count


def today_realized_pnl(journal_dir):
    """Sum realized P&L from today's journal."""
    today_file = journal_dir / f"{today_str()}.jsonl"
    if not today_file.exists():
        return 0.0
    total = 0.0
    with open(today_file) as f:
        for line in f:
            try:
                entry = json.loads(line)
                if entry.get("type") == "fill" and "realized_pnl" in entry:
                    total += entry["realized_pnl"]
            except (json.JSONDecodeError, KeyError):
                continue
    return total


class RiskVerdict:
    APPROVED = "APPROVED"
    BLOCKED = "BLOCKED"
    REDUCED = "REDUCED"

    def __init__(self, verdict, reason=None, new_qty=None, checks_passed=None):
        self.verdict = verdict
        self.reason = reason
        self.new_qty = new_qty
        self.checks_passed = checks_passed or []

    def to_dict(self):
        d = {"verdict": self.verdict}
        if self.reason:
            d["reason"] = self.reason
        if self.new_qty is not None:
            d["new_qty"] = self.new_qty
        d["checks_passed"] = self.checks_passed
        return d

    def __str__(self):
        if self.verdict == self.BLOCKED:
            return f"BLOCKED: {self.reason}"
        elif self.verdict == self.REDUCED:
            return f"REDUCED to {self.new_qty}: {self.reason}"
        else:
            return f"APPROVED ({len(self.checks_passed)} checks passed)"


def check_trade(side, qty, symbol, price, pot=None, sector=None, loop=None):
    """Run all risk checks. Returns RiskVerdict.

    Args:
        side: 'buy' or 'sell'
        qty: number of shares
        symbol: ticker symbol
        price: per-share price
        pot: pot ID (A/B/C) if using pot system
        sector: sector name for concentration check
        loop: 'portfolio', 'swing', or 'session'
    """
    config = load_config()
    state = load_state()
    risk = config["risk"]
    passed = []

    trade_value = qty * price
    portfolio_value = state["account"]["portfolio_value"]
    if portfolio_value <= 0:
        return RiskVerdict(RiskVerdict.BLOCKED, "Portfolio value is zero or negative")

    # ── Check 1: Paper mode guard ──────────────────────────────────────
    if risk.get("paper_mode", True) and not state["account"].get("paper_mode", True):
        return RiskVerdict(RiskVerdict.BLOCKED,
            "Paper mode enabled in config but account is live")
    passed.append("paper_mode_guard")

    # ── Check 2: Circuit breaker ───────────────────────────────────────
    risk_snap = state.get("risk_snapshot", {})
    drawdown = risk_snap.get("drawdown_from_hwm_pct", 0)
    if drawdown >= risk["max_drawdown_pct"]:
        return RiskVerdict(RiskVerdict.BLOCKED,
            f"Circuit breaker: drawdown {drawdown:.1f}% >= {risk['max_drawdown_pct']}% limit. "
            f"Cooldown {risk['circuit_breaker_cooldown_hours']}h required.")
    passed.append("circuit_breaker")

    # ── Check 3: Daily loss limit ──────────────────────────────────────
    daily_pnl = today_realized_pnl(JOURNAL_DIR)
    daily_pnl += risk_snap.get("daily_unrealized_pnl", 0)
    if daily_pnl <= -risk["max_daily_loss"]:
        return RiskVerdict(RiskVerdict.BLOCKED,
            f"Daily loss limit: P&L ${daily_pnl:.2f} breached ${risk['max_daily_loss']:.2f} limit")
    daily_pnl_pct = (daily_pnl / portfolio_value) * 100 if portfolio_value else 0
    if daily_pnl_pct <= -risk["max_daily_loss_pct"]:
        return RiskVerdict(RiskVerdict.BLOCKED,
            f"Daily loss %: {daily_pnl_pct:.1f}% breached {risk['max_daily_loss_pct']}% limit")
    passed.append("daily_loss_limit")

    # ── Check 4: Position size ─────────────────────────────────────────
    if side == "buy":
        is_daytrade = loop == "session"
        max_pct = risk["max_position_pct_daytrade"] if is_daytrade else risk["max_position_pct"]
        position_pct = (trade_value / portfolio_value) * 100
        if position_pct > max_pct:
            max_qty = int((portfolio_value * max_pct / 100) / price)
            if max_qty <= 0:
                return RiskVerdict(RiskVerdict.BLOCKED,
                    f"Position size: {position_pct:.1f}% exceeds {max_pct}% limit, "
                    f"no viable reduced size")
            return RiskVerdict(RiskVerdict.REDUCED,
                f"Position size: {position_pct:.1f}% exceeds {max_pct}% limit",
                new_qty=max_qty)

        # Also check pot-level constraints
        if pot and config.get("pots", {}).get("enabled"):
            pot_data = state.get("pots", {}).get(pot, {})
            pot_alloc = pot_data.get("allocation", 0)
            if pot_alloc > 0:
                pot_max_pct = config["pots"]["max_per_position_pct"]
                pot_position_pct = (trade_value / pot_alloc) * 100
                if pot_position_pct > pot_max_pct:
                    max_qty = int((pot_alloc * pot_max_pct / 100) / price)
                    if max_qty <= 0:
                        return RiskVerdict(RiskVerdict.BLOCKED,
                            f"Pot {pot} position size: {pot_position_pct:.1f}% exceeds "
                            f"{pot_max_pct}% pot limit")
                    return RiskVerdict(RiskVerdict.REDUCED,
                        f"Pot {pot} position size: {pot_position_pct:.1f}% exceeds "
                        f"{pot_max_pct}% pot limit",
                        new_qty=max_qty)
    passed.append("position_size")

    # ── Check 5: Total exposure ────────────────────────────────────────
    if side == "buy":
        current_exposure = risk_snap.get("total_exposure_pct", 0)
        added_exposure = (trade_value / portfolio_value) * 100
        new_exposure = current_exposure + added_exposure
        if new_exposure > risk["max_total_exposure_pct"]:
            return RiskVerdict(RiskVerdict.BLOCKED,
                f"Total exposure: would be {new_exposure:.1f}% "
                f"(limit {risk['max_total_exposure_pct']}%)")

        # Pot-level exposure check
        if pot and config.get("pots", {}).get("enabled"):
            pot_data = state.get("pots", {}).get(pot, {})
            pot_alloc = pot_data.get("allocation", 0)
            pot_cash = pot_data.get("cash", 0)
            pot_exposure = ((pot_alloc - pot_cash) / pot_alloc * 100) if pot_alloc > 0 else 0
            pot_added = (trade_value / pot_alloc * 100) if pot_alloc > 0 else 100
            if pot_exposure + pot_added > config["pots"]["max_exposure_pct"]:
                return RiskVerdict(RiskVerdict.BLOCKED,
                    f"Pot {pot} exposure: would be {pot_exposure + pot_added:.1f}% "
                    f"(limit {config['pots']['max_exposure_pct']}%)")
    passed.append("total_exposure")

    # ── Check 6: Sector concentration ──────────────────────────────────
    if side == "buy" and sector:
        sectors = risk_snap.get("sector_concentration", {})
        current_sector_pct = sectors.get(sector, 0)
        added_pct = (trade_value / portfolio_value) * 100
        if current_sector_pct + added_pct > risk["max_sector_pct"]:
            return RiskVerdict(RiskVerdict.BLOCKED,
                f"Sector concentration: {sector} would be "
                f"{current_sector_pct + added_pct:.1f}% (limit {risk['max_sector_pct']}%)")
    passed.append("sector_concentration")

    # ── Check 7: Open position count ───────────────────────────────────
    if side == "buy":
        open_count = len(state.get("positions", []))
        if open_count >= risk["max_open_positions"]:
            return RiskVerdict(RiskVerdict.BLOCKED,
                f"Max positions: {open_count} open (limit {risk['max_open_positions']})")
    passed.append("position_count")

    # ── Check 8: PDT guard ─────────────────────────────────────────────
    if risk.get("pdt_guard") and loop == "session":
        day_trade_count = state["account"].get("day_trade_count", 0)
        portfolio_val = state["account"].get("portfolio_value", 0)
        if portfolio_val < 25000 and day_trade_count >= 3:
            return RiskVerdict(RiskVerdict.BLOCKED,
                f"PDT guard: {day_trade_count} day trades with "
                f"${portfolio_val:.0f} account (need $25K for unlimited)")
    passed.append("pdt_guard")

    # ── Check 9: Day trade session limit ───────────────────────────────
    if loop == "session":
        session_trades = count_today_trades(JOURNAL_DIR, loop="session")
        if session_trades >= risk["max_trades_per_day_daytrade"]:
            return RiskVerdict(RiskVerdict.BLOCKED,
                f"Session trade limit: {session_trades} trades today "
                f"(limit {risk['max_trades_per_day_daytrade']})")
    elif loop == "swing":
        swing_trades = count_today_trades(JOURNAL_DIR, loop="swing")
        if swing_trades >= risk["max_trades_per_day_swing"]:
            return RiskVerdict(RiskVerdict.BLOCKED,
                f"Swing trade limit: {swing_trades} trades today "
                f"(limit {risk['max_trades_per_day_swing']})")
    passed.append("trade_count_limit")

    # ── Check 10: Time guard (day trades) ──────────────────────────────
    if loop == "session" and side == "buy":
        cutoff = risk.get("force_close_daytrades_by", "15:50")
        now_et = datetime.now(timezone(timedelta(hours=-4)))
        cutoff_h, cutoff_m = map(int, cutoff.split(":"))
        cutoff_time = now_et.replace(hour=cutoff_h, minute=cutoff_m, second=0)
        if now_et >= cutoff_time:
            return RiskVerdict(RiskVerdict.BLOCKED,
                f"Time guard: no new day trade entries after {cutoff} ET "
                f"(current: {now_et.strftime('%H:%M')} ET)")
    passed.append("time_guard")

    # ── Check 11: Pot halt check ───────────────────────────────────────
    if pot and config.get("pots", {}).get("enabled"):
        pot_data = state.get("pots", {}).get(pot, {})
        if pot_data.get("halted"):
            return RiskVerdict(RiskVerdict.BLOCKED,
                f"Pot {pot} is HALTED: {pot_data.get('halt_reason', 'no reason given')}")
    passed.append("pot_halt_check")

    return RiskVerdict(RiskVerdict.APPROVED, checks_passed=passed)


def risk_status():
    """Return current risk utilization vs limits."""
    config = load_config()
    state = load_state()
    risk = config["risk"]
    snap = state.get("risk_snapshot", {})
    pv = state["account"]["portfolio_value"]

    status = {
        "portfolio_value": pv,
        "paper_mode": risk.get("paper_mode", True),
        "utilization": {
            "total_exposure": {
                "current": snap.get("total_exposure_pct", 0),
                "limit": risk["max_total_exposure_pct"],
                "remaining": risk["max_total_exposure_pct"] - snap.get("total_exposure_pct", 0)
            },
            "long_exposure": {
                "current": snap.get("long_exposure_pct", 0),
                "limit": risk["max_long_exposure_pct"]
            },
            "short_exposure": {
                "current": snap.get("short_exposure_pct", 0),
                "limit": risk["max_short_exposure_pct"]
            },
            "largest_position": {
                "current": snap.get("largest_position_pct", 0),
                "limit": risk["max_position_pct"]
            },
            "open_positions": {
                "current": len(state.get("positions", [])),
                "limit": risk["max_open_positions"]
            },
            "drawdown": {
                "current": snap.get("drawdown_from_hwm_pct", 0),
                "limit": risk["max_drawdown_pct"],
                "hwm": snap.get("high_water_mark", pv)
            },
            "daily_pnl": {
                "realized": snap.get("daily_realized_pnl", 0),
                "unrealized": snap.get("daily_unrealized_pnl", 0),
                "limit": risk["max_daily_loss"]
            }
        },
        "pots": {}
    }

    for pot_id, pot_data in state.get("pots", {}).items():
        alloc = pot_data.get("allocation", 0)
        cash = pot_data.get("cash", 0)
        exposure = ((alloc - cash) / alloc * 100) if alloc > 0 else 0
        status["pots"][pot_id] = {
            "name": pot_data.get("name"),
            "allocation": alloc,
            "cash": cash,
            "exposure_pct": round(exposure, 1),
            "exposure_limit": config.get("pots", {}).get("max_exposure_pct", 60),
            "realized_pnl": pot_data.get("realized_pnl", 0),
            "halted": pot_data.get("halted", False)
        }

    return status


def format_status(status):
    """Human-readable risk status."""
    lines = []
    lines.append(f"Portfolio: ${status['portfolio_value']:,.2f} "
                 f"({'PAPER' if status['paper_mode'] else 'LIVE'})")
    lines.append("")

    u = status["utilization"]
    lines.append("Risk Utilization:")
    lines.append(f"  Exposure:  {u['total_exposure']['current']:.1f}% / "
                 f"{u['total_exposure']['limit']}% "
                 f"({u['total_exposure']['remaining']:.1f}% remaining)")
    lines.append(f"  Positions: {u['open_positions']['current']} / "
                 f"{u['open_positions']['limit']}")
    lines.append(f"  Drawdown:  {u['drawdown']['current']:.1f}% / "
                 f"{u['drawdown']['limit']}% "
                 f"(HWM: ${u['drawdown']['hwm']:,.2f})")
    lines.append(f"  Daily P&L: ${u['daily_pnl']['realized']:.2f} realized, "
                 f"${u['daily_pnl']['unrealized']:.2f} unrealized "
                 f"(limit: -${u['daily_pnl']['limit']:.2f})")
    lines.append("")

    lines.append("Pots:")
    for pot_id, p in sorted(status["pots"].items()):
        halt = " [HALTED]" if p["halted"] else ""
        lines.append(f"  {pot_id} ({p['name']}): "
                     f"${p['cash']:,.2f} cash, "
                     f"{p['exposure_pct']}% exposed "
                     f"(limit {p['exposure_limit']}%), "
                     f"P&L ${p['realized_pnl']:,.2f}{halt}")

    return "\n".join(lines)


def main():
    if len(sys.argv) < 2:
        print(__doc__.strip())
        sys.exit(2)

    cmd = sys.argv[1]

    if cmd == "check":
        if len(sys.argv) < 5:
            print("Usage: risk_governor check <side> <qty> <symbol> --price N "
                  "[--pot P] [--sector S] [--loop L]")
            sys.exit(2)

        side = sys.argv[2].lower()
        try:
            qty = int(sys.argv[3])
        except ValueError:
            print(f"Error: qty must be integer, got '{sys.argv[3]}'")
            sys.exit(2)
        symbol = sys.argv[4].upper()

        # Parse named args
        price = None
        pot = None
        sector = None
        loop = None
        i = 5
        while i < len(sys.argv):
            if sys.argv[i] == "--price" and i + 1 < len(sys.argv):
                price = float(sys.argv[i + 1])
                i += 2
            elif sys.argv[i] == "--pot" and i + 1 < len(sys.argv):
                pot = sys.argv[i + 1].upper()
                i += 2
            elif sys.argv[i] == "--sector" and i + 1 < len(sys.argv):
                sector = sys.argv[i + 1].lower()
                i += 2
            elif sys.argv[i] == "--loop" and i + 1 < len(sys.argv):
                loop = sys.argv[i + 1].lower()
                i += 2
            elif sys.argv[i] == "--json":
                i += 1  # handled below
            else:
                print(f"Unknown arg: {sys.argv[i]}")
                sys.exit(2)

        if price is None:
            print("Error: --price is required")
            sys.exit(2)

        verdict = check_trade(side, qty, symbol, price, pot=pot, sector=sector, loop=loop)

        if "--json" in sys.argv:
            print(json.dumps(verdict.to_dict(), indent=2))
        else:
            print(verdict)

        if verdict.verdict == RiskVerdict.BLOCKED:
            sys.exit(1)
        sys.exit(0)

    elif cmd == "status":
        status = risk_status()
        if "--json" in sys.argv:
            print(json.dumps(status, indent=2))
        else:
            print(format_status(status))

    elif cmd == "limits":
        config = load_config()
        print(json.dumps(config["risk"], indent=2))

    else:
        print(f"Unknown command: {cmd}")
        print(__doc__.strip())
        sys.exit(2)


if __name__ == "__main__":
    main()
