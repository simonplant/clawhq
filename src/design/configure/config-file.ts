/**
 * Non-interactive config file loader for `clawhq init --config <file>`.
 *
 * Reads a YAML config file and converts it to WizardAnswers, bypassing
 * the interactive wizard entirely. Enables:
 * - CI/CD pipelines
 * - Scripted deployments
 * - Headless/non-TTY environments
 * - Reproducible agent configuration
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

import { parse as yamlParse } from "yaml";

import { GATEWAY_DEFAULT_PORT, OLLAMA_DEFAULT_MODEL } from "../../config/defaults.js";
import { loadBlueprint } from "../blueprints/loader.js";
import type { WizardAnswers } from "./types.js";

// ── Types ───────────────────────────────────────────────────────────────────

/** Shape of the YAML config file. */
interface ConfigFile {
  blueprint: string;
  channel?: string;
  model_provider?: "local" | "cloud";
  local_model?: string;
  gateway_port?: number;
  deploy_dir?: string;
  instance_name?: string;
  air_gapped?: boolean;

  user?: {
    name?: string;
    timezone?: string;
    communication?: "brief" | "detailed" | "conversational";
    constraints?: string;
  };

  personality?: Record<string, number>;

  customization?: Record<string, string>;

  integrations?: Record<string, Record<string, string>>;

  /** Auth provider credentials (written to .env, referenced in openclaw.json). */
  auth?: {
    provider?: string;
    env?: Record<string, string>;
  };

  /** Channel-specific credentials (bot tokens, etc.). */
  channels?: {
    telegram?: {
      bot_token?: string;
      dm_policy?: string;
      group_policy?: string;
      streaming?: string;
    };
    whatsapp?: {
      phone_number_id?: string;
      access_token?: string;
    };
  };
}

// ── Errors ──────────────────────────────────────────────────────────────────

export class ConfigFileError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigFileError";
  }
}

// ── Loader ──────────────────────────────────────────────────────────────────

/**
 * Load wizard answers from a YAML config file.
 *
 * @param configPath — Path to the YAML config file
 * @returns WizardAnswers ready for generateBundle()
 */
export function loadConfigFile(configPath: string): WizardAnswers {
  const resolved = resolve(configPath);

  if (!existsSync(resolved)) {
    throw new ConfigFileError(`Config file not found: ${resolved}`);
  }

  const content = readFileSync(resolved, "utf-8");
  let parsed: unknown;
  try {
    parsed = yamlParse(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ConfigFileError(`YAML parse error: ${msg}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigFileError("Config file must be a YAML mapping (object)");
  }

  const config = parsed as ConfigFile;

  // Blueprint is required
  if (!config.blueprint || typeof config.blueprint !== "string") {
    throw new ConfigFileError("Config file must specify 'blueprint' (e.g. 'replace-my-pa')");
  }

  // Load the blueprint
  const { blueprint, sourcePath } = loadBlueprint(config.blueprint);

  // Channel — use config or blueprint default
  const channel = config.channel ?? blueprint.channels.default;

  // Validate channel is supported
  if (!blueprint.channels.supported.includes(channel)) {
    throw new ConfigFileError(
      `Channel '${channel}' not supported by blueprint '${blueprint.name}'. ` +
      `Supported: ${blueprint.channels.supported.join(", ")}`,
    );
  }

  // Build user context
  const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const userContext = {
    name: config.user?.name ?? "User",
    timezone: config.user?.timezone ?? detectedTimezone,
    communicationPreference: config.user?.communication ?? ("brief" as const),
    constraints: config.user?.constraints,
  };

  return {
    blueprint,
    blueprintPath: sourcePath,
    channel,
    modelProvider: config.model_provider ?? "local",
    localModel: config.local_model ?? blueprint.model_routing_strategy.local_model_preference ?? OLLAMA_DEFAULT_MODEL,
    gatewayPort: config.gateway_port ?? GATEWAY_DEFAULT_PORT,
    deployDir: expandHome(config.deploy_dir ?? "~/.clawhq"),
    instanceName: config.instance_name,
    airGapped: config.air_gapped ?? false,
    integrations: config.integrations ?? {},
    customizationAnswers: config.customization ?? {},
    personalityDimensions: config.personality
      ? config.personality as unknown as WizardAnswers["personalityDimensions"]
      : blueprint.personality.dimensions,
    userContext,
    auth: config.auth ? {
      provider: config.auth.provider,
      env: config.auth.env,
    } : undefined,
    channelConfig: buildChannelConfig(config.channels),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build channel config from config file channels section. */
function buildChannelConfig(
  channels?: ConfigFile["channels"],
): Record<string, Record<string, string>> | undefined {
  if (!channels) return undefined;

  const result: Record<string, Record<string, string>> = {};

  if (channels.telegram) {
    const tg: Record<string, string> = {};
    if (channels.telegram.bot_token) tg["botToken"] = channels.telegram.bot_token;
    if (channels.telegram.dm_policy) tg["dmPolicy"] = channels.telegram.dm_policy;
    if (channels.telegram.group_policy) tg["groupPolicy"] = channels.telegram.group_policy;
    if (channels.telegram.streaming) tg["streaming"] = channels.telegram.streaming;
    if (Object.keys(tg).length > 0) result["telegram"] = tg;
  }

  if (channels.whatsapp) {
    const wa: Record<string, string> = {};
    if (channels.whatsapp.phone_number_id) wa["phoneNumberId"] = channels.whatsapp.phone_number_id;
    if (channels.whatsapp.access_token) wa["accessToken"] = channels.whatsapp.access_token;
    if (Object.keys(wa).length > 0) result["whatsapp"] = wa;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/** Expand ~ to the user's home directory. */
function expandHome(path: string): string {
  if (path.startsWith("~/")) {
    return `${homedir()}${path.slice(1)}`;
  }
  if (path === "~") {
    return homedir();
  }
  return path;
}
