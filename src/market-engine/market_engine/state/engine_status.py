"""Engine status tracking — writes shared/engine-status.json periodically."""

import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)


class EngineStatus:
    """Tracks engine health state and writes periodic status files."""

    def __init__(self, shared_dir: Path) -> None:
        self._shared_dir = shared_dir
        self._start_time = time.time()
        self._mode = "starting"
        self._market_status = "UNKNOWN"
        self._market_ws_connected = False
        self._market_ws_reconnects = 0
        self._account_ws_connected = False
        self._account_ws_reconnects = 0
        self._symbols_streaming = 0
        self._alerts_today = 0
        self._orders_parsed = 0
        self._last_price_ts = ""

    @property
    def mode(self) -> str:
        return self._mode

    def set_mode(self, mode: str) -> None:
        self._mode = mode

    def set_market_status(self, status: str) -> None:
        self._market_status = status

    def set_market_ws(self, connected: bool, reconnects: int = 0) -> None:
        self._market_ws_connected = connected
        self._market_ws_reconnects = reconnects

    def set_account_ws(self, connected: bool, reconnects: int = 0) -> None:
        self._account_ws_connected = connected
        self._account_ws_reconnects = reconnects

    def set_symbols_count(self, count: int) -> None:
        self._symbols_streaming = count

    def set_alerts_today(self, count: int) -> None:
        self._alerts_today = count

    def set_orders_parsed(self, count: int) -> None:
        self._orders_parsed = count

    def set_last_price_ts(self, ts: str) -> None:
        self._last_price_ts = ts

    def to_dict(self) -> dict:
        return {
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "uptime_seconds": int(time.time() - self._start_time),
            "mode": self._mode,
            "market_status": self._market_status,
            "market_ws": {
                "connected": self._market_ws_connected,
                "reconnect_count": self._market_ws_reconnects,
            },
            "account_ws": {
                "connected": self._account_ws_connected,
                "reconnect_count": self._account_ws_reconnects,
            },
            "symbols_streaming": self._symbols_streaming,
            "alerts_today": self._alerts_today,
            "orders_parsed": self._orders_parsed,
            "last_price_write": self._last_price_ts,
        }

    def write_file(self) -> None:
        """Atomic write of engine-status.json."""
        data = self.to_dict()
        out = self._shared_dir / "engine-status.json"
        tmp = out.with_suffix(".json.tmp")
        try:
            self._shared_dir.mkdir(parents=True, exist_ok=True)
            tmp.write_text(json.dumps(data, indent=2))
            os.rename(tmp, out)
        except Exception as e:
            logger.error("Failed to write engine-status.json: %s", e)
