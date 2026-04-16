import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SmartInferenceAbortError,
  WizardAbortError,
  ConfigFileError,
} from "../../design/configure/index.js";
import { CommandError } from "../errors.js";

import {
  applyEnsureFreshResult,
  ensureFreshOrReset,
  translateInitError,
} from "./init-run.js";

let sandbox: string;
let deployDir: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "clawhq-init-run-test-"));
  deployDir = join(sandbox, ".clawhq");
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("ensureFreshOrReset", () => {
  it("returns fresh when deployDir does not exist", () => {
    expect(ensureFreshOrReset(deployDir, false)).toEqual({ kind: "fresh" });
    expect(ensureFreshOrReset(deployDir, true)).toEqual({ kind: "fresh" });
  });

  it("returns fresh when deployDir exists but has no clawhq.yaml", () => {
    mkdirSync(deployDir, { recursive: true });
    expect(ensureFreshOrReset(deployDir, false)).toEqual({ kind: "fresh" });
  });

  it("returns refused when deployment exists and reset is false", () => {
    mkdirSync(deployDir, { recursive: true });
    writeFileSync(join(deployDir, "clawhq.yaml"), "version: 0.2.0\n");
    expect(ensureFreshOrReset(deployDir, false)).toEqual({ kind: "refused" });
    // Refused is non-destructive — deployDir must be untouched.
    expect(existsSync(join(deployDir, "clawhq.yaml"))).toBe(true);
  });

  it("archives when deployment exists and reset is true", () => {
    mkdirSync(deployDir, { recursive: true });
    writeFileSync(join(deployDir, "clawhq.yaml"), "version: 0.2.0\n");
    writeFileSync(join(deployDir, "marker.txt"), "payload");

    const result = ensureFreshOrReset(deployDir, true);

    expect(result.kind).toBe("archived");
    if (result.kind !== "archived") throw new Error("unreachable");
    expect(existsSync(deployDir)).toBe(false);
    expect(existsSync(result.archivePath)).toBe(true);
    expect(result.archivePath).toMatch(/\.attic\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });
});

describe("applyEnsureFreshResult", () => {
  it("returns silently on fresh", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => applyEnsureFreshResult({ kind: "fresh" }, deployDir)).not.toThrow();
    expect(log).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });

  it("prints archive notice on archived", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    applyEnsureFreshResult(
      { kind: "archived", archivePath: "/tmp/foo.attic.2026-01-01T00-00-00" },
      deployDir,
    );
    const output = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toMatch(/archived/);
    expect(output).toMatch(/foo\.attic/);
  });

  it("throws CommandError(exit=1) on refused and prints recovery hints", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => applyEnsureFreshResult({ kind: "refused" }, deployDir))
      .toThrow(CommandError);
    try {
      applyEnsureFreshResult({ kind: "refused" }, deployDir);
    } catch (e) {
      expect(e).toBeInstanceOf(CommandError);
      expect((e as CommandError).exitCode).toBe(1);
    }
    const output = err.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toMatch(/clawhq apply/);
    expect(output).toMatch(/--reset/);
  });
});

describe("translateInitError", () => {
  it("passes CommandError through unchanged", () => {
    const original = new CommandError("x", 7);
    const result = translateInitError(original);
    expect(result).toBe(original);
  });

  it("maps WizardAbortError to exit 0", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const result = translateInitError(new WizardAbortError("cancelled"));
    expect(result).toBeInstanceOf(CommandError);
    expect(result.exitCode).toBe(0);
  });

  it("maps SmartInferenceAbortError to exit 0", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const result = translateInitError(new SmartInferenceAbortError("cancelled"));
    expect(result.exitCode).toBe(0);
  });

  it("maps inquirer ExitPromptError (by name) to exit 0", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const ctrlC = Object.assign(new Error("User force closed the prompt"), {
      name: "ExitPromptError",
    });
    const result = translateInitError(ctrlC);
    expect(result.exitCode).toBe(0);
  });

  it("maps ConfigFileError to exit 1 with red message", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = translateInitError(new ConfigFileError("bad yaml"));
    expect(result.exitCode).toBe(1);
    const output = err.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toMatch(/bad yaml/);
  });

  it("falls through to renderError + exit 1 for unknown errors", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = translateInitError(new Error("something weird"));
    expect(result.exitCode).toBe(1);
    expect(err).toHaveBeenCalled();
  });
});
