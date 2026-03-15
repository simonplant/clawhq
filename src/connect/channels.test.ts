import { describe, expect, it } from "vitest";

import type { TemplateChannels } from "../templates/types.js";

import {
  checkChannelSupported,
  isDefaultChannel,
  resolveTemplateChannels,
} from "./channels.js";

describe("resolveTemplateChannels", () => {
  it("returns template channels when defined", () => {
    const channels: TemplateChannels = {
      supported: ["telegram", "discord", "matrix"],
      default: "telegram",
    };
    const result = resolveTemplateChannels(channels);
    expect(result.supported).toEqual(["telegram", "discord", "matrix"]);
    expect(result.defaultChannel).toBe("telegram");
  });

  it("falls back to telegram-only when channels is undefined", () => {
    const result = resolveTemplateChannels(undefined);
    expect(result.supported).toEqual(["telegram"]);
    expect(result.defaultChannel).toBe("telegram");
  });

  it("returns a copy of supported array (not a reference)", () => {
    const channels: TemplateChannels = {
      supported: ["telegram", "whatsapp"],
      default: "telegram",
    };
    const result = resolveTemplateChannels(channels);
    result.supported.push("slack");
    expect(channels.supported).toHaveLength(2);
  });
});

describe("checkChannelSupported", () => {
  const channels: TemplateChannels = {
    supported: ["telegram", "whatsapp", "slack"],
    default: "telegram",
  };

  it("returns null for a supported channel", () => {
    expect(checkChannelSupported("telegram", channels)).toBeNull();
    expect(checkChannelSupported("whatsapp", channels)).toBeNull();
    expect(checkChannelSupported("slack", channels)).toBeNull();
  });

  it("returns a warning for an unsupported channel", () => {
    const warning = checkChannelSupported("discord", channels);
    expect(warning).toBeDefined();
    expect(warning?.channel).toBe("discord");
    expect(warning?.message).toContain("not in this template");
    expect(warning?.message).toContain("telegram, whatsapp, slack");
  });

  it("treats telegram as supported when channels is undefined", () => {
    expect(checkChannelSupported("telegram", undefined)).toBeNull();
  });

  it("warns for non-telegram channels when channels is undefined", () => {
    const warning = checkChannelSupported("discord", undefined);
    expect(warning).toBeDefined();
    expect(warning?.channel).toBe("discord");
  });
});

describe("isDefaultChannel", () => {
  it("returns true for the default channel", () => {
    const channels: TemplateChannels = {
      supported: ["telegram", "whatsapp"],
      default: "whatsapp",
    };
    expect(isDefaultChannel("whatsapp", channels)).toBe(true);
  });

  it("returns false for a non-default channel", () => {
    const channels: TemplateChannels = {
      supported: ["telegram", "whatsapp"],
      default: "whatsapp",
    };
    expect(isDefaultChannel("telegram", channels)).toBe(false);
  });

  it("defaults to telegram when channels is undefined", () => {
    expect(isDefaultChannel("telegram", undefined)).toBe(true);
    expect(isDefaultChannel("discord", undefined)).toBe(false);
  });
});
