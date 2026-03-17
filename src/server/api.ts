/**
 * Dashboard API endpoints (v1).
 *
 * Thin adapter routes that wrap existing business logic modules.
 * All endpoints return { ok, data } or { ok: false, error } shape.
 * Streaming endpoints (deploy, build) use SSE.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { ServerConfig, ServerEnv } from "./context.js";

// --- Helper: consistent JSON response ---

function ok<T>(data: T) {
  return { ok: true as const, data };
}

function fail(error: string) {
  return { ok: false as const, error };
}

// --- API router factory ---

export function createApiRouter(config: ServerConfig): Hono<ServerEnv> {
  const api = new Hono<ServerEnv>();
  const { openclawHome } = config;

  // ──────────────────────────────────────────
  // GET /status — agent status dashboard
  // ──────────────────────────────────────────
  api.get("/status", async (c) => {
    try {
      const { collectStatus } = await import("../status/index.js");
      const report = await collectStatus({ openclawHome });
      return c.json(ok(report));
    } catch (err: unknown) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ──────────────────────────────────────────
  // GET /doctor — run diagnostic checks
  // ──────────────────────────────────────────
  api.get("/doctor", async (c) => {
    try {
      const { runChecks, DEFAULT_CHECKS } = await import("../doctor/index.js");
      const ctx = {
        openclawHome,
        configPath: `${openclawHome}/openclaw.json`,
      };
      const report = await runChecks(ctx, DEFAULT_CHECKS);
      return c.json(ok(report));
    } catch (err: unknown) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ──────────────────────────────────────────
  // POST /doctor/fix — auto-fix safe issues
  // ──────────────────────────────────────────
  api.post("/doctor/fix", async (c) => {
    try {
      const { runFixes, DEFAULT_CHECKS, isFixable } = await import("../doctor/index.js");
      const ctx = {
        openclawHome,
        configPath: `${openclawHome}/openclaw.json`,
      };
      const fixable = DEFAULT_CHECKS.filter(isFixable);
      const results = await runFixes(ctx, fixable);
      return c.json(ok(results));
    } catch (err: unknown) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ──────────────────────────────────────────
  // POST /deploy/up — deploy with SSE progress
  // ──────────────────────────────────────────
  api.post("/deploy/up", (c) => {
    return streamSSE(c, async (stream) => {
      let id = 0;
      try {
        const { deployUp } = await import("../deploy/deploy.js");
        const result = await deployUp({
          openclawHome,
          onStep: (stepName, status) => {
            stream.writeSSE({
              data: JSON.stringify({ name: stepName, status }),
              event: "step",
              id: String(id++),
            });
          },
        });
        await stream.writeSSE({
          data: JSON.stringify({ ok: true, data: result }),
          event: "done",
          id: String(id++),
        });
      } catch (err: unknown) {
        await stream.writeSSE({
          data: JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
          event: "error",
          id: String(id),
        });
      }
    });
  });

  // ──────────────────────────────────────────
  // POST /deploy/down — graceful shutdown with SSE
  // ──────────────────────────────────────────
  api.post("/deploy/down", (c) => {
    return streamSSE(c, async (stream) => {
      let id = 0;
      try {
        const { deployDown } = await import("../deploy/deploy.js");
        const result = await deployDown({
          openclawHome,
          onStep: (stepName, status) => {
            stream.writeSSE({
              data: JSON.stringify({ name: stepName, status }),
              event: "step",
              id: String(id++),
            });
          },
        });
        await stream.writeSSE({
          data: JSON.stringify({ ok: true, data: result }),
          event: "done",
          id: String(id++),
        });
      } catch (err: unknown) {
        await stream.writeSSE({
          data: JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
          event: "error",
          id: String(id),
        });
      }
    });
  });

  // ──────────────────────────────────────────
  // POST /deploy/restart — restart with SSE
  // ──────────────────────────────────────────
  api.post("/deploy/restart", (c) => {
    return streamSSE(c, async (stream) => {
      let id = 0;
      try {
        const { deployRestart } = await import("../deploy/deploy.js");
        const result = await deployRestart({
          openclawHome,
          onStep: (stepName, status) => {
            stream.writeSSE({
              data: JSON.stringify({ name: stepName, status }),
              event: "step",
              id: String(id++),
            });
          },
        });
        await stream.writeSSE({
          data: JSON.stringify({ ok: true, data: result }),
          event: "done",
          id: String(id++),
        });
      } catch (err: unknown) {
        await stream.writeSSE({
          data: JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
          event: "error",
          id: String(id),
        });
      }
    });
  });

  // ──────────────────────────────────────────
  // POST /build — two-stage Docker build with SSE
  // ──────────────────────────────────────────
  api.post("/build", (c) => {
    return streamSSE(c, async (stream) => {
      let id = 0;
      try {
        const { twoStageBuild } = await import("../docker/build.js");
        const { DockerClient } = await import("../docker/client.js");
        const client = new DockerClient();
        const result = await twoStageBuild(client, {
          context: openclawHome,
          baseTag: "clawhq-base:latest",
          finalTag: "clawhq:latest",
        });
        if (result.stage1) {
          await stream.writeSSE({
            data: JSON.stringify(result.stage1),
            event: "step",
            id: String(id++),
          });
        }
        await stream.writeSSE({
          data: JSON.stringify(result.stage2),
          event: "step",
          id: String(id++),
        });
        await stream.writeSSE({
          data: JSON.stringify({ ok: true, data: result }),
          event: "done",
          id: String(id++),
        });
      } catch (err: unknown) {
        await stream.writeSSE({
          data: JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
          event: "error",
          id: String(id),
        });
      }
    });
  });

  // ──────────────────────────────────────────
  // GET /approvals — list pending approvals
  // ──────────────────────────────────────────
  api.get("/approvals", async (c) => {
    try {
      const { getPending } = await import("../approval/index.js");
      const pending = await getPending({ openclawHome });
      return c.json(ok(pending));
    } catch (err: unknown) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ──────────────────────────────────────────
  // POST /approvals/:id/approve
  // ──────────────────────────────────────────
  api.post("/approvals/:id/approve", async (c) => {
    try {
      const id = c.req.param("id");
      const { approve } = await import("../approval/index.js");
      const result = await approve(id, { openclawHome });
      return c.json(ok(result));
    } catch (err: unknown) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ──────────────────────────────────────────
  // POST /approvals/:id/reject
  // ──────────────────────────────────────────
  api.post("/approvals/:id/reject", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json().catch(() => ({})) as { reason?: string };
      const { reject } = await import("../approval/index.js");
      const result = await reject(id, body.reason, { openclawHome });
      return c.json(ok(result));
    } catch (err: unknown) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ──────────────────────────────────────────
  // GET /alerts — predictive health alerts
  // ──────────────────────────────────────────
  api.get("/alerts", async (c) => {
    try {
      const { generateAlerts, loadHistory } = await import("../alerts/index.js");
      const snapshots = await loadHistory(openclawHome);
      const report = generateAlerts(snapshots);
      return c.json(ok(report));
    } catch (err: unknown) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ──────────────────────────────────────────
  // GET /backups — list backups
  // ──────────────────────────────────────────
  api.get("/backups", async (c) => {
    try {
      const { listBackups } = await import("../backup/index.js");
      const backups = await listBackups(`${openclawHome}/../.clawhq/backups`);
      return c.json(ok(backups));
    } catch (err: unknown) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ──────────────────────────────────────────
  // POST /backups — create backup
  // ──────────────────────────────────────────
  api.post("/backups", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({})) as {
        gpgRecipient?: string;
        secretsOnly?: boolean;
      };
      const { createBackup } = await import("../backup/index.js");
      const result = await createBackup({
        openclawHome,
        backupDir: `${openclawHome}/../.clawhq/backups`,
        gpgRecipient: body.gpgRecipient ?? "clawhq",
        secretsOnly: body.secretsOnly,
      });
      return c.json(ok(result));
    } catch (err: unknown) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ──────────────────────────────────────────
  // POST /backups/:id/restore — restore backup
  // ──────────────────────────────────────────
  api.post("/backups/:id/restore", async (c) => {
    try {
      const backupId = c.req.param("id");
      const { restoreBackup } = await import("../backup/index.js");
      const result = await restoreBackup({
        backupId,
        backupDir: `${openclawHome}/../.clawhq/backups`,
        openclawHome,
      });
      return c.json(ok(result));
    } catch (err: unknown) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ──────────────────────────────────────────
  // GET /skills — list installed skills
  // ──────────────────────────────────────────
  api.get("/skills", async (c) => {
    try {
      const { loadRegistry } = await import("../skill/index.js");
      const registry = await loadRegistry({
        openclawHome,
        clawhqDir: `${openclawHome}/../.clawhq`,
      });
      return c.json(ok(registry));
    } catch (err: unknown) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ──────────────────────────────────────────
  // POST /skills — install a skill
  // ──────────────────────────────────────────
  api.post("/skills", async (c) => {
    try {
      const body = await c.req.json() as { source: string };
      if (!body.source) {
        return c.json(fail("Missing required field: source"), 400);
      }
      const { stageSkillInstall, activateSkill } = await import("../skill/index.js");
      const ctx = {
        openclawHome,
        clawhqDir: `${openclawHome}/../.clawhq`,
      };
      const staged = await stageSkillInstall(ctx, body.source);
      await activateSkill(ctx, staged.manifest, staged.stagingDir, "registry", body.source);
      return c.json(ok({ manifest: staged.manifest, vetResult: staged.vetResult }));
    } catch (err: unknown) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ──────────────────────────────────────────
  // DELETE /skills/:name — remove a skill
  // ──────────────────────────────────────────
  api.delete("/skills/:name", async (c) => {
    try {
      const name = c.req.param("name");
      const { removeSkillOp } = await import("../skill/index.js");
      const ctx = {
        openclawHome,
        clawhqDir: `${openclawHome}/../.clawhq`,
      };
      const result = await removeSkillOp(ctx, name);
      return c.json(ok(result));
    } catch (err: unknown) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ──────────────────────────────────────────
  // GET /fleet — fleet status
  // ──────────────────────────────────────────
  api.get("/fleet", async (c) => {
    try {
      const { discoverAgents, collectFleetStatus } = await import("../fleet/index.js");
      const agents = await discoverAgents({ openclawHome });
      const report = await collectFleetStatus(agents);
      return c.json(ok(report));
    } catch (err: unknown) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ──────────────────────────────────────────
  // GET /templates — list available templates
  // ──────────────────────────────────────────
  api.get("/templates", async (c) => {
    try {
      const { loadBuiltInTemplateChoices } = await import("../templates/index.js");
      const choices = await loadBuiltInTemplateChoices();
      return c.json(ok(choices));
    } catch (err: unknown) {
      return c.json(fail(err instanceof Error ? err.message : String(err)), 500);
    }
  });

  // ──────────────────────────────────────────
  // GET /logs — SSE log streaming
  // (SSE instead of WebSocket — no additional deps needed)
  // ──────────────────────────────────────────
  api.get("/logs", (c) => {
    const category = c.req.query("category") as "agent" | "gateway" | "cron" | "error" | undefined;
    const tailParam = c.req.query("tail");
    const tail = tailParam ? parseInt(tailParam, 10) : 100;

    return streamSSE(c, async (stream) => {
      let id = 0;
      const abortController = new AbortController();

      stream.onAbort(() => {
        abortController.abort();
      });

      try {
        const { DockerClient } = await import("../docker/client.js");
        const { filterByCategory } = await import("../logs/index.js");
        const docker = new DockerClient();

        const chunks: string[] = [];

        // Create a writable stream that captures output and sends via SSE
        const { Writable } = await import("node:stream");
        const sseWriter = new Writable({
          write(chunk: Buffer, _encoding, callback) {
            const text = chunk.toString();
            const lines = text.split("\n").filter((l: string) => l.trim());
            for (const line of lines) {
              if (category) {
                const filtered = filterByCategory(line, category);
                if (!filtered.trim()) continue;
              }
              chunks.push(line);
            }
            callback();
          },
        });

        // Flush buffered lines periodically via SSE
        const flushInterval = setInterval(async () => {
          if (chunks.length > 0) {
            const batch = chunks.splice(0, chunks.length);
            try {
              await stream.writeSSE({
                data: JSON.stringify(batch),
                event: "logs",
                id: String(id++),
              });
            } catch {
              // Stream closed
              clearInterval(flushInterval);
            }
          }
        }, 500);

        abortController.signal.addEventListener("abort", () => {
          clearInterval(flushInterval);
        });

        await docker.streamLogs({
          tail,
          timestamps: true,
          stdout: sseWriter,
          stderr: sseWriter,
          signal: abortController.signal,
        });

        clearInterval(flushInterval);

        // Flush remaining
        if (chunks.length > 0) {
          await stream.writeSSE({
            data: JSON.stringify(chunks.splice(0, chunks.length)),
            event: "logs",
            id: String(id++),
          });
        }
      } catch (err: unknown) {
        if (!abortController.signal.aborted) {
          await stream.writeSSE({
            data: JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
            event: "error",
            id: String(id),
          });
        }
      }
    });
  });

  return api;
}
