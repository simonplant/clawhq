"""Page renderers — server-side HTML with htmx + Pico CSS.

Uses Python f-strings (no Jinja2 dependency for pages).
Matches ClawHQ's existing dashboard style.
"""

from html import escape


# ── Layout ──────────────────────────────────────────────────────────────────

def _layout(title: str, content: str, active: str = "/") -> str:
    """Wrap page content in the shared layout."""
    def nav_link(href: str, label: str) -> str:
        cls = ' class="active"' if href == active else ""
        return f'<a href="{href}"{cls}>{label}</a>'

    return f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(title)} — Market Engine</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <script src="https://unpkg.com/htmx-ext-sse@2.2.2/sse.js"></script>
  <style>
    :root {{ --pico-font-size: 14px; }}
    .badge {{ display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }}
    .badge-ok {{ background: #2d6a4f; color: #fff; }}
    .badge-warn {{ background: #e9c46a; color: #000; }}
    .badge-err {{ background: #e63946; color: #fff; }}
    .badge-info {{ background: #457b9d; color: #fff; }}
    .badge-high {{ background: #e63946; color: #fff; }}
    .badge-medium {{ background: #e9c46a; color: #000; }}
    .badge-low {{ background: #457b9d; color: #fff; }}
    .pnl-pos {{ color: #2d6a4f; font-weight: 600; }}
    .pnl-neg {{ color: #e63946; font-weight: 600; }}
    .price-cell {{ font-family: monospace; text-align: right; }}
    .alert-row {{ border-left: 3px solid transparent; padding: 4px 8px; margin: 2px 0; }}
    .alert-CRITICAL {{ border-left-color: #e63946; background: rgba(230,57,70,0.1); }}
    .alert-HIGH {{ border-left-color: #e76f51; background: rgba(231,111,81,0.05); }}
    .alert-MEDIUM {{ border-left-color: #e9c46a; }}
    .alert-LOW {{ border-left-color: #457b9d; }}
    table {{ font-size: 13px; }}
    nav {{ margin-bottom: 1rem; }}
    .stats {{ display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }}
    .stat-card {{ background: var(--pico-card-background-color); padding: 0.75rem 1rem; border-radius: 8px; min-width: 120px; }}
    .stat-card .label {{ font-size: 11px; opacity: 0.7; text-transform: uppercase; }}
    .stat-card .value {{ font-size: 1.5rem; font-weight: 700; }}
  </style>
</head>
<body>
  <nav class="container-fluid">
    <ul>
      <li><strong>Market Engine</strong></li>
    </ul>
    <ul>
      {nav_link("/", "Dashboard")}
      {nav_link("/orders", "Orders")}
      {nav_link("/alerts", "Alerts")}
      {nav_link("/positions", "Positions")}
    </ul>
  </nav>
  <main class="container">
    <h2>{escape(title)}</h2>
    {content}
  </main>
</body>
</html>"""


# ── Dashboard ───────────────────────────────────────────────────────────────

def render_dashboard(status: dict, prices: dict, alerts: list, orders: list) -> str:
    market_ws = status.get("market_ws", {})
    mode = status.get("mode", "unknown")
    mode_badge = "badge-ok" if mode == "active" else "badge-warn" if mode == "idle" else "badge-err"

    content = f"""
    <div class="stats" hx-get="/partials/status" hx-trigger="every 10s" hx-swap="innerHTML">
      {render_status_badge(status)}
    </div>

    <div class="grid">
      <div>
        <article>
          <header>Prices</header>
          <div hx-get="/partials/prices" hx-trigger="every 2s" hx-swap="innerHTML">
            {render_price_table(prices)}
          </div>
        </article>
      </div>
      <div>
        <article>
          <header>Recent Alerts</header>
          <div hx-ext="sse" sse-connect="/sse/stream" sse-swap="alert"
               hx-get="/partials/alerts" hx-trigger="load" hx-swap="innerHTML">
            {render_alert_feed(alerts[:5])}
          </div>
        </article>
      </div>
    </div>
    """
    return _layout("Dashboard", content, active="/")


# ── Orders Page ─────────────────────────────────────────────────────────────

def render_orders(orders: list, prices: dict) -> str:
    content = f"""
    <div hx-get="/partials/orders" hx-trigger="every 5s" hx-swap="innerHTML">
      {render_order_table(orders, prices)}
    </div>
    """
    return _layout("Active Orders", content, active="/orders")


# ── Alerts Page ─────────────────────────────────────────────────────────────

def render_alerts(alerts: list) -> str:
    content = f"""
    <div hx-ext="sse" sse-connect="/sse/stream" sse-swap="alert"
         hx-get="/partials/alerts" hx-trigger="load" hx-swap="innerHTML">
      {render_alert_feed(alerts)}
    </div>
    """
    return _layout("Alerts", content, active="/alerts")


# ── Positions Page ──────────────────────────────────────────────────────────

def render_positions(positions: dict, prices: dict) -> str:
    content = f"""
    <div hx-get="/partials/positions" hx-trigger="every 3s" hx-swap="innerHTML">
      {render_positions_table(positions, prices)}
    </div>
    """
    return _layout("Positions", content, active="/positions")


# ── Partials (htmx fragments) ──────────────────────────────────────────────

def render_status_badge(status: dict) -> str:
    mode = status.get("mode", "unknown")
    market = status.get("market_status", "UNKNOWN")
    uptime = status.get("uptime_seconds", 0)
    symbols = status.get("symbols_streaming", 0)
    alerts_today = status.get("alerts_today", 0)
    orders = status.get("orders_parsed", 0)
    ws_ok = status.get("market_ws", {}).get("connected", False)

    mode_cls = "badge-ok" if mode == "active" else "badge-warn" if mode == "idle" else "badge-err"
    ws_cls = "badge-ok" if ws_ok else "badge-err"
    market_cls = "badge-ok" if market == "OPEN" else "badge-warn" if "PRE" in market else "badge-info"

    uptime_str = f"{uptime // 3600}h {(uptime % 3600) // 60}m" if uptime > 0 else "0m"

    return f"""
    <div class="stat-card"><div class="label">Mode</div><div class="value"><span class="badge {mode_cls}">{escape(mode)}</span></div></div>
    <div class="stat-card"><div class="label">Market</div><div class="value"><span class="badge {market_cls}">{escape(market)}</span></div></div>
    <div class="stat-card"><div class="label">Stream</div><div class="value"><span class="badge {ws_cls}">{"connected" if ws_ok else "disconnected"}</span></div></div>
    <div class="stat-card"><div class="label">Symbols</div><div class="value">{symbols}</div></div>
    <div class="stat-card"><div class="label">Orders</div><div class="value">{orders}</div></div>
    <div class="stat-card"><div class="label">Alerts Today</div><div class="value">{alerts_today}</div></div>
    <div class="stat-card"><div class="label">Uptime</div><div class="value">{uptime_str}</div></div>
    """


def render_price_table(prices: dict) -> str:
    if not prices:
        return "<p>No price data yet.</p>"

    rows = []
    for sym in sorted(prices.keys()):
        p = prices[sym]
        last = p.get("last", 0)
        bid = p.get("bid", 0)
        ask = p.get("ask", 0)
        rows.append(f"""
        <tr>
          <td><strong>{escape(sym)}</strong></td>
          <td class="price-cell">{last:.2f}</td>
          <td class="price-cell">{bid:.2f}</td>
          <td class="price-cell">{ask:.2f}</td>
        </tr>""")

    return f"""
    <table>
      <thead><tr><th>Symbol</th><th>Last</th><th>Bid</th><th>Ask</th></tr></thead>
      <tbody>{"".join(rows)}</tbody>
    </table>"""


def render_alert_feed(alerts: list) -> str:
    if not alerts:
        return "<p>No alerts.</p>"

    rows = []
    for a in alerts[:20]:  # Show last 20
        priority = a.get("priority", "LOW")
        ts = a.get("ts", "")[:19].replace("T", " ")
        msg = a.get("msg", "")
        rows.append(f"""
        <div class="alert-row alert-{escape(priority)}">
          <small>{escape(ts)}</small>
          <span class="badge badge-{escape(priority.lower())}">{escape(priority)}</span>
          {escape(msg)}
        </div>""")

    return "".join(rows)


def render_order_table(orders: list, prices: dict) -> str:
    if not orders:
        return "<p>No active orders.</p>"

    rows = []
    for o in orders:
        sym = o.get("exec_as") or o.get("ticker", "")
        price_data = prices.get(sym, {})
        current = price_data.get("last", 0)
        entry = o.get("entry")
        dist = ""
        if entry and current and entry > 0:
            d = abs(current - entry) / entry * 100
            dist = f"{d:.1f}%"

        conviction = o.get("conviction", "")
        conv_cls = "high" if conviction == "HIGH" else "medium" if conviction == "MEDIUM" else "low"
        status = o.get("status", "")
        conf = o.get("confirmation", "")

        rows.append(f"""
        <tr>
          <td>{o.get("order_num", "")}</td>
          <td>{escape(o.get("source", ""))}</td>
          <td><strong>{escape(sym)}</strong></td>
          <td>{escape(o.get("direction", ""))}</td>
          <td class="price-cell">{_fmt_price(entry)}</td>
          <td class="price-cell">{_fmt_price(o.get("stop"))}</td>
          <td class="price-cell">{_fmt_price(o.get("t1"))}</td>
          <td class="price-cell">{_fmt_price(o.get("t2"))}</td>
          <td class="price-cell">{current:.2f if current else ""}</td>
          <td>{dist}</td>
          <td><span class="badge badge-{conv_cls}">{escape(conviction)}</span></td>
          <td>{escape(status)}</td>
          <td>{escape(conf)}</td>
        </tr>""")

    return f"""
    <table>
      <thead><tr>
        <th>#</th><th>Src</th><th>Ticker</th><th>Dir</th>
        <th>Entry</th><th>Stop</th><th>T1</th><th>T2</th>
        <th>Now</th><th>Dist</th><th>Conv</th><th>Status</th><th>Conf</th>
      </tr></thead>
      <tbody>{"".join(rows)}</tbody>
    </table>"""


def render_positions_table(positions: dict, prices: dict) -> str:
    pos_list = positions.get("positions", []) if isinstance(positions, dict) else positions
    totals = positions.get("totals", {}) if isinstance(positions, dict) else {}

    if not pos_list:
        return "<p>No open positions.</p>"

    rows = []
    for p in pos_list:
        pnl = p.get("pnl_dollars", 0)
        pnl_cls = "pnl-pos" if pnl >= 0 else "pnl-neg"
        pnl_pct = p.get("pnl_pct", 0)

        rows.append(f"""
        <tr>
          <td><strong>{escape(p.get("symbol", ""))}</strong></td>
          <td>{p.get("qty", 0)}</td>
          <td>{escape(p.get("side", ""))}</td>
          <td class="price-cell">{p.get("avg_cost", 0):.2f}</td>
          <td class="price-cell">{p.get("current_price", 0):.2f}</td>
          <td class="price-cell {pnl_cls}">${pnl:+.2f}</td>
          <td class="price-cell {pnl_cls}">{pnl_pct:+.1f}%</td>
          <td class="price-cell">${p.get("market_value", 0):,.2f}</td>
        </tr>""")

    total_pnl = totals.get("total_pnl", 0)
    total_cls = "pnl-pos" if total_pnl >= 0 else "pnl-neg"

    return f"""
    <table>
      <thead><tr>
        <th>Symbol</th><th>Qty</th><th>Side</th><th>Avg Cost</th>
        <th>Current</th><th>P&amp;L</th><th>P&amp;L %</th><th>Value</th>
      </tr></thead>
      <tbody>{"".join(rows)}</tbody>
      <tfoot><tr>
        <td colspan="5"><strong>Total</strong></td>
        <td class="price-cell {total_cls}"><strong>${total_pnl:+.2f}</strong></td>
        <td></td>
        <td class="price-cell"><strong>${totals.get("market_value", 0):,.2f}</strong></td>
      </tr></tfoot>
    </table>"""


def _fmt_price(v) -> str:
    if v is None:
        return ""
    try:
        return f"{float(v):.2f}"
    except (TypeError, ValueError):
        return str(v)
