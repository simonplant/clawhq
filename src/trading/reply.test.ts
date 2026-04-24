import { describe, expect, it } from "vitest";

import { parseCommand, parseReply } from "./commands.js";

describe("parseReply", () => {
  it("parses YES-ABCD into approve", () => {
    expect(parseReply("YES-T3ST")).toEqual({ reply: "approve", alertId: "T3ST" });
  });

  it("parses lowercase and trims whitespace", () => {
    expect(parseReply("  yes t3st ")).toEqual({
      reply: "approve",
      alertId: "T3ST",
    });
  });

  it("parses every verb alias", () => {
    const cases: Array<[string, string]> = [
      ["YES-A7F3", "approve"],
      ["ok a7f3", "approve"],
      ["approve A7F3", "approve"],
      ["HALF-A7F3", "reduce-half"],
      ["50-A7F3", "reduce-half"],
      ["THIRD A7F3", "reduce-third"],
      ["33_A7F3", "reduce-third"],
      ["NO-A7F3", "reject"],
      ["skip A7F3", "reject"],
      ["LATER-A7F3", "defer-5m"],
      ["5m-A7F3", "defer-5m"],
      ["OPEN-A7F3", "defer-to-open"],
    ];
    for (const [raw, want] of cases) {
      expect(parseReply(raw)?.reply, raw).toBe(want);
    }
  });

  it("rejects an unknown verb", () => {
    expect(parseReply("maybe-T3ST")).toBeNull();
  });

  it("rejects short or long alert ids", () => {
    expect(parseReply("YES-T3")).toBeNull();
    expect(parseReply("YES-T3STX")).toBeNull();
  });

  it("normalizes the alert id to upper case", () => {
    expect(parseReply("yes-abcd")?.alertId).toBe("ABCD");
  });

  it("parseCommand ignores replies (delegates to parseReply first)", () => {
    expect(parseCommand("YES-T3ST")).toBeNull();
  });
});
