import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  inferCategory,
  readMetadata,
  removeSecretMetadata,
  setSecretMetadata,
  writeMetadata,
} from "./metadata.js";
import type { MetadataFile } from "./types.js";

describe("inferCategory", () => {
  it("detects AI providers", () => {
    expect(inferCategory("ANTHROPIC_API_KEY")).toBe("ai");
    expect(inferCategory("OPENAI_API_KEY")).toBe("ai");
    expect(inferCategory("OLLAMA_HOST")).toBe("ai");
  });

  it("detects messaging providers", () => {
    expect(inferCategory("TELEGRAM_BOT_TOKEN")).toBe("messaging");
    expect(inferCategory("WHATSAPP_TOKEN")).toBe("messaging");
    expect(inferCategory("SLACK_BOT_TOKEN")).toBe("messaging");
    expect(inferCategory("DISCORD_TOKEN")).toBe("messaging");
  });

  it("detects email", () => {
    expect(inferCategory("SMTP_PASSWORD")).toBe("email");
    expect(inferCategory("IMAP_PASSWORD")).toBe("email");
  });

  it("detects calendar", () => {
    expect(inferCategory("CALDAV_PASSWORD")).toBe("calendar");
  });

  it("detects tasks", () => {
    expect(inferCategory("TODOIST_API_KEY")).toBe("tasks");
  });

  it("detects dev tools", () => {
    expect(inferCategory("GITHUB_TOKEN")).toBe("dev");
    expect(inferCategory("LINEAR_API_KEY")).toBe("dev");
  });

  it("detects cloud providers", () => {
    expect(inferCategory("AWS_SECRET_KEY")).toBe("cloud");
  });

  it("detects generic API keys", () => {
    expect(inferCategory("SOME_API_KEY")).toBe("api");
    expect(inferCategory("MY_TOKEN")).toBe("api");
  });

  it("returns other for unknown patterns", () => {
    expect(inferCategory("DATABASE_URL")).toBe("other");
    expect(inferCategory("PORT")).toBe("other");
  });
});

describe("readMetadata", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "meta-test-"));
  });

  it("returns empty object for non-existent file", async () => {
    const result = await readMetadata(join(tmpDir, ".env.meta"));
    expect(result).toEqual({});
  });

  it("reads valid metadata file", async () => {
    const metaPath = join(tmpDir, ".env.meta");
    const data: MetadataFile = {
      MY_KEY: {
        created_at: "2026-01-01T00:00:00.000Z",
        rotated_at: null,
        provider_category: "api",
      },
    };
    await writeFile(metaPath, JSON.stringify(data));

    const result = await readMetadata(metaPath);
    expect(result).toEqual(data);
  });
});

describe("writeMetadata", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "meta-test-"));
  });

  it("writes metadata with 600 permissions", async () => {
    const metaPath = join(tmpDir, ".env.meta");
    const data: MetadataFile = {
      TEST_KEY: {
        created_at: "2026-01-01T00:00:00.000Z",
        rotated_at: null,
        provider_category: "api",
      },
    };

    await writeMetadata(metaPath, data);

    const content = await readFile(metaPath, "utf-8");
    expect(JSON.parse(content)).toEqual(data);

    const s = await stat(metaPath);
    expect(s.mode & 0o777).toBe(0o600);
  });
});

describe("setSecretMetadata", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "meta-test-"));
  });

  it("creates metadata for new secret", async () => {
    const metaPath = join(tmpDir, ".env.meta");
    const result = await setSecretMetadata(metaPath, "ANTHROPIC_API_KEY");

    expect(result.provider_category).toBe("ai");
    expect(result.created_at).toBeTruthy();
    expect(result.rotated_at).toBeNull();
  });

  it("updates rotated_at for existing secret", async () => {
    const metaPath = join(tmpDir, ".env.meta");

    // First write
    await setSecretMetadata(metaPath, "MY_KEY");
    const metadata = await readMetadata(metaPath);
    const originalCreated = metadata.MY_KEY.created_at;

    // Second write (rotation)
    const result = await setSecretMetadata(metaPath, "MY_KEY");

    expect(result.created_at).toBe(originalCreated);
    expect(result.rotated_at).toBeTruthy();
  });

  it("respects explicit category override", async () => {
    const metaPath = join(tmpDir, ".env.meta");
    const result = await setSecretMetadata(metaPath, "MY_CUSTOM", "custom-cat");
    expect(result.provider_category).toBe("custom-cat");
  });
});

describe("removeSecretMetadata", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "meta-test-"));
  });

  it("removes existing metadata", async () => {
    const metaPath = join(tmpDir, ".env.meta");
    await setSecretMetadata(metaPath, "MY_KEY");
    const removed = await removeSecretMetadata(metaPath, "MY_KEY");
    expect(removed).toBe(true);

    const meta = await readMetadata(metaPath);
    expect(meta.MY_KEY).toBeUndefined();
  });

  it("returns false for non-existent key", async () => {
    const metaPath = join(tmpDir, ".env.meta");
    const removed = await removeSecretMetadata(metaPath, "MISSING");
    expect(removed).toBe(false);
  });
});
