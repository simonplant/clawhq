import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadTelegramConfig, submitForApproval } from "./gate.js";
import { getItem } from "./queue.js";

// ── Mock fetch for Telegram API calls ────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

// ── Test setup ──────────────────────────────────────────────────────────────

let testDir: string;
let deployDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "clawhq-gate-test-"));
  deployDir = join(testDir, "deploy");
  mkdirSync(join(deployDir, "workspace", "memory"), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ── submitForApproval ───────────────────────────────────────────────────────

describe("submitForApproval", () => {
  it("enqueues the action and returns the item", async () => {
    const result = await submitForApproval(deployDir, {
      category: "send_email",
      summary: "Reply to alice@example.com",
      detail: "Hi Alice, Tuesday works.",
      source: "email-digest",
    });

    expect(result.item.id).toMatch(/^apv-/);
    expect(result.item.status).toBe("pending");
    expect(result.item.category).toBe("send_email");
    expect(result.notified).toBe(false); // No Telegram config

    // Verify persisted in queue
    const stored = await getItem(deployDir, result.item.id);
    expect(stored).toBeDefined();
    expect(stored?.status).toBe("pending");
  });

  it("auto-sends Telegram notification when config provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 42 } }),
    });

    const result = await submitForApproval(deployDir, {
      category: "send_email",
      summary: "Reply to bob@example.com",
      detail: "Sounds good!",
      source: "email-digest",
      telegramConfig: { botToken: "test-token", chatId: "test-chat" },
    });

    expect(result.item.status).toBe("pending");
    expect(result.notified).toBe(true);

    // Verify Telegram API was called
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("https://api.telegram.org/bottest-token/sendMessage");
    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe("test-chat");
    expect(body.reply_markup.inline_keyboard[0][0].callback_data).toContain("apv:approve:");
    expect(body.reply_markup.inline_keyboard[0][1].callback_data).toContain("apv:reject:");
  });

  it("auto-loads Telegram config from .env when present", async () => {
    mkdirSync(join(deployDir, "engine"), { recursive: true });
    writeFileSync(
      join(deployDir, "engine", ".env"),
      'TELEGRAM_BOT_TOKEN="env-token"\nTELEGRAM_CHAT_ID="env-chat"\n',
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 1 } }),
    });

    const result = await submitForApproval(deployDir, {
      category: "delete",
      summary: "Delete message 123",
      detail: "Permanently delete",
      source: "email",
    });

    expect(result.notified).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe("https://api.telegram.org/botenv-token/sendMessage");
  });

  it("returns notified=false when Telegram fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const result = await submitForApproval(deployDir, {
      category: "send_email",
      summary: "Test",
      detail: "body",
      source: "test",
      telegramConfig: { botToken: "bad-token", chatId: "chat" },
    });

    expect(result.item.status).toBe("pending"); // Still enqueued
    expect(result.notified).toBe(false);
    expect(result.notifyError).toContain("401");
  });

  it("supports all approval categories", async () => {
    const categories = [
      "send_email", "send_message", "account_change",
      "public_post", "delete", "purchase", "other",
    ] as const;

    for (const category of categories) {
      const result = await submitForApproval(deployDir, {
        category,
        summary: `Test ${category}`,
        detail: "detail",
        source: "test",
      });
      expect(result.item.category).toBe(category);
    }
  });
});

// ── loadTelegramConfig ──────────────────────────────────────────────────────

describe("loadTelegramConfig", () => {
  it("returns undefined when .env does not exist", () => {
    expect(loadTelegramConfig(deployDir)).toBeUndefined();
  });

  it("returns undefined when tokens are missing", () => {
    mkdirSync(join(deployDir, "engine"), { recursive: true });
    writeFileSync(join(deployDir, "engine", ".env"), "OTHER_VAR=value\n");
    expect(loadTelegramConfig(deployDir)).toBeUndefined();
  });

  it("loads config from .env with unquoted values", () => {
    mkdirSync(join(deployDir, "engine"), { recursive: true });
    writeFileSync(
      join(deployDir, "engine", ".env"),
      "TELEGRAM_BOT_TOKEN=my-token\nTELEGRAM_CHAT_ID=my-chat\n",
    );
    const config = loadTelegramConfig(deployDir);
    expect(config).toEqual({ botToken: "my-token", chatId: "my-chat" });
  });

  it("loads config from .env with quoted values", () => {
    mkdirSync(join(deployDir, "engine"), { recursive: true });
    writeFileSync(
      join(deployDir, "engine", ".env"),
      `TELEGRAM_BOT_TOKEN="quoted-token"\nTELEGRAM_CHAT_ID='quoted-chat'\n`,
    );
    const config = loadTelegramConfig(deployDir);
    expect(config).toEqual({ botToken: "quoted-token", chatId: "quoted-chat" });
  });

  it("skips comments and blank lines", () => {
    mkdirSync(join(deployDir, "engine"), { recursive: true });
    writeFileSync(
      join(deployDir, "engine", ".env"),
      "# Telegram config\nTELEGRAM_BOT_TOKEN=tok\n\n# Chat\nTELEGRAM_CHAT_ID=cid\n",
    );
    const config = loadTelegramConfig(deployDir);
    expect(config).toEqual({ botToken: "tok", chatId: "cid" });
  });
});
