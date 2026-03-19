import { describe, expect, it } from "vitest";

import { GATEWAY_DEFAULT_PORT } from "./defaults.js";
import {
  OPENCLAW_CONTAINER_CONFIG,
  OPENCLAW_CONTAINER_CREDENTIALS,
  OPENCLAW_CONTAINER_WORKSPACE,
} from "./paths.js";
import type {
  ComposeConfig,
  CronJobDefinition,
  DeploymentBundle,
  IdentityFileInfo,
  OpenClawConfig,
} from "./types.js";
import {
  validateBundle,
  validateLM01,
  validateLM02,
  validateLM03,
  validateLM04,
  validateLM05,
  validateLM06,
  validateLM07,
  validateLM08,
  validateLM09,
  validateLM10,
  validateLM11,
  validateLM12,
  validateLM13,
  validateLM14,
} from "./validate.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function validOpenClawConfig(): OpenClawConfig {
  return {
    dangerouslyDisableDeviceAuth: true,
    allowedOrigins: [`http://localhost:${GATEWAY_DEFAULT_PORT}`],
    trustedProxies: ["172.17.0.1"],
    tools: {
      exec: { host: "gateway", security: "full" },
    },
    fs: { workspaceOnly: true },
  };
}

function validComposeConfig(): ComposeConfig {
  return {
    services: {
      openclaw: {
        user: "1000:1000",
        cap_drop: ["ALL"],
        security_opt: ["no-new-privileges"],
        volumes: [
          `./engine/openclaw.json:${OPENCLAW_CONTAINER_CONFIG}:ro`,
          `./engine/credentials.json:${OPENCLAW_CONTAINER_CREDENTIALS}:ro`,
          `./workspace:${OPENCLAW_CONTAINER_WORKSPACE}`,
        ],
        networks: ["clawhq"],
      },
    },
    networks: {
      clawhq: {
        driver: "bridge",
        driver_opts: {
          "com.docker.network.bridge.enable_icc": "false",
        },
      },
    },
  };
}

function validCronJobs(): CronJobDefinition[] {
  return [
    {
      id: "heartbeat",
      kind: "cron",
      expr: "0-59/10 5-23 * * *",
      task: "Run heartbeat",
      enabled: true,
    },
    {
      id: "morning-brief",
      kind: "cron",
      expr: "0 8 * * *",
      task: "Morning brief",
      enabled: true,
    },
  ];
}

function validIdentityFiles(): IdentityFileInfo[] {
  return [
    { name: "SOUL.md", path: "workspace/identity/SOUL.md", sizeBytes: 3000 },
    { name: "AGENTS.md", path: "workspace/identity/AGENTS.md", sizeBytes: 2000 },
    { name: "USER.md", path: "workspace/identity/USER.md", sizeBytes: 1000 },
  ];
}

function validBundle(): DeploymentBundle {
  return {
    openclawConfig: validOpenClawConfig(),
    composeConfig: validComposeConfig(),
    envVars: {},
    cronJobs: validCronJobs(),
    identityFiles: validIdentityFiles(),
    toolFiles: [],
    clawhqConfig: { version: "1" },
  };
}

// ── LM-01: Device signature loop ────────────────────────────────────────────

describe("LM-01: dangerouslyDisableDeviceAuth", () => {
  it("passes when true", () => {
    expect(validateLM01({ dangerouslyDisableDeviceAuth: true }).passed).toBe(true);
  });

  it("fails when false", () => {
    expect(validateLM01({ dangerouslyDisableDeviceAuth: false }).passed).toBe(false);
  });

  it("fails when missing", () => {
    expect(validateLM01({}).passed).toBe(false);
  });
});

// ── LM-02: CORS errors ─────────────────────────────────────────────────────

describe("LM-02: allowedOrigins", () => {
  it("passes with origins", () => {
    expect(validateLM02({ allowedOrigins: [`http://localhost:${GATEWAY_DEFAULT_PORT}`] }).passed).toBe(true);
  });

  it("fails when empty", () => {
    expect(validateLM02({ allowedOrigins: [] }).passed).toBe(false);
  });

  it("fails when missing", () => {
    expect(validateLM02({}).passed).toBe(false);
  });
});

// ── LM-03: Docker NAT rejection ────────────────────────────────────────────

describe("LM-03: trustedProxies", () => {
  it("passes with proxies", () => {
    expect(validateLM03({ trustedProxies: ["172.17.0.1"] }).passed).toBe(true);
  });

  it("fails when empty", () => {
    expect(validateLM03({ trustedProxies: [] }).passed).toBe(false);
  });

  it("fails when missing", () => {
    expect(validateLM03({}).passed).toBe(false);
  });
});

// ── LM-04: Tool execution host ──────────────────────────────────────────────

describe("LM-04: tools.exec.host", () => {
  it("passes when gateway", () => {
    const config: OpenClawConfig = { tools: { exec: { host: "gateway", security: "full" } } };
    expect(validateLM04(config).passed).toBe(true);
  });

  it("fails when sandbox", () => {
    const config: OpenClawConfig = { tools: { exec: { host: "sandbox", security: "full" } } };
    const result = validateLM04(config);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("sandbox");
  });

  it("fails when missing", () => {
    expect(validateLM04({}).passed).toBe(false);
  });
});

// ── LM-05: Tool security ───────────────────────────────────────────────────

describe("LM-05: tools.exec.security", () => {
  it("passes when full", () => {
    const config: OpenClawConfig = { tools: { exec: { host: "gateway", security: "full" } } };
    expect(validateLM05(config).passed).toBe(true);
  });

  it("fails when allowlist", () => {
    const config: OpenClawConfig = { tools: { exec: { host: "gateway", security: "allowlist" } } };
    const result = validateLM05(config);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("allowlist");
  });
});

// ── LM-06: Container user ──────────────────────────────────────────────────

describe("LM-06: container user UID 1000", () => {
  it("passes with 1000:1000", () => {
    const compose: ComposeConfig = { services: { openclaw: { user: "1000:1000" } } };
    expect(validateLM06(compose).passed).toBe(true);
  });

  it("passes with bare 1000", () => {
    const compose: ComposeConfig = { services: { openclaw: { user: "1000" } } };
    expect(validateLM06(compose).passed).toBe(true);
  });

  it("fails with root", () => {
    const compose: ComposeConfig = { services: { openclaw: { user: "0:0" } } };
    expect(validateLM06(compose).passed).toBe(false);
  });

  it("fails when missing", () => {
    const compose: ComposeConfig = { services: { openclaw: {} } };
    expect(validateLM06(compose).passed).toBe(false);
  });
});

// ── LM-07: Container hardening ──────────────────────────────────────────────

describe("LM-07: cap_drop ALL + no-new-privileges", () => {
  it("passes with both", () => {
    const compose: ComposeConfig = {
      services: {
        openclaw: {
          cap_drop: ["ALL"],
          security_opt: ["no-new-privileges"],
        },
      },
    };
    expect(validateLM07(compose).passed).toBe(true);
  });

  it("fails without cap_drop", () => {
    const compose: ComposeConfig = {
      services: { openclaw: { security_opt: ["no-new-privileges"] } },
    };
    const result = validateLM07(compose);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("cap_drop");
  });

  it("fails without no-new-privileges", () => {
    const compose: ComposeConfig = {
      services: { openclaw: { cap_drop: ["ALL"] } },
    };
    const result = validateLM07(compose);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("no-new-privileges");
  });
});

// ── LM-08: Identity file truncation ─────────────────────────────────────────

describe("LM-08: bootstrapMaxChars", () => {
  it("passes when within limit", () => {
    const config: OpenClawConfig = { identity: { bootstrapMaxChars: 20000 } };
    const files: IdentityFileInfo[] = [
      { name: "SOUL.md", path: "identity/SOUL.md", sizeBytes: 5000 },
      { name: "AGENTS.md", path: "identity/AGENTS.md", sizeBytes: 3000 },
    ];
    expect(validateLM08(config, files).passed).toBe(true);
  });

  it("fails when exceeding limit", () => {
    const config: OpenClawConfig = { identity: { bootstrapMaxChars: 5000 } };
    const files: IdentityFileInfo[] = [
      { name: "SOUL.md", path: "identity/SOUL.md", sizeBytes: 3000 },
      { name: "AGENTS.md", path: "identity/AGENTS.md", sizeBytes: 3000 },
    ];
    const result = validateLM08(config, files);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("6000");
    expect(result.message).toContain("5000");
  });

  it("uses default 20K limit when not specified", () => {
    const files: IdentityFileInfo[] = [
      { name: "SOUL.md", path: "identity/SOUL.md", sizeBytes: 10000 },
    ];
    expect(validateLM08({}, files).passed).toBe(true);
  });
});

// ── LM-09: Cron stepping syntax ─────────────────────────────────────────────

describe("LM-09: cron stepping syntax", () => {
  it("passes with valid expressions", () => {
    const jobs: CronJobDefinition[] = [
      { id: "hb", kind: "cron", expr: "0-59/10 5-23 * * *", task: "t", enabled: true },
      { id: "mb", kind: "cron", expr: "0 8 * * *", task: "t", enabled: true },
      { id: "ev", kind: "every", everyMs: 60000, task: "t", enabled: true },
    ];
    expect(validateLM09(jobs).passed).toBe(true);
  });

  it("fails with bare N/step", () => {
    const jobs: CronJobDefinition[] = [
      { id: "bad", kind: "cron", expr: "5/15 * * * *", task: "t", enabled: true },
    ];
    const result = validateLM09(jobs);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("bad");
    expect(result.message).toContain("5/15");
  });

  it("passes with */step syntax", () => {
    const jobs: CronJobDefinition[] = [
      { id: "ok", kind: "cron", expr: "*/10 * * * *", task: "t", enabled: true },
    ];
    expect(validateLM09(jobs).passed).toBe(true);
  });
});

// ── LM-10: External networks ───────────────────────────────────────────────

describe("LM-10: network declarations", () => {
  it("passes when all networks declared", () => {
    expect(validateLM10(validComposeConfig()).passed).toBe(true);
  });

  it("fails with undeclared networks", () => {
    const compose: ComposeConfig = {
      services: { openclaw: { networks: ["clawhq", "external_net"] } },
      networks: { clawhq: {} },
    };
    const result = validateLM10(compose);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("external_net");
  });
});

// ── LM-11: Missing .env variables ──────────────────────────────────────────

describe("LM-11: .env variables", () => {
  it("passes when all env refs are satisfied", () => {
    const compose: ComposeConfig = {
      services: {
        openclaw: {
          environment: { API_KEY: "${API_KEY}" },
        },
      },
    };
    expect(validateLM11(compose, { API_KEY: "sk-123" }).passed).toBe(true);
  });

  it("fails when env ref is missing", () => {
    const compose: ComposeConfig = {
      services: {
        openclaw: {
          environment: { API_KEY: "${API_KEY}", SECRET: "${SECRET}" },
        },
      },
    };
    const result = validateLM11(compose, { API_KEY: "sk-123" });
    expect(result.passed).toBe(false);
    expect(result.message).toContain("SECRET");
  });

  it("passes with literal values (no env ref)", () => {
    const compose: ComposeConfig = {
      services: {
        openclaw: {
          environment: { NODE_ENV: "production" },
        },
      },
    };
    expect(validateLM11(compose, {}).passed).toBe(true);
  });
});

// ── LM-12: Read-only config mounts ─────────────────────────────────────────

describe("LM-12: config file read-only mounts", () => {
  it("passes with :ro flag", () => {
    const compose: ComposeConfig = {
      services: {
        openclaw: {
          volumes: ["./openclaw.json:/config/openclaw.json:ro"],
        },
      },
    };
    expect(validateLM12(compose).passed).toBe(true);
  });

  it("fails without :ro flag", () => {
    const compose: ComposeConfig = {
      services: {
        openclaw: {
          volumes: ["./openclaw.json:/config/openclaw.json"],
        },
      },
    };
    const result = validateLM12(compose);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("openclaw.json");
  });

  it("passes with object volume mount marked readOnly", () => {
    const compose: ComposeConfig = {
      services: {
        openclaw: {
          volumes: [
            { source: "./openclaw.json", target: "/config/openclaw.json", readOnly: true },
          ],
        },
      },
    };
    expect(validateLM12(compose).passed).toBe(true);
  });
});

// ── LM-13: Egress filtering ────────────────────────────────────────────────

describe("LM-13: network ICC disabled", () => {
  it("passes with ICC disabled", () => {
    expect(validateLM13(validComposeConfig()).passed).toBe(true);
  });

  it("warns without ICC disabled", () => {
    const compose: ComposeConfig = {
      networks: { clawhq: { driver: "bridge" } },
    };
    const result = validateLM13(compose);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe("warning");
  });
});

// ── LM-14: Filesystem access ───────────────────────────────────────────────

describe("LM-14: fs.workspaceOnly", () => {
  it("passes when set to true", () => {
    expect(validateLM14({ fs: { workspaceOnly: true } }).passed).toBe(true);
  });

  it("passes when set to false", () => {
    expect(validateLM14({ fs: { workspaceOnly: false } }).passed).toBe(true);
  });

  it("warns when missing", () => {
    const result = validateLM14({});
    expect(result.passed).toBe(false);
    expect(result.severity).toBe("warning");
  });
});

// ── Full Bundle Validation ──────────────────────────────────────────────────

describe("validateBundle", () => {
  it("passes a valid bundle", () => {
    const report = validateBundle(validBundle());
    expect(report.valid).toBe(true);
    expect(report.errors).toHaveLength(0);
    expect(report.results).toHaveLength(14);
  });

  it("reports errors for invalid configs", () => {
    const bundle = validBundle();
    const broken: DeploymentBundle = {
      ...bundle,
      openclawConfig: {
        ...bundle.openclawConfig,
        dangerouslyDisableDeviceAuth: false,
        allowedOrigins: [],
      },
    };
    const report = validateBundle(broken);
    expect(report.valid).toBe(false);
    expect(report.errors.length).toBeGreaterThanOrEqual(2);
    expect(report.errors.map((e) => e.rule)).toContain("LM-01");
    expect(report.errors.map((e) => e.rule)).toContain("LM-02");
  });

  it("includes actionable fix messages", () => {
    const report = validateBundle(validBundle());
    for (const result of report.results) {
      expect(result.fix).toBeDefined();
      expect(result.fix?.length).toBeGreaterThan(0);
    }
  });
});
