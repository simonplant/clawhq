"""Tests for level engine — alert generation from price vs ORDER levels."""

import pytest

from market_engine.monitor.level_engine import LevelEngine
from market_engine.monitor.order_parser import OrderBlock


def _order(
    ticker="SPY", exec_as="SPY", entry=450.0, stop=440.0, t1=460.0, t2=470.0,
    direction="LONG", status="ACTIVE", conviction="HIGH", confirmation="CONFIRMED",
    source="mancini", order_num=1,
) -> OrderBlock:
    return OrderBlock(
        order_num=order_num,
        conviction=conviction,
        status=status,
        source=source,
        accounts=["tos"],
        ticker=ticker,
        exec_as=exec_as,
        direction=direction,
        setup="test",
        why="test",
        entry=entry,
        stop=stop,
        t1=t1,
        t2=t2,
        confirmation=confirmation,
        confluence="none",
        kills="",
        activation="immediate",
        risk_raw="",
        raw_text="",
    )


class TestEntryAlerts:
    def setup_method(self):
        self.engine = LevelEngine()

    def test_at_entry(self):
        self.engine.update_orders([_order(entry=450.0)])
        alerts = self.engine.check_price("SPY", 450.05)
        assert len(alerts) == 1
        assert alerts[0].type == "AT_ENTRY"
        assert alerts[0].priority == "HIGH"

    def test_near_entry(self):
        self.engine.update_orders([_order(entry=450.0)])
        alerts = self.engine.check_price("SPY", 451.5)
        assert len(alerts) == 1
        assert alerts[0].type == "NEAR_ENTRY"
        assert alerts[0].priority == "MEDIUM"

    def test_approaching_entry(self):
        self.engine.update_orders([_order(entry=450.0)])
        alerts = self.engine.check_price("SPY", 455.0)
        assert len(alerts) == 1
        assert alerts[0].type == "APPROACHING"
        assert alerts[0].priority == "LOW"

    def test_too_far_no_alert(self):
        self.engine.update_orders([_order(entry=450.0)])
        alerts = self.engine.check_price("SPY", 470.0)
        assert len(alerts) == 0

    def test_confirmed_has_trigger_prefix(self):
        self.engine.update_orders([_order(entry=450.0, confirmation="CONFIRMED")])
        alerts = self.engine.check_price("SPY", 450.05)
        assert "[TRIGGER]" in alerts[0].msg

    def test_pending_ta_has_watch_prefix(self):
        self.engine.update_orders([_order(entry=450.0, confirmation="PENDING_TA")])
        alerts = self.engine.check_price("SPY", 450.05)
        assert "[WATCH]" in alerts[0].msg

    def test_skip_closed_orders(self):
        self.engine.update_orders([_order(entry=450.0, status="CLOSED")])
        alerts = self.engine.check_price("SPY", 450.05)
        assert len(alerts) == 0

    def test_skip_killed_orders(self):
        self.engine.update_orders([_order(entry=450.0, status="KILLED")])
        alerts = self.engine.check_price("SPY", 450.05)
        assert len(alerts) == 0


class TestStopAlerts:
    def setup_method(self):
        self.engine = LevelEngine()

    def test_stop_warning_long(self):
        self.engine.update_orders([_order(stop=440.0, status="FILLED", direction="LONG")])
        alerts = self.engine.check_price("SPY", 440.5)
        assert len(alerts) == 1
        assert alerts[0].type == "STOP_WARNING"

    def test_stop_hit_long(self):
        self.engine.update_orders([_order(stop=440.0, status="FILLED", direction="LONG")])
        alerts = self.engine.check_price("SPY", 439.0)
        assert len(alerts) == 1
        assert alerts[0].type == "STOP_HIT"
        assert alerts[0].priority == "CRITICAL"

    def test_stop_warning_short(self):
        self.engine.update_orders([_order(stop=460.0, t1=480.0, t2=490.0, status="FILLED", direction="SHORT")])
        alerts = self.engine.check_price("SPY", 459.5)
        assert len(alerts) == 1
        assert alerts[0].type == "STOP_WARNING"

    def test_stop_no_alert_when_far(self):
        self.engine.update_orders([_order(stop=440.0, status="FILLED", direction="LONG")])
        alerts = self.engine.check_price("SPY", 450.0)
        assert len(alerts) == 0

    def test_stop_only_for_filled(self):
        self.engine.update_orders([_order(stop=440.0, status="ACTIVE", direction="LONG")])
        alerts = self.engine.check_price("SPY", 440.5)
        assert len(alerts) == 0


class TestTargetAlerts:
    def setup_method(self):
        self.engine = LevelEngine()

    def test_t1_alert(self):
        self.engine.update_orders([_order(t1=460.0, status="FILLED", direction="LONG")])
        alerts = self.engine.check_price("SPY", 459.8)
        assert len(alerts) == 1
        assert alerts[0].type == "TARGET_T1"

    def test_t2_alert(self):
        self.engine.update_orders([_order(t2=470.0, status="FILLED", direction="LONG")])
        alerts = self.engine.check_price("SPY", 469.9)
        assert len(alerts) == 1
        assert alerts[0].type == "TARGET_T2"

    def test_target_only_for_filled(self):
        self.engine.update_orders([_order(t1=460.0, status="ACTIVE", direction="LONG")])
        alerts = self.engine.check_price("SPY", 459.8)
        assert len(alerts) == 0


class TestMultipleOrders:
    def test_alerts_from_different_orders(self):
        engine = LevelEngine()
        engine.update_orders([
            _order(ticker="SPY", exec_as="SPY", entry=450.0, order_num=1),
            _order(ticker="META", exec_as="META", entry=480.0, order_num=2),
        ])
        spy_alerts = engine.check_price("SPY", 450.05)
        meta_alerts = engine.check_price("META", 480.10)
        assert len(spy_alerts) == 1
        assert len(meta_alerts) == 1
        assert spy_alerts[0].symbol == "SPY"
        assert meta_alerts[0].symbol == "META"

    def test_wrong_symbol_no_alert(self):
        engine = LevelEngine()
        engine.update_orders([_order(ticker="SPY", exec_as="SPY", entry=450.0)])
        alerts = engine.check_price("AAPL", 450.05)
        assert len(alerts) == 0
