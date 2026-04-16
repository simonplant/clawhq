"""Configuration loader — env vars, CONFIG.json, WATCHLISTS.json."""

import json
import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class EngineConfig:
    """Immutable engine configuration loaded at startup."""

    # Credential proxy (session creation, REST fallback)
    cred_proxy_url: str
    # Tradier account ID (for account streaming + positions)
    tradier_account_id: str
    # Shared volume mount (file-based IPC with Clawdius)
    shared_dir: Path
    # Workspace memory dir (read-only, ORDER blocks live here)
    workspace_memory_dir: Path
    # Lib dir (CONFIG.json, WATCHLISTS.json, risk_governor, etc.)
    lib_dir: Path
    # Web dashboard port
    web_port: int
    # Timezone
    tz: str
    # Whether to use sandbox endpoints
    sandbox: bool

    # Loaded from CONFIG.json
    accounts: dict = field(default_factory=dict)
    watchlists: dict = field(default_factory=dict)


# Tradier WebSocket endpoints
TRADIER_WS_MARKET = "wss://ws.tradier.com/v1/markets/events"
TRADIER_WS_ACCOUNT = "wss://ws.tradier.com/v1/accounts/events"
TRADIER_WS_SANDBOX_MARKET = "wss://sandbox-ws.tradier.com/v1/markets/events"
TRADIER_WS_SANDBOX_ACCOUNT = "wss://sandbox-ws.tradier.com/v1/accounts/events"

# Tradier REST (via cred-proxy)
TRADIER_SESSION_PATH = "/tradier/v1/markets/events/session"
TRADIER_QUOTES_PATH = "/tradier/v1/markets/quotes"
TRADIER_POSITIONS_PATH = "/tradier/v1/accounts/{account_id}/positions"


def load_config() -> EngineConfig:
    """Load configuration from environment variables and JSON files."""
    lib_dir = Path(os.environ.get("MARKETS_CONFIG_DIR", "/app/market_engine/lib"))
    shared_dir = Path(os.environ.get("SHARED_DIR", "/shared"))
    workspace_memory_dir = Path(os.environ.get("WORKSPACE_MEMORY_DIR", "/workspace/memory"))

    # Load CONFIG.json
    accounts = {}
    config_path = lib_dir / "CONFIG.json"
    if config_path.exists():
        with open(config_path) as f:
            raw = json.load(f)
            accounts = raw.get("accounts", {})

    # Load WATCHLISTS.json
    watchlists = {}
    watchlists_path = lib_dir / "WATCHLISTS.json"
    if watchlists_path.exists():
        with open(watchlists_path) as f:
            watchlists = json.load(f)

    return EngineConfig(
        cred_proxy_url=os.environ.get("CRED_PROXY_URL", "http://cred-proxy:9876"),
        tradier_account_id=os.environ.get("TRADIER_ACCOUNT_ID", ""),
        shared_dir=shared_dir,
        workspace_memory_dir=workspace_memory_dir,
        lib_dir=lib_dir,
        web_port=int(os.environ.get("WEB_PORT", "8080")),
        tz=os.environ.get("TZ", "America/Los_Angeles"),
        sandbox=os.environ.get("TRADIER_SANDBOX", "").lower() in ("1", "true", "yes"),
        accounts=accounts,
        watchlists=watchlists,
    )
