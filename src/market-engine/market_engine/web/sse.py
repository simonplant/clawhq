"""SSE broadcast manager — pushes price, alert, position, and status events to browsers.

Single SSE endpoint with multiple event types. Per-client asyncio.Queue
with throttled price events to avoid overwhelming browsers.
"""

import asyncio
import json
import logging
import time
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Throttle price events: max 1 per second per symbol per client
PRICE_THROTTLE_SECONDS = 1.0
# Max queued events per client before dropping
MAX_QUEUE_SIZE = 500


@dataclass
class SSEEvent:
    """A single SSE event to broadcast."""

    event: str  # "price", "alert", "position", "status"
    data: dict


class SSEBroadcaster:
    """Manages SSE client connections and broadcasts events."""

    def __init__(self) -> None:
        self._clients: list[asyncio.Queue[SSEEvent | None]] = []
        self._lock = asyncio.Lock()
        self._price_throttle: dict[str, float] = {}  # symbol -> last broadcast time

    async def subscribe(self) -> AsyncGenerator[str, None]:
        """Subscribe to SSE events. Yields formatted SSE strings."""
        queue: asyncio.Queue[SSEEvent | None] = asyncio.Queue(maxsize=MAX_QUEUE_SIZE)
        async with self._lock:
            self._clients.append(queue)
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield f"event: {event.event}\ndata: {json.dumps(event.data, separators=(',', ':'))}\n\n"
        finally:
            async with self._lock:
                if queue in self._clients:
                    self._clients.remove(queue)

    async def broadcast_price(self, symbol: str, data: dict) -> None:
        """Broadcast a price update (throttled per symbol)."""
        now = time.time()
        last = self._price_throttle.get(symbol, 0)
        if now - last < PRICE_THROTTLE_SECONDS:
            return
        self._price_throttle[symbol] = now
        await self._broadcast(SSEEvent(event="price", data={"symbol": symbol, **data}))

    async def broadcast_alert(self, alert_data: dict) -> None:
        """Broadcast an alert (always sent, not throttled)."""
        await self._broadcast(SSEEvent(event="alert", data=alert_data))

    async def broadcast_positions(self, positions: list[dict], totals: dict) -> None:
        """Broadcast position update."""
        await self._broadcast(SSEEvent(
            event="position",
            data={"positions": positions, "totals": totals},
        ))

    async def broadcast_status(self, status: dict) -> None:
        """Broadcast engine status update."""
        await self._broadcast(SSEEvent(event="status", data=status))

    async def _broadcast(self, event: SSEEvent) -> None:
        """Send event to all connected clients."""
        async with self._lock:
            dead: list[asyncio.Queue] = []
            for queue in self._clients:
                try:
                    queue.put_nowait(event)
                except asyncio.QueueFull:
                    dead.append(queue)
            for q in dead:
                self._clients.remove(q)
                logger.warning("Dropped slow SSE client (queue full)")

    async def shutdown(self) -> None:
        """Disconnect all clients."""
        async with self._lock:
            for queue in self._clients:
                await queue.put(None)
            self._clients.clear()

    @property
    def client_count(self) -> int:
        return len(self._clients)
