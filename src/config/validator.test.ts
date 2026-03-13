import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OpenClawConfig, ValidationResult } from "./schema.js";
import {
  validate,
  validateCronExpression,
  checkIdentityBudget,
  LANDMINE_RULES,
  type ValidationContext,
} from "./validator.js";

function makeCtx(
  config: Partial<OpenClawConfig> = {},
  overrides: Partial<ValidationContext> = {},
): ValidationContext {
  return {
    openclawConfig: config as OpenClawConfig,
    openclawHome: "/tmp/fake-openclaw",
    ...overrides,
  };
}

function findRule(results: ValidationResult[], ruleId: string): ValidationResult {
  const r = results.find((r) => r.rule === ruleId);
  if (!r) throw new Error(`Rule ${ruleId} not found in results`);
  return r;
}

describe("LANDMINE_RULES", () => {
  it("has exactly 14 rules", () => {
    expect(LANDMINE_RULES).toHaveLength(14);
  });

  it("all rules have unique IDs", () => {
    const ids = LANDMINE_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(14);
  });
});

describe("validate returns structured results", () => {
  it("returns one result per rule", () => {
    const results = validate(makeCtx());
    expect(results).toHaveLength(14);
    for (const r of results) {
      expect(r).toHaveProperty("rule");
      expect(r).toHaveProperty("status");
      expect(r).toHaveProperty("message");
      expect(r).toHaveProperty("fix");
      expect(["pass", "warn", "fail"]).toContain(r.status);
    }
  });
});

// --- LM-01: dangerouslyDisableDeviceAuth ---

describe("LM-01: dangerouslyDisableDeviceAuth", () => {
  it("passes when set to true", () => {
    const results = validate(makeCtx({ dangerouslyDisableDeviceAuth: true }));
    expect(findRule(results, "LM-01").status).toBe("pass");
  });

  it("fails when missing", () => {
    const results = validate(makeCtx({}));
    const r = findRule(results, "LM-01");
    expect(r.status).toBe("fail");
    expect(r.fix).toContain("dangerouslyDisableDeviceAuth");
  });

  it("fails when set to false", () => {
    const results = validate(makeCtx({ dangerouslyDisableDeviceAuth: false }));
    expect(findRule(results, "LM-01").status).toBe("fail");
  });
});

// --- LM-02: allowedOrigins ---

describe("LM-02: allowedOrigins", () => {
  it("passes with non-empty array", () => {
    const results = validate(makeCtx({ allowedOrigins: ["http://localhost:18789"] }));
    expect(findRule(results, "LM-02").status).toBe("pass");
  });

  it("fails when missing", () => {
    expect(findRule(validate(makeCtx({})), "LM-02").status).toBe("fail");
  });

  it("fails when empty array", () => {
    expect(findRule(validate(makeCtx({ allowedOrigins: [] })), "LM-02").status).toBe("fail");
  });
});

// --- LM-03: trustedProxies ---

describe("LM-03: trustedProxies", () => {
  it("passes with non-empty array", () => {
    const results = validate(makeCtx({ trustedProxies: ["172.17.0.1"] }));
    expect(findRule(results, "LM-03").status).toBe("pass");
  });

  it("fails when missing", () => {
    expect(findRule(validate(makeCtx({})), "LM-03").status).toBe("fail");
  });

  it("fails when empty array", () => {
    expect(findRule(validate(makeCtx({ trustedProxies: [] })), "LM-03").status).toBe("fail");
  });
});

// --- LM-04: tools.exec.host ---

describe("LM-04: tools.exec.host", () => {
  it("passes when gateway", () => {
    const results = validate(makeCtx({ tools: { exec: { host: "gateway" } } }));
    expect(findRule(results, "LM-04").status).toBe("pass");
  });

  it("warns when not set", () => {
    expect(findRule(validate(makeCtx({})), "LM-04").status).toBe("warn");
  });

  it("fails when node", () => {
    const results = validate(makeCtx({ tools: { exec: { host: "node" } } }));
    expect(findRule(results, "LM-04").status).toBe("fail");
  });

  it("fails when sandbox", () => {
    const results = validate(makeCtx({ tools: { exec: { host: "sandbox" } } }));
    expect(findRule(results, "LM-04").status).toBe("fail");
  });
});

// --- LM-05: tools.exec.security ---

describe("LM-05: tools.exec.security", () => {
  it("passes when full", () => {
    const results = validate(makeCtx({ tools: { exec: { security: "full" } } }));
    expect(findRule(results, "LM-05").status).toBe("pass");
  });

  it("warns when not set", () => {
    expect(findRule(validate(makeCtx({})), "LM-05").status).toBe("warn");
  });

  it("fails when allowlist", () => {
    const results = validate(makeCtx({ tools: { exec: { security: "allowlist" } } }));
    expect(findRule(results, "LM-05").status).toBe("fail");
  });
});

// --- LM-06: Container user ---

describe("LM-06: Container user UID 1000", () => {
  it("passes when user: 1000:1000 present", () => {
    const results = validate(
      makeCtx({}, { composeContent: 'services:\n  agent:\n    user: "1000:1000"\n' }),
    );
    expect(findRule(results, "LM-06").status).toBe("pass");
  });

  it("passes when user: 1000 present", () => {
    const results = validate(
      makeCtx({}, { composeContent: "services:\n  agent:\n    user: 1000\n" }),
    );
    expect(findRule(results, "LM-06").status).toBe("pass");
  });

  it("fails when no user directive", () => {
    const results = validate(
      makeCtx({}, { composeContent: "services:\n  agent:\n    image: openclaw\n" }),
    );
    expect(findRule(results, "LM-06").status).toBe("fail");
  });

  it("warns when no compose content", () => {
    expect(findRule(validate(makeCtx({})), "LM-06").status).toBe("warn");
  });
});

// --- LM-07: ICC disabled ---

describe("LM-07: ICC disabled", () => {
  it("passes when ICC disabled", () => {
    const compose =
      'networks:\n  agent:\n    driver_opts:\n      com.docker.network.bridge.enable_icc: "false"\n';
    const results = validate(makeCtx({}, { composeContent: compose }));
    expect(findRule(results, "LM-07").status).toBe("pass");
  });

  it("fails when ICC not explicitly disabled", () => {
    const compose = "networks:\n  agent:\n    driver: bridge\n";
    const results = validate(makeCtx({}, { composeContent: compose }));
    expect(findRule(results, "LM-07").status).toBe("fail");
  });
});

// --- LM-08: Identity budget ---

describe("LM-08: Identity budget (config check)", () => {
  it("passes with default bootstrapMaxChars", () => {
    expect(findRule(validate(makeCtx({})), "LM-08").status).toBe("pass");
  });
});

// --- LM-09: Cron stepping ---

describe("LM-09: Cron stepping syntax", () => {
  it("validates a correct cron expression", () => {
    expect(validateCronExpression("3-58/15 * * * *").status).toBe("pass");
  });

  it("rejects invalid stepping format 5/15", () => {
    const r = validateCronExpression("5/15 * * * *");
    expect(r.status).toBe("fail");
    expect(r.message).toContain("5/15");
  });

  it("passes simple cron expressions", () => {
    expect(validateCronExpression("*/10 * * * *").status).toBe("pass");
  });

  it("rejects 0/5 in hour field", () => {
    expect(validateCronExpression("0 0/5 * * *").status).toBe("fail");
  });

  it("passes standard expressions without stepping", () => {
    expect(validateCronExpression("0 8 * * 1-5").status).toBe("pass");
  });
});

// --- LM-10: External networks ---

describe("LM-10: External networks", () => {
  it("passes when no external networks", () => {
    const results = validate(
      makeCtx({}, { composeContent: "networks:\n  agent:\n    driver: bridge\n" }),
    );
    expect(findRule(results, "LM-10").status).toBe("pass");
  });

  it("warns when external networks declared", () => {
    const compose = "networks:\n  external_net:\n    external: true\n";
    const results = validate(makeCtx({}, { composeContent: compose }));
    expect(findRule(results, "LM-10").status).toBe("warn");
  });
});

// --- LM-11: .env variables ---

describe("LM-11: .env variables", () => {
  it("passes when all vars present", () => {
    const compose = "environment:\n  - API_KEY=${API_KEY}\n  - TOKEN=${TOKEN}\n";
    const env = "API_KEY=abc123\nTOKEN=xyz789\n";
    const results = validate(makeCtx({}, { composeContent: compose, envContent: env }));
    expect(findRule(results, "LM-11").status).toBe("pass");
  });

  it("fails when vars missing from .env", () => {
    const compose = "environment:\n  - API_KEY=${API_KEY}\n  - TOKEN=${TOKEN}\n";
    const env = "API_KEY=abc123\n";
    const results = validate(makeCtx({}, { composeContent: compose, envContent: env }));
    const r = findRule(results, "LM-11");
    expect(r.status).toBe("fail");
    expect(r.message).toContain("TOKEN");
  });

  it("fails when .env is missing entirely", () => {
    const compose = "environment:\n  - API_KEY=${API_KEY}\n";
    const results = validate(makeCtx({}, { composeContent: compose }));
    expect(findRule(results, "LM-11").status).toBe("fail");
  });

  it("ignores commented lines in .env", () => {
    const compose = "environment:\n  - API_KEY=${API_KEY}\n";
    const env = "# API_KEY=old_value\nAPI_KEY=new_value\n";
    const results = validate(makeCtx({}, { composeContent: compose, envContent: env }));
    expect(findRule(results, "LM-11").status).toBe("pass");
  });
});

// --- LM-12: Read-only mounts ---

describe("LM-12: Read-only mounts", () => {
  it("passes when config mounted read-only", () => {
    const compose = "volumes:\n  - ./openclaw.json:/home/user/.openclaw/openclaw.json:ro\n";
    const results = validate(makeCtx({}, { composeContent: compose }));
    expect(findRule(results, "LM-12").status).toBe("pass");
  });

  it("fails when config not read-only", () => {
    const compose = "volumes:\n  - ./openclaw.json:/home/user/.openclaw/openclaw.json\n";
    const results = validate(makeCtx({}, { composeContent: compose }));
    expect(findRule(results, "LM-12").status).toBe("fail");
  });
});

// --- LM-13: Firewall ---

describe("LM-13: Firewall", () => {
  it("always warns (runtime check only)", () => {
    expect(findRule(validate(makeCtx({})), "LM-13").status).toBe("warn");
  });
});

// --- LM-14: fs.workspaceOnly ---

describe("LM-14: fs.workspaceOnly", () => {
  it("passes when true", () => {
    const results = validate(makeCtx({ fs: { workspaceOnly: true } }));
    expect(findRule(results, "LM-14").status).toBe("pass");
  });

  it("warns when false", () => {
    const results = validate(makeCtx({ fs: { workspaceOnly: false } }));
    expect(findRule(results, "LM-14").status).toBe("warn");
  });

  it("warns when not set", () => {
    expect(findRule(validate(makeCtx({})), "LM-14").status).toBe("warn");
  });
});

// --- checkIdentityBudget (filesystem) ---

describe("checkIdentityBudget", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "clawhq-identity-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("warns when no identity files exist", async () => {
    const r = await checkIdentityBudget(tempDir);
    expect(r.status).toBe("warn");
    expect(r.message).toContain("No identity files found");
  });

  it("passes when under budget", async () => {
    await writeFile(join(tempDir, "SOUL.md"), "x".repeat(5000));
    await writeFile(join(tempDir, "USER.md"), "x".repeat(3000));
    const r = await checkIdentityBudget(tempDir);
    expect(r.status).toBe("pass");
    expect(r.message).toContain("% of budget");
  });

  it("fails when over budget", async () => {
    await writeFile(join(tempDir, "SOUL.md"), "x".repeat(15000));
    await writeFile(join(tempDir, "USER.md"), "x".repeat(10000));
    const r = await checkIdentityBudget(tempDir);
    expect(r.status).toBe("fail");
    expect(r.message).toContain("exceeding bootstrapMaxChars");
  });

  it("warns at 90%+ usage", async () => {
    await writeFile(join(tempDir, "SOUL.md"), "x".repeat(18500));
    const r = await checkIdentityBudget(tempDir);
    expect(r.status).toBe("warn");
    expect(r.message).toContain("% of budget");
  });

  it("respects custom maxChars", async () => {
    await writeFile(join(tempDir, "SOUL.md"), "x".repeat(500));
    const r = await checkIdentityBudget(tempDir, 400);
    expect(r.status).toBe("fail");
  });
});

// --- Full validation pass scenario ---

describe("Full passing config", () => {
  it("passes all rules with a well-configured setup", () => {
    const compose = `
services:
  agent:
    user: "1000:1000"
    volumes:
      - ./openclaw.json:/home/user/.openclaw/openclaw.json:ro
networks:
  agent:
    driver: bridge
    driver_opts:
      com.docker.network.bridge.enable_icc: "false"
`;
    const config: OpenClawConfig = {
      dangerouslyDisableDeviceAuth: true,
      allowedOrigins: ["http://localhost:18789"],
      trustedProxies: ["172.17.0.1"],
      tools: { exec: { host: "gateway", security: "full" } },
      fs: { workspaceOnly: true },
    };
    const results = validate(makeCtx(config, { composeContent: compose }));
    const failures = results.filter((r) => r.status === "fail");
    expect(failures).toHaveLength(0);
  });
});
