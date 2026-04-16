"""ORDER block parser — extracts structured trade plans from daily briefs.

Ported and enhanced from configs/tools/market-monitor/market-monitor:152-193.
Parses the STANDARD_ORDER_FORMAT into OrderBlock dataclasses.
"""

import logging
import re
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

# Regex to find the ## Orders section in the brief
ORDERS_SECTION_RE = re.compile(
    r"^## Orders\s*\n(.*?)(?=^## |\Z)", re.MULTILINE | re.DOTALL
)

# Regex to split individual ORDER blocks
ORDER_BLOCK_RE = re.compile(
    r"ORDER (\d+) \| (\w+) \| (\w+)\n(.*?)(?=ORDER \d+|\Z)", re.DOTALL
)

# Regex to extract leading price number from a field value
PRICE_RE = re.compile(r"[\$]?([\d,]+\.?\d*)")


@dataclass
class OrderBlock:
    """A parsed ORDER block from the daily brief."""

    order_num: int
    conviction: str  # HIGH / MEDIUM / LOW
    status: str  # ACTIVE / CONDITIONAL / TRIGGERED / FILLED / CLOSED / KILLED / BLOCKED
    source: str  # mancini / dp / focus25 / scanner
    accounts: list[str]  # ["tos", "ira", "tradier"]
    ticker: str
    exec_as: str  # actual trading symbol (e.g. /MES for ES futures)
    direction: str  # LONG / SHORT
    setup: str
    why: str
    entry: float | None
    stop: float | None
    t1: float | None
    t2: float | None
    confirmation: str  # PENDING_TA / CONFIRMED / MANUAL
    confluence: str
    kills: str
    activation: str
    risk_raw: str
    raw_text: str  # original block for debugging


def parse_price(val: str) -> float | None:
    """Extract the leading numeric price from a field value like '450.50 LMT'."""
    if not val:
        return None
    m = PRICE_RE.match(val)
    if m:
        try:
            return float(m.group(1).replace(",", ""))
        except ValueError:
            return None
    return None


def parse_order_blocks(brief_path: Path) -> list[OrderBlock]:
    """Extract ORDER blocks from the daily brief's ## Orders section."""
    if not brief_path.exists():
        return []

    content = brief_path.read_text()

    # Find ## Orders section
    orders_match = ORDERS_SECTION_RE.search(content)
    if not orders_match:
        return []

    orders_text = orders_match.group(1)
    orders: list[OrderBlock] = []

    for block in ORDER_BLOCK_RE.finditer(orders_text):
        order_num = int(block.group(1))
        conviction = block.group(2)
        status = block.group(3)
        fields_text = block.group(4)

        # Parse key:value fields
        fields: dict[str, str] = {}
        for line in fields_text.strip().split("\n"):
            line = line.strip()
            if ":" in line:
                key, _, val = line.partition(":")
                fields[key.strip()] = val.strip()

        # Need at least a ticker or exec_as
        ticker = fields.get("ticker", "")
        exec_as = fields.get("exec_as", ticker)
        if not ticker and not exec_as:
            continue

        accounts_raw = fields.get("accounts", "")
        accounts = [a.strip() for a in accounts_raw.split(",") if a.strip()]

        orders.append(OrderBlock(
            order_num=order_num,
            conviction=conviction,
            status=status,
            source=fields.get("source", ""),
            accounts=accounts,
            ticker=ticker,
            exec_as=exec_as,
            direction=fields.get("direction", ""),
            setup=fields.get("setup", ""),
            why=fields.get("why", ""),
            entry=parse_price(fields.get("entry", "")),
            stop=parse_price(fields.get("stop", "")),
            t1=parse_price(fields.get("t1", "")),
            t2=parse_price(fields.get("t2", "")),
            confirmation=fields.get("confirmation", "PENDING_TA"),
            confluence=fields.get("confluence", "none"),
            kills=fields.get("kills", ""),
            activation=fields.get("activation", "immediate"),
            risk_raw=fields.get("risk", ""),
            raw_text=block.group(0),
        ))

    logger.info("Parsed %d ORDER blocks from %s", len(orders), brief_path.name)
    return orders


def get_monitored_symbols(orders: list[OrderBlock]) -> set[str]:
    """Extract the set of symbols to monitor from ORDER blocks."""
    symbols: set[str] = set()
    for order in orders:
        if order.status in ("CLOSED", "KILLED", "BLOCKED"):
            continue
        sym = order.exec_as or order.ticker
        if sym:
            symbols.add(sym)
    return symbols
