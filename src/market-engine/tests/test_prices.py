"""Tests for price store — updates, throttled writes, atomic file I/O."""

import json
import os
import time
from pathlib import Path

from market_engine.state.prices import PriceStore


class TestPriceStore:
    def setup_method(self):
        self.shared = Path("/tmp/test-prices")
        self.shared.mkdir(exist_ok=True)
        self.store = PriceStore(self.shared, write_interval=0.0)  # No throttle for tests

    def teardown_method(self):
        import shutil
        shutil.rmtree(self.shared, ignore_errors=True)

    def test_update_quote(self):
        self.store.update_quote({"symbol": "SPY", "bid": 450.04, "ask": 450.06})
        snap = self.store.get("SPY")
        assert snap is not None
        assert snap.bid == 450.04
        assert snap.ask == 450.06

    def test_update_trade(self):
        self.store.update_trade({
            "symbol": "SPY", "last": "450.05", "price": "450.05",
            "size": "100", "cvol": "28000000",
        })
        snap = self.store.get("SPY")
        assert snap is not None
        assert snap.last == 450.05
        assert snap.size == 100
        assert snap.cvol == 28000000

    def test_update_timesale(self):
        self.store.update_timesale({
            "symbol": "SPY", "last": "450.05", "bid": "450.04",
            "ask": "450.06", "size": "50",
        })
        snap = self.store.get("SPY")
        assert snap is not None
        assert snap.last == 450.05

    def test_timesale_cancel_skipped(self):
        self.store.update_trade({"symbol": "SPY", "last": "450.00"})
        self.store.update_timesale({
            "symbol": "SPY", "last": "999.99", "cancel": True,
        })
        # Price should NOT be updated to 999.99
        assert self.store.get_last("SPY") == 450.00

    def test_timesale_correction_skipped(self):
        self.store.update_trade({"symbol": "SPY", "last": "450.00"})
        self.store.update_timesale({
            "symbol": "SPY", "last": "999.99", "correction": True,
        })
        assert self.store.get_last("SPY") == 450.00

    def test_update_summary(self):
        self.store.update_summary({
            "symbol": "SPY", "high": "451.20", "low": "448.50",
            "open": "449.00", "close": "449.80",
        })
        snap = self.store.get("SPY")
        assert snap is not None
        assert snap.high == 451.20
        assert snap.low == 448.50

    def test_get_last(self):
        self.store.update_trade({"symbol": "SPY", "last": "450.05"})
        assert self.store.get_last("SPY") == 450.05

    def test_get_last_missing_symbol(self):
        assert self.store.get_last("UNKNOWN") == 0.0

    def test_get_all(self):
        self.store.update_trade({"symbol": "SPY", "last": "450.05"})
        self.store.update_trade({"symbol": "QQQ", "last": "380.10"})
        prices = self.store.get_all()
        assert "SPY" in prices
        assert "QQQ" in prices
        assert prices["SPY"]["last"] == 450.05

    def test_flush_writes_file(self):
        self.store.update_trade({"symbol": "SPY", "last": "450.05"})
        self.store.flush()
        out = self.shared / "prices.json"
        assert out.exists()
        data = json.loads(out.read_text())
        assert "prices" in data
        assert "SPY" in data["prices"]

    def test_atomic_write(self):
        """Temp file should not exist after write completes."""
        self.store.update_trade({"symbol": "SPY", "last": "450.05"})
        self.store.flush()
        tmp = self.shared / "prices.json.tmp"
        assert not tmp.exists()

    def test_empty_symbol_ignored(self):
        self.store.update_quote({"symbol": "", "bid": 100})
        assert self.store.get("") is None

    def test_handles_string_prices(self):
        """Tradier trade events send prices as strings."""
        self.store.update_trade({"symbol": "SPY", "last": "450.05", "size": "100"})
        assert self.store.get_last("SPY") == 450.05

    def test_handles_bad_price_values(self):
        """Non-numeric values should default to 0."""
        self.store.update_trade({"symbol": "SPY", "last": "N/A"})
        assert self.store.get_last("SPY") == 0.0
