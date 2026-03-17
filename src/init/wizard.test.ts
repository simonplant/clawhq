import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { FetchFn } from "./detect.js";
import { getBuiltInTemplates } from "./templates.js";
import type { TemplateChoice, WizardIO } from "./types.js";
import { runWizard } from "./wizard.js";

let TEMPLATES: TemplateChoice[];

beforeAll(async () => {
  TEMPLATES = await getBuiltInTemplates();
});

// --- Test IO helper ---

function createMockIO(responses: string[]): { io: WizardIO; logs: string[] } {
  let idx = 0;
  const logs: string[] = [];

  const io: WizardIO = {
    async prompt(_text: string, defaultValue?: string): Promise<string> {
      const answer = responses[idx++] ?? "";
      return answer || defaultValue || "";
    },
    async select(_text: string, choices: string[]): Promise<number> {
      const answer = responses[idx++] ?? "0";
      const num = parseInt(answer, 10);
      return Math.min(Math.max(0, num), choices.length - 1);
    },
    async confirm(_text: string, defaultValue = true): Promise<boolean> {
      const answer = responses[idx++] ?? "";
      if (answer === "") return defaultValue;
      return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
    },
    log(message: string): void {
      logs.push(message);
    },
  };

  return { io, logs };
}

/** Mock fetch that simulates Ollama being unavailable (test default). */
const mockFetchFail: FetchFn = async () => {
  throw new Error("Connection refused");
};

/** Mock fetch that returns Ollama models. */
function mockFetchOllama(models: Array<{ name: string; size: number; details?: { parameter_size?: string } }>): FetchFn {
  return async () => ({
    ok: true,
    json: async () => ({ models }),
  });
}

describe("runWizard", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "clawhq-init-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("completes the full wizard flow with default answers", async () => {
    // Responses: name, timezone, waking start, waking end,
    // template select, email (for detection), messaging credential,
    // set up email? (y), email cred, set up calendar? (n), set up tasks? (n),
    // local-only? (y)
    const { io } = createMockIO([
      "test-agent",        // agent name
      "America/New_York",  // timezone
      "07:00",             // waking start
      "22:00",             // waking end
      "3",                 // template: Replace Google Assistant
      "",                  // email for detection (skip)
      "bot-token-123",     // messaging (required) credential
      "y",                 // set up email?
      "email-pass-456",    // email credential
      "n",                 // set up calendar?
      "n",                 // set up tasks?
      "y",                 // local-only?
    ]);

    const result = await runWizard(io, tempDir, { fetchFn: mockFetchFail });

    expect(result.answers.basics.agentName).toBe("test-agent");
    expect(result.answers.basics.timezone).toBe("America/New_York");
    expect(result.answers.template.id).toBe("replace-google-assistant");
    expect(result.config.validationPassed).toBe(true);
    expect(result.writeResult.errors).toHaveLength(0);
    expect(result.writeResult.filesWritten.length).toBeGreaterThan(0);
  });

  it("generates openclaw.json with correct landmine prevention", async () => {
    const { io } = createMockIO([
      "myagent", "UTC", "06:00", "23:00",
      "3",                    // template (replace-google-assistant)
      "",                     // email for detection
      "tok",                  // messaging cred
      "n", "n", "n",         // skip recommended integrations
      "y",                    // local-only
    ]);

    await runWizard(io, tempDir, { fetchFn: mockFetchFail });

    const configPath = join(tempDir, "openclaw.json");
    const config = JSON.parse(await readFile(configPath, "utf-8"));

    // LM-01
    expect(config.dangerouslyDisableDeviceAuth).toBe(true);
    // LM-02
    expect(config.allowedOrigins).toContain("http://127.0.0.1:18789");
    // LM-03
    expect(config.trustedProxies).toContain("172.17.0.1");
    // LM-04
    expect(config.tools.exec.host).toBe("gateway");
    // LM-05
    expect(config.tools.exec.security).toBe("full");
    // LM-14
    expect(config.fs.workspaceOnly).toBe(true);
  });

  it("generates .env with 600 permissions", async () => {
    const { io } = createMockIO([
      "myagent", "UTC", "06:00", "23:00",
      "3",                 // template (replace-google-assistant)
      "",                  // email for detection
      "secret-token",
      "n", "n", "n",
      "y",
    ]);

    await runWizard(io, tempDir, { fetchFn: mockFetchFail });

    const envPath = join(tempDir, ".env");
    const envContent = await readFile(envPath, "utf-8");
    expect(envContent).toContain("TELEGRAM_BOT_TOKEN=secret-token");

    const stats = await stat(envPath);
    // Check owner-only read/write (0o600)
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("generates docker-compose.yml with security hardening", async () => {
    const { io } = createMockIO([
      "myagent", "UTC", "06:00", "23:00",
      "3",                 // template (replace-google-assistant)
      "",                  // email for detection
      "tok",
      "n", "n", "n",
      "y",
    ]);

    await runWizard(io, tempDir, { fetchFn: mockFetchFail });

    const composePath = join(tempDir, "docker-compose.yml");
    const compose = await readFile(composePath, "utf-8");

    // LM-06: UID 1000
    expect(compose).toContain("1000:1000");
    // LM-07: ICC disabled
    expect(compose).toContain("enable_icc");
    // Container name
    expect(compose).toContain("openclaw-myagent");
  });

  it("generates identity files in workspace/", async () => {
    const { io } = createMockIO([
      "myagent", "UTC", "06:00", "23:00",
      "3",                 // template (replace-google-assistant)
      "",                  // email for detection
      "tok",
      "n", "n", "n",
      "y",
    ]);

    await runWizard(io, tempDir, { fetchFn: mockFetchFail });

    const soulPath = join(tempDir, "workspace", "SOUL.md");
    const soul = await readFile(soulPath, "utf-8");
    expect(soul).toContain("myagent");
    expect(soul).toContain("trusted steward");

    const userPath = join(tempDir, "workspace", "USER.md");
    const user = await readFile(userPath, "utf-8");
    expect(user).toContain("User Context");
  });

  it("generates cron/jobs.json with valid schedules", async () => {
    const { io } = createMockIO([
      "myagent", "UTC", "07:00", "22:00",
      "3",                 // template (replace-google-assistant)
      "",                  // email for detection
      "tok",
      "n", "n", "n",
      "y",
    ]);

    await runWizard(io, tempDir, { fetchFn: mockFetchFail });

    const cronPath = join(tempDir, "cron", "jobs.json");
    const jobs = JSON.parse(await readFile(cronPath, "utf-8"));

    expect(Array.isArray(jobs)).toBe(true);
    expect(jobs.length).toBeGreaterThan(0);

    // Verify heartbeat job exists
    const heartbeat = jobs.find((j: { id: string }) => j.id === "heartbeat");
    expect(heartbeat).toBeDefined();
    expect(heartbeat.enabled).toBe(true);

    // LM-09: No invalid stepping syntax (N/M without range)
    for (const job of jobs) {
      const fields = (job.expr ?? "").split(" ");
      for (const field of fields) {
        // Valid forms: */N, N-M/N, plain number, *, N,M
        expect(field).not.toMatch(/^\d+\/\d+$/);
      }
    }
  });

  it("includes cloud providers in config when not local-only", async () => {
    const { io } = createMockIO([
      "myagent", "UTC", "06:00", "23:00",
      "3",                            // template (replace-google-assistant)
      "",                             // email for detection
      "tok",                          // messaging
      "n", "n", "n",                  // skip integrations
      "n",                            // NOT local-only
      "y",                            // enable Anthropic
      "sk-ant-test-key",              // Anthropic key
      "n",                            // skip OpenAI
      "n", "n", "n", "y", "n",       // category opt-in (only research=y)
    ]);

    const result = await runWizard(io, tempDir, { fetchFn: mockFetchFail });

    expect(result.answers.modelRouting.localOnly).toBe(false);
    expect(result.answers.modelRouting.cloudProviders).toHaveLength(1);
    expect(result.answers.modelRouting.cloudProviders[0].provider).toBe("anthropic");

    // Check .env has the key
    const envPath = join(tempDir, ".env");
    const envContent = await readFile(envPath, "utf-8");
    expect(envContent).toContain("ANTHROPIC_API_KEY=sk-ant-test-key");
  });

  it("all validation rules pass on generated config", async () => {
    const { io } = createMockIO([
      "test-agent", "UTC", "06:00", "23:00",
      "3",                 // template (replace-google-assistant)
      "",                  // email for detection
      "tok",
      "n", "n", "n",
      "y",
    ]);

    const result = await runWizard(io, tempDir, { fetchFn: mockFetchFail });

    const failures = result.config.validationResults.filter(
      (r) => r.status === "fail",
    );
    expect(failures).toHaveLength(0);
  });

  it("includes detection result when email provider detected", async () => {
    const { io } = createMockIO([
      "test-agent", "UTC", "06:00", "23:00",
      "3",                          // template (replace-google-assistant)
      "user@gmail.com",             // email for detection → triggers Google discovery
      "y",                          // confirm detected services
      "tok",                        // messaging
      "n",                          // set up email?
      "n",                          // set up calendar? (auto-detected but user can skip)
      "n",                          // set up tasks? (auto-detected but user can skip)
      "y",                          // local-only
    ]);

    const result = await runWizard(io, tempDir, { fetchFn: mockFetchFail });

    expect(result.detection).toBeDefined();
    expect(result.detection?.discoveredIntegrations).not.toBeNull();
    expect(result.detection?.discoveredIntegrations?.provider).toBe("google");
    expect(result.config.validationPassed).toBe(true);
  });

  it("includes detection result with Ollama models", async () => {
    const fetch = mockFetchOllama([
      { name: "llama3:8b", size: 4_000_000_000, details: { parameter_size: "8B" } },
    ]);

    const { io } = createMockIO([
      "test-agent", "UTC", "06:00", "23:00",
      "3",                 // template (replace-google-assistant)
      "",                  // no email
      "y",                 // confirm detected services (Ollama found)
      "tok",               // messaging
      "n", "n", "n",       // skip integrations
      "y",                 // local-only
    ]);

    const result = await runWizard(io, tempDir, { fetchFn: fetch });

    expect(result.detection).toBeDefined();
    expect(result.detection?.ollamaModels).toHaveLength(1);
    expect(result.detection?.ollamaModels[0].name).toBe("llama3:8b");
    expect(result.detection?.ollamaAvailable).toBe(true);
  });

  it("completes air-gapped wizard with no detection or cloud steps", async () => {
    const { io, logs } = createMockIO([
      "air-agent",           // agent name
      "UTC",                 // timezone
      "06:00",               // waking start
      "23:00",               // waking end
      "3",                   // template: Replace Google Assistant
      "tok",                 // messaging (required) credential
      "n", "n", "n",         // skip recommended integrations
    ]);

    const result = await runWizard(io, tempDir, {
      fetchFn: mockFetchFail,
      airGapped: true,
    });

    // Air-gapped flag should be set
    expect(result.answers.airGapped).toBe(true);
    // Should be local-only with no cloud providers
    expect(result.answers.modelRouting.localOnly).toBe(true);
    expect(result.answers.modelRouting.cloudProviders).toHaveLength(0);
    // All categories should disallow cloud
    for (const cat of result.answers.modelRouting.categories) {
      expect(cat.cloudAllowed).toBe(false);
    }
    // Config should validate and write successfully
    expect(result.config.validationPassed).toBe(true);
    expect(result.writeResult.errors).toHaveLength(0);
    // Should log air-gapped banner
    expect(logs.some((l) => l.includes("AIR-GAPPED MODE"))).toBe(true);
    // Should NOT have email detection prompt in logs (skipped)
    expect(logs.some((l) => l.includes("Auto-Detection"))).toBe(false);
  });

  it("air-gapped config has no cloud API env vars", async () => {
    const { io } = createMockIO([
      "air-agent", "UTC", "06:00", "23:00",
      "3",                   // template
      "tok",                 // messaging
      "n", "n", "n",         // skip integrations
    ]);

    const result = await runWizard(io, tempDir, {
      fetchFn: mockFetchFail,
      airGapped: true,
    });

    const envPath = join(tempDir, ".env");
    const envContent = await readFile(envPath, "utf-8");
    expect(envContent).not.toContain("ANTHROPIC_API_KEY");
    expect(envContent).not.toContain("OPENAI_API_KEY");
    expect(result.config.validationPassed).toBe(true);
  });

  it("air-gapped docker-compose includes air-gapped label", async () => {
    const { io } = createMockIO([
      "air-agent", "UTC", "06:00", "23:00",
      "3",                   // template
      "tok",                 // messaging
      "n", "n", "n",         // skip integrations
    ]);

    await runWizard(io, tempDir, {
      fetchFn: mockFetchFail,
      airGapped: true,
    });

    const composePath = join(tempDir, "docker-compose.yml");
    const compose = await readFile(composePath, "utf-8");
    expect(compose).toContain("clawhq.air-gapped");
  });
});

describe("getBuiltInTemplates", () => {
  it("has 6 built-in templates", () => {
    expect(TEMPLATES).toHaveLength(6);
  });

  it("all templates have unique IDs", () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(TEMPLATES.length);
  });

  it("all templates require messaging", () => {
    for (const t of TEMPLATES) {
      expect(t.integrationsRequired).toContain("messaging");
    }
  });

  it("all templates have security posture set", () => {
    for (const t of TEMPLATES) {
      expect(["standard", "hardened", "paranoid"]).toContain(t.security.posture);
    }
  });
});
