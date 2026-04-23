/**
 * engine/openclaw.json — runtime config read/write.
 *
 * OpenClaw's runtime config is a ~50-field JSON document (gateway, agent,
 * tools, channels, integrations). ClawHQ doesn't re-validate the full
 * schema — OpenClaw owns that, and we track it through the 14-landmine
 * validator at src/config/validate.ts. What this module owns:
 *
 *   - One atomic reader (loadRuntimeConfig) with structural guards
 *     (must be object, not null, not array). Loud failure on malformed
 *     JSON, matches the cron-store loud-failure pattern.
 *   - One atomic writer (saveRuntimeConfig) via writeFileAtomic. Prior
 *     writers (fix.ts fixers, updater migrations) used non-atomic
 *     writeFile and could leave torn files on crash.
 *
 * The config remains typed as `Record<string, unknown>` — the TS
 * OpenClawConfig type in src/config/types.ts is an informal approximation
 * of OpenClaw's shape; the authoritative schema lives upstream. Callers
 * that need specific fields narrow at their use site.
 */

import { existsSync, readFileSync } from "node:fs";

import { FILE_MODE_SECRET } from "../config/defaults.js";
import { writeFileAtomic } from "../config/fs-atomic.js";

// ── Types ───────────────────────────────────────────────────────────────────

/** Opaque on-disk shape. Callers narrow specific fields at use. */
export type RuntimeConfig = Record<string, unknown>;

export class InvalidRuntimeConfigError extends Error {
  constructor(configPath: string, detail: string) {
    super(
      `engine/openclaw.json at ${configPath} is not a valid runtime config: ${detail}. ` +
        "Run `clawhq apply` to regenerate from the blueprint.",
    );
    this.name = "InvalidRuntimeConfigError";
  }
}

// ── Load ────────────────────────────────────────────────────────────────────

/**
 * Read and structurally validate engine/openclaw.json.
 *
 * @throws {InvalidRuntimeConfigError} when the file is missing (callers
 *   should precheck with existsSync if ENOENT is a non-error), when JSON
 *   parsing fails, or when the root isn't a plain object. Full schema
 *   validation (the 14-landmine rules) stays in src/config/validate.ts.
 */
export function loadRuntimeConfig(configPath: string): RuntimeConfig {
  if (!existsSync(configPath)) {
    throw new InvalidRuntimeConfigError(configPath, "file does not exist");
  }

  const raw = readFileSync(configPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new InvalidRuntimeConfigError(configPath, `invalid JSON — ${msg}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    const actual = parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed;
    throw new InvalidRuntimeConfigError(configPath, `root is ${actual}, expected object`);
  }
  return parsed as RuntimeConfig;
}

// ── Save ────────────────────────────────────────────────────────────────────

/**
 * Write engine/openclaw.json atomically. Canonical formatting: 2-space
 * indent, trailing newline, file mode 0600 (matches FILE_MODE_SECRET —
 * openclaw.json contains agent identity + model routing secrets in its
 * `agent.model` / `channels.*.tokens` sections).
 */
export function saveRuntimeConfig(configPath: string, config: RuntimeConfig): void {
  const content = JSON.stringify(config, null, 2) + "\n";
  writeFileAtomic(configPath, content, FILE_MODE_SECRET);
}
