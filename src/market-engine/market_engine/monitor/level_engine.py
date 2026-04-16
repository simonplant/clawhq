"""Level engine — compares real-time prices to ORDER block levels and fires alerts.

Enhanced from configs/tools/market-monitor/market-monitor:198-295.
Tighter thresholds for real-time streaming (vs 30-min polling).
Direction-aware, confirmation-aware, with risk governor integration.
"""

import logging
from dataclasses import dataclass
from typing import Any

from .dedup import Deduplicator
from .order_parser import OrderBlock

logger = logging.getLogger(__name__)

# Alert thresholds (tighter than polling-based market-monitor)
THRESHOLD_AT = 0.15  # within 0.15% = at level
THRESHOLD_NEAR = 0.50  # within 0.50% = near
THRESHOLD_APPROACHING = 1.50  # within 1.50% = approaching
THRESHOLD_STOP = 0.30  # within 0.30% of stop
THRESHOLD_TARGET = 0.30  # within 0.30% of target


@dataclass
class Alert:
    """A generated price alert."""

    type: str  # AT_ENTRY, NEAR_ENTRY, APPROACHING, STOP_WARNING, STOP_HIT, TARGET_T1, TARGET_T2
    priority: str  # CRITICAL, HIGH, MEDIUM, LOW
    symbol: str
    price: float
    level: float
    level_name: str  # entry, stop, t1, t2
    dist_pct: float
    source: str
    direction: str
    conviction: str
    confirmation: str
    governor: str  # APPROVED / BLOCKED / SKIPPED
    msg: str
    order_num: int


class LevelEngine:
    """Monitors prices against ORDER block levels."""

    def __init__(self) -> None:
        self._orders: list[OrderBlock] = []
        self._dedup = Deduplicator(ttl_seconds=60.0)

    def update_orders(self, orders: list[OrderBlock]) -> None:
        """Update the ORDER blocks being monitored."""
        self._orders = orders

    def reset_daily(self) -> None:
        """Reset dedup state for a new trading day."""
        self._dedup.reset()

    def check_price(self, symbol: str, price: float) -> list[Alert]:
        """Check a price update against all ORDER block levels. Returns new alerts."""
        if price <= 0:
            return []

        alerts: list[Alert] = []

        for order in self._orders:
            if order.status in ("CLOSED", "KILLED", "BLOCKED"):
                continue

            # Match symbol
            order_sym = order.exec_as or order.ticker
            if order_sym != symbol:
                continue

            # Check entry proximity (for non-filled orders)
            if order.status not in ("FILLED",) and order.entry:
                alerts.extend(self._check_entry(order, price))

            # Check stop proximity (for filled positions)
            if order.status == "FILLED" and order.stop:
                alerts.extend(self._check_stop(order, price))

            # Check target proximity (for filled positions)
            if order.status == "FILLED":
                if order.t1:
                    alerts.extend(self._check_target(order, price, order.t1, "t1", "TARGET_T1"))
                if order.t2:
                    alerts.extend(self._check_target(order, price, order.t2, "t2", "TARGET_T2"))

        # Periodic cleanup
        self._dedup.cleanup()

        return alerts

    def _check_entry(self, order: OrderBlock, price: float) -> list[Alert]:
        """Check proximity to entry level."""
        entry = order.entry
        if not entry or entry <= 0:
            return []

        dist_pct = abs(price - entry) / entry * 100
        sym = order.exec_as or order.ticker

        # Confirmation-aware prefix
        if order.confirmation in ("CONFIRMED", "MANUAL"):
            prefix = "[TRIGGER]"
        else:
            prefix = "[WATCH]"

        if dist_pct <= THRESHOLD_AT:
            alert_type = "AT_ENTRY"
            priority = "HIGH"
            msg = f"{prefix} {order.source}: {sym} AT entry {entry} (current {price})"
        elif dist_pct <= THRESHOLD_NEAR:
            alert_type = "NEAR_ENTRY"
            priority = "MEDIUM"
            msg = f"{prefix} {order.source}: {sym} near entry {entry} ({dist_pct:.1f}% away, current {price})"
        elif dist_pct <= THRESHOLD_APPROACHING:
            alert_type = "APPROACHING"
            priority = "LOW"
            msg = f"{order.source}: {sym} {dist_pct:.1f}% from entry {entry} (current {price})"
        else:
            return []

        if not self._dedup.should_alert(alert_type, sym, "entry"):
            return []

        # Risk governor check for AT_ENTRY on confirmed orders
        governor = "SKIPPED"
        if alert_type == "AT_ENTRY" and order.confirmation in ("CONFIRMED", "MANUAL"):
            governor = self._check_governor(order, price)
            if governor != "SKIPPED":
                msg += f" — Governor: {governor}"

        return [Alert(
            type=alert_type,
            priority=priority,
            symbol=sym,
            price=price,
            level=entry,
            level_name="entry",
            dist_pct=round(dist_pct, 3),
            source=order.source,
            direction=order.direction,
            conviction=order.conviction,
            confirmation=order.confirmation,
            governor=governor,
            msg=msg,
            order_num=order.order_num,
        )]

    def _check_stop(self, order: OrderBlock, price: float) -> list[Alert]:
        """Check proximity to stop level (FILLED positions only)."""
        stop = order.stop
        if not stop or stop <= 0:
            return []

        sym = order.exec_as or order.ticker
        direction = order.direction

        # Direction-aware: LONG = price dropping toward stop; SHORT = price rising toward stop
        if direction == "LONG":
            if price > stop * (1 + THRESHOLD_STOP / 100):
                return []  # Price well above stop
            crossed = price <= stop
        elif direction == "SHORT":
            if price < stop * (1 - THRESHOLD_STOP / 100):
                return []  # Price well below stop
            crossed = price >= stop
        else:
            return []

        dist_pct = abs(price - stop) / stop * 100

        if crossed:
            alert_type = "STOP_HIT"
            priority = "CRITICAL"
            msg = f"STOP HIT: {sym} at {price}, stop was {stop} ({order.direction})"
        else:
            alert_type = "STOP_WARNING"
            priority = "HIGH"
            msg = f"STOP WARNING: {sym} at {price}, stop at {stop} ({dist_pct:.1f}% away)"

        if not self._dedup.should_alert(alert_type, sym, "stop"):
            return []

        return [Alert(
            type=alert_type,
            priority=priority,
            symbol=sym,
            price=price,
            level=stop,
            level_name="stop",
            dist_pct=round(dist_pct, 3),
            source=order.source,
            direction=order.direction,
            conviction=order.conviction,
            confirmation=order.confirmation,
            governor="SKIPPED",
            msg=msg,
            order_num=order.order_num,
        )]

    def _check_target(
        self, order: OrderBlock, price: float, target: float, name: str, alert_type: str
    ) -> list[Alert]:
        """Check proximity to a target level (T1/T2)."""
        sym = order.exec_as or order.ticker
        direction = order.direction

        # Direction-aware: LONG = price rising toward target; SHORT = price falling
        if direction == "LONG" and price < target * (1 - THRESHOLD_TARGET / 100):
            return []
        if direction == "SHORT" and price > target * (1 + THRESHOLD_TARGET / 100):
            return []

        dist_pct = abs(price - target) / target * 100
        if dist_pct > THRESHOLD_TARGET:
            return []

        if not self._dedup.should_alert(alert_type, sym, name):
            return []

        msg = f"TARGET {name.upper()}: {sym} at {price}, {name.upper()} at {target} ({dist_pct:.1f}% away)"

        return [Alert(
            type=alert_type,
            priority="MEDIUM",
            symbol=sym,
            price=price,
            level=target,
            level_name=name,
            dist_pct=round(dist_pct, 3),
            source=order.source,
            direction=order.direction,
            conviction=order.conviction,
            confirmation=order.confirmation,
            governor="SKIPPED",
            msg=msg,
            order_num=order.order_num,
        )]

    def _check_governor(self, order: OrderBlock, price: float) -> str:
        """Run risk_governor.check_trade() if available. Returns verdict string."""
        try:
            import subprocess
            import sys
            from pathlib import Path

            gov_path = Path(__file__).parent.parent / "lib" / "risk_governor.py"
            if not gov_path.exists():
                return "SKIPPED"

            side = "buy" if order.direction == "LONG" else "sell"
            # Extract qty from risk_raw if possible, default to 1
            qty = "1"

            result = subprocess.run(
                [sys.executable, str(gov_path), "check", side, qty, order.ticker,
                 "--price", str(price)],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0:
                return "APPROVED"
            elif result.returncode == 1:
                return f"BLOCKED: {result.stdout.strip()[:80]}"
            else:
                return "ERROR"
        except Exception as e:
            logger.debug("Governor check failed: %s", e)
            return "SKIPPED"
