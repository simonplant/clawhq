import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diffSnapshot, takeSnapshot, unclassifiedEntries } from "./snapshot.js";

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "clawhq-snapshot-test-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function write(rel: string, content: string) {
  const abs = join(testDir, rel);
  const dir = abs.slice(0, abs.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(abs, content);
}

describe("takeSnapshot", () => {
  it("captures every file with hash, size, and owner classification", async () => {
    write("workspace/SOUL.md", "identity content");
    write("workspace/MEMORY.md", "user notes");
    write("cron/jobs.json", '{"version":1,"jobs":[]}');
    write("random/unclassified.txt", "who owns me");

    const snap = await takeSnapshot(testDir);

    const paths = snap.entries.map((e) => e.path);
    expect(paths).toContain("workspace/SOUL.md");
    expect(paths).toContain("workspace/MEMORY.md");
    expect(paths).toContain("cron/jobs.json");
    expect(paths).toContain("random/unclassified.txt");

    const soul = snap.entries.find((e) => e.path === "workspace/SOUL.md")!;
    expect(soul.owner).toBe("clawhq");
    expect(soul.size).toBe("identity content".length);
    expect(soul.hash).toMatch(/^[a-f0-9]{64}$/);

    expect(snap.entries.find((e) => e.path === "workspace/MEMORY.md")?.owner).toBe("user");
    expect(snap.entries.find((e) => e.path === "cron/jobs.json")?.owner).toBe("merged");
    expect(snap.entries.find((e) => e.path === "random/unclassified.txt")?.owner).toBeNull();
  });

  it("sorts entries by path for deterministic output", async () => {
    write("z.txt", "z");
    write("a.txt", "a");
    write("m.txt", "m");

    const snap = await takeSnapshot(testDir);
    const paths = snap.entries.map((e) => e.path);
    expect(paths).toEqual([...paths].sort());
  });

  it("excludes default ephemeral prefixes (engine/source, media)", async () => {
    write("engine/source/package.json", "{}");
    write("media/video.mp4", "binary");
    write("workspace/SOUL.md", "kept");

    const snap = await takeSnapshot(testDir);
    const paths = snap.entries.map((e) => e.path);
    expect(paths).toContain("workspace/SOUL.md");
    expect(paths).not.toContain("engine/source/package.json");
    expect(paths).not.toContain("media/video.mp4");
  });

  it("honors custom excludePrefixes override", async () => {
    write("workspace/SOUL.md", "identity");
    write("cache/big.bin", "ephemeral");

    const snap = await takeSnapshot(testDir, { excludePrefixes: ["cache"] });
    const paths = snap.entries.map((e) => e.path);
    expect(paths).toContain("workspace/SOUL.md");
    expect(paths).not.toContain("cache/big.bin");
  });
});

describe("diffSnapshot", () => {
  it("detects added, removed, and modified files", async () => {
    write("a.txt", "original");
    write("b.txt", "to delete");
    const before = await takeSnapshot(testDir);

    writeFileSync(join(testDir, "a.txt"), "modified");
    rmSync(join(testDir, "b.txt"));
    write("c.txt", "fresh");
    const after = await takeSnapshot(testDir);

    const diff = diffSnapshot(before, after);
    const byKind = Object.fromEntries(
      diff.entries.map((e) => [e.path, e.kind] as const),
    );
    expect(byKind["a.txt"]).toBe("modified");
    expect(byKind["b.txt"]).toBe("removed");
    expect(byKind["c.txt"]).toBe("added");
  });

  it("groups diff counts by owner, labelling unclassified", async () => {
    const before = await takeSnapshot(testDir);

    write("workspace/SOUL.md", "x");           // clawhq
    write("workspace/MEMORY.md", "y");         // user
    write("random/unknown.txt", "z");          // unclassified
    const after = await takeSnapshot(testDir);

    const diff = diffSnapshot(before, after);
    expect(diff.byOwner["clawhq"]).toBe(1);
    expect(diff.byOwner["user"]).toBe(1);
    expect(diff.byOwner["unclassified"]).toBe(1);
  });

  it("reports empty diff when snapshots match", async () => {
    write("a.txt", "stable");
    const first = await takeSnapshot(testDir);
    const second = await takeSnapshot(testDir);

    const diff = diffSnapshot(first, second);
    expect(diff.entries).toHaveLength(0);
  });
});

describe("unclassifiedEntries", () => {
  it("returns only entries with null owner", async () => {
    write("workspace/SOUL.md", "classified");
    write("random/file.txt", "no rule");

    const snap = await takeSnapshot(testDir);
    const unclassified = unclassifiedEntries(snap);
    const paths = unclassified.map((e) => e.path);
    expect(paths).toContain("random/file.txt");
    expect(paths).not.toContain("workspace/SOUL.md");
  });
});
