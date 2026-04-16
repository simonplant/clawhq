"""Tests for alert deduplication."""

import time
from unittest.mock import patch

from market_engine.monitor.dedup import Deduplicator


class TestDeduplication:
    def test_first_alert_allowed(self):
        d = Deduplicator(ttl_seconds=60)
        assert d.should_alert("AT_ENTRY", "SPY", "entry") is True

    def test_duplicate_within_ttl_suppressed(self):
        d = Deduplicator(ttl_seconds=60)
        d.should_alert("AT_ENTRY", "SPY", "entry")
        assert d.should_alert("AT_ENTRY", "SPY", "entry") is False

    def test_different_symbol_allowed(self):
        d = Deduplicator(ttl_seconds=60)
        d.should_alert("AT_ENTRY", "SPY", "entry")
        assert d.should_alert("AT_ENTRY", "META", "entry") is True

    def test_different_level_allowed(self):
        d = Deduplicator(ttl_seconds=60)
        d.should_alert("AT_ENTRY", "SPY", "entry")
        assert d.should_alert("STOP_WARNING", "SPY", "stop") is True

    def test_escalation_overrides_ttl(self):
        d = Deduplicator(ttl_seconds=60)
        d.should_alert("APPROACHING", "SPY", "entry")
        # NEAR_ENTRY is higher priority — should fire despite TTL
        assert d.should_alert("NEAR_ENTRY", "SPY", "entry") is True

    def test_escalation_chain(self):
        d = Deduplicator(ttl_seconds=60)
        assert d.should_alert("APPROACHING", "SPY", "entry") is True
        assert d.should_alert("NEAR_ENTRY", "SPY", "entry") is True
        assert d.should_alert("AT_ENTRY", "SPY", "entry") is True

    def test_downgrade_suppressed(self):
        d = Deduplicator(ttl_seconds=60)
        d.should_alert("AT_ENTRY", "SPY", "entry")
        # APPROACHING is lower — should be suppressed
        assert d.should_alert("APPROACHING", "SPY", "entry") is False

    def test_ttl_expiry_allows_repeat(self):
        d = Deduplicator(ttl_seconds=0.1)
        d.should_alert("AT_ENTRY", "SPY", "entry")
        time.sleep(0.15)
        assert d.should_alert("AT_ENTRY", "SPY", "entry") is True

    def test_reset_clears_state(self):
        d = Deduplicator(ttl_seconds=60)
        d.should_alert("AT_ENTRY", "SPY", "entry")
        d.reset()
        assert d.should_alert("AT_ENTRY", "SPY", "entry") is True

    def test_cleanup_removes_expired(self):
        d = Deduplicator(ttl_seconds=0.01)
        d.should_alert("AT_ENTRY", "SPY", "entry")
        time.sleep(0.1)
        d.cleanup()
        assert len(d._seen) == 0
