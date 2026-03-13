import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UpdateError } from "./types.js";
import { checkForUpdate, fetchLatestRelease, fetchReleasesSince } from "./version-check.js";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchLatestRelease", () => {
  it("returns release info from GitHub API", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: "v2.1.0",
        published_at: "2026-03-10T00:00:00Z",
        html_url: "https://github.com/openclaw/openclaw/releases/tag/v2.1.0",
      }),
    });

    const release = await fetchLatestRelease();

    expect(release.tag).toBe("v2.1.0");
    expect(release.version).toBe("2.1.0");
    expect(release.publishedAt).toBe("2026-03-10T00:00:00Z");
    expect(release.url).toContain("v2.1.0");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/repos/openclaw/openclaw/releases/latest"),
      expect.any(Object),
    );
  });

  it("uses custom repo", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: "v1.0.0",
        published_at: "2026-01-01T00:00:00Z",
        html_url: "https://example.com",
      }),
    });

    await fetchLatestRelease({ repo: "custom/repo" });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/repos/custom/repo/releases/latest"),
      expect.any(Object),
    );
  });

  it("throws on 404 (no releases)", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    await expect(fetchLatestRelease()).rejects.toThrow(UpdateError);
    await expect(fetchLatestRelease()).rejects.toThrow(/No releases found/);
  });

  it("throws on 403 (rate limited)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    await expect(fetchLatestRelease()).rejects.toThrow(/rate limit/i);
  });

  it("throws on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    await expect(fetchLatestRelease()).rejects.toThrow(/Cannot reach GitHub API/);
  });

  it("throws when release has no tag", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: "",
        published_at: "2026-01-01T00:00:00Z",
      }),
    });

    await expect(fetchLatestRelease()).rejects.toThrow(/no tag/i);
  });
});

describe("fetchReleasesSince", () => {
  it("returns releases newer than the given tag", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        { tag_name: "v2.1.0", published_at: "2026-03-10T00:00:00Z", html_url: "" },
        { tag_name: "v2.0.0", published_at: "2026-02-01T00:00:00Z", html_url: "" },
        { tag_name: "v1.9.0", published_at: "2026-01-15T00:00:00Z", html_url: "" },
      ],
    });

    const releases = await fetchReleasesSince("v2.0.0");

    expect(releases).toHaveLength(1);
    expect(releases[0].tag).toBe("v2.1.0");
  });

  it("returns empty array if already on latest", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        { tag_name: "v2.1.0", published_at: "2026-03-10T00:00:00Z", html_url: "" },
      ],
    });

    const releases = await fetchReleasesSince("v2.1.0");

    expect(releases).toHaveLength(0);
  });
});

describe("checkForUpdate", () => {
  it("reports update available when versions differ", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: "v2.1.0",
        published_at: "2026-03-10T00:00:00Z",
        html_url: "",
      }),
    });

    const result = await checkForUpdate("v1.0.0");

    expect(result.updateAvailable).toBe(true);
    expect(result.current).toBe("v1.0.0");
    expect(result.latest.tag).toBe("v2.1.0");
  });

  it("reports no update when already on latest", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: "v2.1.0",
        published_at: "2026-03-10T00:00:00Z",
        html_url: "",
      }),
    });

    const result = await checkForUpdate("v2.1.0");

    expect(result.updateAvailable).toBe(false);
  });
});
