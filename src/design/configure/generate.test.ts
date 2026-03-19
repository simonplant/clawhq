import { describe, expect, it } from "vitest";

import { validateBundle } from "../../config/validate.js";
import { loadBlueprint } from "../blueprints/loader.js";

import { generateBundle } from "./generate.js";
import type { WizardAnswers } from "./types.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeAnswers(overrides: Partial<WizardAnswers> = {}): WizardAnswers {
  const loaded = loadBlueprint("family-hub");
  return {
    blueprint: loaded.blueprint,
    blueprintPath: loaded.sourcePath,
    channel: "telegram",
    modelProvider: "local",
    localModel: "llama3:8b",
    gatewayPort: 18789,
    deployDir: "/tmp/clawhq-test",
    airGapped: false,
    integrations: {},
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("generateBundle", () => {
  it("produces a bundle that passes all 14 landmine rules", () => {
    const answers = makeAnswers();
    const bundle = generateBundle(answers);
    const report = validateBundle(bundle);

    expect(report.valid).toBe(true);
    expect(report.errors).toHaveLength(0);
  });

  it("sets LM-01: dangerouslyDisableDeviceAuth to true", () => {
    const bundle = generateBundle(makeAnswers());
    expect(bundle.openclawConfig.dangerouslyDisableDeviceAuth).toBe(true);
  });

  it("sets LM-02: allowedOrigins with localhost entries", () => {
    const bundle = generateBundle(makeAnswers({ gatewayPort: 19000 }));
    expect(bundle.openclawConfig.allowedOrigins).toContain("http://localhost:19000");
    expect(bundle.openclawConfig.allowedOrigins).toContain("http://127.0.0.1:19000");
  });

  it("sets LM-03: trustedProxies with Docker bridge", () => {
    const bundle = generateBundle(makeAnswers());
    expect(bundle.openclawConfig.trustedProxies).toContain("172.17.0.1");
  });

  it("sets LM-04: tools.exec.host to gateway", () => {
    const bundle = generateBundle(makeAnswers());
    expect(bundle.openclawConfig.tools?.exec.host).toBe("gateway");
  });

  it("sets LM-05: tools.exec.security to full", () => {
    const bundle = generateBundle(makeAnswers());
    expect(bundle.openclawConfig.tools?.exec.security).toBe("full");
  });

  it("sets LM-06: container user to 1000:1000", () => {
    const bundle = generateBundle(makeAnswers());
    const svc = bundle.composeConfig.services?.["openclaw"];
    expect(svc?.user).toBe("1000:1000");
  });

  it("sets LM-07: cap_drop ALL and no-new-privileges", () => {
    const bundle = generateBundle(makeAnswers());
    const svc = bundle.composeConfig.services?.["openclaw"];
    expect(svc?.cap_drop).toContain("ALL");
    expect(svc?.security_opt).toContain("no-new-privileges");
  });

  it("keeps LM-08: identity files within bootstrapMaxChars", () => {
    const bundle = generateBundle(makeAnswers());
    const totalSize = bundle.identityFiles.reduce((s, f) => s + f.sizeBytes, 0);
    const maxChars = bundle.openclawConfig.identity?.bootstrapMaxChars ?? 20_000;
    expect(totalSize).toBeLessThanOrEqual(maxChars);
  });

  it("produces LM-09: valid cron expressions (no bare N/step)", () => {
    const bundle = generateBundle(makeAnswers());
    for (const job of bundle.cronJobs) {
      if (job.kind === "cron" && job.expr) {
        for (const field of job.expr.split(/\s+/)) {
          expect(field).not.toMatch(/^\d+\/\d+$/);
        }
      }
    }
  });

  it("sets LM-13: ICC disabled on agent network", () => {
    const bundle = generateBundle(makeAnswers());
    const networks = bundle.composeConfig.networks ?? {};
    const hasIcc = Object.values(networks).some(
      (n) => n.driver_opts?.["com.docker.network.bridge.enable_icc"] === "false",
    );
    expect(hasIcc).toBe(true);
  });

  it("sets LM-14: fs.workspaceOnly explicitly", () => {
    const bundle = generateBundle(makeAnswers());
    expect(bundle.openclawConfig.fs?.workspaceOnly).toBeDefined();
  });

  it("enables selected channel and disables others", () => {
    const bundle = generateBundle(makeAnswers({ channel: "whatsapp" }));
    const channels = bundle.openclawConfig.channels ?? {};
    expect(channels["whatsapp"]?.enabled).toBe(true);
    expect(channels["telegram"]?.enabled).toBe(false);
  });

  it("uses local model when modelProvider is local", () => {
    const bundle = generateBundle(makeAnswers({
      modelProvider: "local",
      localModel: "mistral:7b",
    }));
    expect(bundle.openclawConfig.agents?.defaults?.model?.primary).toBe("mistral:7b");
  });

  it("generates cron jobs from blueprint", () => {
    const bundle = generateBundle(makeAnswers());
    expect(bundle.cronJobs.length).toBeGreaterThan(0);
    const ids = bundle.cronJobs.map((j) => j.id);
    expect(ids).toContain("heartbeat");
    expect(ids).toContain("morning-brief");
  });

  it("generates identity files from blueprint personality", () => {
    const bundle = generateBundle(makeAnswers());
    expect(bundle.identityFiles.length).toBeGreaterThan(0);
    const names = bundle.identityFiles.map((f) => f.name);
    expect(names).toContain("SOUL.md");
    expect(names).toContain("AGENTS.md");
  });

  it("sets cloud to paranoid in air-gapped mode", () => {
    const bundle = generateBundle(makeAnswers({ airGapped: true }));
    expect(bundle.clawhqConfig.cloud?.enabled).toBe(false);
    expect(bundle.clawhqConfig.cloud?.trustMode).toBe("paranoid");
  });

  it("flattens integration credentials into env vars", () => {
    const bundle = generateBundle(makeAnswers({
      integrations: {
        email: { IMAP_HOST: "imap.example.com", IMAP_USER: "user@example.com" },
      },
    }));
    expect(bundle.envVars["EMAIL_IMAP_HOST"]).toBe("imap.example.com");
    expect(bundle.envVars["EMAIL_IMAP_USER"]).toBe("user@example.com");
  });

  it("passes full validation for every built-in blueprint", () => {
    const blueprintNames = [
      "family-hub",
      "founders-ops",
      "replace-chatgpt-plus",
      "replace-google-assistant",
      "replace-my-pa",
      "research-copilot",
    ];

    for (const name of blueprintNames) {
      const loaded = loadBlueprint(name);
      const answers = makeAnswers({
        blueprint: loaded.blueprint,
        blueprintPath: loaded.sourcePath,
      });
      const bundle = generateBundle(answers);
      const report = validateBundle(bundle);

      expect(report.valid, `Blueprint "${name}" should pass validation`).toBe(true);
    }
  });
});
