"""Alert deduplication — prevents repeated alerts for the same level.

Key: (alert_type, symbol, level_name) with TTL.
Escalation: APPROACHING → NEAR → AT always fires (type upgrade).
"""

import time
from dataclasses import dataclass, field

# Alert priority order (higher index = higher priority)
ALERT_PRIORITY = {
    "APPROACHING": 0,
    "NEAR_ENTRY": 1,
    "AT_ENTRY": 2,
    "TARGET_T1": 3,
    "TARGET_T2": 4,
    "STOP_WARNING": 5,
    "STOP_HIT": 6,
}


@dataclass
class Deduplicator:
    """TTL-based alert deduplication with escalation override."""

    ttl_seconds: float = 60.0
    _seen: dict[tuple[str, str], tuple[float, str]] = field(default_factory=dict, init=False)

    def should_alert(self, alert_type: str, symbol: str, level_name: str) -> bool:
        """Check if this alert should fire. Returns True if it should."""
        key = (symbol, level_name)
        now = time.time()

        if key in self._seen:
            ts, prev_type = self._seen[key]

            # TTL expired — allow
            if now - ts >= self.ttl_seconds:
                self._seen[key] = (now, alert_type)
                return True

            # Escalation: higher priority type always fires
            prev_priority = ALERT_PRIORITY.get(prev_type, -1)
            curr_priority = ALERT_PRIORITY.get(alert_type, -1)
            if curr_priority > prev_priority:
                self._seen[key] = (now, alert_type)
                return True

            # Same or lower priority within TTL — suppress
            return False

        # Never seen — allow
        self._seen[key] = (now, alert_type)
        return True

    def reset(self) -> None:
        """Clear all dedup state (daily reset)."""
        self._seen.clear()

    def cleanup(self) -> None:
        """Remove expired entries to prevent memory growth."""
        now = time.time()
        expired = [k for k, (ts, _) in self._seen.items() if now - ts >= self.ttl_seconds * 5]
        for k in expired:
            del self._seen[k]
