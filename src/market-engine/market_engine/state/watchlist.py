"""Watchlist management — merges symbols from multiple sources.

Reads shared/watchlist.json (written by Clawdius), merges with ORDER block
tickers and portfolio symbols from WATCHLISTS.json. Detects changes and
triggers resubscribe.
"""

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


class WatchlistManager:
    """Manages the merged set of symbols to stream."""

    def __init__(self, shared_dir: Path, lib_dir: Path) -> None:
        self._shared_dir = shared_dir
        self._lib_dir = lib_dir
        self._current_symbols: set[str] = set()
        self._clawdius_symbols: set[str] = set()
        self._order_symbols: set[str] = set()
        self._portfolio_symbols: set[str] = set()
        self._load_portfolio()

    @property
    def symbols(self) -> set[str]:
        return self._current_symbols

    def _load_portfolio(self) -> None:
        """Load portfolio symbols from WATCHLISTS.json."""
        path = self._lib_dir / "WATCHLISTS.json"
        if not path.exists():
            return
        try:
            with open(path) as f:
                data = json.load(f)
            # Collect all symbols from all lists
            for key, symbols in data.items():
                if isinstance(symbols, list):
                    self._portfolio_symbols.update(
                        s for s in symbols if isinstance(s, str) and s
                    )
            logger.info("Loaded %d portfolio symbols", len(self._portfolio_symbols))
        except Exception as e:
            logger.error("Failed to load WATCHLISTS.json: %s", e)

    def update_clawdius_watchlist(self) -> bool:
        """Read shared/watchlist.json and update. Returns True if symbols changed."""
        path = self._shared_dir / "watchlist.json"
        if not path.exists():
            return False
        try:
            with open(path) as f:
                data = json.load(f)
            symbols = set(data.get("symbols", []))
            if symbols != self._clawdius_symbols:
                self._clawdius_symbols = symbols
                return self._recompute()
            return False
        except Exception as e:
            logger.debug("Failed to read watchlist.json: %s", e)
            return False

    def update_order_symbols(self, symbols: set[str]) -> bool:
        """Update symbols derived from ORDER blocks. Returns True if merged set changed."""
        self._order_symbols = symbols
        return self._recompute()

    def _recompute(self) -> bool:
        """Recompute the merged symbol set. Returns True if it changed."""
        merged = self._clawdius_symbols | self._order_symbols | self._portfolio_symbols
        # Remove empty strings and futures-style symbols that Tradier doesn't support
        merged = {s for s in merged if s and not s.startswith("/")}
        if merged != self._current_symbols:
            old_count = len(self._current_symbols)
            self._current_symbols = merged
            logger.info(
                "Watchlist updated: %d → %d symbols (clawdius=%d, orders=%d, portfolio=%d)",
                old_count, len(merged),
                len(self._clawdius_symbols), len(self._order_symbols),
                len(self._portfolio_symbols),
            )
            return True
        return False
