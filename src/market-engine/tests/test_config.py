"""Tests for config loading — env vars, JSON files, malformation handling."""

import json
import os
from pathlib import Path
from unittest.mock import patch

from market_engine.config import load_config


class TestConfigLoading:
    def setup_method(self):
        self.lib = Path("/tmp/test-config-lib")
        self.lib.mkdir(exist_ok=True)
        self.shared = Path("/tmp/test-config-shared")
        self.shared.mkdir(exist_ok=True)

    def teardown_method(self):
        import shutil
        shutil.rmtree(self.lib, ignore_errors=True)
        shutil.rmtree(self.shared, ignore_errors=True)

    def test_defaults_without_env(self):
        with patch.dict(os.environ, {
            "MARKETS_CONFIG_DIR": str(self.lib),
            "SHARED_DIR": str(self.shared),
        }, clear=False):
            cfg = load_config()
        assert cfg.web_port == 8080
        assert cfg.sandbox is False
        assert cfg.cred_proxy_url == "http://cred-proxy:9876"

    def test_loads_accounts_from_config_json(self):
        (self.lib / "CONFIG.json").write_text(json.dumps({
            "accounts": {"tos": {"balance": 100000}},
        }))
        with patch.dict(os.environ, {
            "MARKETS_CONFIG_DIR": str(self.lib),
            "SHARED_DIR": str(self.shared),
        }, clear=False):
            cfg = load_config()
        assert "tos" in cfg.accounts

    def test_loads_watchlists_from_json(self):
        (self.lib / "WATCHLISTS.json").write_text(json.dumps({
            "portfolio": ["SPY", "QQQ"],
        }))
        with patch.dict(os.environ, {
            "MARKETS_CONFIG_DIR": str(self.lib),
            "SHARED_DIR": str(self.shared),
        }, clear=False):
            cfg = load_config()
        assert "portfolio" in cfg.watchlists

    def test_malformed_config_json_doesnt_crash(self):
        (self.lib / "CONFIG.json").write_text("not valid json {{{")
        with patch.dict(os.environ, {
            "MARKETS_CONFIG_DIR": str(self.lib),
            "SHARED_DIR": str(self.shared),
        }, clear=False):
            cfg = load_config()
        assert cfg.accounts == {}

    def test_malformed_watchlists_doesnt_crash(self):
        (self.lib / "WATCHLISTS.json").write_text("broken")
        with patch.dict(os.environ, {
            "MARKETS_CONFIG_DIR": str(self.lib),
            "SHARED_DIR": str(self.shared),
        }, clear=False):
            cfg = load_config()
        assert cfg.watchlists == {}

    def test_missing_json_files_ok(self):
        with patch.dict(os.environ, {
            "MARKETS_CONFIG_DIR": str(self.lib),
            "SHARED_DIR": str(self.shared),
        }, clear=False):
            cfg = load_config()
        assert cfg.accounts == {}
        assert cfg.watchlists == {}

    def test_sandbox_mode_from_env(self):
        with patch.dict(os.environ, {
            "MARKETS_CONFIG_DIR": str(self.lib),
            "SHARED_DIR": str(self.shared),
            "TRADIER_SANDBOX": "true",
        }, clear=False):
            cfg = load_config()
        assert cfg.sandbox is True

    def test_custom_web_port(self):
        with patch.dict(os.environ, {
            "MARKETS_CONFIG_DIR": str(self.lib),
            "SHARED_DIR": str(self.shared),
            "WEB_PORT": "9090",
        }, clear=False):
            cfg = load_config()
        assert cfg.web_port == 9090
