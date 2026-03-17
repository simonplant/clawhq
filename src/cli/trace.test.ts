import { describe, expect, it } from "vitest";

import { createTraceCommand } from "./trace.js";

describe("createTraceCommand", () => {
  const cmd = createTraceCommand();

  it("creates a trace command", () => {
    expect(cmd.name()).toBe("trace");
  });

  it("has a why subcommand", () => {
    const why = cmd.commands.find((c) => c.name() === "why");
    expect(why).toBeDefined();
    expect(why!.description()).toMatch(/explain|why/i);
  });

  it("has a list subcommand", () => {
    const list = cmd.commands.find((c) => c.name() === "list");
    expect(list).toBeDefined();
  });

  it("has a correct subcommand", () => {
    const correct = cmd.commands.find((c) => c.name() === "correct");
    expect(correct).toBeDefined();
  });

  it("why subcommand accepts a query argument", () => {
    const why = cmd.commands.find((c) => c.name() === "why")!;
    const args = why.registeredArguments;
    expect(args).toHaveLength(1);
    expect(args[0].name()).toBe("query");
  });

  it("list subcommand has filtering options", () => {
    const list = cmd.commands.find((c) => c.name() === "list")!;
    const optionNames = list.options.map((o) => o.long);
    expect(optionNames).toContain("--action-type");
    expect(optionNames).toContain("--since");
    expect(optionNames).toContain("--before");
    expect(optionNames).toContain("--limit");
  });
});
