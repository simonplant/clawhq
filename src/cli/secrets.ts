/**
 * `clawhq secrets` subcommand — add and list secrets.
 *
 * Manages secrets in .env with metadata tracking in .env.meta.
 * Never displays secret values.
 */

import { createInterface } from "node:readline";

import { Command } from "commander";

import { DEFAULT_PROBES, runProbes } from "../security/credentials/index.js";
import { emitSecretAuditEvent } from "../security/secrets/audit.js";
import {
  atomicWriteEnvFile,
  getEnvValue,
  readEnvFile,
  removeEnvValue,
  setEnvValue,
  writeEnvFile,
} from "../security/secrets/env.js";
import type { EnvFile } from "../security/secrets/env.js";
import { inferCategory, readMetadata, removeSecretMetadata, setSecretMetadata } from "../security/secrets/metadata.js";
import { enforceEnvPermissions } from "../security/secrets/permissions.js";
import { scanDanglingReferences } from "../security/secrets/references.js";
import type { SecretEntry } from "../security/secrets/types.js";

/**
 * Prompt for a secret value with masked input (no echo).
 * Returns the entered string.
 */
export async function promptMaskedInput(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Disable echo by writing the prompt manually and intercepting keystrokes
    process.stdout.write(prompt);

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    // Only set raw mode if stdin is a TTY
    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    let value = "";

    const onData = (key: Buffer): void => {
      const ch = key.toString("utf-8");

      if (ch === "\r" || ch === "\n") {
        // Enter pressed
        if (stdin.isTTY) {
          stdin.setRawMode(wasRaw ?? false);
        }
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        rl.close();
        resolve(value);
        return;
      }

      if (ch === "\u0003") {
        // Ctrl+C
        if (stdin.isTTY) {
          stdin.setRawMode(wasRaw ?? false);
        }
        stdin.removeListener("data", onData);
        rl.close();
        process.exit(130);
        return;
      }

      if (ch === "\u007f" || ch === "\b") {
        // Backspace
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stdout.write("\b \b");
        }
        return;
      }

      value += ch;
      process.stdout.write("*");
    };

    stdin.on("data", onData);
  });
}

/**
 * Build the list of SecretEntry objects from .env and .env.meta.
 */
export async function buildSecretList(
  env: EnvFile,
  metaPath: string,
): Promise<SecretEntry[]> {
  const metadata = await readMetadata(metaPath);

  // Run credential probes to get health status
  const report = await runProbes(env);
  const healthMap = new Map<string, string>();
  for (const probe of DEFAULT_PROBES) {
    const result = report.results.find((r) => r.provider === probe.provider);
    if (result) {
      healthMap.set(probe.envVar, result.status);
    }
  }

  const entries: SecretEntry[] = [];
  for (const entry of env.entries) {
    if (entry.type !== "pair" || !entry.key) continue;

    const meta = metadata[entry.key];
    entries.push({
      name: entry.key,
      provider_category: meta?.provider_category ?? inferCategory(entry.key),
      health_status: (healthMap.get(entry.key) as SecretEntry["health_status"]) ?? "unknown",
      created_at: meta?.created_at ?? "",
      rotated_at: meta?.rotated_at ?? null,
    });
  }

  return entries;
}

/**
 * Format the age of a secret from its created_at timestamp.
 */
export function formatAge(createdAt: string): string {
  if (!createdAt) return "-";
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "1d";
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(days / 365);
  return `${years}y`;
}

/**
 * Format the secrets list as a human-readable table.
 */
export function formatSecretsTable(entries: SecretEntry[]): string {
  if (entries.length === 0) {
    return "No secrets found in .env";
  }

  const nameWidth = Math.max(4, ...entries.map((e) => e.name.length));
  const catWidth = Math.max(8, ...entries.map((e) => e.provider_category.length));
  const healthWidth = 7;
  const ageWidth = 5;

  const lines: string[] = [];

  lines.push(
    `${"NAME".padEnd(nameWidth)}  ${"CATEGORY".padEnd(catWidth)}  ${"HEALTH".padEnd(healthWidth)}  ${"AGE".padEnd(ageWidth)}  LAST ROTATED`,
  );
  lines.push("-".repeat(nameWidth + catWidth + healthWidth + ageWidth + 20));

  const STATUS_LABELS: Record<string, string> = {
    valid: "VALID",
    expired: "EXPRD",
    failing: "FAIL",
    error: "ERROR",
    missing: "SKIP",
    unknown: "  -",
  };

  for (const entry of entries) {
    const label = STATUS_LABELS[entry.health_status] ?? "  -";
    const age = formatAge(entry.created_at);
    const rotated = entry.rotated_at
      ? new Date(entry.rotated_at).toISOString().slice(0, 10)
      : "-";

    lines.push(
      `${entry.name.padEnd(nameWidth)}  ${entry.provider_category.padEnd(catWidth)}  ${label.padEnd(healthWidth)}  ${age.padEnd(ageWidth)}  ${rotated}`,
    );
  }

  lines.push("");
  lines.push(`${entries.length} secret${entries.length === 1 ? "" : "s"} configured`);

  return lines.join("\n");
}

/**
 * Create the `secrets` command with `add` and `list` subcommands.
 */
export function createSecretsCommand(): Command {
  const secretsCmd = new Command("secrets")
    .description("Manage secrets — add, list, rotate, and revoke")
    .option("--env <path>", "Path to .env file", "~/.openclaw/.env");

  secretsCmd
    .command("add <name>")
    .description("Add a secret (prompts for masked input, writes to .env with 600 permissions)")
    .option("--validate", "Run credential health probe after writing")
    .action(async (name: string, opts: { validate?: boolean }) => {
      const parentOpts = secretsCmd.opts() as { env: string };
      const envPath = parentOpts.env.replace(/^~/, process.env.HOME ?? "~");
      const metaPath = envPath + ".meta";

      try {
        // Read or create .env
        let env: EnvFile;
        try {
          env = await readEnvFile(envPath);
        } catch {
          // File doesn't exist yet — start with empty
          env = { entries: [] };
        }

        // Check if already exists
        const existing = getEnvValue(env, name);
        if (existing !== undefined) {
          console.log(`Secret ${name} already exists. Value will be updated.`);
        }

        // Prompt for masked input
        const value = await promptMaskedInput(`Enter value for ${name}: `);
        if (!value) {
          console.error("No value provided. Aborting.");
          process.exitCode = 1;
          return;
        }

        // Write to .env
        setEnvValue(env, name, value);
        await writeEnvFile(envPath, env);
        await enforceEnvPermissions(envPath);

        // Write metadata
        await setSecretMetadata(metaPath, name);

        console.log(`Secret ${name} written to ${envPath}`);

        // Optional validation via credential health probes
        if (opts.validate) {
          const probe = DEFAULT_PROBES.find((p) => p.envVar === name);
          if (!probe) {
            console.log(
              `No health probe available for ${name} — skipping validation`,
            );
          } else {
            console.log(`Validating ${name}...`);
            const result = await probe.check(value);
            if (result.status === "valid") {
              console.log(`✓ ${result.provider}: ${result.message}`);
            } else {
              console.log(`✗ ${result.provider}: ${result.message}`);
              process.exitCode = 1;
            }
          }
        }
      } catch (err: unknown) {
        console.error(
          `Failed to add secret: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });

  secretsCmd
    .command("list", { isDefault: true })
    .description("List secrets with name, category, health, age — never shows values")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const parentOpts = secretsCmd.opts() as { env: string };
      const envPath = parentOpts.env.replace(/^~/, process.env.HOME ?? "~");
      const metaPath = envPath + ".meta";

      try {
        const env = await readEnvFile(envPath);
        const entries = await buildSecretList(env, metaPath);

        if (opts.json) {
          console.log(JSON.stringify(entries, null, 2));
        } else {
          console.log(formatSecretsTable(entries));
        }
      } catch (err: unknown) {
        console.error(
          `Cannot read .env file at ${envPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });

  secretsCmd
    .command("rotate <name>")
    .description("Rotate a secret — prompts for new value, validates, and atomically swaps in .env")
    .option("--validate", "Run credential health probe after rotation")
    .action(async (name: string, opts: { validate?: boolean }) => {
      const parentOpts = secretsCmd.opts() as { env: string };
      const envPath = parentOpts.env.replace(/^~/, process.env.HOME ?? "~");
      const metaPath = envPath + ".meta";

      try {
        const env = await readEnvFile(envPath);

        // Verify secret exists
        const existing = getEnvValue(env, name);
        if (existing === undefined) {
          console.error(`Secret ${name} not found in ${envPath}`);
          process.exitCode = 1;
          return;
        }

        // Prompt for new value
        const value = await promptMaskedInput(`Enter new value for ${name}: `);
        if (!value) {
          console.error("No value provided. Aborting.");
          process.exitCode = 1;
          return;
        }

        // Optional validation before swapping
        if (opts.validate) {
          const probe = DEFAULT_PROBES.find((p) => p.envVar === name);
          if (probe) {
            console.log(`Validating new value for ${name}...`);
            const result = await probe.check(value);
            if (result.status !== "valid") {
              console.error(`✗ Validation failed: ${result.message}`);
              console.error("Rotation aborted — old value preserved.");
              process.exitCode = 1;
              return;
            }
            console.log(`✓ ${result.provider}: ${result.message}`);
          }
        }

        // Atomically swap in .env
        setEnvValue(env, name, value);
        await atomicWriteEnvFile(envPath, env);

        // Update rotated_at in metadata
        await setSecretMetadata(metaPath, name);

        // Emit audit event
        await emitSecretAuditEvent(envPath, "rotated", name);

        console.log(`Secret ${name} rotated successfully`);
      } catch (err: unknown) {
        console.error(
          `Failed to rotate secret: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });

  secretsCmd
    .command("revoke <name>")
    .description("Revoke a secret — removes from .env and warns about dangling references")
    .action(async (name: string) => {
      const parentOpts = secretsCmd.opts() as { env: string };
      const envPath = parentOpts.env.replace(/^~/, process.env.HOME ?? "~");
      const metaPath = envPath + ".meta";

      try {
        const env = await readEnvFile(envPath);

        // Verify secret exists
        const existing = getEnvValue(env, name);
        if (existing === undefined) {
          console.error(`Secret ${name} not found in ${envPath}`);
          process.exitCode = 1;
          return;
        }

        // Remove from .env
        removeEnvValue(env, name);
        await atomicWriteEnvFile(envPath, env);

        // Verify removal by re-reading
        const verify = await readEnvFile(envPath);
        if (getEnvValue(verify, name) !== undefined) {
          console.error(`Failed to verify removal of ${name} — secret may still be present`);
          process.exitCode = 1;
          return;
        }

        // Remove metadata
        await removeSecretMetadata(metaPath, name);

        // Emit audit event
        await emitSecretAuditEvent(envPath, "revoked", name);

        console.log(`Secret ${name} revoked and removed from ${envPath}`);

        // Scan for dangling references
        const refs = await scanDanglingReferences(name);
        if (refs.length > 0) {
          console.log("");
          console.log(`⚠ Warning: ${refs.length} dangling reference${refs.length === 1 ? "" : "s"} found:`);
          for (const ref of refs) {
            console.log(`  ${ref.file}:${ref.line} — ${ref.match}`);
          }
          console.log("");
          console.log("These config files still reference the revoked secret.");
        }
      } catch (err: unknown) {
        console.error(
          `Failed to revoke secret: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });

  return secretsCmd;
}
