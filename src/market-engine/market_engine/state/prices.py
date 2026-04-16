"""In-memory price store with throttled file writes.

Updated on every quote/trade event. Writes shared/prices.json atomically
at most once per second.
"""

import json
import logging
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class PriceSnapshot:
    """Latest price data for a single symbol."""

    bid: float = 0.0
    ask: float = 0.0
    last: float = 0.0
    size: int = 0
    cvol: int = 0
    high: float = 0.0
    low: float = 0.0
    open: float = 0.0
    close: float = 0.0
    ts: str = ""


class PriceStore:
    """Thread-safe in-memory price store with throttled file persistence."""

    def __init__(self, shared_dir: Path, write_interval: float = 1.0) -> None:
        self._prices: dict[str, PriceSnapshot] = {}
        self._lock = threading.Lock()
        self._shared_dir = shared_dir
        self._write_interval = write_interval
        self._last_write: float = 0.0
        self._dirty: bool = False

    def update_quote(self, msg: dict) -> None:
        """Update from a Tradier quote event."""
        sym = msg.get("symbol", "")
        if not sym:
            return
        with self._lock:
            snap = self._prices.setdefault(sym, PriceSnapshot())
            snap.bid = _float(msg.get("bid", snap.bid))
            snap.ask = _float(msg.get("ask", snap.ask))
            snap.ts = datetime.now(timezone.utc).isoformat()
            # Derive last from midpoint if not separately provided
            if snap.bid > 0 and snap.ask > 0 and snap.last == 0:
                snap.last = round((snap.bid + snap.ask) / 2, 4)
            self._dirty = True
        self._maybe_write()

    def update_trade(self, msg: dict) -> None:
        """Update from a Tradier trade or tradex event."""
        sym = msg.get("symbol", "")
        if not sym:
            return
        with self._lock:
            snap = self._prices.setdefault(sym, PriceSnapshot())
            snap.last = _float(msg.get("last", msg.get("price", snap.last)))
            snap.size = _int(msg.get("size", snap.size))
            snap.cvol = _int(msg.get("cvol", snap.cvol))
            snap.ts = datetime.now(timezone.utc).isoformat()
            self._dirty = True
        self._maybe_write()

    def update_summary(self, msg: dict) -> None:
        """Update from a Tradier summary event (session high/low/open/close)."""
        sym = msg.get("symbol", "")
        if not sym:
            return
        with self._lock:
            snap = self._prices.setdefault(sym, PriceSnapshot())
            if "high" in msg:
                snap.high = _float(msg["high"])
            if "low" in msg:
                snap.low = _float(msg["low"])
            if "open" in msg:
                snap.open = _float(msg["open"])
            if "close" in msg:
                snap.close = _float(msg["close"])
            self._dirty = True

    def update_timesale(self, msg: dict) -> None:
        """Update from a Tradier timesale event. Skips cancels and corrections."""
        sym = msg.get("symbol", "")
        if not sym:
            return
        # Skip cancelled or corrected trades — bad data
        if msg.get("cancel") or msg.get("correction"):
            return
        with self._lock:
            snap = self._prices.setdefault(sym, PriceSnapshot())
            snap.last = _float(msg.get("last", snap.last))
            snap.bid = _float(msg.get("bid", snap.bid))
            snap.ask = _float(msg.get("ask", snap.ask))
            snap.size = _int(msg.get("size", snap.size))
            snap.ts = datetime.now(timezone.utc).isoformat()
            self._dirty = True
        self._maybe_write()

    def get(self, symbol: str) -> PriceSnapshot | None:
        with self._lock:
            return self._prices.get(symbol)

    def get_last(self, symbol: str) -> float:
        with self._lock:
            snap = self._prices.get(symbol)
            return snap.last if snap else 0.0

    def get_all(self) -> dict[str, dict]:
        """Get all prices as a serializable dict."""
        with self._lock:
            return {
                sym: {
                    "bid": s.bid, "ask": s.ask, "last": s.last,
                    "size": s.size, "cvol": s.cvol,
                    "high": s.high, "low": s.low, "open": s.open, "close": s.close,
                    "ts": s.ts,
                }
                for sym, s in self._prices.items()
            }

    def flush(self) -> None:
        """Force write to disk."""
        self._write_file()

    def _maybe_write(self) -> None:
        """Write to disk if enough time has passed since last write."""
        now = time.time()
        if self._dirty and now - self._last_write >= self._write_interval:
            self._write_file()

    def _write_file(self) -> None:
        """Atomic write of prices.json."""
        with self._lock:
            if not self._dirty:
                return
            data = {
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "prices": {
                    sym: {
                        "bid": s.bid, "ask": s.ask, "last": s.last,
                        "size": s.size, "cvol": s.cvol,
                        "high": s.high, "low": s.low, "open": s.open, "close": s.close,
                        "ts": s.ts,
                    }
                    for sym, s in self._prices.items()
                },
            }
            self._dirty = False

        out = self._shared_dir / "prices.json"
        tmp = out.with_suffix(".json.tmp")
        try:
            self._shared_dir.mkdir(parents=True, exist_ok=True)
            tmp.write_text(json.dumps(data, separators=(",", ":")))
            os.rename(tmp, out)
            self._last_write = time.time()
        except Exception as e:
            logger.error("Failed to write prices.json: %s", e)


def _float(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _int(v: Any) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0
