import { join } from "node:path";

import chalk from "chalk";
import type { Command } from "commander";
import ora from "ora";

import {
  buildOwaspExport,
  createAuditConfig,
  formatAuditJson,
  formatAuditTable,
  readAuditReport,
} from "../../secure/audit/index.js";
import { writeEnvValue, deleteEnvValue, readEnvValue } from "../../secure/credentials/env-store.js";
import { formatProbeReport, runProbes } from "../../secure/credentials/health.js";
import { CommandError } from "../errors.js";
import { renderError, ensureInstalled } from "../ux.js";

async function readStdinValue(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8").trim();
}

export function registerSecureCommands(program: Command, defaultDeployDir: string): void {
  program
    .command("scan")
    .description("Scan for secrets and PII using gitleaks")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (opts: { deployDir: string }) => {
      ensureInstalled(opts.deployDir);
      const { execSync } = await import("node:child_process");

      try {
        execSync("gitleaks version", { stdio: "ignore" });
      } catch {
        console.log(chalk.yellow("gitleaks is not installed.\n"));
        console.log("Install gitleaks for secret scanning (800+ patterns, actively maintained):\n");
        console.log("  brew install gitleaks          # macOS");
        console.log("  sudo apt install gitleaks      # Debian/Ubuntu");
        console.log("  https://github.com/gitleaks/gitleaks#installing\n");
        throw new CommandError("", 1);
      }

      try {
        execSync(`gitleaks detect --source "${opts.deployDir}" --verbose`, { stdio: "inherit" });
        console.log(chalk.green("\n✔ No secrets detected."));
      } catch {
        throw new CommandError("", 1);
      }
    });

  const creds = program
    .command("creds")
    .description("Manage and check credentials for configured integrations");

  creds
    .command("check", { isDefault: true })
    .description("Check credential health for all configured integrations")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--configured", "Show only configured integrations (hide unconfigured)")
    .action(async (opts: { deployDir: string; configured?: boolean }) => {
      ensureInstalled(opts.deployDir);

      const envPath = join(opts.deployDir, "engine", ".env");
      const spinner = ora("Checking credentials…");
      spinner.start();

      try {
        const report = await runProbes({
          envPath,
          includeUnconfigured: !opts.configured,
        });

        spinner.stop();
        console.log(formatProbeReport(report));

        if (!report.healthy) {
          throw new CommandError("", 1);
        }
      } finally {
        spinner.stop();
      }
    });

  creds
    .command("set <key> [value]")
    .description("Set a credential env var (reads from stdin if value omitted). Writes to engine/.env and .env (0600).")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (key: string, value: string | undefined, opts: { deployDir: string }) => {
      ensureInstalled(opts.deployDir);
      if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
        console.error(renderError(`Invalid key "${key}" — must be SHOUTY_SNAKE_CASE`));
        throw new CommandError("", 1);
      }
      let v = value;
      if (v === undefined) {
        v = await readStdinValue();
      }
      if (!v) {
        console.error(renderError("Empty value refused — pass a value or pipe one on stdin"));
        throw new CommandError("", 1);
      }
      for (const rel of ["engine/.env", ".env"]) {
        const path = join(opts.deployDir, rel);
        writeEnvValue(path, key, v);
      }
      const preview = v.length > 8 ? `${v.slice(0, 4)}…${v.slice(-4)}` : "***";
      console.log(chalk.green(`✔ ${key} set (${preview}) — run \`clawhq apply && clawhq restart\` to pick it up`));
    });

  creds
    .command("unset <key>")
    .description("Remove a credential env var from engine/.env and .env")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (key: string, opts: { deployDir: string }) => {
      ensureInstalled(opts.deployDir);
      for (const rel of ["engine/.env", ".env"]) {
        const path = join(opts.deployDir, rel);
        deleteEnvValue(path, key);
      }
      console.log(chalk.green(`✔ ${key} removed`));
    });

  creds
    .command("get <key>")
    .description("Read a credential env var value (masked unless --show)")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--show", "Print the raw value instead of masking")
    .action((key: string, opts: { deployDir: string; show?: boolean }) => {
      ensureInstalled(opts.deployDir);
      const v = readEnvValue(join(opts.deployDir, "engine", ".env"), key);
      if (v === undefined) {
        console.error(chalk.yellow(`${key}: not set`));
        throw new CommandError("", 1);
      }
      if (opts.show) console.log(v);
      else console.log(v.length > 8 ? `${v.slice(0, 4)}…${v.slice(-4)}` : "***");
    });

  program
    .command("audit")
    .description("Tool execution + egress + secret audit trail")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON for scripting")
    .option("--export", "Export in OWASP-compatible format")
    .option("--since <datetime>", "Only show events after this ISO timestamp")
    .option("-n, --limit <count>", "Max events per stream")
    .action(async (opts: {
      deployDir: string;
      json?: boolean;
      export?: boolean;
      since?: string;
      limit?: string;
    }) => {
      ensureInstalled(opts.deployDir);

      const config = createAuditConfig(opts.deployDir, "");
      const limit = opts.limit ? parseInt(opts.limit, 10) : undefined;

      const spinner = ora("Reading audit logs…");
      if (!opts.json && !opts.export) spinner.start();

      try {
        const report = await readAuditReport(config, {
          since: opts.since,
          limit,
        });

        if (!opts.json && !opts.export) spinner.stop();

        if (opts.export) {
          const owaspExport = buildOwaspExport(report, opts.deployDir);
          console.log(JSON.stringify(owaspExport, null, 2));
        } else if (opts.json) {
          console.log(formatAuditJson(report));
        } else {
          console.log(formatAuditTable(report));
        }
      } catch (error) {
        spinner.stop();
        if (error instanceof CommandError) throw error;
        console.error(renderError(error));
        throw new CommandError("", 1);
      }
    });
}
