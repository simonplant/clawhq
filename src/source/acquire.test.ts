import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  acquireSource,
  getSourceStatus,
  readStoredHash,
  resolveSourceConfig,
  VersionNotPinned,
  versionDir,
} from "./acquire.js";
import type { SourceConfig } from "./types.js";

// Mock child_process.execFile
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    // The last arg is the callback
    const cb = args[args.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void;
    const resolvedArgs = args.slice(0, -1);
    const result = mockExecFile(...resolvedArgs);
    if (result && typeof result.then === "function") {
      result.then(
        (r: { stdout: string; stderr: string }) => cb(null, r),
        (e: Error) => cb(e, { stdout: "", stderr: "" }),
      );
    } else {
      cb(null, result ?? { stdout: "", stderr: "" });
    }
  },
}));

describe("resolveSourceConfig", () => {
  it("returns defaults when no config provided", () => {
    const config = resolveSourceConfig();
    expect(config.repo).toBe("https://github.com/openclaw-ai/openclaw.git");
    expect(config.version).toBe("");
    expect(config.cacheDir).toContain("openclaw-source");
  });

  it("merges provided source config", () => {
    const config = resolveSourceConfig({
      source: {
        repo: "https://example.com/oc.git",
        version: "v1.0.0",
        cacheDir: "/tmp/cache",
      },
    });
    expect(config.repo).toBe("https://example.com/oc.git");
    expect(config.version).toBe("v1.0.0");
    expect(config.cacheDir).toBe("/tmp/cache");
  });
});

describe("versionDir", () => {
  it("returns cache dir joined with version", () => {
    expect(versionDir("/cache", "v1.0.0")).toBe(join("/cache", "v1.0.0"));
  });
});

describe("getSourceStatus", () => {
  let testDir: string;
  let config: SourceConfig;

  beforeEach(async () => {
    testDir = join(tmpdir(), `clawhq-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
    config = {
      repo: "https://example.com/openclaw.git",
      version: "v1.0.0",
      cacheDir: testDir,
    };
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("reports not cached when version dir is empty", async () => {
    const status = await getSourceStatus(config);
    expect(status.cached).toBe(false);
    expect(status.pinnedVersion).toBe("v1.0.0");
    expect(status.versionMatch).toBe(false);
  });

  it("reports cached with integrity ok when hash matches", async () => {
    const srcDir = versionDir(testDir, "v1.0.0");
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, "README.md"), "hello");

    // Mock git rev-parse to return a known hash
    const fakeHash = "abc123def456";
    mockExecFile.mockResolvedValue({ stdout: fakeHash + "\n", stderr: "" });

    // Write stored hash
    await writeFile(join(testDir, "v1.0.0.sha256"), fakeHash + "\n");

    const status = await getSourceStatus(config);
    expect(status.cached).toBe(true);
    expect(status.integrityOk).toBe(true);
    expect(status.treeHash).toBe(fakeHash);
  });

  it("reports integrity failure when hash mismatches", async () => {
    const srcDir = versionDir(testDir, "v1.0.0");
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, "README.md"), "hello");

    mockExecFile.mockResolvedValue({ stdout: "currenthash\n", stderr: "" });

    // Write a different stored hash
    await writeFile(join(testDir, "v1.0.0.sha256"), "oldhash\n");

    const status = await getSourceStatus(config);
    expect(status.cached).toBe(true);
    expect(status.integrityOk).toBe(false);
  });
});

describe("readStoredHash", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `clawhq-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("returns null when no hash file exists", async () => {
    const hash = await readStoredHash(testDir, "v1.0.0");
    expect(hash).toBeNull();
  });

  it("returns stored hash content", async () => {
    await writeFile(join(testDir, "v1.0.0.sha256"), "abc123\n");
    const hash = await readStoredHash(testDir, "v1.0.0");
    expect(hash).toBe("abc123");
  });
});

describe("acquireSource", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `clawhq-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
    mockExecFile.mockReset();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("throws VersionNotPinned when no version set", async () => {
    const config: SourceConfig = {
      repo: "https://example.com/oc.git",
      version: "",
      cacheDir: testDir,
    };

    await expect(acquireSource(config)).rejects.toThrow(VersionNotPinned);
  });

  it("returns cache hit when source is cached and verified", async () => {
    const config: SourceConfig = {
      repo: "https://example.com/oc.git",
      version: "v1.0.0",
      cacheDir: testDir,
    };

    // Set up cached source
    const srcDir = versionDir(testDir, "v1.0.0");
    await mkdir(srcDir, { recursive: true });
    await writeFile(join(srcDir, "package.json"), "{}");

    const fakeHash = "cached123";
    mockExecFile.mockResolvedValue({ stdout: fakeHash + "\n", stderr: "" });
    await writeFile(join(testDir, "v1.0.0.sha256"), fakeHash + "\n");

    const result = await acquireSource(config);
    expect(result.cacheHit).toBe(true);
    expect(result.success).toBe(true);
    expect(result.version).toBe("v1.0.0");
  });

  it("clones fresh when cache is empty", async () => {
    const config: SourceConfig = {
      repo: "https://example.com/oc.git",
      version: "v1.0.0",
      cacheDir: testDir,
    };

    // Mock git clone (creates the directory) and git rev-parse
    mockExecFile.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "git" && args[0] === "clone") {
        // Simulate clone by creating the target dir with a file
        const targetDir = args[args.length - 1] as string;
        await mkdir(targetDir, { recursive: true });
        await writeFile(join(targetDir, "package.json"), "{}");
        return { stdout: "", stderr: "" };
      }
      if (cmd === "git" && args[0] === "rev-parse") {
        return { stdout: "newhash123\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    });

    const result = await acquireSource(config);
    expect(result.cacheHit).toBe(false);
    expect(result.success).toBe(true);
    expect(result.treeHash).toBe("newhash123");
  });
});
