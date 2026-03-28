/**
 * Tests for per-instance Docker resource name derivation (FEAT-110).
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getInstanceNames } from "./instance.js";
import { DEFAULT_DEPLOY_DIR } from "../../config/paths.js";

describe("getInstanceNames", () => {
  // ── Slug derivation ──────────────────────────────────────────────────────

  it("default deploy dir → slug 'default'", () => {
    const names = getInstanceNames(DEFAULT_DEPLOY_DIR);
    expect(names.slug).toBe("default");
  });

  it("tilde-expanded default deploy dir → slug 'default'", () => {
    // Some callers may expand ~ themselves
    const expanded = join(homedir(), ".clawhq");
    const names = getInstanceNames(expanded);
    expect(names.slug).toBe("default");
  });

  it("named directory → slug from basename", () => {
    const names = getInstanceNames(join(homedir(), ".clawhq-work"));
    expect(names.slug).toBe("clawhq_work");
  });

  it("camelCase name is lowercased", () => {
    const names = getInstanceNames("/opt/agents/AliceBot");
    expect(names.slug).toBe("alicebot");
  });

  it("special chars are replaced with underscore", () => {
    const names = getInstanceNames("/opt/agents/my.agent-v2");
    expect(names.slug).toBe("my_agent_v2");
  });

  it("consecutive special chars collapse to single underscore", () => {
    const names = getInstanceNames("/opt/agents/my---agent");
    expect(names.slug).toBe("my_agent");
  });

  it("leading/trailing underscores are stripped", () => {
    const names = getInstanceNames("/opt/agents/_internal_");
    expect(names.slug).toBe("internal");
  });

  it("slug is truncated to 32 chars", () => {
    const long = "a".repeat(40);
    const names = getInstanceNames(`/opt/agents/${long}`);
    expect(names.slug.length).toBeLessThanOrEqual(32);
  });

  it("empty basename falls back to 'default'", () => {
    // Simulate a path that normalises to an empty basename
    const names = getInstanceNames("/");
    expect(names.slug).toBe("default");
  });

  // ── Resource name derivation ─────────────────────────────────────────────

  it("default instance → expected resource names", () => {
    const names = getInstanceNames(DEFAULT_DEPLOY_DIR);
    expect(names.networkName).toBe("clawhq_default_net");
    expect(names.projectName).toBe("clawhq_default");
    expect(names.containerName).toBe("clawhq_default_openclaw");
    expect(names.stage1Tag).toBe("openclaw:local_default");
    expect(names.stage2Tag).toBe("openclaw:custom_default");
  });

  it("named instance → expected resource names", () => {
    const names = getInstanceNames("/opt/agents/alice");
    expect(names.networkName).toBe("clawhq_alice_net");
    expect(names.projectName).toBe("clawhq_alice");
    expect(names.containerName).toBe("clawhq_alice_openclaw");
    expect(names.stage1Tag).toBe("openclaw:local_alice");
    expect(names.stage2Tag).toBe("openclaw:custom_alice");
  });

  // ── Isolation guarantee ──────────────────────────────────────────────────

  it("two different deploy dirs produce different networks", () => {
    const a = getInstanceNames(join(homedir(), ".clawhq"));
    const b = getInstanceNames(join(homedir(), ".clawhq-work"));
    expect(a.networkName).not.toBe(b.networkName);
    expect(a.containerName).not.toBe(b.containerName);
    expect(a.stage2Tag).not.toBe(b.stage2Tag);
  });

  it("same deploy dir always returns same names (idempotent)", () => {
    const dir = join(homedir(), ".clawhq");
    expect(getInstanceNames(dir)).toEqual(getInstanceNames(dir));
  });
});
