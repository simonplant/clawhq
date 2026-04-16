#!/usr/bin/env python3
"""market_calendar.py — US market day/holiday detection and session timing.

No external dependencies. Hardcoded holidays updated annually.

Usage:
  market-calendar today        — is today a market day? what session?
  market-calendar status       — current market status (pre/open/post/closed)
  market-calendar next         — next market day
  market-calendar week         — this week's market days
  market-calendar check DATE   — is DATE a market day?
"""

import json
import sys
from datetime import datetime, timezone, timedelta, date

# US market holidays for 2026 (update annually)
# Sources: NYSE/NASDAQ holiday calendar
US_MARKET_HOLIDAYS_2026 = {
    date(2026, 1, 1),   # New Year's Day
    date(2026, 1, 19),  # MLK Day
    date(2026, 2, 16),  # Presidents Day
    date(2026, 4, 3),   # Good Friday
    date(2026, 5, 25),  # Memorial Day
    date(2026, 7, 3),   # Independence Day (observed)
    date(2026, 9, 7),   # Labor Day
    date(2026, 11, 26), # Thanksgiving
    date(2026, 12, 25), # Christmas
}

# Early close days (1 PM ET)
US_EARLY_CLOSE_2026 = {
    date(2026, 11, 27), # Day after Thanksgiving
    date(2026, 12, 24), # Christmas Eve
}

ET = timezone(timedelta(hours=-4))  # EDT (Mar-Nov)
EST = timezone(timedelta(hours=-5))  # EST (Nov-Mar)


def _et_now():
    """Current time in US Eastern. Approximates DST."""
    utc_now = datetime.now(timezone.utc)
    month = utc_now.month
    # Approximate DST: EDT Mar-Nov, EST Nov-Mar
    if 3 <= month <= 10:
        return utc_now.astimezone(ET)
    return utc_now.astimezone(EST)


def is_market_day(d=None):
    """Is the given date a US market trading day?"""
    if d is None:
        d = _et_now().date()
    elif isinstance(d, str):
        d = date.fromisoformat(d)
    # Weekend
    if d.weekday() >= 5:
        return False
    # Holiday
    if d in US_MARKET_HOLIDAYS_2026:
        return False
    return True


def is_early_close(d=None):
    """Is the given date an early close day (1 PM ET)?"""
    if d is None:
        d = _et_now().date()
    elif isinstance(d, str):
        d = date.fromisoformat(d)
    return d in US_EARLY_CLOSE_2026


def market_status():
    """Current market session status."""
    now = _et_now()
    today = now.date()

    if not is_market_day(today):
        if today.weekday() >= 5:
            return {"status": "CLOSED", "reason": "weekend", "next": str(next_market_day(today))}
        return {"status": "CLOSED", "reason": "holiday", "next": str(next_market_day(today))}

    h, m = now.hour, now.minute
    minutes = h * 60 + m
    close_time = 780 if is_early_close(today) else 960  # 1 PM or 4 PM

    if minutes < 240:  # before 4 AM
        return {"status": "CLOSED", "reason": "overnight", "session": "pre-market opens 4:00 AM ET"}
    elif minutes < 570:  # 4 AM - 9:30 AM
        return {"status": "PRE-MARKET", "opens_in": f"{(570 - minutes)} min"}
    elif minutes < close_time:
        remaining = close_time - minutes
        early = " (early close)" if is_early_close(today) else ""
        return {"status": "OPEN", "closes_in": f"{remaining} min{early}"}
    elif minutes < close_time + 240:  # up to 4h after close
        return {"status": "AFTER-HOURS", "closed_at": "1:00 PM ET" if is_early_close(today) else "4:00 PM ET"}
    else:
        return {"status": "CLOSED", "reason": "after hours ended", "next": str(next_market_day(today + timedelta(days=1)))}


def next_market_day(after=None):
    """Next market trading day after the given date."""
    if after is None:
        after = _et_now().date()
    elif isinstance(after, str):
        after = date.fromisoformat(after)
    d = after + timedelta(days=1)
    for _ in range(10):  # max 10 days ahead
        if is_market_day(d):
            return d
        d += timedelta(days=1)
    return d


def market_week(d=None):
    """Market days this week."""
    if d is None:
        d = _et_now().date()
    elif isinstance(d, str):
        d = date.fromisoformat(d)
    # Find Monday
    monday = d - timedelta(days=d.weekday())
    days = []
    for i in range(5):
        day = monday + timedelta(days=i)
        days.append({
            "date": str(day),
            "market_day": is_market_day(day),
            "early_close": is_early_close(day),
            "today": day == _et_now().date(),
        })
    return days


def main():
    if len(sys.argv) < 2:
        print(__doc__.strip())
        sys.exit(0)

    cmd = sys.argv[1]
    use_json = "--json" in sys.argv

    if cmd == "today":
        today = _et_now().date()
        status = market_status()
        if use_json:
            print(json.dumps({"date": str(today), "market_day": is_market_day(today),
                              "early_close": is_early_close(today), **status}, indent=2))
        else:
            day_type = "MARKET DAY" if is_market_day(today) else "CLOSED"
            early = " (early close)" if is_early_close(today) else ""
            print(f"{today} ({today.strftime('%A')}): {day_type}{early}")
            print(f"Status: {status['status']}")
            for k, v in status.items():
                if k != "status":
                    print(f"  {k}: {v}")

    elif cmd == "status":
        status = market_status()
        if use_json:
            print(json.dumps(status, indent=2))
        else:
            print(f"Market: {status['status']}")
            for k, v in status.items():
                if k != "status":
                    print(f"  {k}: {v}")

    elif cmd == "next":
        nxt = next_market_day()
        print(json.dumps({"next_market_day": str(nxt), "day": nxt.strftime("%A")}, indent=2)
              if use_json else f"{nxt} ({nxt.strftime('%A')})")

    elif cmd == "week":
        days = market_week()
        if use_json:
            print(json.dumps(days, indent=2))
        else:
            for d in days:
                flag = " <-- TODAY" if d["today"] else ""
                status = "OPEN" if d["market_day"] else "CLOSED"
                early = " (early close)" if d["early_close"] else ""
                dt = date.fromisoformat(d["date"])
                print(f"  {d['date']} ({dt.strftime('%a')}): {status}{early}{flag}")

    elif cmd == "check":
        if len(sys.argv) < 3:
            print("Usage: market-calendar check YYYY-MM-DD")
            sys.exit(2)
        d = sys.argv[2]
        result = is_market_day(d)
        early = is_early_close(d)
        if use_json:
            print(json.dumps({"date": d, "market_day": result, "early_close": early}))
        else:
            dt = date.fromisoformat(d)
            status = "MARKET DAY" if result else "CLOSED"
            early_str = " (early close)" if early else ""
            print(f"{d} ({dt.strftime('%A')}): {status}{early_str}")

    else:
        print(f"Unknown command: {cmd}")
        sys.exit(2)


if __name__ == "__main__":
    main()
