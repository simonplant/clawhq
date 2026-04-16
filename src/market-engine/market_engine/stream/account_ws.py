"""Account WebSocket — streams order fills, cancellations, and status changes.

Separate connection from market data. Uses account session token.
"""

import asyncio
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import websockets
from websockets.asyncio.client import connect as ws_connect

from ..config import TRADIER_WS_ACCOUNT, TRADIER_WS_SANDBOX_ACCOUNT
from .reconnect import ReconnectState, is_market_hours, seconds_until_market_open
from .session import SessionError, create_account_session

logger = logging.getLogger(__name__)


@dataclass
class AccountStream:
    """Manages the Tradier account WebSocket connection."""

    cred_proxy_url: str
    account_id: str
    sandbox: bool = False
    on_order: Callable[[dict], Any] | None = None

    _ws: Any = field(default=None, init=False)
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

    async def run(self) -> None:
        """Main loop — connect, stream account events, reconnect on failure."""
        self._running = True
        while self._running:
            if not is_market_hours():
                wait = seconds_until_market_open()
                await asyncio.sleep(min(wait, 300))
                continue

            if not self.account_id:
                logger.warning("No account ID configured, account stream disabled")
                await asyncio.sleep(60)
                continue

            try:
                await self._connect_and_stream()
            except SessionError as e:
                logger.error("Account session creation failed: %s", e)
                self._reconnect.record_failure()
                await self._reconnect.wait()
            except websockets.exceptions.ConnectionClosed as e:
                logger.warning("Account WebSocket closed: %s", e)
                self._reconnect.record_failure()
                await self._reconnect.wait()
            except Exception as e:
                logger.error("Unexpected account stream error: %s", e, exc_info=True)
                self._reconnect.record_failure()
                await self._reconnect.wait()

    async def stop(self) -> None:
        self._running = False
        if self._ws:
            await self._ws.close()

    async def _connect_and_stream(self) -> None:
        session_id = create_account_session(self.cred_proxy_url)

        ws_url = TRADIER_WS_SANDBOX_ACCOUNT if self.sandbox else TRADIER_WS_ACCOUNT
        logger.info("Connecting account stream to %s", ws_url)

        async with ws_connect(ws_url, compression=None) as ws:
            self._ws = ws

            # Subscribe to account events
            payload = {
                "sessionid": session_id,
                "account_id": [self.account_id],
            }
            await ws.send(json.dumps(payload))
            self._reconnect.record_success()
            logger.info("Account stream connected for %s", self.account_id)

            async for raw in ws:
                if not raw or raw.strip() == "":
                    continue
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                if self.on_order:
                    try:
                        self.on_order(msg)
                    except Exception as e:
                        logger.error("Account callback error: %s", e, exc_info=True)

        self._ws = None
