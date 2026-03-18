import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discoverAgents } from "./discovery.js";

describe("discoverAgents", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `fleet-discovery-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("returns empty array when config does not exist", async () => {
    const agents = await discoverAgents({
      openclawHome: join(testDir, "nonexistent"),
    });

    expect(agents).toEqual([]);
  });

  it("returns single default agent for single-agent deployment", async () => {
    await writeFile(
      join(testDir, "openclaw.json"),
      JSON.stringify({ gateway: { port: 18789 } }),
    );

    const agents = await discoverAgents({ openclawHome: testDir });

    expect(agents).toHaveLength(1);
    expect(agents[0].id).toBe("default");
    expect(agents[0].isDefault).toBe(true);
    expect(agents[0].openclawHome).toBe(testDir);
  });

  it("discovers multiple agents from agents.list", async () => {
    const config = {
      agents: {
        list: [
          { id: "main", default: true, workspace: "/home/node/.openclaw/workspace" },
          { id: "work", workspace: "/home/node/.openclaw/agents/work/agent/workspace" },
          { id: "family", workspace: "/home/node/.openclaw/agents/family/agent/workspace" },
        ],
      },
    };

    await writeFile(join(testDir, "openclaw.json"), JSON.stringify(config));

    const agents = await discoverAgents({ openclawHome: testDir });

    expect(agents).toHaveLength(3);
    expect(agents[0].id).toBe("main");
    expect(agents[0].isDefault).toBe(true);
    expect(agents[1].id).toBe("work");
    expect(agents[1].isDefault).toBe(false);
    expect(agents[2].id).toBe("family");
    expect(agents[2].isDefault).toBe(false);
  });

  it("uses configPath option when provided", async () => {
    const configDir = join(testDir, "custom");
    await mkdir(configDir, { recursive: true });

    const config = {
      agents: {
        list: [
          { id: "alpha", default: true, workspace: "/w" },
          { id: "beta", workspace: "/w2" },
        ],
      },
    };

    const configPath = join(configDir, "openclaw.json");
    await writeFile(configPath, JSON.stringify(config));

    const agents = await discoverAgents({
      openclawHome: testDir,
      configPath,
    });

    expect(agents).toHaveLength(2);
    expect(agents[0].id).toBe("alpha");
  });
});
