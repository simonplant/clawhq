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
