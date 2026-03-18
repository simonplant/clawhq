import { describe, expect, it } from "vitest";

import { buildConversationTexts, extractMessages } from "./parser.js";
import type { ChatGPTMessage } from "./types.js";

describe("extractMessages", () => {
  it("extracts messages from mapping and sorts by time", () => {
    const mapping: Record<string, { message: ChatGPTMessage | null }> = {
      "node-1": {
        message: {
          id: "msg-1",
          author: { role: "user" },
          content: { content_type: "text", parts: ["Hello"] },
          create_time: 1700000002,
        },
      },
      "node-2": {
        message: {
          id: "msg-2",
          author: { role: "assistant" },
          content: { content_type: "text", parts: ["Hi there"] },
          create_time: 1700000003,
        },
      },
      "node-0": {
        message: {
          id: "msg-0",
          author: { role: "user" },
          content: { content_type: "text", parts: ["First message"] },
          create_time: 1700000001,
        },
      },
    };

    const messages = extractMessages(mapping);
    expect(messages).toHaveLength(3);
    expect(messages[0].id).toBe("msg-0");
    expect(messages[1].id).toBe("msg-1");
    expect(messages[2].id).toBe("msg-2");
  });

  it("skips nodes with null messages", () => {
    const mapping: Record<string, { message: ChatGPTMessage | null }> = {
      "node-1": { message: null },
      "node-2": {
        message: {
          id: "msg-2",
          author: { role: "user" },
          content: { content_type: "text", parts: ["Hello"] },
          create_time: 1700000001,
        },
      },
    };

    const messages = extractMessages(mapping);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe("msg-2");
  });

  it("skips messages with empty parts", () => {
    const mapping: Record<string, { message: ChatGPTMessage | null }> = {
      "node-1": {
        message: {
          id: "msg-1",
          author: { role: "user" },
          content: { content_type: "text", parts: [] },
          create_time: 1700000001,
        },
      },
      "node-2": {
        message: {
          id: "msg-2",
          author: { role: "user" },
          content: { content_type: "text", parts: ["  "] },
          create_time: 1700000002,
        },
      },
    };

    const messages = extractMessages(mapping);
    expect(messages).toHaveLength(0);
  });
});

describe("buildConversationTexts", () => {
  it("builds text blocks from user messages", () => {
    const conversations = [
      {
        title: "Test Chat",
        create_time: 1700000000,
        update_time: 1700000100,
        mapping: {
          "n1": {
            message: {
              id: "m1",
              author: { role: "user" as const },
              content: { content_type: "text", parts: ["I prefer mornings"] },
              create_time: 1700000001,
            },
          },
          "n2": {
            message: {
              id: "m2",
              author: { role: "assistant" as const },
              content: { content_type: "text", parts: ["Noted!"] },
              create_time: 1700000002,
            },
          },
          "n3": {
            message: {
              id: "m3",
              author: { role: "user" as const },
              content: { content_type: "text", parts: ["I work at a startup"] },
              create_time: 1700000003,
            },
          },
        },
      },
    ];

    const texts = buildConversationTexts(conversations);
    expect(texts).toHaveLength(1);
    expect(texts[0].title).toBe("Test Chat");
    expect(texts[0].text).toContain("I prefer mornings");
    expect(texts[0].text).toContain("I work at a startup");
    // Should not include assistant messages
    expect(texts[0].text).not.toContain("Noted!");
  });

  it("skips conversations with no user messages", () => {
    const conversations = [
      {
        title: "Empty Chat",
        create_time: 1700000000,
        update_time: 1700000100,
        mapping: {
          "n1": {
            message: {
              id: "m1",
              author: { role: "assistant" as const },
              content: { content_type: "text", parts: ["Hello"] },
              create_time: 1700000001,
            },
          },
        },
      },
    ];

    const texts = buildConversationTexts(conversations);
    expect(texts).toHaveLength(0);
  });
});
