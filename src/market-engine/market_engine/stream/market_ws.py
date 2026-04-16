"""Market WebSocket — streams real-time quotes, trades, and timesales from Tradier.

Single persistent connection. Symbols can be updated by resending the subscribe
payload (no reconnect needed). Filter types are locked at connect time.
"""

import asyncio
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import websockets
from websockets.asyncio.client import connect as ws_connect

from ..config import TRADIER_WS_MARKET, TRADIER_WS_SANDBOX_MARKET
from .reconnect import ReconnectState, is_market_hours, seconds_until_market_open
from .session import SessionError, create_market_session

logger = logging.getLogger(__name__)

# Tradier event types we subscribe to
FILTERS = ["quote", "trade", "timesale"]


@dataclass
class MarketStream:
    """Manages the Tradier market WebSocket connection."""

    cred_proxy_url: str
    sandbox: bool = False
    on_quote: Callable[[dict], Any] | None = None
    on_trade: Callable[[dict], Any] | None = None
    on_timesale: Callable[[dict], Any] | None = None
    on_summary: Callable[[dict], Any] | None = None

    _symbols: set[str] = field(default_factory=set, init=False)
    _ws: Any = field(default=None, init=False)
    _session_id: str = field(default="", init=False)
    _reconnect: ReconnectState = field(default_factory=ReconnectState, init=False)
    _running: bool = field(default=False, init=False)

    @property
    def connected(self) -> bool:
        return self._ws is not None and self._ws.open

    @property
    def degraded(self) -> bool:
        return self._reconnect.degraded

    @property
    def reconnect_count(self) -> int:
        return self._reconnect.consecutive_failures

    def update_symbols(self, symbols: set[str]) -> None:
        """Update the symbol set. Triggers resubscribe on next tick if connected."""
        old = self._symbols
        self._symbols = set(symbols)  # Defensive copy
        if old != self._symbols and self._ws and self._ws.open:
            # Schedule resubscribe (fire-and-forget)
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self._resubscribe())
            except RuntimeError:
                pass  # No running loop — resubscribe on next connect

    async def run(self) -> None:
        """Main loop — connect, stream, reconnect on failure. Runs forever."""
        self._running = True
        while self._running:
            # Wait for market hours
            if not is_market_hours():
                wait = seconds_until_market_open()
                logger.info("Market closed. Sleeping %.0f seconds until next open.", wait)
                await asyncio.sleep(min(wait, 300))  # Check every 5 min max
                continue

            if not self._symbols:
                logger.debug("No symbols to stream, waiting...")
                await asyncio.sleep(10)
                continue

            try:
                await self._connect_and_stream()
            except SessionError as e:
                logger.error("Session creation failed: %s", e)
                self._reconnect.record_failure()
                await self._reconnect.wait()
            except websockets.exceptions.ConnectionClosed as e:
                logger.warning("WebSocket closed: %s", e)
                self._reconnect.record_failure()
                await self._reconnect.wait()
            except Exception as e:
                logger.error("Unexpected stream error: %s", e, exc_info=True)
                self._reconnect.record_failure()
                await self._reconnect.wait()

    async def stop(self) -> None:
        self._running = False
        if self._ws:
            await self._ws.close()

    async def _connect_and_stream(self) -> None:
        """Create session, connect WebSocket, subscribe, and process messages."""
        # Create fresh session (5-min TTL)
        self._session_id = create_market_session(self.cred_proxy_url)

        ws_url = TRADIER_WS_SANDBOX_MARKET if self.sandbox else TRADIER_WS_MARKET
        logger.info("Connecting to %s with %d symbols", ws_url, len(self._symbols))

        async with ws_connect(ws_url, compression=None) as ws:
            self._ws = ws
            await self._subscribe(ws)
            self._reconnect.record_success()
            logger.info("Market stream connected — streaming %d symbols", len(self._symbols))

            async for raw in ws:
                if not raw or raw.strip() == "":
                    continue
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    logger.debug("Non-JSON message: %s", raw[:100])
                    continue

                await self._dispatch(msg)

        self._ws = None

    async def _subscribe(self, ws: Any) -> None:
        """Send subscribe payload."""
        payload = {
            "symbols": sorted(self._symbols),
            "sessionid": self._session_id,
            "filter": FILTERS,
            "linebreak": True,
            "validOnly": True,
        }
        await ws.send(json.dumps(payload))
        logger.debug("Subscribed to %d symbols", len(self._symbols))

    async def _resubscribe(self) -> None:
        """Resend subscribe payload with updated symbols (no reconnect needed)."""
        if self._ws and self._ws.open:
            try:
                await self._subscribe(self._ws)
                logger.info("Resubscribed with %d symbols", len(self._symbols))
            except Exception as e:
                logger.warning("Resubscribe failed: %s", e)

    async def _dispatch(self, msg: dict) -> None:
        """Route a message to the appropriate callback."""
        msg_type = msg.get("type", "")
        try:
            if msg_type == "quote" and self.on_quote:
                self.on_quote(msg)
            elif msg_type == "trade" and self.on_trade:
                self.on_trade(msg)
            elif msg_type == "timesale" and self.on_timesale:
                self.on_timesale(msg)
            elif msg_type == "summary" and self.on_summary:
                self.on_summary(msg)
            elif msg_type == "tradex" and self.on_trade:
                # tradex is an enhanced trade — route to same handler
                self.on_trade(msg)
        except Exception as e:
            logger.error("Callback error for %s: %s", msg_type, e, exc_info=True)
