import { describe, expect, it } from "vitest";

import { GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";
import { validateBundle } from "../../config/validate.js";
import { loadBlueprint } from "../blueprints/loader.js";

import { generateAllowlistContent, generateBundle, generateSkillFiles, validateCronExpr } from "./generate.js";
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
    expect(bundle.openclawConfig.gateway?.controlUi?.dangerouslyDisableDeviceAuth).toBe(true);
  });

  it("sets LM-02: allowedOrigins with localhost entries", () => {
    const bundle = generateBundle(makeAnswers({ gatewayPort: 19000 }));
    expect(bundle.openclawConfig.gateway?.controlUi?.allowedOrigins).toContain("http://127.0.0.1:19000");
  });

  it("sets LM-03: trustedProxies with Docker bridge", () => {
    const bundle = generateBundle(makeAnswers());
    expect(bundle.openclawConfig.gateway?.trustedProxies).toContain("172.17.0.1");
  });

  it("sets LM-04: tools.exec.host to gateway", () => {
    const bundle = generateBundle(makeAnswers());
    expect(bundle.openclawConfig.tools?.exec.host).toBe("gateway");
  });

  it("sets LM-05: tools.exec.security to full", () => {
    const bundle = generateBundle(makeAnswers());
    expect(bundle.openclawConfig.tools?.exec.security).toBe("full");
  });

  it("sets tool filesystem config for workspace access", () => {
    const bundle = generateBundle(makeAnswers());
    const fs = bundle.openclawConfig.tools?.fs;
    expect(fs).toBeDefined();
    expect(fs!.workspaceOnly).toBe(false);
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
    expect(bundle.openclawConfig.tools?.fs?.workspaceOnly).toBeDefined();
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
    expect(bundle.openclawConfig.agents?.defaults?.model?.primary).toBe("ollama/mistral:7b");
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

  it("identity files include content with sizeBytes matching Buffer.byteLength", () => {
    const bundle = generateBundle(makeAnswers());
    expect(bundle.identityFiles.length).toBeGreaterThan(0);
    for (const f of bundle.identityFiles) {
      expect(f.content).toBeDefined();
      expect(f.content.length).toBeGreaterThan(0);
      expect(f.sizeBytes).toBe(Buffer.byteLength(f.content, "utf-8"));
    }
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

  it("emits model and fallbacks from blueprint cron_config.model_routing", () => {
    const loaded = loadBlueprint("email-manager");
    const answers = makeAnswers({
      blueprint: loaded.blueprint,
      blueprintPath: loaded.sourcePath,
    });
    const bundle = generateBundle(answers);

    const heartbeat = bundle.cronJobs.find((j) => j.id === "heartbeat");
    expect(heartbeat?.model).toBe("haiku");
    expect(heartbeat?.fallbacks).toEqual(["sonnet"]);

    const workSession = bundle.cronJobs.find((j) => j.id === "work-session");
    expect(workSession?.model).toBe("opus");
    expect(workSession?.fallbacks).toEqual(["sonnet"]);

    const morningBrief = bundle.cronJobs.find((j) => j.id === "morning-brief");
    expect(morningBrief?.model).toBe("sonnet");
    expect(morningBrief?.fallbacks).toEqual(["haiku"]);
  });

  it("skill cron jobs inherit work_session model routing", () => {
    const loaded = loadBlueprint("email-manager");
    const answers = makeAnswers({
      blueprint: loaded.blueprint,
      blueprintPath: loaded.sourcePath,
    });
    const bundle = generateBundle(answers);

    const skillJob = bundle.cronJobs.find((j) => j.id === "skill-email-digest");
    expect(skillJob?.model).toBe("opus");
    expect(skillJob?.fallbacks).toEqual(["sonnet"]);
  });

  it("omits model and fallbacks when model_routing is not set", () => {
    const loaded = loadBlueprint("family-hub");
    const bp = {
      ...loaded.blueprint,
      cron_config: { ...loaded.blueprint.cron_config, model_routing: undefined },
    };
    const answers = makeAnswers({ blueprint: bp, blueprintPath: loaded.sourcePath });
    const bundle = generateBundle(answers);

    const heartbeat = bundle.cronJobs.find((j) => j.id === "heartbeat");
    expect(heartbeat?.model).toBeUndefined();
    expect(heartbeat?.fallbacks).toBeUndefined();
  });

  it("sets posture-driven exec.ask to 'off' for hardened blueprints", () => {
    const bundle = generateBundle(makeAnswers());
    expect(bundle.openclawConfig.tools?.exec.ask).toBe("off");
  });

  it("sets posture-driven exec.ask to 'off' for under-attack posture", () => {
    const loaded = loadBlueprint("family-hub");
    const bp = {
      ...loaded.blueprint,
      security_posture: { ...loaded.blueprint.security_posture, posture: "under-attack" as const },
    };
    const answers = makeAnswers({ blueprint: bp, blueprintPath: loaded.sourcePath });
    const bundle = generateBundle(answers);
    expect(bundle.openclawConfig.tools?.exec.ask).toBe("off");
  });

  it("sets heartbeat and skill cron jobs to session 'isolated'", () => {
    const loaded = loadBlueprint("email-manager");
    const answers = makeAnswers({
      blueprint: loaded.blueprint,
      blueprintPath: loaded.sourcePath,
    });
    const bundle = generateBundle(answers);

    const heartbeat = bundle.cronJobs.find((j) => j.id === "heartbeat");
    expect(heartbeat?.session).toBe("isolated");

    const skillJob = bundle.cronJobs.find((j) => j.id === "skill-email-digest");
    expect(skillJob?.session).toBe("isolated");
  });

  it("sets work-session and morning-brief to session 'main'", () => {
    const bundle = generateBundle(makeAnswers());
    const workSession = bundle.cronJobs.find((j) => j.id === "work-session");
    expect(workSession?.session).toBe("main");

    const morningBrief = bundle.cronJobs.find((j) => j.id === "morning-brief");
    expect(morningBrief?.session).toBe("main");
  });

  it("populates activeHours on cron jobs with 'waking' qualifier", () => {
    // family-hub has quiet_hours "21:00-06:00" and heartbeat "*/15 waking"
    const bundle = generateBundle(makeAnswers());
    const heartbeat = bundle.cronJobs.find((j) => j.id === "heartbeat");
    expect(heartbeat?.activeHours).toEqual({ start: 6, end: 21 });

    const workSession = bundle.cronJobs.find((j) => j.id === "work-session");
    expect(workSession?.activeHours).toEqual({ start: 6, end: 21 });
  });

  it("does not set activeHours on morning-brief (no waking qualifier)", () => {
    const bundle = generateBundle(makeAnswers());
    const morningBrief = bundle.cronJobs.find((j) => j.id === "morning-brief");
    expect(morningBrief?.activeHours).toBeUndefined();
  });

  it("includes timezone in activeHours when userContext provides it", () => {
    const answers = makeAnswers({
      userContext: {
        name: "Test",
        timezone: "America/Los_Angeles",
        communicationPreference: "brief",
      },
    });
    const bundle = generateBundle(answers);
    const heartbeat = bundle.cronJobs.find((j) => j.id === "heartbeat");
    expect(heartbeat?.activeHours?.tz).toBe("America/Los_Angeles");
  });

  it("defaults morning-brief delivery to 'announce', others to 'none'", () => {
    const bundle = generateBundle(makeAnswers());
    const heartbeat = bundle.cronJobs.find((j) => j.id === "heartbeat");
    expect(heartbeat?.delivery).toBe("none");

    const workSession = bundle.cronJobs.find((j) => j.id === "work-session");
    expect(workSession?.delivery).toBe("none");

    const morningBrief = bundle.cronJobs.find((j) => j.id === "morning-brief");
    expect(morningBrief?.delivery).toBe("announce");
  });

  it("allows blueprint to override delivery mode per job", () => {
    const loaded = loadBlueprint("family-hub");
    const bp = {
      ...loaded.blueprint,
      cron_config: {
        ...loaded.blueprint.cron_config,
        delivery: { heartbeat: "errors" as const, morning_brief: "none" as const },
      },
    };
    const answers = makeAnswers({ blueprint: bp, blueprintPath: loaded.sourcePath });
    const bundle = generateBundle(answers);

    const heartbeat = bundle.cronJobs.find((j) => j.id === "heartbeat");
    expect(heartbeat?.delivery).toBe("errors");

    const morningBrief = bundle.cronJobs.find((j) => j.id === "morning-brief");
    expect(morningBrief?.delivery).toBe("none");
  });

  it("allows blueprint to override sessionTarget per job", () => {
    const loaded = loadBlueprint("family-hub");
    const bp = {
      ...loaded.blueprint,
      cron_config: {
        ...loaded.blueprint.cron_config,
        session_target: { heartbeat: "main" as const },
      },
    };
    const answers = makeAnswers({ blueprint: bp, blueprintPath: loaded.sourcePath });
    const bundle = generateBundle(answers);

    const heartbeat = bundle.cronJobs.find((j) => j.id === "heartbeat");
    expect(heartbeat?.session).toBe("main");
  });

  it("uses cost-efficient defaults: cheap models for frequent jobs", () => {
    // All 7 blueprints should route heartbeat to haiku (cheapest)
    const blueprintNames = [
      "email-manager", "family-hub", "founders-ops",
      "replace-chatgpt-plus", "replace-google-assistant", "replace-my-pa",
      "research-copilot",
    ];

    for (const name of blueprintNames) {
      const loaded = loadBlueprint(name);
      const answers = makeAnswers({
        blueprint: loaded.blueprint,
        blueprintPath: loaded.sourcePath,
      });
      const bundle = generateBundle(answers);
      const heartbeat = bundle.cronJobs.find((j) => j.id === "heartbeat");
      expect(heartbeat?.model, `${name}: heartbeat should use haiku`).toBe("haiku");
      expect(heartbeat?.fallbacks, `${name}: heartbeat should fall back to sonnet`).toEqual(["sonnet"]);
    }
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

describe("profile-driven tools.deny", () => {
  it("blueprint with profile_ref 'dev' gets no tools denied", () => {
    const loaded = loadBlueprint("family-hub");
    const bp = { ...loaded.blueprint, profile_ref: "dev" };
    const answers = makeAnswers({ blueprint: bp, blueprintPath: loaded.sourcePath });
    const bundle = generateBundle(answers);
    expect(bundle.openclawConfig.tools?.deny).toBeUndefined();
  });

  it("blueprint with profile_ref 'lifeops' gets browser and nodes denied", () => {
    const loaded = loadBlueprint("family-hub");
    const bp = { ...loaded.blueprint, profile_ref: "lifeops" };
    const answers = makeAnswers({ blueprint: bp, blueprintPath: loaded.sourcePath });
    const bundle = generateBundle(answers);
    expect(bundle.openclawConfig.tools?.deny).toContain("browser");
    expect(bundle.openclawConfig.tools?.deny).toContain("nodes");
  });

  it("blueprint-level deny adds to profile deny", () => {
    const loaded = loadBlueprint("family-hub");
    const bp = {
      ...loaded.blueprint,
      profile_ref: "lifeops",
      toolbelt: { ...loaded.blueprint.toolbelt, deny: ["gateway"] },
    };
    const answers = makeAnswers({ blueprint: bp, blueprintPath: loaded.sourcePath });
    const bundle = generateBundle(answers);
    const deny = bundle.openclawConfig.tools?.deny;
    expect(deny).toContain("browser");
    expect(deny).toContain("nodes");
    expect(deny).toContain("gateway");
  });

  it("blueprint-level allow overrides profile deny", () => {
    const loaded = loadBlueprint("family-hub");
    const bp = {
      ...loaded.blueprint,
      profile_ref: "lifeops",
      toolbelt: { ...loaded.blueprint.toolbelt, allow: ["browser"] },
    };
    const answers = makeAnswers({ blueprint: bp, blueprintPath: loaded.sourcePath });
    const bundle = generateBundle(answers);
    const deny = bundle.openclawConfig.tools?.deny;
    expect(deny).toContain("nodes");
    expect(deny).not.toContain("browser");
  });

  it("deny-wins: tool in both blueprint deny and allow stays denied", () => {
    const loaded = loadBlueprint("family-hub");
    const bp = {
      ...loaded.blueprint,
      profile_ref: "lifeops",
      toolbelt: { ...loaded.blueprint.toolbelt, deny: ["browser"], allow: ["browser"] },
    };
    const answers = makeAnswers({ blueprint: bp, blueprintPath: loaded.sourcePath });
    const bundle = generateBundle(answers);
    expect(bundle.openclawConfig.tools?.deny).toContain("browser");
  });

  it("no profile_ref means no tools.deny", () => {
    const loaded = loadBlueprint("family-hub");
    const bp = { ...loaded.blueprint, profile_ref: undefined };
    const answers = makeAnswers({ blueprint: bp, blueprintPath: loaded.sourcePath });
    const bundle = generateBundle(answers);
    expect(bundle.openclawConfig.tools?.deny).toBeUndefined();
  });

  it("markets profile denies nodes but allows browser", () => {
    const loaded = loadBlueprint("family-hub");
    const bp = { ...loaded.blueprint, profile_ref: "markets" };
    const answers = makeAnswers({ blueprint: bp, blueprintPath: loaded.sourcePath });
    const bundle = generateBundle(answers);
    const deny = bundle.openclawConfig.tools?.deny;
    expect(deny).toContain("nodes");
    expect(deny).not.toContain("browser");
  });

  it("existing blueprints with profile_ref still pass full validation", () => {
    const blueprintNames = [
      "email-manager", "family-hub", "founders-ops",
      "replace-chatgpt-plus", "replace-google-assistant", "replace-my-pa",
      "research-copilot",
    ];

    for (const name of blueprintNames) {
      const loaded = loadBlueprint(name);
      expect(loaded.blueprint.profile_ref).toBeDefined();
      const answers = makeAnswers({
        blueprint: loaded.blueprint,
        blueprintPath: loaded.sourcePath,
      });
      const bundle = generateBundle(answers);
      const report = validateBundle(bundle);
      expect(report.valid, `Blueprint "${name}" should pass validation with profile_ref`).toBe(true);
    }
  });
});

describe("delegated action rules", () => {
  it("generates delegatedRulesFile for blueprints with delegation_rules", () => {
    const loaded = loadBlueprint("email-manager");
    const answers = makeAnswers({
      blueprint: loaded.blueprint,
      blueprintPath: loaded.sourcePath,
    });
    const bundle = generateBundle(answers);

    expect(bundle.delegatedRulesFile).toBeDefined();
    expect(bundle.delegatedRulesFile!.path).toBe("workspace/delegated-rules.json");
    expect(bundle.delegatedRulesFile!.categoryCount).toBeGreaterThan(0);
    expect(bundle.delegatedRulesFile!.ruleCount).toBeGreaterThan(0);
    expect(bundle.delegatedRulesFile!.sizeBytes).toBeGreaterThan(0);
  });

  it("omits delegatedRulesFile when blueprint has no delegation_rules", () => {
    const loaded = loadBlueprint("family-hub");
    const bp = { ...loaded.blueprint, delegation_rules: undefined };
    const answers = makeAnswers({ blueprint: bp, blueprintPath: loaded.sourcePath });
    const bundle = generateBundle(answers);

    expect(bundle.delegatedRulesFile).toBeUndefined();
  });

  it("counts rules correctly across categories", () => {
    const loaded = loadBlueprint("email-manager");
    const answers = makeAnswers({
      blueprint: loaded.blueprint,
      blueprintPath: loaded.sourcePath,
    });
    const bundle = generateBundle(answers);
    const info = bundle.delegatedRulesFile!;

    // email-manager has 3 categories (appointment-confirm, vendor-reply, unsubscribe)
    expect(info.categoryCount).toBe(3);
    // Total rules across all categories
    expect(info.ruleCount).toBeGreaterThanOrEqual(8);
  });
});

describe("multi-instance support", () => {
  it("uses default network name when instanceName is omitted", () => {
    const bundle = generateBundle(makeAnswers());
    const networks = bundle.composeConfig.networks ?? {};
    expect(networks).toHaveProperty("clawhq_net");
  });

  it("uses default network name when instanceName is 'default'", () => {
    const bundle = generateBundle(makeAnswers({ instanceName: "default" }));
    const networks = bundle.composeConfig.networks ?? {};
    expect(networks).toHaveProperty("clawhq_net");
    const svc = bundle.composeConfig.services?.["openclaw"];
    expect(svc?.networks).toContain("clawhq_net");
  });

  it("uses per-instance network name when instanceName is set", () => {
    const bundle = generateBundle(makeAnswers({ instanceName: "john" }));
    const networks = bundle.composeConfig.networks ?? {};
    expect(networks).toHaveProperty("clawhq_john_net");
    expect(networks).not.toHaveProperty("clawhq_net");
    const svc = bundle.composeConfig.services?.["openclaw"];
    expect(svc?.networks).toContain("clawhq_john_net");
  });

  it("threads instanceName into clawhqConfig", () => {
    const bundle = generateBundle(makeAnswers({ instanceName: "john" }));
    expect(bundle.clawhqConfig.instanceName).toBe("john");
  });

  it("omits instanceName from clawhqConfig when using default", () => {
    const bundle = generateBundle(makeAnswers());
    expect(bundle.clawhqConfig.instanceName).toBeUndefined();
  });

  it("two different instance names produce non-colliding networks", () => {
    const bundle1 = generateBundle(makeAnswers({ instanceName: "john" }));
    const bundle2 = generateBundle(makeAnswers({ instanceName: "jane" }));
    const nets1 = Object.keys(bundle1.composeConfig.networks ?? {});
    const nets2 = Object.keys(bundle2.composeConfig.networks ?? {});
    expect(nets1[0]).not.toBe(nets2[0]);
    expect(nets1[0]).toBe("clawhq_john_net");
    expect(nets2[0]).toBe("clawhq_jane_net");
  });

  it("ICC is disabled on per-instance network", () => {
    const bundle = generateBundle(makeAnswers({ instanceName: "john" }));
    const networks = bundle.composeConfig.networks ?? {};
    const net = networks["clawhq_john_net"];
    expect(net?.driver_opts?.["com.docker.network.bridge.enable_icc"]).toBe("false");
  });

  it("passes full validation with instanceName set", () => {
    const bundle = generateBundle(makeAnswers({ instanceName: "john" }));
    const report = validateBundle(bundle);
    expect(report.valid).toBe(true);
    expect(report.errors).toHaveLength(0);
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

// ── Skill Files in Bundle ──────────────────────────────────────────────────

describe("skill files in deployment bundle", () => {
  it("includes platform skill files (cron-doctor, scanner-triage) in every bundle", () => {
    const bundle = generateBundle(makeAnswers());
    const skillNames = [...new Set(bundle.skillFiles.map((f) => f.skillName))];
    expect(skillNames).toContain("cron-doctor");
    expect(skillNames).toContain("scanner-triage");
  });

  it("includes platform skills regardless of blueprint", () => {
    const blueprintNames = [
      "email-manager", "family-hub", "founders-ops",
      "replace-chatgpt-plus", "replace-google-assistant", "replace-my-pa",
      "research-copilot",
    ];

    for (const name of blueprintNames) {
      const loaded = loadBlueprint(name);
      const answers = makeAnswers({
        blueprint: loaded.blueprint,
        blueprintPath: loaded.sourcePath,
      });
      const bundle = generateBundle(answers);
      const skillNames = [...new Set(bundle.skillFiles.map((f) => f.skillName))];
      expect(skillNames, `${name}: should include cron-doctor`).toContain("cron-doctor");
      expect(skillNames, `${name}: should include scanner-triage`).toContain("scanner-triage");
    }
  });

  it("includes blueprint-selected skills from skill_bundle.included", () => {
    const loaded = loadBlueprint("email-manager");
    const bundle = generateBundle(makeAnswers({
      blueprint: loaded.blueprint,
      blueprintPath: loaded.sourcePath,
    }));
    // email-manager includes email-digest and morning-brief skills
    const skillNames = [...new Set(bundle.skillFiles.map((f) => f.skillName))];
    for (const included of loaded.blueprint.skill_bundle.included) {
      expect(skillNames, `should include ${included}`).toContain(included);
    }
  });

  it("skill files target workspace/skills/ path", () => {
    const bundle = generateBundle(makeAnswers());
    for (const f of bundle.skillFiles) {
      expect(f.path).toMatch(/^workspace\/skills\//);
    }
  });

  it("skill files have non-zero sizeBytes", () => {
    const bundle = generateBundle(makeAnswers());
    for (const f of bundle.skillFiles) {
      expect(f.sizeBytes).toBeGreaterThan(0);
    }
  });
});

describe("generateSkillFiles", () => {
  it("always returns platform skills", () => {
    const loaded = loadBlueprint("family-hub");
    const files = generateSkillFiles(loaded.blueprint);
    const names = [...new Set(files.map((f) => f.skillName))];
    expect(names).toContain("cron-doctor");
    expect(names).toContain("scanner-triage");
  });

  it("deduplicates platform skills if also listed in skill_bundle.included", () => {
    const loaded = loadBlueprint("family-hub");
    const bp = {
      ...loaded.blueprint,
      skill_bundle: { ...loaded.blueprint.skill_bundle, included: ["cron-doctor"] },
    };
    const files = generateSkillFiles(bp);
    const cronDoctorFiles = files.filter((f) => f.skillName === "cron-doctor");
    // Should have exactly 1 SKILL.md, not duplicated
    const skillMds = cronDoctorFiles.filter((f) => f.relativePath.endsWith("SKILL.md"));
    expect(skillMds).toHaveLength(1);
  });
});

// ── Allowlist Generation ────────────────────────────────────────────────────

describe("generateAllowlistContent", () => {
  it("compiles blueprint egress_domains into YAML allowlist", () => {
    const answers = makeAnswers();
    const content = generateAllowlistContent(answers.blueprint);

    // Should be valid YAML with domain entries
    expect(content).toContain("domain:");
    expect(content).toContain("port:");
  });

  it("includes integration domains when integration names provided", () => {
    const answers = makeAnswers();
    const content = generateAllowlistContent(answers.blueprint, ["telegram"]);

    expect(content).toContain("api.telegram.org");
  });

  it("deduplicates domains from blueprint and integrations", () => {
    const { blueprint } = loadBlueprint("research-copilot");
    // research-copilot has api.tavily.com in egress_domains
    const content = generateAllowlistContent(blueprint, ["tavily"]);

    // api.tavily.com should appear only once
    const matches = content.match(/api\.tavily\.com/g);
    expect(matches).toHaveLength(1);
  });

  it("returns air-gap comment for blueprint with no egress and no integrations", () => {
    const answers = makeAnswers();
    // Override blueprint to have no egress_domains
    const emptyBp = {
      ...answers.blueprint,
      security_posture: { ...answers.blueprint.security_posture, egress_domains: [] as readonly string[] },
    };
    const content = generateAllowlistContent(emptyBp, []);

    expect(content).toContain("air-gap");
  });
});
