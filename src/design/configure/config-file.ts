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
import { homedir } from "node:os";
import { resolve } from "node:path";

import { parse as yamlParse } from "yaml";

import { GATEWAY_DEFAULT_PORT, OLLAMA_DEFAULT_MODEL } from "../../config/defaults.js";
import { loadBlueprint } from "../blueprints/loader.js";
import { compile } from "../catalog/index.js";
import type { CompiledWorkspace } from "../catalog/types.js";

import type { WizardAnswers } from "./types.js";

// ── Types ───────────────────────────────────────────────────────────────────

/** Shape of the YAML config file. */
interface ConfigFile {
  /** Legacy: direct blueprint reference. */
  blueprint?: string;

  /** New: mission profile composition (personality is implicit — canonical ClawHQ vector). */
  profile?: string;
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

  /** Free-text SOUL.md overrides. Only user-facing personality customization. */
  soul_overrides?: string;

  customization?: Record<string, string>;

  integrations?: Record<string, Record<string, string>>;

  /** Auth provider credentials (written to .env, referenced in openclaw.json). */
  auth?: {
    provider?: string;
    env?: Record<string, string>;
  };

  /** Provider selections per capability domain. */
  providers?: Record<string, string>;

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
 * Check if a config file uses the composition format (profile-based).
 *
 * Personality is implicit — every agent uses the canonical ClawHQ vector.
 * A config qualifies as a composition config when it specifies `profile`
 * (top-level or under `composition:`).
 */
export function isCompositionConfig(configPath: string): boolean {
  const resolved = resolve(configPath);
  if (!existsSync(resolved)) return false;
  const content = readFileSync(resolved, "utf-8");
  const parsed = yamlParse(content) as Record<string, unknown> | null;
  if (!parsed) return false;
  // Flat format: profile at top level
  if (parsed.profile) return true;
  // Deployed format: composition.profile
  const comp = parsed.composition as Record<string, unknown> | undefined;
  return !!comp?.profile;
}

/**
 * Load a composition config and compile it into workspace files.
 *
 * @param configPath — Path to the YAML config file with profile: + personality:
 * @returns CompiledWorkspace with all files ready to write
 */
export function loadAndCompileComposition(configPath: string): CompiledWorkspace {
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

  const config = parsed as ConfigFile;

  if (!config.profile) {
    throw new ConfigFileError("Composition config must specify 'profile'");
  }

  const deployDir = expandHome(config.deploy_dir ?? "~/.clawhq");
  const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return compile(
    {
      profile: config.profile,
      providers: config.providers,
      channels: buildChannelConfig(config.channels),
      soul_overrides: config.soul_overrides,
    },
    {
      name: config.user?.name ?? "User",
      timezone: config.user?.timezone ?? detectedTimezone,
      communication: config.user?.communication ?? "brief",
      constraints: config.user?.constraints,
    },
    deployDir,
    config.gateway_port ?? GATEWAY_DEFAULT_PORT,
  );
}

/**
 * Load wizard answers from a YAML config file (legacy blueprint path).
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
    soulOverrides: config.soul_overrides,
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
