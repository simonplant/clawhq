import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkFirstRun, markFirstRunComplete } from "./first-run.js";

describe("markFirstRunComplete", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `first-run-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes state.json with firstRunComplete=true", async () => {
    await markFirstRunComplete(tmpDir);
    const raw = await readFile(join(tmpDir, "state.json"), "utf-8");
    const state = JSON.parse(raw);
    expect(state.firstRunComplete).toBe(true);
  });

  it("creates parent directories if missing", async () => {
    const nested = join(tmpDir, "sub", "dir");
    await markFirstRunComplete(nested);
    expect(existsSync(join(nested, "state.json"))).toBe(true);
  });
});

describe("checkFirstRun", () => {
  let tmpClawhq: string;
  let tmpOpenclaw: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    const base = join(tmpdir(), `first-run-hook-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tmpClawhq = join(base, "clawhq");
    tmpOpenclaw = join(base, "openclaw");
    await mkdir(tmpClawhq, { recursive: true });
    await mkdir(tmpOpenclaw, { recursive: true });
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // Ensure TTY for tests
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true, configurable: true });
    delete process.env.CI;
  });

  afterEach(async () => {
    consoleSpy.mockRestore();
    process.env = { ...originalEnv };
    await rm(tmpClawhq, { recursive: true, force: true }).catch(() => {});
    await rm(tmpOpenclaw, { recursive: true, force: true }).catch(() => {});
  });

  function createProgram(opts: { clawhqDir: string; openclawHome: string }): Command {
    const program = new Command();
    program.command("doctor").action(() => {});
    program.command("init").action(() => {});
    program.command("quickstart").action(() => {});
    checkFirstRun(program, opts);
    return program;
  }

  it("prints hint when no openclaw.json and firstRunComplete=false", async () => {
    const program = createProgram({ clawhqDir: tmpClawhq, openclawHome: tmpOpenclaw });
    await program.parseAsync(["node", "clawhq", "doctor"]);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("clawhq quickstart"));
  });

  it("does not print hint when openclaw.json exists", async () => {
    await writeFile(join(tmpOpenclaw, "openclaw.json"), "{}", "utf-8");
    const program = createProgram({ clawhqDir: tmpClawhq, openclawHome: tmpOpenclaw });
    await program.parseAsync(["node", "clawhq", "doctor"]);
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining("clawhq quickstart"));
  });

  it("does not print hint when firstRunComplete=true", async () => {
    await markFirstRunComplete(tmpClawhq);
    const program = createProgram({ clawhqDir: tmpClawhq, openclawHome: tmpOpenclaw });
    await program.parseAsync(["node", "clawhq", "doctor"]);
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining("clawhq quickstart"));
  });

  it("does not print hint for init command", async () => {
    const program = createProgram({ clawhqDir: tmpClawhq, openclawHome: tmpOpenclaw });
    await program.parseAsync(["node", "clawhq", "init"]);
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining("clawhq quickstart"));
  });

  it("does not print hint for quickstart command", async () => {
    const program = createProgram({ clawhqDir: tmpClawhq, openclawHome: tmpOpenclaw });
    await program.parseAsync(["node", "clawhq", "quickstart"]);
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining("clawhq quickstart"));
  });

  it("does not print hint in CI environment", async () => {
    process.env.CI = "true";
    const program = createProgram({ clawhqDir: tmpClawhq, openclawHome: tmpOpenclaw });
    await program.parseAsync(["node", "clawhq", "doctor"]);
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining("clawhq quickstart"));
  });

  it("does not print hint in non-TTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, writable: true, configurable: true });
    const program = createProgram({ clawhqDir: tmpClawhq, openclawHome: tmpOpenclaw });
    await program.parseAsync(["node", "clawhq", "doctor"]);
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining("clawhq quickstart"));
  });
});
