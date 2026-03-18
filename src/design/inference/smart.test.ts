import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { WizardIO } from "../configure/types.js";

import { runSmartInit } from "./smart.js";

// --- Mock Ollama server ---

function createMockOllamaServer(inferenceResponse: Record<string, unknown>): {
  server: Server;
  port: number;
  start: () => Promise<void>;
  close: () => Promise<void>;
} {
  let port = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => { chunks.push(chunk); });
    req.on("end", () => {
      if (req.url === "/api/tags") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          models: [{ name: "llama3:8b", size: 4000000000, modified_at: "2024-01-01" }],
        }));
      } else if (req.url === "/api/chat") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          message: {
            role: "assistant",
            content: JSON.stringify(inferenceResponse),
          },
          done: true,
        }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });

  return {
    server,
    get port() { return port; },
    start: () => new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          port = addr.port;
        }
        resolve();
      });
    }),
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
    }),
  };
}

// --- Mock IO helper ---

function createMockIO(responses: string[]): WizardIO & { logs: string[] } {
  let idx = 0;
  const logs: string[] = [];

  return {
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
    logs,
  };
}

describe("runSmartInit", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "clawhq-smart-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("falls back to guided wizard when Ollama is unavailable", async () => {
    // Responses for: guided wizard flow (fallback)
    // name, timezone, waking start, waking end,
    // template select, messaging credential,
    // skip integrations, local-only
    const io = createMockIO([
      "test-agent",        // agent name (guided)
      "UTC",               // timezone
      "07:00",             // waking start
      "22:00",             // waking end
      "3",                 // template (replace-google-assistant)
      "bot-token-123",     // messaging credential
      "n", "n", "n",       // skip recommended
      "y",                 // local-only
    ]);

    const result = await runSmartInit({
      io,
      outputDir: tempDir,
      ollamaHost: "http://localhost:99999", // unreachable
    });

    expect(result.usedInference).toBe(false);
    expect(result.config.validationPassed).toBe(true);
  });

  describe("with mock Ollama", () => {
    let mockOllama: ReturnType<typeof createMockOllamaServer>;

    beforeAll(async () => {
      mockOllama = createMockOllamaServer({
        templateId: "replace-my-pa",
        agentName: "jarvis",
        timezone: "America/New_York",
        wakingHoursStart: "07:00",
        wakingHoursEnd: "23:00",
        integrations: ["messaging", "email", "calendar"],
        autonomyLevel: "medium",
        boundaries: ["never send emails without approval"],
        cloudProviders: [],
        cloudCategories: [],
      });
      await mockOllama.start();
    });

    afterAll(async () => {
      await mockOllama.close();
    });

    it("completes smart init with inference", async () => {
      const io = createMockIO([
        // User description
        "I want an agent that manages my email, calendar, and tasks",
        // Refinement: "Does this look right?" → yes
        "y",
        // Credential collection: messaging, email, calendar
        "bot-token-123",
        "email-pass",
        "caldav-pass",
      ]);

      const result = await runSmartInit({
        io,
        outputDir: tempDir,
        ollamaHost: `http://127.0.0.1:${mockOllama.port}`,
      });

      expect(result.usedInference).toBe(true);
      expect(result.answers.basics.agentName).toBe("jarvis");
      expect(result.answers.basics.timezone).toBe("America/New_York");
      expect(result.answers.template.id).toBe("replace-my-pa");
      expect(result.config.validationPassed).toBe(true);
      expect(result.writeResult.errors).toHaveLength(0);
    });

    it("generates valid openclaw.json from inference", async () => {
      const io = createMockIO([
        "I need a personal assistant for email and calendar",
        "y",                    // looks right
        "tok", "pass", "pass",  // credentials
      ]);

      await runSmartInit({
        io,
        outputDir: tempDir,
        ollamaHost: `http://127.0.0.1:${mockOllama.port}`,
      });

      const configPath = join(tempDir, "openclaw.json");
      const config = JSON.parse(await readFile(configPath, "utf-8"));

      // Landmine prevention
      expect(config.dangerouslyDisableDeviceAuth).toBe(true);
      expect(config.allowedOrigins).toContain("http://127.0.0.1:18789");
      expect(config.trustedProxies).toContain("172.17.0.1");
      expect(config.tools.exec.host).toBe("gateway");
      expect(config.tools.exec.security).toBe("full");
    });

    it("falls back when user provides empty description", async () => {
      const io = createMockIO([
        "",                      // empty description → fallback
        "test-agent", "UTC", "07:00", "22:00",
        "3",                     // template
        "tok",
        "n", "n", "n",
        "y",
      ]);

      const result = await runSmartInit({
        io,
        outputDir: tempDir,
        ollamaHost: `http://127.0.0.1:${mockOllama.port}`,
      });

      expect(result.usedInference).toBe(false);
    });
  });
});
