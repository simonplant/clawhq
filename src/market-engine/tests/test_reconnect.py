"""Tests for reconnection logic and market hours detection."""

import asyncio
from datetime import datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest

from market_engine.stream.reconnect import (
    ReconnectState,
    is_market_hours,
    seconds_until_market_open,
)

ET = ZoneInfo("America/New_York")


class TestReconnectState:
    def test_initial_state(self):
        r = ReconnectState()
        assert r.consecutive_failures == 0
        assert r.degraded is False
        assert r.delay == 1.0

    def test_exponential_backoff(self):
        r = ReconnectState()
        assert r.delay == 1.0  # 2^0
        r.record_failure()
        assert r.delay == 2.0  # 2^1
        r.record_failure()
        assert r.delay == 4.0  # 2^2
        r.record_failure()
        assert r.delay == 8.0  # 2^3

    def test_backoff_caps_at_max(self):
        r = ReconnectState(max_delay=60.0)
        for _ in range(20):
            r.record_failure()
        assert r.delay == 60.0

    def test_success_resets_failures(self):
        r = ReconnectState()
        for _ in range(5):
            r.record_failure()
        r.record_success()
        assert r.consecutive_failures == 0
        assert r.degraded is False
        assert r.delay == 1.0

    def test_degraded_after_threshold(self):
        r = ReconnectState(max_failures_before_degraded=3)
        r.record_failure()
        r.record_failure()
        assert r.degraded is False
        r.record_failure()
        assert r.degraded is True

    def test_success_clears_degraded(self):
        r = ReconnectState(max_failures_before_degraded=2)
        r.record_failure()
        r.record_failure()
        assert r.degraded is True
        r.record_success()
        assert r.degraded is False

    @pytest.mark.asyncio
    async def test_wait_sleeps_correct_duration(self):
        r = ReconnectState(base_delay=0.01, max_delay=0.05)
        # First wait should be ~0.01s
        import time
        start = time.monotonic()
        await r.wait()
        elapsed = time.monotonic() - start
        assert elapsed >= 0.01
        assert elapsed < 0.1


class TestMarketHours:
    def test_weekday_during_market(self):
        # Wednesday 10:00 AM ET = market open
        mock_time = datetime(2026, 4, 15, 10, 0, tzinfo=ET)
        with patch("market_engine.stream.reconnect.datetime") as mock_dt:
            mock_dt.now.return_value = mock_time
            assert is_market_hours() is True

    def test_weekday_before_market(self):
        # Wednesday 3:00 AM ET = before 6 AM monitoring window
        mock_time = datetime(2026, 4, 15, 3, 0, tzinfo=ET)
        with patch("market_engine.stream.reconnect.datetime") as mock_dt:
            mock_dt.now.return_value = mock_time
            assert is_market_hours() is False

    def test_weekday_after_market(self):
        # Wednesday 5:00 PM ET = after 4:30 PM monitoring window
        mock_time = datetime(2026, 4, 15, 17, 0, tzinfo=ET)
        with patch("market_engine.stream.reconnect.datetime") as mock_dt:
            mock_dt.now.return_value = mock_time
            assert is_market_hours() is False

    def test_weekend_returns_false(self):
        # Saturday 10:00 AM ET
        mock_time = datetime(2026, 4, 18, 10, 0, tzinfo=ET)
        with patch("market_engine.stream.reconnect.datetime") as mock_dt:
            mock_dt.now.return_value = mock_time
            assert is_market_hours() is False

    def test_premarket_window(self):
        # Wednesday 6:30 AM ET = within monitoring window
        mock_time = datetime(2026, 4, 15, 6, 30, tzinfo=ET)
        with patch("market_engine.stream.reconnect.datetime") as mock_dt:
            mock_dt.now.return_value = mock_time
            assert is_market_hours() is True

    def test_seconds_until_open_returns_positive(self):
        result = seconds_until_market_open()
        assert result >= 60.0  # Minimum 60 seconds
