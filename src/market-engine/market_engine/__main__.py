"""market-engine entry point — orchestrates all components.

Usage: python -m market_engine

Startup sequence:
1. Load config
2. Check market status
3. If closed: idle mode (web only, timer for next open)
4. If open: parse brief, connect streams, start dashboard
5. Main loop: asyncio.gather all tasks
6. At close: disconnect streams, switch to idle
"""

import asyncio
import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import uvicorn

from .config import load_config
from .monitor.level_engine import LevelEngine
from .monitor.order_parser import get_monitored_symbols, parse_order_blocks
from .state.alerts import AlertStore
from .state.engine_status import EngineStatus
from .state.positions import PositionStore
from .state.prices import PriceStore
from .state.watchlist import WatchlistManager
from .stream.account_ws import AccountStream
from .stream.market_ws import MarketStream
from .stream.reconnect import is_market_hours, seconds_until_market_open
from .web.app import create_app
from .web.sse import SSEBroadcaster

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("market_engine")


class Engine:
    """Main orchestrator — manages all components."""

    def __init__(self) -> None:
        self.cfg = load_config()
        self.shared_dir = self.cfg.shared_dir
        self.shared_dir.mkdir(parents=True, exist_ok=True)

        # State stores
        self.price_store = PriceStore(self.shared_dir)
        self.alert_store = AlertStore(self.shared_dir)
        self.engine_status = EngineStatus(self.shared_dir)
        self.position_store = PositionStore(
            shared_dir=self.shared_dir,
            price_store=self.price_store,
            cred_proxy_url=self.cfg.cred_proxy_url,
            account_id=self.cfg.tradier_account_id,
        )
        self.watchlist = WatchlistManager(self.shared_dir, self.cfg.lib_dir)
        self.level_engine = LevelEngine()
        self.broadcaster = SSEBroadcaster()

        # Streams
        self.market_stream = MarketStream(
            cred_proxy_url=self.cfg.cred_proxy_url,
            sandbox=self.cfg.sandbox,
            on_quote=self._on_quote,
            on_trade=self._on_trade,
            on_timesale=self._on_timesale,
            on_summary=self._on_summary,
        )
        self.account_stream = AccountStream(
            cred_proxy_url=self.cfg.cred_proxy_url,
            account_id=self.cfg.tradier_account_id,
            sandbox=self.cfg.sandbox,
            on_order=self._on_order_event,
        )

        self._running = True

    # ── Callbacks (called from stream threads) ──────────────────────────────

    def _on_quote(self, msg: dict) -> None:
        self.price_store.update_quote(msg)
        self._check_levels(msg.get("symbol", ""))

    def _on_trade(self, msg: dict) -> None:
        self.price_store.update_trade(msg)
        self._check_levels(msg.get("symbol", ""))

    def _on_timesale(self, msg: dict) -> None:
        self.price_store.update_timesale(msg)
        self._check_levels(msg.get("symbol", ""))

    def _on_summary(self, msg: dict) -> None:
        self.price_store.update_summary(msg)

    def _on_order_event(self, msg: dict) -> None:
        self.position_store.handle_order_event(msg)

    def _check_levels(self, symbol: str) -> None:
        """Run level checks and broadcast any alerts."""
        if not symbol:
            return
        price = self.price_store.get_last(symbol)
        if price <= 0:
            return

        alerts = self.level_engine.check_price(symbol, price)
        for alert in alerts:
            entry = self.alert_store.record(alert)
            # Fire SSE broadcast (schedule on event loop)
            try:
                loop = asyncio.get_running_loop()
                loop.call_soon_threadsafe(
                    lambda e=entry: asyncio.ensure_future(self.broadcaster.broadcast_alert(e))
                )
            except RuntimeError:
                pass  # No event loop running yet

    # ── Data accessors (for web app) ────────────────────────────────────────

    def get_prices(self) -> dict:
        return self.price_store.get_all()

    def get_orders(self) -> list:
        orders = self._current_orders
        return [
            {
                "order_num": o.order_num,
                "source": o.source,
                "ticker": o.ticker,
                "exec_as": o.exec_as,
                "direction": o.direction,
                "entry": o.entry,
                "stop": o.stop,
                "t1": o.t1,
                "t2": o.t2,
                "conviction": o.conviction,
                "status": o.status,
                "confirmation": o.confirmation,
                "confluence": o.confluence,
            }
            for o in orders
        ]

    def get_alerts(self) -> list:
        return self.alert_store.recent

    def get_positions(self) -> dict:
        positions = self.position_store.get_all()
        total_value = sum(p["market_value"] for p in positions)
        total_pnl = sum(p["pnl_dollars"] for p in positions)
        return {
            "positions": positions,
            "totals": {"market_value": round(total_value, 2), "total_pnl": round(total_pnl, 2)},
        }

    def get_status(self) -> dict:
        self.engine_status.set_market_ws(
            self.market_stream.connected, self.market_stream.reconnect_count
        )
        self.engine_status.set_account_ws(
            self.account_stream.connected, self.account_stream.reconnect_count
        )
        self.engine_status.set_symbols_count(len(self.watchlist.symbols))
        self.engine_status.set_alerts_today(self.alert_store.count_today)
        self.engine_status.set_orders_parsed(len(self._current_orders))
        return self.engine_status.to_dict()

    # ── Brief & watchlist management ────────────────────────────────────────

    _current_orders: list = []
    _brief_mtime: float = 0.0

    def _today_brief_path(self) -> Path:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        return self.cfg.workspace_memory_dir / f"trading-{today}.md"

    def _refresh_orders(self) -> None:
        """Re-parse ORDER blocks from today's brief if file changed."""
        brief = self._today_brief_path()
        if not brief.exists():
            return
        try:
            mtime = brief.stat().st_mtime
        except OSError:
            return
        if mtime == self._brief_mtime:
            return

        self._brief_mtime = mtime
        self._current_orders = parse_order_blocks(brief)
        self.level_engine.update_orders(self._current_orders)

        # Update watchlist with ORDER block symbols
        order_syms = get_monitored_symbols(self._current_orders)
        if self.watchlist.update_order_symbols(order_syms):
            self.market_stream.update_symbols(self.watchlist.symbols)

    def _refresh_watchlist(self) -> None:
        """Check for watchlist.json changes from Clawdius."""
        if self.watchlist.update_clawdius_watchlist():
            self.market_stream.update_symbols(self.watchlist.symbols)

    # ── Periodic tasks ──────────────────────────────────────────────────────

    async def _file_watcher(self) -> None:
        """Periodically check for brief/watchlist file changes."""
        while self._running:
            try:
                self._refresh_orders()
                self._refresh_watchlist()
            except Exception as e:
                logger.error("File watcher error: %s", e, exc_info=True)
            await asyncio.sleep(10)

    async def _status_writer(self) -> None:
        """Periodically write engine-status.json."""
        while self._running:
            try:
                self.engine_status.write_file()
            except Exception as e:
                logger.error("Status writer error: %s", e)
            await asyncio.sleep(30)

    async def _position_writer(self) -> None:
        """Periodically write positions.json."""
        while self._running:
            try:
                self.position_store.write_file()
            except Exception as e:
                logger.error("Position writer error: %s", e)
            await asyncio.sleep(5)

    async def _price_broadcaster(self) -> None:
        """Periodically broadcast prices via SSE."""
        while self._running:
            try:
                prices = self.price_store.get_all()
                for sym, data in prices.items():
                    await self.broadcaster.broadcast_price(sym, data)
            except Exception as e:
                logger.error("Price broadcaster error: %s", e)
            await asyncio.sleep(1)

    async def _market_hours_monitor(self) -> None:
        """Monitor market hours transitions — idle/active mode switching."""
        while self._running:
            if is_market_hours():
                if self.engine_status.mode != "active":
                    logger.info("Market hours detected — activating")
                    self.engine_status.set_mode("active")
                    self.engine_status.set_market_status("OPEN")
                    # Initial load
                    self._refresh_orders()
                    self._refresh_watchlist()
                    self.market_stream.update_symbols(self.watchlist.symbols)
                    try:
                        self.position_store.load_from_broker()
                    except Exception as e:
                        logger.warning("Initial position load failed: %s", e)
            else:
                if self.engine_status.mode == "active":
                    logger.info("Market closed — switching to idle")
                    self.engine_status.set_mode("idle")
                    self.engine_status.set_market_status("CLOSED")
                    self.price_store.flush()
                    self.level_engine.reset_daily()

            await asyncio.sleep(60)

    # ── Main ────────────────────────────────────────────────────────────────

    async def run(self) -> None:
        """Main entry point — start all components."""
        logger.info("Market Engine starting...")

        # Initial state
        if is_market_hours():
            self.engine_status.set_mode("active")
            self.engine_status.set_market_status("OPEN")
            self._refresh_orders()
            self._refresh_watchlist()
            self.market_stream.update_symbols(self.watchlist.symbols)
            try:
                self.position_store.load_from_broker()
            except Exception as e:
                logger.warning("Initial position load failed: %s", e)
        else:
            self.engine_status.set_mode("idle")
            self.engine_status.set_market_status("CLOSED")

        self.engine_status.write_file()

        # Create web app
        app = create_app(
            broadcaster=self.broadcaster,
            get_prices=self.get_prices,
            get_orders=self.get_orders,
            get_alerts=self.get_alerts,
            get_positions=self.get_positions,
            get_status=self.get_status,
        )

        # Web server config
        config = uvicorn.Config(
            app,
            host="0.0.0.0",
            port=self.cfg.web_port,
            log_level="warning",
            access_log=False,
        )
        server = uvicorn.Server(config)

        logger.info("Starting on port %d (mode: %s)", self.cfg.web_port, self.engine_status.mode)

        # Run all tasks concurrently
        try:
            await asyncio.gather(
                server.serve(),
                self.market_stream.run(),
                self.account_stream.run(),
                self._file_watcher(),
                self._status_writer(),
                self._position_writer(),
                self._price_broadcaster(),
                self._market_hours_monitor(),
            )
        except asyncio.CancelledError:
            logger.info("Shutting down...")
        finally:
            self._running = False
            await self.market_stream.stop()
            await self.account_stream.stop()
            await self.broadcaster.shutdown()
            self.price_store.flush()
            self.engine_status.set_mode("stopped")
            self.engine_status.write_file()
            logger.info("Market Engine stopped.")


def main() -> None:
    engine = Engine()

    # Handle SIGTERM/SIGINT gracefully
    loop = asyncio.new_event_loop()

    def shutdown(sig):
        logger.info("Received %s, shutting down...", sig.name)
        engine._running = False
        for task in asyncio.all_tasks(loop):
            task.cancel()

    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, shutdown, sig)

    try:
        loop.run_until_complete(engine.run())
    except KeyboardInterrupt:
        pass
    finally:
        loop.close()


if __name__ == "__main__":
    main()
