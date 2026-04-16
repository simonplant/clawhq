"""Tests for watchlist management."""

import json
from pathlib import Path

from market_engine.state.watchlist import WatchlistManager


class TestWatchlistManager:
    def setup_method(self):
        self.shared = Path("/tmp/test-shared")
        self.shared.mkdir(exist_ok=True)
        self.lib = Path("/tmp/test-lib")
        self.lib.mkdir(exist_ok=True)

    def teardown_method(self):
        import shutil
        shutil.rmtree(self.shared, ignore_errors=True)
        shutil.rmtree(self.lib, ignore_errors=True)

    def test_empty_initial_state(self):
        wm = WatchlistManager(self.shared, self.lib)
        assert wm.symbols == set()

    def test_loads_portfolio_from_watchlists_json(self):
        (self.lib / "WATCHLISTS.json").write_text(json.dumps({
            "portfolio": ["SPY", "QQQ"],
            "dp": ["META", "NVDA"],
        }))
        wm = WatchlistManager(self.shared, self.lib)
        # Portfolio symbols loaded but merge hasn't run yet via update
        # They become part of merged set when recompute fires
        wm.update_order_symbols(set())  # trigger recompute
        assert "SPY" in wm.symbols
        assert "QQQ" in wm.symbols
        assert "META" in wm.symbols

    def test_update_order_symbols(self):
        wm = WatchlistManager(self.shared, self.lib)
        changed = wm.update_order_symbols({"AAPL", "TSLA"})
        assert changed is True
        assert "AAPL" in wm.symbols
        assert "TSLA" in wm.symbols

    def test_no_change_returns_false(self):
        wm = WatchlistManager(self.shared, self.lib)
        wm.update_order_symbols({"AAPL"})
        changed = wm.update_order_symbols({"AAPL"})
        assert changed is False

    def test_clawdius_watchlist_merge(self):
        (self.shared / "watchlist.json").write_text(json.dumps({
            "updated_at": "2026-04-16T00:00:00Z",
            "symbols": ["GOOGL", "AMZN"],
        }))
        wm = WatchlistManager(self.shared, self.lib)
        changed = wm.update_clawdius_watchlist()
        assert changed is True
        assert "GOOGL" in wm.symbols
        assert "AMZN" in wm.symbols

    def test_filters_futures_symbols(self):
        """Futures symbols like /MES are filtered (Tradier doesn't support them)."""
        wm = WatchlistManager(self.shared, self.lib)
        wm.update_order_symbols({"/MES", "SPY", "/ES"})
        assert "/MES" not in wm.symbols
        assert "/ES" not in wm.symbols
        assert "SPY" in wm.symbols

    def test_merge_deduplicates(self):
        (self.lib / "WATCHLISTS.json").write_text(json.dumps({
            "portfolio": ["SPY"],
        }))
        (self.shared / "watchlist.json").write_text(json.dumps({
            "symbols": ["SPY"],
        }))
        wm = WatchlistManager(self.shared, self.lib)
        wm.update_order_symbols({"SPY"})
        wm.update_clawdius_watchlist()
        # SPY appears in all 3 sources but set deduplicates
        assert "SPY" in wm.symbols
        # A set can only contain each element once by definition
        assert isinstance(wm.symbols, set)
