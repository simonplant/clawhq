import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadAndValidate } from "./index.js";

describe("loadAndValidate", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "clawhq-loadvalidate-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("fails when openclaw.json does not exist", async () => {
    const projectPath = join(tempDir, "clawhq.yaml");
    await writeFile(
      projectPath,
      "openclaw:\n  configPath: /nonexistent/openclaw.json\n  home: /tmp/fake\n",
    );

    const result = await loadAndValidate({
      userConfigPath: join(tempDir, "nonexistent-user.yaml"),
      projectConfigPath: projectPath,
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].rule).toBe("CONFIG");
    expect(result.failures[0].message).toContain("Failed to load");
  });

  it("validates a well-configured openclaw.json", async () => {
    const openclawDir = join(tempDir, ".openclaw");
    await mkdir(openclawDir, { recursive: true });
    const configPath = join(openclawDir, "openclaw.json");
    await writeFile(
      configPath,
      JSON.stringify({
        dangerouslyDisableDeviceAuth: true,
        allowedOrigins: ["http://localhost:18789"],
        trustedProxies: ["172.17.0.1"],
        tools: { exec: { host: "gateway", security: "full" } },
        fs: { workspaceOnly: true },
      }),
    );

    const projectPath = join(tempDir, "clawhq.yaml");
    await writeFile(
      projectPath,
      `openclaw:\n  configPath: ${configPath}\n  home: ${openclawDir}\n`,
    );

    const result = await loadAndValidate({
      userConfigPath: join(tempDir, "nonexistent-user.yaml"),
      projectConfigPath: projectPath,
    });

    expect(result.results).toHaveLength(14);
    expect(result.failures).toHaveLength(0);
    expect(result.passed).toBe(true);
  });

  it("reports failures for invalid openclaw.json", async () => {
    const openclawDir = join(tempDir, ".openclaw");
    await mkdir(openclawDir, { recursive: true });
    const configPath = join(openclawDir, "openclaw.json");
    await writeFile(configPath, JSON.stringify({}));

    const projectPath = join(tempDir, "clawhq.yaml");
    await writeFile(
      projectPath,
      `openclaw:\n  configPath: ${configPath}\n  home: ${openclawDir}\n`,
    );

    const result = await loadAndValidate({
      userConfigPath: join(tempDir, "nonexistent-user.yaml"),
      projectConfigPath: projectPath,
    });

    expect(result.passed).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
    // LM-01, LM-02, LM-03 should all fail with empty config
    const ruleIds = result.failures.map((f) => f.rule);
    expect(ruleIds).toContain("LM-01");
    expect(ruleIds).toContain("LM-02");
    expect(ruleIds).toContain("LM-03");
  });

  it("separates warnings from failures", async () => {
    const openclawDir = join(tempDir, ".openclaw");
    await mkdir(openclawDir, { recursive: true });
    const configPath = join(openclawDir, "openclaw.json");
    await writeFile(
      configPath,
      JSON.stringify({
        dangerouslyDisableDeviceAuth: true,
        allowedOrigins: ["http://localhost:18789"],
        trustedProxies: ["172.17.0.1"],
        // Omit tools.exec — will produce warnings for LM-04, LM-05
      }),
    );

    const projectPath = join(tempDir, "clawhq.yaml");
    await writeFile(
      projectPath,
      `openclaw:\n  configPath: ${configPath}\n  home: ${openclawDir}\n`,
    );

    const result = await loadAndValidate({
      userConfigPath: join(tempDir, "nonexistent-user.yaml"),
      projectConfigPath: projectPath,
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    const warningRules = result.warnings.map((w) => w.rule);
    expect(warningRules).toContain("LM-04");
    expect(warningRules).toContain("LM-05");
  });

  it("passes compose and env content through to validator", async () => {
    const openclawDir = join(tempDir, ".openclaw");
    await mkdir(openclawDir, { recursive: true });
    const configPath = join(openclawDir, "openclaw.json");
    await writeFile(
      configPath,
      JSON.stringify({
        dangerouslyDisableDeviceAuth: true,
        allowedOrigins: ["http://localhost:18789"],
        trustedProxies: ["172.17.0.1"],
        tools: { exec: { host: "gateway", security: "full" } },
        fs: { workspaceOnly: true },
      }),
    );

    const projectPath = join(tempDir, "clawhq.yaml");
    await writeFile(
      projectPath,
      `openclaw:\n  configPath: ${configPath}\n  home: ${openclawDir}\n`,
    );

    const compose = `services:
  agent:
    user: "1000:1000"
    volumes:
      - ./openclaw.json:/home/user/.openclaw/openclaw.json:ro
    environment:
      - API_KEY=\${API_KEY}
networks:
  agent:
    driver_opts:
      com.docker.network.bridge.enable_icc: "false"
`;
    const env = "API_KEY=test123\n";

    const result = await loadAndValidate({
      userConfigPath: join(tempDir, "nonexistent-user.yaml"),
      projectConfigPath: projectPath,
      composeContent: compose,
      envContent: env,
    });

    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it("fails when configPath is not set and default does not exist", async () => {
    // Point openclaw.configPath to a nonexistent location
    const projectPath = join(tempDir, "clawhq.yaml");
    await writeFile(
      projectPath,
      "openclaw:\n  configPath: /nonexistent/path/openclaw.json\n  home: /nonexistent/path\n",
    );

    const result = await loadAndValidate({
      userConfigPath: join(tempDir, "nonexistent-user.yaml"),
      projectConfigPath: projectPath,
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].rule).toBe("CONFIG");
    expect(result.failures[0].message).toContain("Failed to load");
  });
});
