/**
 * Template-driven channel resolution utilities.
 *
 * Resolves which channels a template supports, validates channel
 * connection requests against the template, and provides warnings
 * for unsupported channels.
 */

import type { TemplateChannels } from "../blueprints/types.js";

/** Default channels when a template has no explicit channels block. */
const DEFAULT_CHANNELS: TemplateChannels = {
  supported: ["telegram"],
  default: "telegram",
};

/** All channel types recognized by ClawHQ. */
export const ALL_CHANNELS = ["telegram", "whatsapp", "discord", "slack", "matrix"] as const;

export interface ChannelResolution {
  /** Channels supported by the template. */
  supported: string[];
  /** The default (auto-enabled) channel. */
  defaultChannel: string;
}

export interface ChannelWarning {
  channel: string;
  message: string;
}

/**
 * Resolve the effective channels from a template's channels block.
 * Falls back to telegram-only when the template has no channels definition.
 */
export function resolveTemplateChannels(
  channels: TemplateChannels | undefined,
): ChannelResolution {
  const effective = channels ?? DEFAULT_CHANNELS;
  return {
    supported: [...effective.supported],
    defaultChannel: effective.default,
  };
}

/**
 * Check whether a channel is supported by the given template channels.
 * Returns a warning object if not supported, or null if it is supported.
 */
export function checkChannelSupported(
  channel: string,
  channels: TemplateChannels | undefined,
): ChannelWarning | null {
  const resolution = resolveTemplateChannels(channels);
  if (resolution.supported.includes(channel)) {
    return null;
  }
  return {
    channel,
    message: `Channel "${channel}" is not in this template's supported channels (${resolution.supported.join(", ")}). It may not work correctly.`,
  };
}

/**
 * Returns whether a channel is the default for the template.
 */
export function isDefaultChannel(
  channel: string,
  channels: TemplateChannels | undefined,
): boolean {
  const resolution = resolveTemplateChannels(channels);
  return resolution.defaultChannel === channel;
}
