import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchChangelog, formatChangelog, hasBreakingChanges } from "./changelog.js";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hasBreakingChanges", () => {
  it("detects 'BREAKING CHANGE' marker", () => {
    expect(hasBreakingChanges("This is a BREAKING CHANGE")).toBe(true);
  });

  it("detects 'breaking change' case-insensitive", () => {
    expect(hasBreakingChanges("This has a breaking change")).toBe(true);
  });

  it("detects warning emoji", () => {
    expect(hasBreakingChanges("⚠️ Config schema changed")).toBe(true);
  });

  it("detects 'removed' keyword", () => {
    expect(hasBreakingChanges("Removed deprecated API endpoint")).toBe(true);
  });

  it("detects 'renamed' keyword", () => {
    expect(hasBreakingChanges("Renamed config field from foo to bar")).toBe(true);
  });

  it("returns false for normal release notes", () => {
    expect(hasBreakingChanges("Fixed a bug in the parser")).toBe(false);
    expect(hasBreakingChanges("Added new feature")).toBe(false);
    expect(hasBreakingChanges("Performance improvements")).toBe(false);
  });

  it("returns false for empty body", () => {
    expect(hasBreakingChanges("")).toBe(false);
  });
});

describe("fetchChangelog", () => {
  it("returns entries between current and latest", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        { tag_name: "v2.1.0", published_at: "2026-03-10", body: "New features" },
        { tag_name: "v2.0.0", published_at: "2026-02-01", body: "BREAKING CHANGE: new config format" },
        { tag_name: "v1.9.0", published_at: "2026-01-15", body: "Bug fixes" },
      ],
    });

    const result = await fetchChangelog("v1.9.0");

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].tag).toBe("v2.1.0");
    expect(result.entries[0].breaking).toBe(false);
    expect(result.entries[1].tag).toBe("v2.0.0");
    expect(result.entries[1].breaking).toBe(true);
    expect(result.hasBreaking).toBe(true);
  });

  it("returns empty entries when already on latest", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        { tag_name: "v2.1.0", published_at: "2026-03-10", body: "New features" },
      ],
    });

    const result = await fetchChangelog("v2.1.0");

    expect(result.entries).toHaveLength(0);
    expect(result.hasBreaking).toBe(false);
  });

  it("strips v prefix from version", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        { tag_name: "v3.0.0", published_at: "2026-04-01", body: "Major" },
        { tag_name: "v2.0.0", published_at: "2026-03-01", body: "Old" },
      ],
    });

    const result = await fetchChangelog("v2.0.0");

    expect(result.entries[0].version).toBe("3.0.0");
  });
});

describe("formatChangelog", () => {
  it("formats entries with tags and dates", () => {
    const output = formatChangelog({
      entries: [
        { tag: "v2.1.0", version: "2.1.0", date: "2026-03-10T00:00:00Z", body: "New features", breaking: false },
        { tag: "v2.0.0", version: "2.0.0", date: "2026-02-01T00:00:00Z", body: "Major release", breaking: false },
      ],
      hasBreaking: false,
    });

    expect(output).toContain("v2.1.0");
    expect(output).toContain("2026-03-10");
    expect(output).toContain("New features");
    expect(output).toContain("v2.0.0");
  });

  it("shows warning for breaking changes", () => {
    const output = formatChangelog({
      entries: [
        { tag: "v2.0.0", version: "2.0.0", date: "2026-02-01T00:00:00Z", body: "BREAKING", breaking: true },
      ],
      hasBreaking: true,
    });

    expect(output).toContain("WARNING");
    expect(output).toContain("[BREAKING]");
  });

  it("handles empty entries", () => {
    const output = formatChangelog({ entries: [], hasBreaking: false });
    expect(output).toContain("No changelog entries");
  });

  it("handles entries with empty body", () => {
    const output = formatChangelog({
      entries: [
        { tag: "v1.0.0", version: "1.0.0", date: "", body: "", breaking: false },
      ],
      hasBreaking: false,
    });

    expect(output).toContain("no release notes");
  });
});
