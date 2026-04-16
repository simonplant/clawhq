"""FastAPI application factory for the market-engine web dashboard."""

import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from sse_starlette.sse import EventSourceResponse

from .sse import SSEBroadcaster

logger = logging.getLogger(__name__)


def create_app(
    broadcaster: SSEBroadcaster,
    get_prices: callable,
    get_orders: callable,
    get_alerts: callable,
    get_positions: callable,
    get_status: callable,
) -> FastAPI:
    """Create the FastAPI app with all routes wired up."""
    from .pages import render_alerts, render_dashboard, render_orders, render_positions

    app = FastAPI(title="Market Engine", docs_url=None, redoc_url=None)

    @app.get("/", response_class=HTMLResponse)
    async def dashboard():
        return render_dashboard(
            status=get_status(),
            prices=get_prices(),
            alerts=get_alerts(),
            orders=get_orders(),
        )

    @app.get("/orders", response_class=HTMLResponse)
    async def orders_page():
        return render_orders(
            orders=get_orders(),
            prices=get_prices(),
        )

    @app.get("/alerts", response_class=HTMLResponse)
    async def alerts_page():
        return render_alerts(alerts=get_alerts())

    @app.get("/positions", response_class=HTMLResponse)
    async def positions_page():
        return render_positions(
            positions=get_positions(),
            prices=get_prices(),
        )

    @app.get("/health")
    async def health():
        status = get_status()
        return JSONResponse({
            "status": "ok",
            "mode": status.get("mode", "unknown"),
            "market_ws": status.get("market_ws", {}).get("connected", False),
            "account_ws": status.get("account_ws", {}).get("connected", False),
            "uptime": status.get("uptime_seconds", 0),
        })

    @app.get("/sse/stream")
    async def sse_stream(request: Request):
        async def event_generator():
            async for event_str in broadcaster.subscribe():
                if await request.is_disconnected():
                    break
                yield event_str

        return EventSourceResponse(event_generator())

    # htmx partial endpoints
    @app.get("/partials/prices", response_class=HTMLResponse)
    async def partial_prices():
        from .pages import render_price_table
        return render_price_table(get_prices())

    @app.get("/partials/alerts", response_class=HTMLResponse)
    async def partial_alerts():
        from .pages import render_alert_feed
        return render_alert_feed(get_alerts())

    @app.get("/partials/orders", response_class=HTMLResponse)
    async def partial_orders():
        from .pages import render_order_table
        return render_order_table(get_orders(), get_prices())

    @app.get("/partials/positions", response_class=HTMLResponse)
    async def partial_positions():
        from .pages import render_positions_table
        return render_positions_table(get_positions(), get_prices())

    @app.get("/partials/status", response_class=HTMLResponse)
    async def partial_status():
        from .pages import render_status_badge
        return render_status_badge(get_status())

    return app
