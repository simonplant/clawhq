import { describe, expect, it } from "vitest";

import { classifyCorrection, createSignal } from "./classifier.js";

describe("classifyCorrection", () => {
  it("classifies boundary signals from 'never' keyword", () => {
    expect(classifyCorrection("Never contact my ex")).toBe("boundary");
  });

  it("classifies boundary signals from 'absolutely not' keyword", () => {
    expect(classifyCorrection("Absolutely not — don't share that")).toBe("boundary");
  });

  it("classifies boundary signals from 'must not' keyword", () => {
    expect(classifyCorrection("You must not access my health data")).toBe("boundary");
  });

  it("classifies boundary signals from 'under no circumstances'", () => {
    expect(classifyCorrection("Under no circumstances should you send that")).toBe("boundary");
  });

  it("classifies one-time signals from 'just this once'", () => {
    expect(classifyCorrection("Just this once, skip the morning brief")).toBe("one-time");
  });

  it("classifies one-time signals from 'this time only'", () => {
    expect(classifyCorrection("This time only, use a formal tone")).toBe("one-time");
  });

  it("classifies one-time signals from 'temporarily'", () => {
    expect(classifyCorrection("Temporarily hold all email replies")).toBe("one-time");
  });

  it("classifies one-time signals from 'for now'", () => {
    expect(classifyCorrection("For now, skip calendar checks")).toBe("one-time");
  });

  it("defaults to preference for general corrections", () => {
    expect(classifyCorrection("Use bullet points in summaries")).toBe("preference");
  });

  it("defaults to preference for vague corrections", () => {
    expect(classifyCorrection("That's not quite right, try shorter emails")).toBe("preference");
  });

  it("boundary takes priority over one-time", () => {
    // "never" + "for now" — boundary wins
    expect(classifyCorrection("Never do that, not even for now")).toBe("boundary");
  });

  it("is case-insensitive", () => {
    expect(classifyCorrection("NEVER do that again")).toBe("boundary");
    expect(classifyCorrection("JUST THIS ONCE skip it")).toBe("one-time");
  });
});

describe("createSignal", () => {
  it("creates a signal with auto-classified type", () => {
    const signal = createSignal({
      actionType: "email_reply",
      originalDecision: "Sent formal reply",
      correction: "Use a more casual tone",
      appliedToIdentity: "USER.md",
      category: "email-tone",
    });

    expect(signal.id).toMatch(/^sig-/);
    expect(signal.signalType).toBe("preference");
    expect(signal.actionType).toBe("email_reply");
    expect(signal.category).toBe("email-tone");
    expect(signal.appliedToIdentity).toBe("USER.md");
    expect(signal.timestamp).toBeTruthy();
  });

  it("creates a signal with explicit type override", () => {
    const signal = createSignal({
      actionType: "scheduling",
      originalDecision: "Scheduled meeting at 8am",
      correction: "Never schedule before 9am",
      appliedToIdentity: "AGENTS.md",
      category: "scheduling",
      signalType: "boundary",
    });

    expect(signal.signalType).toBe("boundary");
  });

  it("auto-classifies boundary from correction text", () => {
    const signal = createSignal({
      actionType: "data_access",
      originalDecision: "Accessed health records",
      correction: "Never access my health data",
      appliedToIdentity: "AGENTS.md",
      category: "data-access",
    });

    expect(signal.signalType).toBe("boundary");
  });
});
