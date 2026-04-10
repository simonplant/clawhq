import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { apply, parseUserMd } from "./index.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "clawhq-apply-test-"));
  // Scaffold minimal deploy directory
  await mkdir(join(testDir, "engine"), { recursive: true });
  await mkdir(join(testDir, "workspace"), { recursive: true });
  await mkdir(join(testDir, "cron"), { recursive: true });
  await mkdir(join(testDir, "ops", "firewall"), { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// ── parseUserMd ─────────────────────────────────────────────────────────────

describe("parseUserMd", () => {
  it("parses standard USER.md format", () => {
    const content = `# About You

**Name:** Simon
**Timezone:** America/Los_Angeles
**Communication preference:** brief
`;
    const user = parseUserMd(content);
    expect(user.name).toBe("Simon");
    expect(user.timezone).toBe("America/Los_Angeles");
    expect(user.communication).toBe("brief");
    expect(user.constraints).toBeUndefined();
  });

  it("parses USER.md with constraints", () => {
    const content = `# About You

**Name:** Alice
**Timezone:** Europe/London
**Communication preference:** detailed

## Constraints

No meetings before 10am.
Prefer async communication.
`;
    const user = parseUserMd(content);
    expect(user.name).toBe("Alice");
    expect(user.timezone).toBe("Europe/London");
    expect(user.communication).toBe("detailed");
    expect(user.constraints).toContain("No meetings before 10am");
  });

  it("defaults to brief for unknown communication style", () => {
    const content = `**Name:** Bob\n**Communication preference:** unknown`;
    const user = parseUserMd(content);
    expect(user.communication).toBe("brief");
  });

  it("defaults name to User when missing", () => {
    const user = parseUserMd("");
    expect(user.name).toBe("User");
  });

  it("handles conversational communication preference", () => {
    const content = `**Name:** Carol\n**Communication preference:** conversational`;
    const user = parseUserMd(content);
    expect(user.communication).toBe("conversational");
  });
});

// ── apply ───────────────────────────────────────────────────────────────────

describe("apply", () => {
  it("fails when clawhq.yaml is missing", async () => {
    const result = await apply({ deployDir: testDir });
    expect(result.success).toBe(false);
    expect(result.error).toContain("clawhq.yaml not found");
  });

  it("fails when composition is missing from clawhq.yaml", async () => {
    await writeFile(join(testDir, "clawhq.yaml"), "version: 0.2.0\n");
    const result = await apply({ deployDir: testDir });
    expect(result.success).toBe(false);
    expect(result.error).toContain("composition.profile");
  });

  it("compiles and writes files from valid clawhq.yaml", async () => {
    await writeFile(join(testDir, "clawhq.yaml"), `
version: 0.2.0
composition:
  profile: life-ops
  personality: digital-assistant
`);
    // Write a USER.md so it doesn't use defaults
    await writeFile(join(testDir, "workspace", "USER.md"), `# About You

**Name:** TestUser
**Timezone:** UTC
**Communication preference:** brief
`);

    const result = await apply({ deployDir: testDir });
    expect(result.success).toBe(true);
    expect(result.report.added.length + result.report.changed.length).toBeGreaterThan(0);

    // Verify key files were written
    const soulMd = await readFile(join(testDir, "workspace", "SOUL.md"), "utf-8");
    expect(soulMd).toContain("Digital Assistant");

    const agentsMd = await readFile(join(testDir, "workspace", "AGENTS.md"), "utf-8");
    expect(agentsMd.length).toBeGreaterThan(0);
  });

  it("preserves MEMORY.md (stateful file)", async () => {
    const memoryContent = "# My important memories\n\nDo not delete me.\n";
    await writeFile(join(testDir, "workspace", "MEMORY.md"), memoryContent);
    await writeFile(join(testDir, "clawhq.yaml"), `
version: 0.2.0
composition:
  profile: life-ops
  personality: digital-assistant
`);

    const result = await apply({ deployDir: testDir });
    expect(result.success).toBe(true);
    expect(result.report.skipped).toContain("workspace/MEMORY.md");

    // Verify MEMORY.md was not overwritten
    const preserved = await readFile(join(testDir, "workspace", "MEMORY.md"), "utf-8");
    expect(preserved).toBe(memoryContent);
  });

  it("preserves existing .env credentials", async () => {
    // Pre-populate .env with a real credential
    await writeFile(join(testDir, ".env"), "OPENCLAW_GATEWAY_TOKEN=real-secret-token-123\nTAVILY_API_KEY=tavily-key-456\n");
    await writeFile(join(testDir, "engine", ".env"), "OPENCLAW_GATEWAY_TOKEN=real-secret-token-123\nTAVILY_API_KEY=tavily-key-456\n");
    await writeFile(join(testDir, "clawhq.yaml"), `
version: 0.2.0
composition:
  profile: life-ops
  personality: digital-assistant
  providers:
    search: tavily
`);

    const result = await apply({ deployDir: testDir });
    expect(result.success).toBe(true);

    // Verify the gateway token was preserved (not replaced with a fresh random one)
    const envContent = await readFile(join(testDir, ".env"), "utf-8");
    expect(envContent).toContain("real-secret-token-123");
  });

  it("dry-run does not write files", async () => {
    await writeFile(join(testDir, "clawhq.yaml"), `
version: 0.2.0
composition:
  profile: life-ops
  personality: digital-assistant
`);

    const result = await apply({ deployDir: testDir, dryRun: true });
    expect(result.success).toBe(true);
    expect(result.report.added.length).toBeGreaterThan(0);

    // SOUL.md should NOT exist since we didn't write
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(testDir, "workspace", "SOUL.md"))).toBe(false);
  });

  it("is idempotent — second run reports all unchanged", async () => {
    await writeFile(join(testDir, "clawhq.yaml"), `
version: 0.2.0
composition:
  profile: life-ops
  personality: digital-assistant
`);

    // First run
    const first = await apply({ deployDir: testDir });
    expect(first.success).toBe(true);

    // Second run
    const second = await apply({ deployDir: testDir });
    expect(second.success).toBe(true);
    expect(second.report.added).toHaveLength(0);
    // .env files always show as "changed" because generated content has CHANGE_ME
    // placeholders while disk has real values — the merge resolves this but the
    // pre-merge diff sees a difference. All non-.env files should be unchanged.
    const nonEnvChanged = second.report.changed.filter((f) => !f.endsWith(".env"));
    expect(nonEnvChanged).toHaveLength(0);
    expect(second.report.unchanged.length).toBeGreaterThan(0);
  });
});
