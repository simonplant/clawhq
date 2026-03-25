import { describe, expect, it } from "vitest";

import { GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";
import { validateBundle } from "../../config/validate.js";
import { loadBlueprint } from "../blueprints/loader.js";

import { generateBundle, validateCronExpr } from "./generate.js";
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
    gatewayPort: GATEWAY_DEFAULT_PORT,
    deployDir: "/tmp/clawhq-test",
    airGapped: false,
    integrations: {},
    customizationAnswers: {},
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

  it("sets explicit tool access grants for v0.8.7+ compatibility", () => {
    const bundle = generateBundle(makeAnswers());
    const grants = bundle.openclawConfig.tools?.accessGrants;
    expect(grants).toBeDefined();
    expect(grants!.length).toBeGreaterThan(0);
    expect(grants![0]).toEqual({ type: "user", value: "*" });
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

  it("generates skill-specific cron jobs for included skills", () => {
    const loaded = loadBlueprint("email-manager");
    const answers = makeAnswers({
      blueprint: loaded.blueprint,
      blueprintPath: loaded.sourcePath,
    });
    const bundle = generateBundle(answers);
    const ids = bundle.cronJobs.map((j) => j.id);
    expect(ids).toContain("skill-email-digest");
    expect(ids).toContain("skill-morning-brief");

    // Verify the skill cron job uses valid expressions (LM-09)
    const skillJob = bundle.cronJobs.find((j) => j.id === "skill-email-digest");
    expect(skillJob).toBeDefined();
    expect(skillJob?.enabled).toBe(true);
    expect(skillJob?.expr).toBeDefined();
    // Must not have bare N/step
    for (const field of (skillJob?.expr ?? "").split(/\s+/)) {
      expect(field).not.toMatch(/^\d+\/\d+$/);
    }
  });

  it("rejects cron expressions with out-of-range values at generation time", () => {
    const loaded = loadBlueprint("family-hub");
    // Inject an invalid heartbeat cron into the blueprint
    const bp = { ...loaded.blueprint, cron_config: { ...loaded.blueprint.cron_config, heartbeat: "99 99 99 99 99" } };
    const answers = makeAnswers({ blueprint: bp, blueprintPath: loaded.sourcePath });
    expect(() => generateBundle(answers)).toThrow(/Invalid cron expression/);
  });

  it("rejects cron expressions with minute > 59", () => {
    const loaded = loadBlueprint("family-hub");
    const bp = { ...loaded.blueprint, cron_config: { ...loaded.blueprint.cron_config, heartbeat: "60 * * * *" } };
    const answers = makeAnswers({ blueprint: bp, blueprintPath: loaded.sourcePath });
    expect(() => generateBundle(answers)).toThrow(/minute.*out of range/);
  });

  it("rejects morning brief with hour > 23", () => {
    const loaded = loadBlueprint("family-hub");
    const bp = { ...loaded.blueprint, cron_config: { ...loaded.blueprint.cron_config, morning_brief: "25:00" } };
    const answers = makeAnswers({ blueprint: bp, blueprintPath: loaded.sourcePath });
    expect(() => generateBundle(answers)).toThrow(/Invalid morning brief time/);
  });

  it("passes full validation for every built-in blueprint", () => {
    const blueprintNames = [
      "email-manager",
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

describe("validateCronExpr", () => {
  it("accepts valid 5-field expressions", () => {
    expect(validateCronExpr("0 7 * * *")).toHaveLength(0);
    expect(validateCronExpr("*/15 * * * *")).toHaveLength(0);
    expect(validateCronExpr("0-59/10 5-23 * * *")).toHaveLength(0);
    expect(validateCronExpr("0 0 1 1 0")).toHaveLength(0);
    expect(validateCronExpr("59 23 31 12 7")).toHaveLength(0);
  });

  it("rejects wrong field count", () => {
    expect(validateCronExpr("* * *")).not.toHaveLength(0);
    expect(validateCronExpr("* * * * * *")).not.toHaveLength(0);
    expect(validateCronExpr("*")).not.toHaveLength(0);
  });

  it("rejects minute > 59", () => {
    const errors = validateCronExpr("60 * * * *");
    expect(errors.some((e) => e.includes("minute"))).toBe(true);
  });

  it("rejects hour > 23", () => {
    const errors = validateCronExpr("0 24 * * *");
    expect(errors.some((e) => e.includes("hour"))).toBe(true);
  });

  it("rejects day-of-month > 31", () => {
    const errors = validateCronExpr("0 0 32 * *");
    expect(errors.some((e) => e.includes("day-of-month"))).toBe(true);
  });

  it("rejects day-of-month 0", () => {
    const errors = validateCronExpr("0 0 0 * *");
    expect(errors.some((e) => e.includes("day-of-month"))).toBe(true);
  });

  it("rejects month > 12", () => {
    const errors = validateCronExpr("0 0 * 13 *");
    expect(errors.some((e) => e.includes("month"))).toBe(true);
  });

  it("rejects month 0", () => {
    const errors = validateCronExpr("0 0 * 0 *");
    expect(errors.some((e) => e.includes("month"))).toBe(true);
  });

  it("rejects day-of-week > 7", () => {
    const errors = validateCronExpr("0 0 * * 8");
    expect(errors.some((e) => e.includes("day-of-week"))).toBe(true);
  });

  it("accepts comma-separated lists", () => {
    expect(validateCronExpr("0,15,30,45 * * * *")).toHaveLength(0);
  });

  it("rejects out-of-range values in lists", () => {
    const errors = validateCronExpr("0,60 * * * *");
    expect(errors.some((e) => e.includes("minute"))).toBe(true);
  });

  it("rejects all-invalid expression like 99 99 99 99 99", () => {
    const errors = validateCronExpr("99 99 99 99 99");
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });

  it("accepts boundary values at limits", () => {
    expect(validateCronExpr("0 0 1 1 0")).toHaveLength(0);
    expect(validateCronExpr("59 23 31 12 7")).toHaveLength(0);
  });
});
