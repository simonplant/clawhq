/**
 * Canonical default values for ClawHQ configuration.
 *
 * Single source of truth for magic numbers that appear across the codebase.
 * Changing a default here changes it everywhere.
 */

/** Default port for the OpenClaw Gateway WebSocket server. */
export const GATEWAY_DEFAULT_PORT = 18789;

/** Default port for the ClawHQ web dashboard. */
export const DASHBOARD_DEFAULT_PORT = 3737;

/** Default base URL for the local Ollama API. */
export const OLLAMA_DEFAULT_URL = "http://127.0.0.1:11434";

/** Default Ollama model for local inference. */
export const OLLAMA_DEFAULT_MODEL = "llama3:8b";

/** Canonical WhatsApp / Facebook Graph API version. */
export const WHATSAPP_API_VERSION = "v21.0";

/** Base URL for the Facebook Graph API (no trailing slash, no version). */
export const WHATSAPP_API_BASE = "https://graph.facebook.com";

/** Base URL for the Anthropic API (no trailing slash). */
export const ANTHROPIC_API_BASE = "https://api.anthropic.com";

/** Canonical Anthropic API version string (sent as anthropic-version header). */
export const ANTHROPIC_API_VERSION = "2023-06-01";

/** Base URL for the OpenAI API (no trailing slash). */
export const OPENAI_API_BASE = "https://api.openai.com";

/** Base URL for the Telegram Bot API (no trailing slash). */
export const TELEGRAM_API_BASE = "https://api.telegram.org";

// ── Container identity ──────────────────────────────────────────────────────

/** Container non-root user (LM-06 landmine requirement). */
export const CONTAINER_USER = "1000:1000";

// ── Repository URLs ─────────────────────────────────────────────────────────

/** Canonical OpenClaw repository URL (used by from-source installer). */
export const OPENCLAW_REPO_URL = "https://github.com/nicepkg/openclaw.git";

// ── File permission modes ────────────────────────────────────────────────────

/** Owner read/write only — secrets (.env, credentials.json). */
export const FILE_MODE_SECRET = 0o600;

/** Owner rwx only — directories containing secrets (keys/, cloud/). */
export const DIR_MODE_SECRET = 0o700;

/** Owner read/write, group+other read — general config files. */
export const FILE_MODE_CONFIG = 0o644;

/** Owner rwx, group+other rx — executable scripts (tool wrappers, skills). */
export const FILE_MODE_EXEC = 0o755;

// ── Timeout & interval defaults ─────────────────────────────────────────────

/** Default RPC request timeout for Gateway WebSocket calls (ms). */
export const GATEWAY_RPC_TIMEOUT_MS = 10_000;

/** Timeout for establishing a WebSocket connection to the Gateway (ms). */
export const GATEWAY_CONNECT_TIMEOUT_MS = 5_000;

/** Interval between Gateway health poll checks (ms). */
export const GATEWAY_HEALTH_INTERVAL_MS = 30_000;

/** Timeout for a single Gateway health check RPC (ms). */
export const GATEWAY_HEALTH_TIMEOUT_MS = 5_000;

/** Timeout for shell commands executed by doctor checks (ms). */
export const DOCTOR_EXEC_TIMEOUT_MS = 15_000;

/** Timeout for credential probe HTTP requests (ms). */
export const CREDENTIALS_PROBE_TIMEOUT_MS = 10_000;

/** Timeout for shell commands in monitor alerts (ms). */
export const MONITOR_EXEC_TIMEOUT_MS = 10_000;

/** Timeout for shell commands in monitor recovery (ms). */
export const RECOVERY_EXEC_TIMEOUT_MS = 30_000;

/** Timeout for shell commands in status dashboard (ms). */
export const STATUS_EXEC_TIMEOUT_MS = 10_000;

/** Default interval for status --watch mode (ms). */
export const STATUS_WATCH_INTERVAL_MS = 5_000;

/** Timeout for shell commands in log streaming (ms). */
export const LOGS_EXEC_TIMEOUT_MS = 30_000;

/** Timeout for shell commands in updater (ms). */
export const UPDATER_EXEC_TIMEOUT_MS = 30_000;

/** Default interval for the monitor health polling loop (ms). */
export const MONITOR_HEALTH_INTERVAL_MS = 30_000;

/** Timeout for GPG encryption/decryption in backup operations (ms). */
export const BACKUP_GPG_TIMEOUT_MS = 60_000;

/** Timeout for GPG decryption during backup restore (ms). */
export const BACKUP_RESTORE_GPG_TIMEOUT_MS = 120_000;

/** Timeout for tar extraction during backup restore (ms). */
export const BACKUP_RESTORE_TAR_TIMEOUT_MS = 120_000;

/** Timeout for Docker image pull during updates (ms). */
export const UPDATER_PULL_TIMEOUT_MS = 300_000;

/** Default interval for scheduled memory lifecycle runs (ms). */
export const MONITOR_MEMORY_LIFECYCLE_INTERVAL_MS = 6 * 3_600_000;

// ── Deploy / launcher defaults ──────────────────────────────────────────────

/** Overall timeout for post-deploy health verification (ms). */
export const DEPLOY_HEALTH_TIMEOUT_MS = 60_000;

/** Base interval between health check retries during deploy (ms). */
export const DEPLOY_HEALTH_INTERVAL_MS = 2_000;

/** Maximum back-off interval for deploy health retries (ms). */
export const DEPLOY_HEALTH_MAX_INTERVAL_MS = 10_000;

/** Timeout for individual RPC calls during deploy health checks (ms). */
export const DEPLOY_RPC_TIMEOUT_MS = 5_000;

/** Timeout for the post-deploy smoke test message round-trip (ms). */
export const DEPLOY_SMOKE_TIMEOUT_MS = 30_000;

/** Timeout for shell commands in preflight checks (ms). */
export const PREFLIGHT_EXEC_TIMEOUT_MS = 15_000;

/** Timeout for git clone operations in from-source installer (ms). */
export const INSTALL_CLONE_TIMEOUT_MS = 300_000;

/** Timeout for Docker build in from-source installer (ms). */
export const INSTALL_BUILD_TIMEOUT_MS = 600_000;

/** Timeout for docker compose up/down commands (ms). */
export const DEPLOY_COMPOSE_TIMEOUT_MS = 120_000;

/** Timeout for Ollama local inference generation (ms). */
export const OLLAMA_GENERATE_TIMEOUT_MS = 120_000;

/** Ollama availability check and model listing timeout (ms). */
export const OLLAMA_PROBE_TIMEOUT_MS = 5_000;

/** Telegram long-poll getUpdates timeout in seconds. */
export const TELEGRAM_POLLING_TIMEOUT_SEC = 30;

// ── Cloud module defaults ───────────────────────────────────────────────────

/** Timeout for the cloud heartbeat health-reporter RPC (ms). */
export const CLOUD_HEARTBEAT_RPC_TIMEOUT_MS = 10_000;

/** Maximum command history entries retained in the cloud command queue. */
export const CLOUD_COMMAND_QUEUE_MAX_HISTORY = 100;

/** Maximum age (ms) for a cloud command before it is rejected as stale. Default: 5 minutes. */
export const CLOUD_COMMAND_MAX_AGE_MS = 5 * 60 * 1_000;

/** Polling interval for cloud provisioning status checks (ms). */
export const CLOUD_POLL_INTERVAL_MS = 5_000;

/** Timeout for cloud provider API requests (ms). */
export const CLOUD_API_TIMEOUT_MS = 30_000;

/** Timeout for polling cloud provisioning status until ready (ms). */
export const CLOUD_POLL_TIMEOUT_MS = 300_000;

/** Timeout for long-running cloud operations — snapshots, GCE ops (ms). */
export const CLOUD_OPERATION_TIMEOUT_MS = 600_000;

// ── OpenClaw environment variable defaults (v0.8.6+) ────────────────────────

/** Default WebSocket event caller timeout in milliseconds (was hardcoded 60s). */
export const WEBSOCKET_EVENT_CALLER_TIMEOUT_MS = 60_000;

/** Default for ENABLE_AUDIT_STDOUT — enable audit logging to stdout. */
export const ENABLE_AUDIT_STDOUT = "true";

// ── Identity / bootstrap limits ─────────────────────────────────────────────

/** Maximum character budget for identity bootstrap content (LM-08). */
export const BOOTSTRAP_MAX_CHARS = 20_000;

// ── Backing service defaults ───────────────────────────────────────────────

/** Default PostgreSQL Docker image. */
export const SERVICE_POSTGRES_IMAGE = "postgres:16-alpine";

/** Default PostgreSQL host port. */
export const SERVICE_POSTGRES_PORT = 5432;

/** Default Redis Docker image. */
export const SERVICE_REDIS_IMAGE = "redis:7-alpine";

/** Default Redis host port. */
export const SERVICE_REDIS_PORT = 6379;

/** Default Qdrant Docker image. */
export const SERVICE_QDRANT_IMAGE = "qdrant/qdrant:v1.12.5";

/** Default Qdrant host port. */
export const SERVICE_QDRANT_PORT = 6333;

/** Default healthcheck interval for backing services. */
export const SERVICE_HEALTHCHECK_INTERVAL = "10s";

/** Default healthcheck timeout for backing services. */
export const SERVICE_HEALTHCHECK_TIMEOUT = "5s";

/** Default healthcheck retry count for backing services. */
export const SERVICE_HEALTHCHECK_RETRIES = 5;
