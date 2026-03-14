/**
 * `clawhq secrets` subcommand — add and list secrets.
 *
 * Manages secrets in .env with metadata tracking in .env.meta.
 * Never displays secret values.
 */

import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

import { Command } from "commander";

import { DEFAULT_PROBES, runProbes } from "../security/credentials/index.js";
import {
  emitSecretAuditEvent,
  readAuditEvents,
  verifyAuditChain,
} from "../security/secrets/audit.js";
import type { SecretAuditEvent } from "../security/secrets/audit.js";
import { migrateToEncrypted, decryptForDeploy } from "../security/secrets/encrypted-store.js";
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
import { PlaintextEnvStore, decryptArchive } from "../security/secrets/plaintext-store.js";
import { scanDanglingReferences } from "../security/secrets/references.js";
import type { SecretArchive } from "../security/secrets/store.js";
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

        // Emit audit event
        await emitSecretAuditEvent(envPath, "added", name);

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

  secretsCmd
    .command("audit")
    .description("Display chronological audit log of all secret events")
    .option("--verify", "Validate HMAC chain integrity")
    .option("--json", "Output as JSON")
    .action(async (opts: { verify?: boolean; json?: boolean }) => {
      const parentOpts = secretsCmd.opts() as { env: string };
      const envPath = parentOpts.env.replace(/^~/, process.env.HOME ?? "~");

      try {
        if (opts.verify) {
          const result = await verifyAuditChain(envPath);
          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else if (result.valid) {
            console.log(`Chain integrity: VALID (${result.eventCount} events verified)`);
          } else {
            console.log(`Chain integrity: TAMPERED`);
            for (const err of result.errors) {
              console.log(`  seq ${err.seq}: ${err.message}`);
            }
            process.exitCode = 1;
          }
          return;
        }

        const events = await readAuditEvents(envPath);
        if (opts.json) {
          console.log(JSON.stringify(events, null, 2));
        } else {
          console.log(formatAuditTable(events));
        }
      } catch (err: unknown) {
        console.error(
          `Failed to read audit trail: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });

  secretsCmd
    .command("export")
    .description("Export all secrets to an encrypted portable archive (.clawhq-secrets.enc)")
    .option("-o, --output <path>", "Output file path", ".clawhq-secrets.enc")
    .action(async (opts: { output: string }) => {
      const parentOpts = secretsCmd.opts() as { env: string };
      const envPath = parentOpts.env.replace(/^~/, process.env.HOME ?? "~");
      const metaPath = envPath + ".meta";

      try {
        const passphrase = await promptMaskedInput("Enter encryption passphrase: ");
        if (!passphrase) {
          console.error("No passphrase provided. Aborting.");
          process.exitCode = 1;
          return;
        }

        const confirm = await promptMaskedInput("Confirm passphrase: ");
        if (passphrase !== confirm) {
          console.error("Passphrases do not match. Aborting.");
          process.exitCode = 1;
          return;
        }

        const store = new PlaintextEnvStore(envPath, metaPath);
        const archive = await store.exportArchive(passphrase);

        await writeFile(opts.output, JSON.stringify(archive, null, 2) + "\n", "utf-8");
        console.log(`Exported ${archive.secretCount} secret${archive.secretCount === 1 ? "" : "s"} to ${opts.output}`);
      } catch (err: unknown) {
        console.error(
          `Failed to export secrets: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });

  secretsCmd
    .command("import <file>")
    .description("Import secrets from an encrypted archive with integrity verification")
    .option("--overwrite", "Overwrite existing secrets without prompting")
    .action(async (file: string, opts: { overwrite?: boolean }) => {
      const parentOpts = secretsCmd.opts() as { env: string };
      const envPath = parentOpts.env.replace(/^~/, process.env.HOME ?? "~");
      const metaPath = envPath + ".meta";

      try {
        const content = await readFile(file, "utf-8");
        const archive = JSON.parse(content) as SecretArchive;

        if (archive.version !== 1) {
          console.error(`Unsupported archive version: ${archive.version}`);
          process.exitCode = 1;
          return;
        }

        const passphrase = await promptMaskedInput("Enter archive passphrase: ");
        if (!passphrase) {
          console.error("No passphrase provided. Aborting.");
          process.exitCode = 1;
          return;
        }

        // Decrypt and verify integrity
        const payload = decryptArchive(archive, passphrase);

        // Check for conflicts
        let env: EnvFile;
        try {
          env = await readEnvFile(envPath);
        } catch {
          env = { entries: [] };
        }

        const conflicts: string[] = [];
        for (const key of Object.keys(payload.secrets)) {
          if (getEnvValue(env, key) !== undefined) {
            conflicts.push(key);
          }
        }

        if (conflicts.length > 0 && !opts.overwrite) {
          console.log(`${conflicts.length} existing secret${conflicts.length === 1 ? "" : "s"} will be overwritten:`);
          for (const key of conflicts) {
            console.log(`  ${key}`);
          }
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          const answer = await new Promise<string>((resolve) => {
            rl.question("Continue? (y/N) ", resolve);
          });
          rl.close();
          if (answer.toLowerCase() !== "y") {
            console.log("Import cancelled.");
            return;
          }
        }

        // Import secrets
        const store = new PlaintextEnvStore(envPath, metaPath);
        const imported = await store.importArchive(archive, passphrase);

        // Restore metadata
        for (const [key, meta] of Object.entries(payload.metadata)) {
          await setSecretMetadata(metaPath, key, meta.provider_category);
        }

        // Emit audit events
        for (const key of imported) {
          await emitSecretAuditEvent(envPath, "added", key);
        }

        await enforceEnvPermissions(envPath);
        console.log(`Imported ${imported.length} secret${imported.length === 1 ? "" : "s"} from ${file}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Unsupported state") || msg.includes("unable to authenticate")) {
          console.error("Decryption failed — wrong passphrase or corrupted archive");
        } else {
          console.error(`Failed to import secrets: ${msg}`);
        }
        process.exitCode = 1;
      }
    });

  secretsCmd
    .command("encrypt")
    .description("Migrate from plaintext .env to encrypted .env.enc storage")
    .action(async () => {
      const parentOpts = secretsCmd.opts() as { env: string };
      const envPath = parentOpts.env.replace(/^~/, process.env.HOME ?? "~");
      const encPath = envPath + ".enc";

      try {
        const passphrase = await promptMaskedInput("Enter encryption passphrase for .env.enc: ");
        if (!passphrase) {
          console.error("No passphrase provided. Aborting.");
          process.exitCode = 1;
          return;
        }

        const confirm = await promptMaskedInput("Confirm passphrase: ");
        if (passphrase !== confirm) {
          console.error("Passphrases do not match. Aborting.");
          process.exitCode = 1;
          return;
        }

        console.log("Migrating secrets to encrypted storage...");
        const { migratedCount } = await migrateToEncrypted(envPath, encPath, passphrase);
        console.log(`Migrated ${migratedCount} secret${migratedCount === 1 ? "" : "s"} to ${encPath}`);
        console.log("Plaintext .env has been securely wiped.");
      } catch (err: unknown) {
        console.error(
          `Failed to migrate: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exitCode = 1;
      }
    });

  secretsCmd
    .command("decrypt-for-deploy")
    .description("Decrypt .env.enc to a temporary .env for deploy (use with tmpfs mount)")
    .requiredOption("-o, --output <path>", "Output path for plaintext .env (should be on tmpfs)")
    .action(async (opts: { output: string }) => {
      const parentOpts = secretsCmd.opts() as { env: string };
      const envPath = parentOpts.env.replace(/^~/, process.env.HOME ?? "~");
      const encPath = envPath + ".enc";

      try {
        const passphrase = await promptMaskedInput("Enter .env.enc passphrase: ");
        if (!passphrase) {
          console.error("No passphrase provided. Aborting.");
          process.exitCode = 1;
          return;
        }

        await decryptForDeploy(encPath, opts.output, passphrase);
        console.log(`Decrypted secrets written to ${opts.output}`);
        console.log("Ensure this path is on tmpfs — secrets must not persist to disk.");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Unsupported state") || msg.includes("unable to authenticate")) {
          console.error("Decryption failed — wrong passphrase");
        } else {
          console.error(`Failed to decrypt: ${msg}`);
        }
        process.exitCode = 1;
      }
    });

  return secretsCmd;
}

/**
 * Format audit events as a human-readable table.
 */
export function formatAuditTable(events: SecretAuditEvent[]): string {
  if (events.length === 0) {
    return "No audit events recorded";
  }

  const seqWidth = Math.max(3, String(events[events.length - 1].seq).length);
  const eventWidth = Math.max(5, ...events.map((e) => e.event.length));
  const nameWidth = Math.max(6, ...events.map((e) => e.secret_name.length));

  const lines: string[] = [];

  lines.push(
    `${"SEQ".padEnd(seqWidth)}  ${"TIMESTAMP".padEnd(24)}  ${"EVENT".padEnd(eventWidth)}  SECRET`,
  );
  lines.push("-".repeat(seqWidth + eventWidth + nameWidth + 32));

  for (const ev of events) {
    const ts = ev.timestamp.slice(0, 19).replace("T", " ");
    lines.push(
      `${String(ev.seq).padEnd(seqWidth)}  ${ts.padEnd(24)}  ${ev.event.padEnd(eventWidth)}  ${ev.secret_name}`,
    );
  }

  lines.push("");
  lines.push(`${events.length} event${events.length === 1 ? "" : "s"}`);

  return lines.join("\n");
}
