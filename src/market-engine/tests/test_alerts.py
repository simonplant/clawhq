"""Tests for alert store — JSONL persistence and in-memory ring buffer."""

import json
from pathlib import Path

from market_engine.monitor.level_engine import Alert
from market_engine.state.alerts import AlertStore


def _alert(symbol="SPY", alert_type="AT_ENTRY", priority="HIGH") -> Alert:
    return Alert(
        type=alert_type,
        priority=priority,
        symbol=symbol,
        price=450.05,
        level=450.00,
        level_name="entry",
        dist_pct=0.01,
        source="mancini",
        direction="LONG",
        conviction="HIGH",
        confirmation="CONFIRMED",
        governor="APPROVED",
        msg=f"[TRIGGER] mancini: {symbol} AT entry 450.00",
        order_num=1,
    )


class TestAlertStore:
    def setup_method(self):
        self.shared = Path("/tmp/test-alerts")
        self.shared.mkdir(exist_ok=True)
        self.store = AlertStore(self.shared)

    def teardown_method(self):
        import shutil
        shutil.rmtree(self.shared, ignore_errors=True)

    def test_record_returns_dict(self):
        entry = self.store.record(_alert())
        assert isinstance(entry, dict)
        assert entry["symbol"] == "SPY"
        assert entry["type"] == "AT_ENTRY"

    def test_record_increments_count(self):
        assert self.store.count_today == 0
        self.store.record(_alert())
        assert self.store.count_today == 1
        self.store.record(_alert(symbol="QQQ"))
        assert self.store.count_today == 2

    def test_record_adds_to_recent(self):
        self.store.record(_alert())
        assert len(self.store.recent) == 1
        assert self.store.recent[0]["symbol"] == "SPY"

    def test_recent_is_reverse_chronological(self):
        self.store.record(_alert(symbol="SPY"))
        self.store.record(_alert(symbol="QQQ"))
        assert self.store.recent[0]["symbol"] == "QQQ"  # Most recent first
        assert self.store.recent[1]["symbol"] == "SPY"

    def test_record_writes_jsonl(self):
        self.store.record(_alert())
        files = list(self.shared.glob("alerts-*.jsonl"))
        assert len(files) == 1
        lines = files[0].read_text().strip().split("\n")
        assert len(lines) == 1
        data = json.loads(lines[0])
        assert data["symbol"] == "SPY"

    def test_multiple_records_append(self):
        self.store.record(_alert(symbol="SPY"))
        self.store.record(_alert(symbol="QQQ"))
        files = list(self.shared.glob("alerts-*.jsonl"))
        lines = files[0].read_text().strip().split("\n")
        assert len(lines) == 2

    def test_recent_ring_buffer_limit(self):
        """Ring buffer should cap at MAX_RECENT (100)."""
        for i in range(110):
            self.store.record(_alert(symbol=f"SYM{i}"))
        assert len(self.store.recent) == 100

    def test_entry_has_required_fields(self):
        entry = self.store.record(_alert())
        required = ["ts", "type", "priority", "symbol", "price", "level",
                     "level_name", "source", "direction", "conviction",
                     "confirmation", "governor", "msg", "order_num"]
        for field in required:
            assert field in entry, f"Missing field: {field}"
