"""Position tracking with live P&L computation.

Loads initial positions from Tradier REST API, updates from account WebSocket
fills, computes P&L using real-time prices.
"""

import json
import logging
import os
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .prices import PriceStore

logger = logging.getLogger(__name__)


@dataclass
class Position:
    """A single open position."""

    symbol: str
    qty: float
    side: str  # "long" or "short"
    avg_cost: float
    current_price: float = 0.0
    pnl_dollars: float = 0.0
    pnl_pct: float = 0.0
    market_value: float = 0.0


class PositionStore:
    """Manages positions with live P&L via price store."""

    def __init__(
        self,
        shared_dir: Path,
        price_store: PriceStore,
        cred_proxy_url: str,
        account_id: str,
    ) -> None:
        self._positions: dict[str, Position] = {}
        self._shared_dir = shared_dir
        self._price_store = price_store
        self._cred_proxy_url = cred_proxy_url
        self._account_id = account_id

    def load_from_broker(self) -> None:
        """Fetch current positions from Tradier via cred-proxy."""
        if not self._account_id:
            logger.warning("No account ID — skipping position load")
            return

        url = f"{self._cred_proxy_url}/tradier/v1/accounts/{self._account_id}/positions"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})

        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
        except Exception as e:
            logger.error("Failed to fetch positions: %s", e)
            return

        positions = data.get("positions", {}).get("position", [])
        if isinstance(positions, dict):
            positions = [positions]

        self._positions.clear()
        for p in positions:
            sym = p.get("symbol", "")
            qty = float(p.get("quantity", 0))
            cost = float(p.get("cost_basis", 0))
            avg = cost / qty if qty != 0 else 0
            side = "long" if qty > 0 else "short"

            self._positions[sym] = Position(
                symbol=sym,
                qty=abs(qty),
                side=side,
                avg_cost=round(avg, 4),
            )

        logger.info("Loaded %d positions from broker", len(self._positions))

    def handle_order_event(self, msg: dict) -> None:
        """Handle an account WebSocket order event (fill, cancel, etc.)."""
        event_type = msg.get("type", "")
        if event_type == "order" and msg.get("status") == "filled":
            # Reload positions on fill — simplest correct approach
            self.load_from_broker()

    def update_pnl(self) -> None:
        """Recompute P&L for all positions using current prices."""
        for sym, pos in self._positions.items():
            price = self._price_store.get_last(sym)
            if price <= 0:
                continue
            pos.current_price = price
            if pos.side == "long":
                pos.pnl_dollars = round((price - pos.avg_cost) * pos.qty, 2)
            else:
                pos.pnl_dollars = round((pos.avg_cost - price) * pos.qty, 2)
            pos.pnl_pct = round(pos.pnl_dollars / (pos.avg_cost * pos.qty) * 100, 2) if pos.avg_cost > 0 else 0.0
            pos.market_value = round(price * pos.qty, 2)

    def get_all(self) -> list[dict]:
        """Get all positions as serializable dicts."""
        self.update_pnl()
        return [
            {
                "symbol": p.symbol,
                "qty": p.qty,
                "side": p.side,
                "avg_cost": p.avg_cost,
                "current_price": p.current_price,
                "pnl_dollars": p.pnl_dollars,
                "pnl_pct": p.pnl_pct,
                "market_value": p.market_value,
            }
            for p in self._positions.values()
        ]

    def write_file(self) -> None:
        """Atomic write of positions.json."""
        self.update_pnl()
        positions = self.get_all()
        total_value = sum(p["market_value"] for p in positions)
        total_pnl = sum(p["pnl_dollars"] for p in positions)

        data = {
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "positions": positions,
            "totals": {
                "market_value": round(total_value, 2),
                "total_pnl": round(total_pnl, 2),
            },
        }

        out = self._shared_dir / "positions.json"
        tmp = out.with_suffix(".json.tmp")
        try:
            self._shared_dir.mkdir(parents=True, exist_ok=True)
            tmp.write_text(json.dumps(data, separators=(",", ":")))
            os.rename(tmp, out)
        except Exception as e:
            logger.error("Failed to write positions.json: %s", e)
