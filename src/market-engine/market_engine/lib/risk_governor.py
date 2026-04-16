#!/usr/bin/env python3
"""risk_governor.py — hard constraint enforcement between signal and execution.

The LLM cannot override this. Every proposed trade passes through check_trade()
before any order is placed. If the governor says BLOCKED, the trade does not happen.

Usage:
  risk_governor check <side> <qty> <symbol> --price N [--account A] [--sector S] [--loop L]
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

ACCOUNT_IDS = ("tos", "ira", "tradier")


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


def _get_account_constraints(config, account_id):
    """Get constraints for a specific account, with defaults."""
    acct = config.get("accounts", {}).get(account_id, {})
    c = acct.get("constraints", {})
    return {
        "max_position_pct": c.get("max_position_pct", 15.0),
        "max_total_exposure_pct": c.get("max_total_exposure_pct", 60.0),
        "max_sector_pct": c.get("max_sector_pct", 35.0),
        "max_daily_loss": c.get("max_daily_loss", 1000.0),
        "max_daily_loss_pct": c.get("max_daily_loss_pct", 2.0),
        "max_drawdown_pct": c.get("max_drawdown_pct", 10.0),
        "max_trades_per_day": c.get("max_trades_per_day", 10),
        "max_open_positions": c.get("max_open_positions", 10),
        "pdt_guard": c.get("pdt_guard", False),
        "shorting": c.get("shorting", True),
        "futures": c.get("futures", True),
    }


def _account_exposure(acct):
    """Total exposure for an account from its positions."""
    positions = acct.get("positions", {})
    if isinstance(positions, dict):
        return sum(
            p["qty"] * p.get("current_price", p["avg_cost"])
            for p in positions.values()
        )
    return 0.0


def check_trade(side, qty, symbol, price, account=None, sector=None, loop=None):
    """Run all risk checks. Returns RiskVerdict."""
    config = load_config()
    state = load_state()
    passed = []

    # Determine which account and its constraints
    if account and account in config.get("accounts", {}):
        constraints = _get_account_constraints(config, account)
        acct_state = state.get("accounts", {}).get(account, {})
        acct_balance = acct_state.get("balance", config["accounts"][account].get("balance", 0))
    else:
        # Global fallback — use combined capital
        constraints = {
            "max_position_pct": 5.0,
            "max_total_exposure_pct": 60.0,
            "max_sector_pct": 35.0,
            "max_daily_loss": 5000.0,
            "max_daily_loss_pct": 2.0,
            "max_drawdown_pct": 10.0,
            "max_trades_per_day": 20,
            "max_open_positions": 30,
            "pdt_guard": False,
            "shorting": True,
            "futures": True,
        }
        acct_state = {}
        acct_balance = sum(
            a.get("balance", 0) for a in state.get("accounts", {}).values()
        )

    trade_value = qty * price
    if acct_balance <= 0:
        return RiskVerdict(RiskVerdict.BLOCKED, "Account balance is zero or negative")

    # ── Check 1: Account halt ─────────────────────────────────────────
    if acct_state.get("halted"):
        return RiskVerdict(RiskVerdict.BLOCKED,
            f"Account {account} is HALTED: {acct_state.get('halt_reason', 'no reason given')}")
    passed.append("account_halt_check")

    # ── Check 2: Circuit breaker (drawdown) ───────────────────────────
    risk_snap = state.get("risk_snapshot", {})
    drawdown = risk_snap.get("drawdown_from_hwm_pct", 0)
    if drawdown >= constraints["max_drawdown_pct"]:
        return RiskVerdict(RiskVerdict.BLOCKED,
            f"Circuit breaker: drawdown {drawdown:.1f}% >= {constraints['max_drawdown_pct']}% limit")
    passed.append("circuit_breaker")

    # ── Check 3: Daily loss limit ─────────────────────────────────────
    daily_pnl = today_realized_pnl(JOURNAL_DIR)
    daily_pnl += risk_snap.get("daily_unrealized_pnl", 0)
    if daily_pnl <= -constraints["max_daily_loss"]:
        return RiskVerdict(RiskVerdict.BLOCKED,
            f"Daily loss limit: P&L ${daily_pnl:.2f} breached ${constraints['max_daily_loss']:.2f} limit")
    daily_pnl_pct = (daily_pnl / acct_balance) * 100 if acct_balance else 0
    if daily_pnl_pct <= -constraints["max_daily_loss_pct"]:
        return RiskVerdict(RiskVerdict.BLOCKED,
            f"Daily loss %: {daily_pnl_pct:.1f}% breached {constraints['max_daily_loss_pct']}% limit")
    passed.append("daily_loss_limit")

    # ── Check 4: Position size ────────────────────────────────────────
    if side == "buy":
        max_pct = constraints["max_position_pct"]
        position_pct = (trade_value / acct_balance) * 100
        if position_pct > max_pct:
            max_qty = int((acct_balance * max_pct / 100) / price)
            if max_qty <= 0:
                return RiskVerdict(RiskVerdict.BLOCKED,
                    f"Position size: {position_pct:.1f}% exceeds {max_pct}% limit, "
                    f"no viable reduced size")
            return RiskVerdict(RiskVerdict.REDUCED,
                f"Position size: {position_pct:.1f}% exceeds {max_pct}% limit",
                new_qty=max_qty)
    passed.append("position_size")

    # ── Check 5: Total exposure ───────────────────────────────────────
    if side == "buy":
        current_exposure = _account_exposure(acct_state) if acct_state else 0
        added_exposure_pct = (trade_value / acct_balance) * 100
        current_exposure_pct = (current_exposure / acct_balance) * 100 if acct_balance else 0
        new_exposure_pct = current_exposure_pct + added_exposure_pct
        if new_exposure_pct > constraints["max_total_exposure_pct"]:
            return RiskVerdict(RiskVerdict.BLOCKED,
                f"Total exposure: would be {new_exposure_pct:.1f}% "
                f"(limit {constraints['max_total_exposure_pct']}%)")
    passed.append("total_exposure")

    # ── Check 6: Sector concentration ─────────────────────────────────
    if side == "buy" and sector:
        sectors = risk_snap.get("sector_concentration", {})
        current_sector_pct = sectors.get(sector, 0)
        added_pct = (trade_value / acct_balance) * 100
        if current_sector_pct + added_pct > constraints["max_sector_pct"]:
            return RiskVerdict(RiskVerdict.BLOCKED,
                f"Sector concentration: {sector} would be "
                f"{current_sector_pct + added_pct:.1f}% (limit {constraints['max_sector_pct']}%)")
    passed.append("sector_concentration")

    # ── Check 7: Open position count ──────────────────────────────────
    if side == "buy":
        open_count = len(acct_state.get("positions", {})) if acct_state else 0
        if open_count >= constraints["max_open_positions"]:
            return RiskVerdict(RiskVerdict.BLOCKED,
                f"Max positions: {open_count} open (limit {constraints['max_open_positions']})")
    passed.append("position_count")

    # ── Check 8: PDT guard ────────────────────────────────────────────
    if constraints.get("pdt_guard") and loop == "session":
        # For PDT-limited accounts, check day trade count
        day_trade_count = acct_state.get("day_trade_count", 0)
        if acct_balance < 25000 and day_trade_count >= 3:
            return RiskVerdict(RiskVerdict.BLOCKED,
                f"PDT guard: {day_trade_count} day trades with "
                f"${acct_balance:.0f} account (need $25K for unlimited)")
    passed.append("pdt_guard")

    # ── Check 9: Trade count limit ────────────────────────────────────
    max_trades = constraints.get("max_trades_per_day", 10)
    today_trades = count_today_trades(JOURNAL_DIR)
    if today_trades >= max_trades:
        return RiskVerdict(RiskVerdict.BLOCKED,
            f"Trade count limit: {today_trades} trades today (limit {max_trades})")
    passed.append("trade_count_limit")

    # ── Check 10: Time guard (day trades) ─────────────────────────────
    if loop == "session" and side == "buy":
        now_et = datetime.now(timezone(timedelta(hours=-4)))
        cutoff_time = now_et.replace(hour=15, minute=50, second=0)
        if now_et >= cutoff_time:
            return RiskVerdict(RiskVerdict.BLOCKED,
                f"Time guard: no new day trade entries after 15:50 ET "
                f"(current: {now_et.strftime('%H:%M')} ET)")
    passed.append("time_guard")

    # ── Check 11: Short/futures restrictions ───────────────────────────
    if side == "sell" and not constraints.get("shorting", True):
        return RiskVerdict(RiskVerdict.BLOCKED,
            f"Account {account} does not allow shorting")
    if symbol in ("/MES", "/ES", "ES=F", "NQ=F", "/NQ") and not constraints.get("futures", True):
        return RiskVerdict(RiskVerdict.BLOCKED,
            f"Account {account} does not allow futures trading")
    passed.append("instrument_restrictions")

    return RiskVerdict(RiskVerdict.APPROVED, checks_passed=passed)


def risk_status():
    """Return current risk utilization vs limits."""
    config = load_config()
    state = load_state()
    risk_snap = state.get("risk_snapshot", {})

    status = {
        "accounts": {},
        "global": {
            "drawdown_pct": risk_snap.get("drawdown_from_hwm_pct", 0),
            "high_water_mark": risk_snap.get("high_water_mark", 0),
            "daily_realized_pnl": risk_snap.get("daily_realized_pnl", 0),
            "daily_unrealized_pnl": risk_snap.get("daily_unrealized_pnl", 0),
        }
    }

    for acct_id in ACCOUNT_IDS:
        acct_config = config.get("accounts", {}).get(acct_id, {})
        acct_state = state.get("accounts", {}).get(acct_id, {})
        constraints = _get_account_constraints(config, acct_id)
        balance = acct_state.get("balance", acct_config.get("balance", 0))
        exposure = _account_exposure(acct_state)
        exposure_pct = (exposure / balance * 100) if balance else 0

        status["accounts"][acct_id] = {
            "name": acct_config.get("name", acct_id),
            "balance": balance,
            "cash": acct_state.get("cash", balance),
            "exposure_pct": round(exposure_pct, 1),
            "exposure_limit": constraints["max_total_exposure_pct"],
            "positions": len(acct_state.get("positions", {})),
            "position_limit": constraints["max_open_positions"],
            "realized_pnl": acct_state.get("realized_pnl", 0),
            "halted": acct_state.get("halted", False),
        }

    return status


def format_status(status):
    """Human-readable risk status."""
    lines = []

    g = status["global"]
    lines.append(f"Drawdown: {g['drawdown_pct']:.1f}% (HWM: ${g['high_water_mark']:,.2f})")
    lines.append(f"Daily P&L: ${g['daily_realized_pnl']:.2f} realized, ${g['daily_unrealized_pnl']:.2f} unrealized")
    lines.append("")

    lines.append("Accounts:")
    for acct_id in ACCOUNT_IDS:
        a = status["accounts"].get(acct_id)
        if not a:
            continue
        halt = " [HALTED]" if a["halted"] else ""
        lines.append(f"  {acct_id} ({a['name']}): "
                     f"${a['cash']:,.2f} cash, "
                     f"{a['exposure_pct']}% exposed "
                     f"(limit {a['exposure_limit']}%), "
                     f"{a['positions']} positions "
                     f"(limit {a['position_limit']}), "
                     f"P&L ${a['realized_pnl']:,.2f}{halt}")

    return "\n".join(lines)


def main():
    if len(sys.argv) < 2:
        print(__doc__.strip())
        sys.exit(2)

    cmd = sys.argv[1]

    if cmd == "check":
        if len(sys.argv) < 5:
            print("Usage: risk_governor check <side> <qty> <symbol> --price N "
                  "[--account A] [--sector S] [--loop L]")
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
        account = None
        sector = None
        loop = None
        i = 5
        while i < len(sys.argv):
            if sys.argv[i] == "--price" and i + 1 < len(sys.argv):
                price = float(sys.argv[i + 1])
                i += 2
            elif sys.argv[i] in ("--account", "--pot") and i + 1 < len(sys.argv):
                account = sys.argv[i + 1].lower()
                i += 2
            elif sys.argv[i] == "--sector" and i + 1 < len(sys.argv):
                sector = sys.argv[i + 1].lower()
                i += 2
            elif sys.argv[i] == "--loop" and i + 1 < len(sys.argv):
                loop = sys.argv[i + 1].lower()
                i += 2
            elif sys.argv[i] == "--json":
                i += 1
            else:
                print(f"Unknown arg: {sys.argv[i]}")
                sys.exit(2)

        if price is None:
            print("Error: --price is required")
            sys.exit(2)

        verdict = check_trade(side, qty, symbol, price, account=account, sector=sector, loop=loop)

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
        for acct_id in ACCOUNT_IDS:
            acct = config.get("accounts", {}).get(acct_id, {})
            print(f"=== {acct_id}: {acct.get('name', acct_id)} ===")
            print(json.dumps(acct.get("constraints", {}), indent=2))
            print()

    else:
        print(f"Unknown command: {cmd}")
        print(__doc__.strip())
        sys.exit(2)


if __name__ == "__main__":
    main()
