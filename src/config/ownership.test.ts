import { describe, expect, it } from "vitest";

import { classify, classifyRule, OWNERSHIP_RULES } from "./ownership.js";

describe("classify", () => {
  it("returns null for paths with no rule", () => {
    expect(classify("some/totally/unknown/path.txt")).toBeNull();
    expect(classify("nope")).toBeNull();
  });

  it("classifies identity files as clawhq-owned", () => {
    expect(classify("workspace/SOUL.md")).toBe("clawhq");
    expect(classify("workspace/AGENTS.md")).toBe("clawhq");
    expect(classify("workspace/BOOTSTRAP.md")).toBe("clawhq");
    expect(classify("workspace/IDENTITY.md")).toBe("clawhq");
    expect(classify("workspace/TOOLS.md")).toBe("clawhq");
    expect(classify("workspace/HEARTBEAT.md")).toBe("clawhq");
  });

  it("classifies USER.md as seeded-once (roundtripped by apply)", () => {
    expect(classify("workspace/USER.md")).toBe("seeded-once");
  });

  it("classifies user memory as user-owned", () => {
    expect(classify("workspace/MEMORY.md")).toBe("user");
    expect(classify("workspace/memory/2026-04-16.md")).toBe("user");
    expect(classify("workspace/memory/nested/dir/note.md")).toBe("user");
  });

  it("classifies credentials.json as seeded-once (per Phase 0 fix)", () => {
    expect(classify("engine/credentials.json")).toBe("seeded-once");
  });

  it("classifies cron/jobs.json as merged", () => {
    expect(classify("cron/jobs.json")).toBe("merged");
  });

  it("classifies compose + Dockerfile as build-owned", () => {
    expect(classify("engine/docker-compose.yml")).toBe("build");
    expect(classify("engine/Dockerfile")).toBe("build");
    expect(classify("engine/build-manifest.json")).toBe("build");
  });

  it("classifies openclaw runtime state under agents/ and delivery-queue/", () => {
    expect(classify("agents/main/sessions/sessions.json")).toBe("openclaw");
    expect(classify("delivery-queue/failed/abc.json")).toBe("openclaw");
    expect(classify("devices/paired.json")).toBe("openclaw");
    expect(classify("credentials/telegram-pairing.json")).toBe("openclaw");
  });

  it("classifies cron/runs/* as openclaw-owned (execution logs)", () => {
    expect(classify("cron/runs/heartbeat.jsonl")).toBe("openclaw");
  });

  it("matches directory prefix patterns on the prefix itself", () => {
    expect(classify("ops/audit")).toBe("clawhq");
  });

  it("classifyRule returns the reason string for drift reports", () => {
    const rule = classifyRule("workspace/SOUL.md");
    expect(rule?.owner).toBe("clawhq");
    expect(rule?.reason).toMatch(/identity/i);
  });

  it("has no duplicate exact-path rules", () => {
    const exact = OWNERSHIP_RULES
      .filter((r) => !r.pattern.endsWith("/**"))
      .map((r) => r.pattern);
    expect(new Set(exact).size).toBe(exact.length);
  });
});
