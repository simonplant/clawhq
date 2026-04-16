"""Reconnection logic with exponential backoff and market-hours awareness."""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

# Eastern Time (DST-aware via zoneinfo)
ET = ZoneInfo("America/New_York")


@dataclass
class ReconnectState:
    """Tracks reconnection attempts and backoff."""

    consecutive_failures: int = 0
    max_failures_before_degraded: int = 10
    base_delay: float = 1.0
    max_delay: float = 60.0
    _degraded: bool = field(default=False, init=False)

    @property
    def degraded(self) -> bool:
        return self._degraded

    def record_success(self) -> None:
        self.consecutive_failures = 0
        self._degraded = False

    def record_failure(self) -> None:
        self.consecutive_failures += 1
        if self.consecutive_failures >= self.max_failures_before_degraded:
            self._degraded = True
            logger.warning(
                "Entered degraded mode after %d consecutive failures",
                self.consecutive_failures,
            )

    @property
    def delay(self) -> float:
        """Exponential backoff: 1, 2, 4, 8, 16, 32, 60, 60, ..."""
        exp = min(self.consecutive_failures, 6)  # cap exponent
        return min(self.base_delay * (2 ** exp), self.max_delay)

    async def wait(self) -> None:
        """Wait the appropriate backoff duration."""
        d = self.delay
        logger.info("Reconnecting in %.1fs (attempt %d)", d, self.consecutive_failures + 1)
        await asyncio.sleep(d)


def is_market_hours() -> bool:
    """Check if US market is in a monitorable window (6 AM - 4:30 PM ET, weekdays)."""
    now_et = datetime.now(ET)
    if now_et.weekday() >= 5:  # Weekend
        return False
    minutes = now_et.hour * 60 + now_et.minute
    return 360 <= minutes <= 990  # 6:00 AM to 4:30 PM ET


def seconds_until_market_open() -> float:
    """Seconds until next market monitoring window (6:00 AM ET, next weekday)."""
    now_et = datetime.now(ET)
    # Target: next weekday at 6:00 AM ET
    target = now_et.replace(hour=6, minute=0, second=0, microsecond=0)

    if now_et >= target or now_et.weekday() >= 5:
        # Already past 6 AM today or weekend — advance to next weekday
        target += timedelta(days=1)
        while target.weekday() >= 5:
            target += timedelta(days=1)

    diff = (target - now_et).total_seconds()
    return max(diff, 60.0)  # At least 60 seconds
