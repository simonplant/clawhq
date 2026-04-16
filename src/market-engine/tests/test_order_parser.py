"""Tests for ORDER block parser."""

from pathlib import Path
from textwrap import dedent

import pytest

from market_engine.monitor.order_parser import OrderBlock, parse_order_blocks, parse_price


# ── parse_price ─────────────────────────────────────────────────────────────

class TestParsePrice:
    def test_simple_number(self):
        assert parse_price("450.50 LMT") == 450.50

    def test_dollar_sign(self):
        assert parse_price("$142.30") == 142.30

    def test_comma_thousands(self):
        assert parse_price("5,842.00 LMT") == 5842.00

    def test_integer(self):
        assert parse_price("100") == 100.0

    def test_empty(self):
        assert parse_price("") is None

    def test_no_number(self):
        assert parse_price("none") is None

    def test_with_explanation(self):
        assert parse_price("450.50 — stated level") == 450.50


# ── parse_order_blocks ──────────────────────────────────────────────────────

SAMPLE_BRIEF = dedent("""\
    # Trading Brief 2026-04-16

    ## Context
    Some market context here.

    ## Orders

    ORDER 1 | HIGH | ACTIVE
      source:       mancini
      accounts:     tos, ira, tradier
      ticker:       ES
      exec_as:      /MES
      direction:    LONG
      setup:        bounce — "hold 5840 for move to 5870"
      why:          Mancini primary bull level
      entry:        5840 LMT
      stop:         5820 — stated
      t1:           5870 (75%) — stated
      t2:           5900 (15%) — estimated
      runner:       10% trail BE after T1
      risk:         20 | 2 shares | $40
      confirmation: CONFIRMED
      confluence:   none
      caveat:       none
      kills:        level_broken
      activation:   immediate
      verify:       none

    ORDER 2 | MEDIUM | CONDITIONAL
      source:       dp
      accounts:     tos, ira
      ticker:       META
      exec_as:      META
      direction:    LONG
      setup:        pullback — "bounce off 200d MA"
      why:          DP conviction at key support
      entry:        $480.50 LMT
      stop:         $470.00 — MA-2%
      t1:           $500.00 (75%) — next R
      t2:           $520.00 (15%) — estimated
      runner:       10% trail BE after T1
      risk:         10.50 | 5 shares | $52.50
      confirmation: PENDING_TA
      confluence:   DP+FOCUS25
      caveat:       earnings in 2 weeks
      kills:        dp_flat, gap_killed
      activation:   price must close above 485
      verify:       check volume

    ## Review
    Some review content.
""")


class TestParseOrderBlocks:
    def setup_method(self):
        self.tmp = Path("/tmp/test-brief.md")
        self.tmp.write_text(SAMPLE_BRIEF)

    def teardown_method(self):
        if self.tmp.exists():
            self.tmp.unlink()

    def test_parses_two_orders(self):
        orders = parse_order_blocks(self.tmp)
        assert len(orders) == 2

    def test_first_order_fields(self):
        orders = parse_order_blocks(self.tmp)
        o = orders[0]
        assert o.order_num == 1
        assert o.conviction == "HIGH"
        assert o.status == "ACTIVE"
        assert o.source == "mancini"
        assert o.accounts == ["tos", "ira", "tradier"]
        assert o.ticker == "ES"
        assert o.exec_as == "/MES"
        assert o.direction == "LONG"
        assert o.entry == 5840.0
        assert o.stop == 5820.0
        assert o.t1 == 5870.0
        assert o.t2 == 5900.0
        assert o.confirmation == "CONFIRMED"
        assert o.confluence == "none"
        assert o.kills == "level_broken"
        assert o.activation == "immediate"

    def test_second_order_fields(self):
        orders = parse_order_blocks(self.tmp)
        o = orders[1]
        assert o.order_num == 2
        assert o.conviction == "MEDIUM"
        assert o.status == "CONDITIONAL"
        assert o.source == "dp"
        assert o.accounts == ["tos", "ira"]
        assert o.ticker == "META"
        assert o.entry == 480.50
        assert o.stop == 470.00
        assert o.t1 == 500.00
        assert o.t2 == 520.00
        assert o.confirmation == "PENDING_TA"
        assert o.confluence == "DP+FOCUS25"

    def test_missing_file(self):
        orders = parse_order_blocks(Path("/tmp/nonexistent.md"))
        assert orders == []

    def test_no_orders_section(self):
        p = Path("/tmp/test-no-orders.md")
        p.write_text("# Brief\n\n## Context\nNo orders here.\n")
        try:
            orders = parse_order_blocks(p)
            assert orders == []
        finally:
            p.unlink()

    def test_malformed_block_skipped(self):
        """Block without ticker or exec_as should be skipped."""
        p = Path("/tmp/test-malformed.md")
        p.write_text(dedent("""\
            ## Orders

            ORDER 1 | HIGH | ACTIVE
              source:       mancini
              direction:    LONG
              entry:        5840 LMT
        """))
        try:
            orders = parse_order_blocks(p)
            assert len(orders) == 0
        finally:
            p.unlink()
