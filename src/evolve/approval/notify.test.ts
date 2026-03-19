import { describe, expect, it, vi, beforeEach } from "vitest";

import { sendApprovalNotification, sendResolutionConfirmation } from "./notify.js";
import type { TelegramConfig } from "./notify.js";
import type { ApprovalItem } from "./types.js";

// ── Mock fetch ──────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

const TELEGRAM_CONFIG: TelegramConfig = {
  botToken: "123456:ABC-DEF",
  chatId: "999888",
};

function makePendingItem(overrides?: Partial<ApprovalItem>): ApprovalItem {
  return {
    id: "apv-test-0001",
    category: "send_email",
    summary: "Reply to alice@example.com: Re: Meeting",
    detail: "Hi Alice, Tuesday works for me. Best, User",
    source: "email-digest",
    status: "pending",
    createdAt: "2026-03-19T10:00:00.000Z",
    metadata: { to: "alice@example.com", subject: "Re: Meeting" },
    ...overrides,
  };
}

// ── sendApprovalNotification ────────────────────────────────────────────────

describe("sendApprovalNotification", () => {
  it("sends a Telegram message with inline keyboard", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 42 } }),
    });

    const item = makePendingItem();
    const result = await sendApprovalNotification(TELEGRAM_CONFIG, item);

    expect(result.success).toBe(true);
    expect(result.messageId).toBe(42);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bot123456:ABC-DEF/sendMessage");

    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe("999888");
    expect(body.parse_mode).toBe("MarkdownV2");

    // Verify inline keyboard has approve/reject buttons
    const keyboard = body.reply_markup.inline_keyboard;
    expect(keyboard).toHaveLength(1);
    expect(keyboard[0]).toHaveLength(2);
    expect(keyboard[0][0].text).toBe("Approve");
    expect(keyboard[0][0].callback_data).toBe("apv:approve:apv-test-0001");
    expect(keyboard[0][1].text).toBe("Reject");
    expect(keyboard[0][1].callback_data).toBe("apv:reject:apv-test-0001");
  });

  it("returns error on API failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const result = await sendApprovalNotification(TELEGRAM_CONFIG, makePendingItem());

    expect(result.success).toBe(false);
    expect(result.error).toContain("401");
  });

  it("returns error on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const result = await sendApprovalNotification(TELEGRAM_CONFIG, makePendingItem());

    expect(result.success).toBe(false);
    expect(result.error).toContain("Network error");
  });

  it("includes category label in the message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 1 } }),
    });

    await sendApprovalNotification(TELEGRAM_CONFIG, makePendingItem({ category: "purchase" }));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain("Purchase");
  });
});

// ── sendResolutionConfirmation ──────────────────────────────────────────────

describe("sendResolutionConfirmation", () => {
  it("edits the original message to show resolution", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    const item = makePendingItem({ status: "approved" });
    await sendResolutionConfirmation(TELEGRAM_CONFIG, item, 42);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bot123456:ABC-DEF/editMessageText");

    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe("999888");
    expect(body.message_id).toBe(42);
    expect(body.text).toContain("Approved");
  });

  it("does not throw on failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("fail"));

    // Should not throw
    await sendResolutionConfirmation(TELEGRAM_CONFIG, makePendingItem(), 42);
  });
});
