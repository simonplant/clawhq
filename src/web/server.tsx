/**
 * Web dashboard server — Hono + htmx + Pico CSS.
 *
 * Exposes full operational control via browser: doctor, logs, approvals,
 * init, deploy, skills. Same capability as CLI users.
 *
 * All routes call the same module APIs that the CLI commands use.
 */

import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { realpathSync } from "node:fs";

import { Hono } from "hono";
import { stringify as yamlStringify } from "yaml";

import { deploy, restart, shutdown } from "../build/launcher/index.js";
import { FILE_MODE_SECRET, GATEWAY_DEFAULT_PORT, OLLAMA_DEFAULT_MODEL } from "../config/defaults.js";
import { readEnvValue } from "../secure/credentials/env-store.js";
import {
  loadAllBuiltinBlueprints,
  loadBlueprint,
} from "../design/blueprints/index.js";
import {
  generateBundle,
  generateIdentityFiles,
  writeBundle,
} from "../design/configure/index.js";
import {
  approve as approveItem,
  listPending,
  reject as rejectItem,
} from "../evolve/approval/index.js";
import {
  installSkill,
  listSkills,
  removeSkill,
} from "../evolve/skills/index.js";
import {
  runDoctor,
  runDoctorWithFix,
} from "../operate/doctor/index.js";
import { streamLogs } from "../operate/logs/index.js";
import { getStatus } from "../operate/status/index.js";

import { ApprovalsPage, ApprovalList } from "./pages/approvals.js";
import { DeployPage, DeployResult } from "./pages/deploy.js";
import { DoctorPage, DoctorResults } from "./pages/doctor.js";
import { HomePage, StatusCard } from "./pages/home.js";
import { InitPage, InitResult } from "./pages/init.js";
import { LogsPage, LogOutput } from "./pages/logs.js";
import { SentinelPricingPage, SignupConfirmation } from "./pages/sentinel.js";
import { SkillsPage, SkillList, SkillResult } from "./pages/skills.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface DashboardOptions {
  readonly deployDir: string;
  readonly port?: number;
  readonly hostname?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_LOG_LINES = 10_000;
const LOG_RATE_LIMIT = 30;
const LOG_RATE_WINDOW_MS = 60_000;

// ── App Factory ─────────────────────────────────────────────────────────────

export function createApp(options: DashboardOptions): Hono {
  const { deployDir } = options;
  const app = new Hono();

  // CSRF token — generated per app instance
  const csrfToken = randomBytes(32).toString("hex");

  // Rate limiter state for /api/logs
  const logRequestTimes: number[] = [];

  // ── CSRF Middleware ──────────────────────────────────────────────────────
  app.use("*", async (c, next) => {
    if (c.req.method === "POST") {
      // Sentinel signup is public-facing — exempt from CSRF
      const path = new URL(c.req.url).pathname;
      if (!path.startsWith("/sentinel/")) {
        const headerToken = c.req.header("X-CSRF-Token");
        if (headerToken !== csrfToken) {
          return c.html("<p>CSRF token validation failed</p>", 403);
        }
      }
    }
    await next();
  });

  // ── Full Pages ──────────────────────────────────────────────────────────

  app.get("/", async (c) => {
    const status = await getStatus({ deployDir });
    return c.html(<HomePage status={status} csrfToken={csrfToken} />);
  });

  app.get("/doctor", async (c) => {
    const report = await runDoctor({ deployDir });
    return c.html(<DoctorPage report={report} csrfToken={csrfToken} />);
  });

  app.get("/logs", async (c) => {
    const result = await streamLogs({ deployDir, lines: 100 });
    return c.html(
      <LogsPage output={result.output ?? ""} lineCount={result.lineCount ?? 0} csrfToken={csrfToken} />,
    );
  });

  app.get("/deploy", async (c) => {
    const status = await getStatus({ deployDir });
    return c.html(<DeployPage status={status} csrfToken={csrfToken} />);
  });

  app.get("/approvals", async (c) => {
    const items = await listPending(deployDir);
    return c.html(<ApprovalsPage items={items} csrfToken={csrfToken} />);
  });

  app.get("/skills", async (c) => {
    const result = await listSkills({ deployDir });
    return c.html(<SkillsPage skills={result.skills} csrfToken={csrfToken} />);
  });

  app.get("/init", async (c) => {
    const loaded = loadAllBuiltinBlueprints();
    const blueprints = loaded.map((l) => l.blueprint);
    return c.html(<InitPage blueprints={blueprints} csrfToken={csrfToken} />);
  });

  // ── API Endpoints (htmx partials) ───────────────────────────────────────

  app.get("/api/status", async (c) => {
    const status = await getStatus({ deployDir });
    return c.html(<StatusCard status={status} />);
  });

  app.post("/api/doctor", async (c) => {
    const report = await runDoctor({ deployDir });
    return c.html(<DoctorResults report={report} />);
  });

  app.post("/api/doctor/fix", async (c) => {
    const { report } = await runDoctorWithFix({ deployDir });
    return c.html(<DoctorResults report={report} />);
  });

  app.get("/api/logs", async (c) => {
    // Rate limiting
    const now = Date.now();
    while (logRequestTimes.length > 0 && logRequestTimes[0]! < now - LOG_RATE_WINDOW_MS) {
      logRequestTimes.shift();
    }
    if (logRequestTimes.length >= LOG_RATE_LIMIT) {
      return c.html("<p>Rate limit exceeded. Try again later.</p>", 429);
    }
    logRequestTimes.push(now);

    const rawLines = parseInt(c.req.query("lines") ?? "100", 10);
    const lines = Math.max(1, Math.min(isNaN(rawLines) ? 100 : rawLines, MAX_LOG_LINES));
    const result = await streamLogs({ deployDir, lines });
    return c.html(<LogOutput output={result.output ?? ""} />);
  });

  app.post("/api/deploy/up", async (c) => {
    try {
      const gatewayToken = readEnvValue(join(deployDir, "engine", ".env"), "OPENCLAW_GATEWAY_TOKEN") ?? "";
      const result = await deploy({ deployDir, gatewayToken });
      if (!result.success) {
        return c.html(
          <DeployResult success={false} message={result.error ?? "Deploy failed"} />,
          500,
        );
      }
      return c.html(
        <DeployResult success={true} message="Agent started successfully" />,
      );
    } catch (err) {
      return c.html(
        <DeployResult success={false} message={err instanceof Error ? err.message : "Unknown error"} />,
        500,
      );
    }
  });

  app.post("/api/deploy/restart", async (c) => {
    try {
      const gatewayToken = readEnvValue(join(deployDir, "engine", ".env"), "OPENCLAW_GATEWAY_TOKEN") ?? "";
      const result = await restart({ deployDir, gatewayToken });
      if (!result.success) {
        return c.html(
          <DeployResult success={false} message={result.error ?? "Restart failed"} />,
          500,
        );
      }
      return c.html(
        <DeployResult success={true} message="Agent restarted" />,
      );
    } catch (err) {
      return c.html(
        <DeployResult success={false} message={err instanceof Error ? err.message : "Unknown error"} />,
        500,
      );
    }
  });

  app.post("/api/deploy/down", async (c) => {
    try {
      const result = await shutdown({ deployDir });
      if (!result.success) {
        return c.html(
          <DeployResult success={false} message={result.error ?? "Shutdown failed"} />,
          500,
        );
      }
      return c.html(
        <DeployResult success={true} message="Agent stopped" />,
      );
    } catch (err) {
      return c.html(
        <DeployResult success={false} message={err instanceof Error ? err.message : "Unknown error"} />,
        500,
      );
    }
  });

  app.get("/api/approvals", async (c) => {
    const items = await listPending(deployDir);
    return c.html(<ApprovalList items={items} />);
  });

  app.post("/api/approvals/:id/approve", async (c) => {
    const id = c.req.param("id");
    await approveItem(deployDir, id, { resolvedVia: "web" });
    const items = await listPending(deployDir);
    return c.html(<ApprovalList items={items} />);
  });

  app.post("/api/approvals/:id/reject", async (c) => {
    const id = c.req.param("id");
    await rejectItem(deployDir, id, { resolvedVia: "web" });
    const items = await listPending(deployDir);
    return c.html(<ApprovalList items={items} />);
  });

  app.get("/api/skills", async (c) => {
    const result = await listSkills({ deployDir });
    return c.html(<SkillList skills={result.skills} />);
  });

  app.post("/api/skills/install", async (c) => {
    const body = await c.req.parseBody();
    const source = typeof body["source"] === "string" ? body["source"] : "";
    if (!source) {
      return c.html(<SkillResult success={false} message="Skill source is required" />, 400);
    }
    const result = await installSkill({ deployDir, source, autoApprove: true });
    return c.html(
      <SkillResult
        success={result.success}
        message={result.success ? `Skill "${result.skillName}" installed` : result.error ?? "Install failed"}
      />,
    );
  });

  app.post("/api/skills/:name/remove", async (c) => {
    const name = decodeURIComponent(c.req.param("name"));
    const result = await removeSkill(deployDir, name);
    if (result.success) {
      const skillResult = await listSkills({ deployDir });
      return c.html(<SkillList skills={skillResult.skills} />);
    }
    return c.html(<SkillResult success={false} message={result.error ?? "Remove failed"} />);
  });

  app.post("/api/init", async (c) => {
    const body = await c.req.parseBody();
    const blueprintName = typeof body["blueprint"] === "string" ? body["blueprint"] : "";
    if (!blueprintName) {
      return c.html(<InitResult success={false} message="Blueprint selection is required" />, 400);
    }

    try {
      const loaded = loadBlueprint(blueprintName);
      const blueprint = loaded.blueprint;

      const channel = typeof body["channel"] === "string" ? body["channel"] : "telegram";
      const modelProvider = body["modelProvider"] === "cloud" ? "cloud" as const : "local" as const;
      const localModel = typeof body["localModel"] === "string" ? body["localModel"] : OLLAMA_DEFAULT_MODEL;
      const gatewayPort = parseInt(typeof body["gatewayPort"] === "string" ? body["gatewayPort"] : String(GATEWAY_DEFAULT_PORT), 10);
      if (isNaN(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535) {
        return c.html(<InitResult success={false} message="Invalid gateway port: must be 1-65535" />, 400);
      }
      const rawDeployDir = typeof body["deployDir"] === "string" && body["deployDir"]
        ? body["deployDir"]
        : deployDir;
      const tildeExpanded = rawDeployDir.startsWith("~")
        ? rawDeployDir.replace("~", homedir())
        : rawDeployDir;
      const resolvedDeployDir = resolve(tildeExpanded);
      // Resolve symlinks to prevent path traversal via symlink chains
      let realDeployDir: string;
      try {
        realDeployDir = realpathSync(resolvedDeployDir);
      } catch {
        realDeployDir = resolvedDeployDir; // Path doesn't exist yet — use resolved
      }
      const home = homedir();
      const rel = relative(home, realDeployDir);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        return c.html(`<div class="error">Deploy directory must be within your home directory</div>`, 400);
      }
      const airGapped = body["airGapped"] === "true";

      const answers = {
        blueprint,
        blueprintPath: loaded.sourcePath,
        channel,
        modelProvider,
        localModel,
        gatewayPort,
        deployDir: resolvedDeployDir,
        airGapped,
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

      const writeResult = writeBundle(resolvedDeployDir, files);

      return c.html(
        <InitResult
          success={true}
          message={`Agent forged from "${blueprintName}" blueprint`}
          files={writeResult.written}
        />,
      );
    } catch (err) {
      return c.html(
        <InitResult
          success={false}
          message={err instanceof Error ? err.message : "Unknown error during setup"}
        />,
        500,
      );
    }
  });

  // ── Sentinel Pricing (public-facing) ──────────────────────────────────

  app.get("/sentinel", (c) => {
    return c.html(<SentinelPricingPage />);
  });

  app.post("/sentinel/signup", async (c) => {
    const body = await c.req.parseBody();
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!email || !email.includes("@")) {
      return c.html("<p>Please provide a valid email address.</p>", 400);
    }
    // Store signup for revenue validation — in production, this hits the Sentinel API.
    // For MVP, log the signup and show confirmation.
    console.log(`[sentinel] Waitlist signup: ${email}`);
    return c.html(<SignupConfirmation email={email} />);
  });

  return app;
}
