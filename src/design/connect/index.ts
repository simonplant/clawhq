/**
 * Channel connection module — `clawhq connect`.
 *
 * Re-exports the public API for channel setup, testing, and health checks.
 */

export type {
  ChannelType,
  ChannelSetupResult,
  ChannelTestResult,
  ChannelTestStep,
  ChannelHealth,
  ChannelStatus,
  ConnectOptions,
  ChannelSetupFlow,
} from "./types.js";

export { telegramFlow, validateTelegramToken } from "./telegram.js";
export { whatsappFlow, validateWhatsAppCredentials } from "./whatsapp.js";
export { readChannelEnv, readOpenClawChannels, writeChannelConfig, writeChannelEnv } from "./config.js";
export { collectChannelHealth, formatChannelSection, formatTestResult } from "./format.js";
export { resolveTemplateChannels, checkChannelSupported, isDefaultChannel, ALL_CHANNELS } from "./channels.js";
export type { ChannelResolution, ChannelWarning } from "./channels.js";
