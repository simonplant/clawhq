import { describe, expect, it } from "vitest";

import {
  phase,
  phaseLabel,
  status,
  statusIndicator,
  spinner,
  sectionHeader,
  formatError,
} from "./ui.js";

describe("phase labels", () => {
  it("returns colored strings for each phase", () => {
    expect(phase.plan).toContain("plan");
    expect(phase.build).toContain("build");
    expect(phase.secure).toContain("secure");
    expect(phase.deploy).toContain("deploy");
    expect(phase.operate).toContain("operate");
  });

  it("phaseLabel returns the matching label", () => {
    expect(phaseLabel("plan")).toBe(phase.plan);
    expect(phaseLabel("deploy")).toBe(phase.deploy);
  });
});

describe("status indicators", () => {
  it("returns colored symbols", () => {
    expect(status.pass).toContain("✔");
    expect(status.fail).toContain("✘");
    expect(status.warn).toContain("⚠");
  });

  it("statusIndicator returns the matching symbol", () => {
    expect(statusIndicator("pass")).toBe(status.pass);
    expect(statusIndicator("fail")).toBe(status.fail);
    expect(statusIndicator("warn")).toBe(status.warn);
  });
});

describe("spinner", () => {
  it("creates an ora spinner with given text", () => {
    const s = spinner("Loading...");
    expect(s).toBeDefined();
    expect(s.text).toBe("Loading...");
  });
});

describe("sectionHeader", () => {
  it("wraps title with blank lines", () => {
    const header = sectionHeader("Diagnostics");
    expect(header).toContain("Diagnostics");
    expect(header.startsWith("\n")).toBe(true);
    expect(header.endsWith("\n")).toBe(true);
  });
});

describe("formatError", () => {
  it("includes code and message", () => {
    const output = formatError("E001", "Docker not found");
    expect(output).toContain("E001");
    expect(output).toContain("Docker not found");
  });

  it("includes hint when provided", () => {
    const output = formatError("E002", "Port in use", "Try a different port");
    expect(output).toContain("Hint");
    expect(output).toContain("Try a different port");
  });

  it("omits hint line when not provided", () => {
    const output = formatError("E003", "Config invalid");
    expect(output).not.toContain("Hint");
  });
});
