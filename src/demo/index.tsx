/**
 * Demo orchestrator — zero-config working agent in 60 seconds.
 *
 * Spins up a fully working demo with no configuration:
 * 1. Creates ephemeral temp directory
 * 2. Probes for Ollama, falls back to mock LLM
 * 3. Generates config from "replace-chatgpt-plus" blueprint
 * 4. Starts web chat UI on localhost
 * 5. Cleans up on exit
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { stringify as yamlStringify } from "yaml";

import { FILE_MODE_SECRET, GATEWAY_DEFAULT_PORT, OLLAMA_DEFAULT_URL } from "../config/defaults.js";
import { loadBlueprint } from "../design/blueprints/index.js";
import {
  generateBundle,
  generateIdentityFiles,
  writeBundle,
} from "../design/configure/index.js";

import { DemoChatPage } from "./chat.js";
import { createEphemeralDir, type EphemeralDir } from "./ephemeral.js";
import { startMockLlm } from "./mock-llm.js";

// ── Constants ────────────────────────────────────────────────────────────────

const DEMO_BLUEPRINT = "replace-chatgpt-plus";
const DEMO_CHAT_PORT = 3838;
const MOCK_LLM_PORT = 11435; // Avoids collision with real Ollama on 11434

// ── Types ────────────────────────────────────────────────────────────────────

export interface DemoOptions {
  readonly port?: number;
}

export interface DemoProgress {
  step: "init" | "ollama-probe" | "mock-llm" | "blueprint" | "config" | "chat-server" | "ready";
  status: "running" | "done" | "skipped";
  message: string;
}

export type ProgressCallback = (event: DemoProgress) => void;

// ── Ollama probe ─────────────────────────────────────────────────────────────

async function probeOllama(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    const res = await fetch(`${url}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

// ── Demo runner ──────────────────────────────────────────────────────────────

export async function runDemo(
  options: DemoOptions = {},
  onProgress?: ProgressCallback,
): Promise<{ port: number; close: () => void }> {
  const chatPort = options.port ?? DEMO_CHAT_PORT;
  const progress = onProgress ?? (() => {});
  const cleanups: Array<() => void> = [];

  // 1. Create ephemeral directory
  progress({ step: "init", status: "running", message: "Creating ephemeral demo environment..." });
  let ephemeral: EphemeralDir;
  try {
    ephemeral = createEphemeralDir();
    cleanups.push(ephemeral.cleanup);
    progress({ step: "init", status: "done", message: `Demo directory: ${ephemeral.path}` });
  } catch (err) {
    throw new Error(`Failed to create demo directory: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  // 2. Probe Ollama
  progress({ step: "ollama-probe", status: "running", message: "Checking for Ollama..." });
  const ollamaAvailable = await probeOllama(OLLAMA_DEFAULT_URL);
  let ollamaUrl: string;

  if (ollamaAvailable) {
    ollamaUrl = OLLAMA_DEFAULT_URL;
    progress({ step: "ollama-probe", status: "done", message: "Ollama detected — using local models" });
    progress({ step: "mock-llm", status: "skipped", message: "Skipped (Ollama available)" });
  } else {
    progress({ step: "ollama-probe", status: "done", message: "Ollama not found — starting mock LLM" });

    // 3. Start mock LLM
    progress({ step: "mock-llm", status: "running", message: "Starting demo LLM server..." });
    const mockLlm = await startMockLlm(MOCK_LLM_PORT);
    cleanups.push(mockLlm.close);
    ollamaUrl = `http://127.0.0.1:${mockLlm.port}`;
    progress({ step: "mock-llm", status: "done", message: `Mock LLM running on port ${mockLlm.port}` });
  }

  // 4. Load blueprint and generate config
  progress({ step: "blueprint", status: "running", message: `Loading "${DEMO_BLUEPRINT}" blueprint...` });
  const loaded = loadBlueprint(DEMO_BLUEPRINT);
  const blueprint = loaded.blueprint;
  progress({ step: "blueprint", status: "done", message: `Blueprint loaded: ${blueprint.name}` });

  progress({ step: "config", status: "running", message: "Forging demo agent configuration..." });
  const answers = {
    blueprint,
    blueprintPath: loaded.sourcePath,
    channel: "web" as const,
    modelProvider: "local" as const,
    localModel: ollamaAvailable ? "llama3:8b" : "demo-agent",
    gatewayPort: GATEWAY_DEFAULT_PORT,
    deployDir: ephemeral.path,
    airGapped: true,
    integrations: {},
    customizationAnswers: {},
  };

  const bundle = generateBundle(answers);
  const identityFiles = generateIdentityFiles(blueprint, answers.customizationAnswers);

  const files = [
    {
      relativePath: "engine/openclaw.json",
      content: JSON.stringify(bundle.openclawConfig, null, 2) + "\n",
    },
    {
      relativePath: "engine/docker-compose.yml",
      content: yamlStringify(bundle.composeConfig),
    },
    {
      relativePath: "engine/.env",
      content: Object.entries(bundle.envVars)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") + "\n",
      mode: FILE_MODE_SECRET,
    },
    {
      relativePath: "engine/credentials.json",
      content: JSON.stringify({}, null, 2) + "\n",
      mode: FILE_MODE_SECRET,
    },
    {
      relativePath: "cron/jobs.json",
      content: JSON.stringify(bundle.cronJobs, null, 2) + "\n",
    },
    {
      relativePath: "clawhq.yaml",
      content: yamlStringify(bundle.clawhqConfig),
    },
    ...identityFiles.map((f) => ({
      relativePath: f.relativePath,
      content: f.content,
    })),
  ];

  writeBundle(ephemeral.path, files);
  progress({ step: "config", status: "done", message: `Agent forged — ${files.length} files written` });

  // 5. Start chat web server
  progress({ step: "chat-server", status: "running", message: "Starting web chat UI..." });
  const app = new Hono();

  app.get("/", (c) => {
    return c.html(<DemoChatPage />);
  });

  // Proxy /api/chat to the LLM (avoids CORS issues in browser)
  app.post("/api/chat", async (c) => {
    try {
      const body = await c.req.text();
      const res = await fetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const data = await res.text();
      return c.text(data, 200, { "Content-Type": "application/json" });
    } catch {
      return c.json({ error: "LLM connection failed" }, 502);
    }
  });

  const chatServer = await new Promise<{ port: number; hostname: string; close: () => void }>((resolve) => {
    const server = serve(
      { fetch: app.fetch, port: chatPort, hostname: "localhost" },
      () => {
        resolve({
          port: chatPort,
          hostname: "localhost",
          close: () => { server.close(); },
        });
      },
    );
  });
  cleanups.push(chatServer.close);
  progress({ step: "chat-server", status: "done", message: `Chat UI at http://localhost:${chatServer.port}` });

  // 6. Ready
  progress({ step: "ready", status: "done", message: "Demo is running!" });

  // Return a combined close function
  return {
    port: chatServer.port,
    close: () => {
      for (const fn of cleanups.reverse()) {
        try { fn(); } catch { /* best-effort */ }
      }
    },
  };
}
