"""Alert store — append-only JSONL with date rotation.

Writes to shared/alerts-YYYY-MM-DD.jsonl. Also maintains an in-memory
ring buffer of recent alerts for the web dashboard SSE feed.
"""

import json
import logging
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from ..monitor.level_engine import Alert

logger = logging.getLogger(__name__)

MAX_RECENT = 100  # Ring buffer size for web dashboard


class AlertStore:
    """Append-only alert log with in-memory recent buffer."""

    def __init__(self, shared_dir: Path) -> None:
        self._shared_dir = shared_dir
        self._recent: deque[dict] = deque(maxlen=MAX_RECENT)
        self._count_today: int = 0
        self._current_date: str = ""

    @property
    def count_today(self) -> int:
        return self._count_today

    @property
    def recent(self) -> list[dict]:
        return list(self._recent)

    def record(self, alert: Alert) -> dict:
        """Record an alert to JSONL file and in-memory buffer. Returns the dict written."""
        now = datetime.now(timezone.utc)
        today = now.strftime("%Y-%m-%d")

        # Daily rotation
        if today != self._current_date:
            self._current_date = today
            self._count_today = 0

        entry = {
            "ts": now.isoformat(),
            "type": alert.type,
            "priority": alert.priority,
            "symbol": alert.symbol,
            "price": alert.price,
            "level": alert.level,
            "level_name": alert.level_name,
            "dist_pct": alert.dist_pct,
            "source": alert.source,
            "direction": alert.direction,
            "conviction": alert.conviction,
            "confirmation": alert.confirmation,
            "governor": alert.governor,
            "order_num": alert.order_num,
            "msg": alert.msg,
        }

        # Append to JSONL
        self._shared_dir.mkdir(parents=True, exist_ok=True)
        alerts_file = self._shared_dir / f"alerts-{today}.jsonl"
        try:
            with open(alerts_file, "a") as f:
                f.write(json.dumps(entry, separators=(",", ":")) + "\n")
        except Exception as e:
            logger.error("Failed to write alert: %s", e)

        # In-memory buffer
        self._recent.appendleft(entry)
        self._count_today += 1

        return entry
