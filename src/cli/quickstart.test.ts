import { describe, expect, it } from "vitest";

import { createQuickstartCommand } from "./quickstart.js";

describe("createQuickstartCommand", () => {
  const cmd = createQuickstartCommand();

  it("creates a command named quickstart", () => {
    expect(cmd.name()).toBe("quickstart");
  });

  it("has a description", () => {
    expect(cmd.description()).toBeTruthy();
  });

  it("supports --template option with default personal-assistant", () => {
    const opt = cmd.options.find((o) => o.long === "--template");
    expect(opt).toBeDefined();
    expect(opt?.defaultValue).toBe("personal-assistant");
  });

  it("supports --smart flag", () => {
    const opt = cmd.options.find((o) => o.long === "--smart");
    expect(opt).toBeDefined();
  });

  it("supports --skip-build flag", () => {
    const opt = cmd.options.find((o) => o.long === "--skip-build");
    expect(opt).toBeDefined();
  });

  it("supports --skip-deploy flag", () => {
    const opt = cmd.options.find((o) => o.long === "--skip-deploy");
    expect(opt).toBeDefined();
  });

  it("supports --home option with default ~/.openclaw", () => {
    const opt = cmd.options.find((o) => o.long === "--home");
    expect(opt).toBeDefined();
    expect(opt?.defaultValue).toBe("~/.openclaw");
  });

  it("supports --gateway-host option", () => {
    const opt = cmd.options.find((o) => o.long === "--gateway-host");
    expect(opt).toBeDefined();
    expect(opt?.defaultValue).toBe("127.0.0.1");
  });

  it("supports --gateway-port option", () => {
    const opt = cmd.options.find((o) => o.long === "--gateway-port");
    expect(opt).toBeDefined();
    expect(opt?.defaultValue).toBe("18789");
  });

  it("supports --health-timeout option", () => {
    const opt = cmd.options.find((o) => o.long === "--health-timeout");
    expect(opt).toBeDefined();
    expect(opt?.defaultValue).toBe("60000");
  });

  it("has all expected options", () => {
    const longFlags = cmd.options.map((o) => o.long);
    expect(longFlags).toContain("--template");
    expect(longFlags).toContain("--smart");
    expect(longFlags).toContain("--skip-build");
    expect(longFlags).toContain("--skip-deploy");
    expect(longFlags).toContain("--home");
    expect(longFlags).toContain("--context");
    expect(longFlags).toContain("--base-tag");
    expect(longFlags).toContain("--tag");
  });
});
