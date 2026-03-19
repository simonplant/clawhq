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

/** Canonical WhatsApp / Facebook Graph API version. */
export const WHATSAPP_API_VERSION = "v21.0";

/** Base URL for the Facebook Graph API (no trailing slash, no version). */
export const WHATSAPP_API_BASE = "https://graph.facebook.com";

/** Base URL for the Anthropic API (no trailing slash). */
export const ANTHROPIC_API_BASE = "https://api.anthropic.com";

/** Base URL for the OpenAI API (no trailing slash). */
export const OPENAI_API_BASE = "https://api.openai.com";

/** Base URL for the Telegram Bot API (no trailing slash). */
export const TELEGRAM_API_BASE = "https://api.telegram.org";
