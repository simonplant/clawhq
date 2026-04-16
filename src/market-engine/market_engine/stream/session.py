"""Tradier streaming session lifecycle.

Creates short-lived session tokens via the credential proxy.
Sessions have a 5-minute TTL — create immediately before connecting.
"""

import json
import logging
import urllib.request
from urllib.error import HTTPError, URLError

logger = logging.getLogger(__name__)


class SessionError(Exception):
    """Failed to create a Tradier streaming session."""


def create_market_session(cred_proxy_url: str) -> str:
    """Create a Tradier market streaming session via cred-proxy.

    POST {cred_proxy_url}/tradier/v1/markets/events/session
    Returns the sessionid string (valid for 5 minutes).
    """
    url = f"{cred_proxy_url}/tradier/v1/markets/events/session"
    data = b""  # POST with empty body
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": "0",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read())
    except json.JSONDecodeError as e:
        raise SessionError(f"Invalid JSON in session response: {e}") from e
    except HTTPError as e:
        raise SessionError(f"HTTP {e.code} creating session: {e.reason}") from e
    except URLError as e:
        raise SessionError(f"Connection failed: {e.reason}") from e

    # Response: {"stream": {"sessionid": "...", "url": "..."}}
    session_id = body.get("stream", {}).get("sessionid")
    if not session_id:
        raise SessionError(f"No sessionid in response: {body}")

    logger.info("Created Tradier market session (expires in 5 min)")
    return session_id


def create_account_session(cred_proxy_url: str) -> str:
    """Create a Tradier account streaming session via cred-proxy.

    POST {cred_proxy_url}/tradier/v1/accounts/events/session
    Returns the sessionid string.
    """
    url = f"{cred_proxy_url}/tradier/v1/accounts/events/session"
    data = b""
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": "0",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read())
    except json.JSONDecodeError as e:
        raise SessionError(f"Invalid JSON in account session response: {e}") from e
    except HTTPError as e:
        raise SessionError(f"HTTP {e.code} creating account session: {e.reason}") from e
    except URLError as e:
        raise SessionError(f"Connection failed: {e.reason}") from e

    session_id = body.get("stream", {}).get("sessionid")
    if not session_id:
        raise SessionError(f"No sessionid in account session response: {body}")

    logger.info("Created Tradier account session")
    return session_id
