import { createHmac } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dispatch, dispatchTest } from "./dispatcher.js";
import {
  addChannel,
  getChannel,
  loadChannels,
  removeChannel,
  saveChannels,
} from "./store.js";
import type {
  NotificationChannel,
  NotificationEvent,
  TelegramChannel,
  WebhookChannel,
} from "./types.js";
import { newChannelId } from "./types.js";
import { signPayload } from "./webhook.js";

const TEST_DIR = "/tmp/clawhq-notifications-test";
const STORE_PATH = join(TEST_DIR, "notifications.json");

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

// --- newChannelId ---

describe("newChannelId", () => {
  it("returns an 8-character string", () => {
    const id = newChannelId();
    expect(id).toHaveLength(8);
  });

  it("returns unique values", () => {
    const ids = new Set(Array.from({ length: 10 }, () => newChannelId()));
    expect(ids.size).toBe(10);
  });
});

// --- signPayload ---

describe("signPayload", () => {
  it("produces valid HMAC-SHA256 hex signature", () => {
    const payload = '{"type":"alert.critical","title":"Test"}';
    const secret = "test-secret-key";
    const sig = signPayload(payload, secret);

    const expected = createHmac("sha256", secret).update(payload).digest("hex");
    expect(sig).toBe(expected);
  });

  it("produces different signatures for different secrets", () => {
    const payload = '{"test": true}';
    const sig1 = signPayload(payload, "secret-a");
    const sig2 = signPayload(payload, "secret-b");
    expect(sig1).not.toBe(sig2);
  });
});

// --- store ---

describe("loadChannels", () => {
  it("returns empty array for missing file", async () => {
    const channels = await loadChannels(TEST_DIR, "/tmp/nonexistent/notifications.json");
    expect(channels).toEqual([]);
  });

  it("returns empty array for invalid JSON", async () => {
    await writeFile(STORE_PATH, "not json");
    const channels = await loadChannels(TEST_DIR, STORE_PATH);
    expect(channels).toEqual([]);
  });

  it("returns empty array for wrong version", async () => {
    await writeFile(STORE_PATH, JSON.stringify({ version: 99, channels: [] }));
    const channels = await loadChannels(TEST_DIR, STORE_PATH);
    expect(channels).toEqual([]);
  });

  it("loads valid channels", async () => {
    const channel: WebhookChannel = {
      id: "abc",
      name: "test-webhook",
      type: "webhook",
      events: ["alert.critical"],
      enabled: true,
      createdAt: "2026-03-17T00:00:00Z",
      url: "https://example.com/hook",
      secret: "s3cret",
    };
    await writeFile(STORE_PATH, JSON.stringify({ version: 1, channels: [channel] }, null, 2));

    const channels = await loadChannels(TEST_DIR, STORE_PATH);
    expect(channels).toHaveLength(1);
    expect(channels[0].id).toBe("abc");
    expect(channels[0].type).toBe("webhook");
  });
});

describe("saveChannels", () => {
  it("writes channels to disk", async () => {
    const channel: TelegramChannel = {
      id: "tg1",
      name: "my-telegram",
      type: "telegram",
      events: ["approval.pending"],
      enabled: true,
      createdAt: "2026-03-17T00:00:00Z",
      token: "123:ABC",
      chatId: "456",
    };

    await saveChannels([channel], TEST_DIR, STORE_PATH);
    const raw = await readFile(STORE_PATH, "utf-8");
    const data = JSON.parse(raw);
    expect(data.version).toBe(1);
    expect(data.channels).toHaveLength(1);
    expect(data.channels[0].id).toBe("tg1");
  });
});

describe("addChannel", () => {
  it("adds a channel to an empty store", async () => {
    const channel: WebhookChannel = {
      id: "wh1",
      name: "webhook-1",
      type: "webhook",
      events: ["alert.critical", "alert.warning"],
      enabled: true,
      createdAt: "2026-03-17T00:00:00Z",
      url: "https://example.com/hook",
      secret: "key",
    };

    await addChannel(channel, TEST_DIR, STORE_PATH);
    const channels = await loadChannels(TEST_DIR, STORE_PATH);
    expect(channels).toHaveLength(1);
    expect(channels[0].id).toBe("wh1");
  });

  it("appends to existing channels", async () => {
    const ch1: WebhookChannel = {
      id: "a", name: "a", type: "webhook", events: ["alert.critical"],
      enabled: true, createdAt: "2026-03-17T00:00:00Z", url: "https://a.com", secret: "x",
    };
    const ch2: WebhookChannel = {
      id: "b", name: "b", type: "webhook", events: ["alert.warning"],
      enabled: true, createdAt: "2026-03-17T00:00:00Z", url: "https://b.com", secret: "y",
    };

    await addChannel(ch1, TEST_DIR, STORE_PATH);
    await addChannel(ch2, TEST_DIR, STORE_PATH);
    const channels = await loadChannels(TEST_DIR, STORE_PATH);
    expect(channels).toHaveLength(2);
  });
});

describe("removeChannel", () => {
  it("returns false for non-existent channel", async () => {
    const removed = await removeChannel("nonexistent", TEST_DIR, STORE_PATH);
    expect(removed).toBe(false);
  });

  it("removes an existing channel", async () => {
    const channel: WebhookChannel = {
      id: "del1", name: "to-delete", type: "webhook", events: ["alert.critical"],
      enabled: true, createdAt: "2026-03-17T00:00:00Z", url: "https://x.com", secret: "k",
    };
    await addChannel(channel, TEST_DIR, STORE_PATH);

    const removed = await removeChannel("del1", TEST_DIR, STORE_PATH);
    expect(removed).toBe(true);

    const channels = await loadChannels(TEST_DIR, STORE_PATH);
    expect(channels).toHaveLength(0);
  });
});

describe("getChannel", () => {
  it("returns undefined for missing channel", async () => {
    const ch = await getChannel("nope", TEST_DIR, STORE_PATH);
    expect(ch).toBeUndefined();
  });

  it("finds existing channel", async () => {
    const channel: WebhookChannel = {
      id: "find1", name: "findme", type: "webhook", events: ["backup.failed"],
      enabled: true, createdAt: "2026-03-17T00:00:00Z", url: "https://f.com", secret: "s",
    };
    await addChannel(channel, TEST_DIR, STORE_PATH);

    const found = await getChannel("find1", TEST_DIR, STORE_PATH);
    expect(found).toBeDefined();
    expect(found!.name).toBe("findme");
  });
});

// --- dispatcher ---

describe("dispatch", () => {
  it("returns empty array when no channels configured", async () => {
    const event: NotificationEvent = {
      type: "alert.critical",
      title: "Test",
      message: "Test message",
      timestamp: "2026-03-17T00:00:00Z",
    };

    const results = await dispatch(event, TEST_DIR, STORE_PATH);
    expect(results).toEqual([]);
  });

  it("skips channels that do not subscribe to event type", async () => {
    const channel: WebhookChannel = {
      id: "wh1", name: "webhook-1", type: "webhook",
      events: ["backup.failed"],  // not alert.critical
      enabled: true, createdAt: "2026-03-17T00:00:00Z",
      url: "https://example.com/hook", secret: "key",
    };
    await saveChannels([channel], TEST_DIR, STORE_PATH);

    const event: NotificationEvent = {
      type: "alert.critical",
      title: "Test",
      message: "Test message",
      timestamp: "2026-03-17T00:00:00Z",
    };

    const results = await dispatch(event, TEST_DIR, STORE_PATH);
    expect(results).toEqual([]);
  });

  it("skips disabled channels", async () => {
    const channel: WebhookChannel = {
      id: "wh1", name: "webhook-1", type: "webhook",
      events: ["alert.critical"],
      enabled: false,
      createdAt: "2026-03-17T00:00:00Z",
      url: "https://example.com/hook", secret: "key",
    };
    await saveChannels([channel], TEST_DIR, STORE_PATH);

    const event: NotificationEvent = {
      type: "alert.critical",
      title: "Test",
      message: "Test message",
      timestamp: "2026-03-17T00:00:00Z",
    };

    const results = await dispatch(event, TEST_DIR, STORE_PATH);
    expect(results).toEqual([]);
  });
});

describe("dispatchTest", () => {
  it("returns error for unknown channel", async () => {
    const result = await dispatchTest("nonexistent", TEST_DIR, STORE_PATH);
    expect(result.sent).toBe(false);
    expect(result.error).toContain("not found");
  });
});
