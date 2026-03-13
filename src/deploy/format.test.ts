import { describe, expect, it } from "vitest";

import { formatStepResult, formatSummary, formatPreflightFailures } from "./format.js";
import type { StepResult } from "./types.js";

describe("formatStepResult", () => {
  it("formats a successful step", () => {
    const step: StepResult = {
      name: "Docker daemon",
      status: "done",
      message: "Docker is running",
      durationMs: 150,
    };
    const output = formatStepResult(1, 4, step);
    expect(output).toContain("[1/4]");
    expect(output).toContain("OK");
    expect(output).toContain("Docker daemon");
    expect(output).toContain("150ms");
  });

  it("formats duration in seconds when >= 1000ms", () => {
    const step: StepResult = {
      name: "Health poll",
      status: "done",
      message: "Healthy",
      durationMs: 3500,
    };
    const output = formatStepResult(3, 4, step);
    expect(output).toContain("3.5s");
  });

  it("formats a failed step", () => {
    const step: StepResult = {
      name: "Config validation",
      status: "failed",
      message: "Validation failed",
      durationMs: 50,
    };
    const output = formatStepResult(2, 4, step);
    expect(output).toContain("FAIL");
  });
});

describe("formatSummary", () => {
  it("shows success message", () => {
    const steps: StepResult[] = [
      { name: "Step 1", status: "done", message: "OK", durationMs: 100 },
      { name: "Step 2", status: "done", message: "OK", durationMs: 200 },
    ];
    const output = formatSummary("Deployment", steps, true);
    expect(output).toContain("completed successfully");
    expect(output).toContain("300ms");
  });

  it("shows failure message with details", () => {
    const steps: StepResult[] = [
      { name: "Step 1", status: "done", message: "OK", durationMs: 100 },
      { name: "Step 2", status: "failed", message: "Port in use", durationMs: 50 },
    ];
    const output = formatSummary("Deployment", steps, false);
    expect(output).toContain("failed");
    expect(output).toContain("1 error");
    expect(output).toContain("Port in use");
  });
});

describe("formatPreflightFailures", () => {
  it("shows nothing when all pass", () => {
    const steps: StepResult[] = [
      { name: "Docker", status: "done", message: "OK", durationMs: 10 },
    ];
    expect(formatPreflightFailures(steps)).toBe("");
  });

  it("lists failed checks with messages", () => {
    const steps: StepResult[] = [
      { name: "Docker", status: "done", message: "OK", durationMs: 10 },
      { name: "Images", status: "failed", message: "Missing openclaw:custom", durationMs: 10 },
      { name: "Config", status: "failed", message: "LM-01 failed", durationMs: 10 },
    ];
    const output = formatPreflightFailures(steps);
    expect(output).toContain("Pre-flight checks failed");
    expect(output).toContain("Missing openclaw:custom");
    expect(output).toContain("LM-01 failed");
    expect(output).toContain("Deployment aborted");
  });
});
