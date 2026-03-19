/**
 * Web dashboard server — Hono + htmx + Pico CSS.
 *
 * Exposes full operational control via browser: doctor, logs, approvals,
 * init, deploy, skills. Same capability as CLI users.
 *
 * All routes call the same module APIs that the CLI commands use.
 */

import { homedir } from "node:os";

import { Hono } from "hono";
import { stringify as yamlStringify } from "yaml";

import { deploy, restart, shutdown } from "../build/launcher/index.js";
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
import { SkillsPage, SkillList, SkillResult } from "./pages/skills.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface DashboardOptions {
  readonly deployDir: string;
  readonly port?: number;
  readonly hostname?: string;
}

// ── App Factory ─────────────────────────────────────────────────────────────

export function createApp(options: DashboardOptions): Hono {
  const { deployDir } = options;
  const app = new Hono();

  // ── Full Pages ──────────────────────────────────────────────────────────

  app.get("/", async (c) => {
    const status = await getStatus({ deployDir });
    return c.html(<HomePage status={status} />);
  });

  app.get("/doctor", async (c) => {
    const report = await runDoctor({ deployDir });
    return c.html(<DoctorPage report={report} />);
  });

  app.get("/logs", async (c) => {
    const result = await streamLogs({ deployDir, lines: 100 });
    return c.html(
      <LogsPage output={result.output ?? ""} lineCount={result.lineCount ?? 0} />,
    );
  });

  app.get("/deploy", async (c) => {
    const status = await getStatus({ deployDir });
    return c.html(<DeployPage status={status} />);
  });

  app.get("/approvals", async (c) => {
    const items = await listPending(deployDir);
    return c.html(<ApprovalsPage items={items} />);
  });

  app.get("/skills", async (c) => {
    const result = await listSkills({ deployDir });
    return c.html(<SkillsPage skills={result.skills} />);
  });

  app.get("/init", async (c) => {
    const loaded = loadAllBuiltinBlueprints();
    const blueprints = loaded.map((l) => l.blueprint);
    return c.html(<InitPage blueprints={blueprints} />);
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
    const lines = parseInt(c.req.query("lines") ?? "100", 10);
    const result = await streamLogs({ deployDir, lines: isNaN(lines) ? 100 : lines });
    return c.html(<LogOutput output={result.output ?? ""} />);
  });

  app.post("/api/deploy/up", async (c) => {
    try {
      const result = await deploy({ deployDir, gatewayToken: "" });
      return c.html(
        <DeployResult
          success={result.success}
          message={result.success ? "Agent started successfully" : result.error ?? "Deploy failed"}
        />,
      );
    } catch (err) {
      return c.html(
        <DeployResult success={false} message={err instanceof Error ? err.message : "Unknown error"} />,
      );
    }
  });

  app.post("/api/deploy/restart", async (c) => {
    try {
      const result = await restart({ deployDir, gatewayToken: "" });
      return c.html(
        <DeployResult
          success={result.success}
          message={result.success ? "Agent restarted" : result.error ?? "Restart failed"}
        />,
      );
    } catch (err) {
      return c.html(
        <DeployResult success={false} message={err instanceof Error ? err.message : "Unknown error"} />,
      );
    }
  });

  app.post("/api/deploy/down", async (c) => {
    try {
      const result = await shutdown({ deployDir });
      return c.html(
        <DeployResult
          success={result.success}
          message={result.success ? "Agent stopped" : result.error ?? "Shutdown failed"}
        />,
      );
    } catch (err) {
      return c.html(
        <DeployResult success={false} message={err instanceof Error ? err.message : "Unknown error"} />,
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
      return c.html(<SkillResult success={false} message="Skill source is required" />);
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
      return c.html(<InitResult success={false} message="Blueprint selection is required" />);
    }

    try {
      const loaded = loadBlueprint(blueprintName);
      const blueprint = loaded.blueprint;

      const channel = typeof body["channel"] === "string" ? body["channel"] : "telegram";
      const modelProvider = body["modelProvider"] === "cloud" ? "cloud" as const : "local" as const;
      const localModel = typeof body["localModel"] === "string" ? body["localModel"] : "llama3:8b";
      const gatewayPort = parseInt(typeof body["gatewayPort"] === "string" ? body["gatewayPort"] : "18789", 10);
      const rawDeployDir = typeof body["deployDir"] === "string" && body["deployDir"]
        ? body["deployDir"]
        : deployDir;
      const resolvedDeployDir = rawDeployDir.startsWith("~")
        ? rawDeployDir.replace("~", homedir())
        : rawDeployDir;
      const airGapped = body["airGapped"] === "true";

      const answers = {
        blueprint,
        blueprintPath: loaded.sourcePath,
        channel,
        modelProvider,
        localModel,
        gatewayPort: isNaN(gatewayPort) ? 18789 : gatewayPort,
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
          mode: 0o600,
        },
        {
          relativePath: "engine/credentials.json",
          content: JSON.stringify({}, null, 2) + "\n",
          mode: 0o600,
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
      );
    }
  });

  return app;
}
