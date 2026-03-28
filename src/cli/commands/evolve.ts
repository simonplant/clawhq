import { join } from "node:path";

import type { Command } from "commander";

import chalk from "chalk";
import ora from "ora";

import {
  approve as approveItem,
  countPending,
  listPending,
  reject as rejectItem,
  sendApprovalNotification,
  startApprovalBot,
} from "../../evolve/approval/index.js";
import type { TelegramConfig } from "../../evolve/approval/index.js";
import {
  destroyAgent,
  exportBundle,
  formatDestroyJson,
  formatDestroyTable,
  formatExportJson,
  formatExportTable,
  formatVerifyResult,
  verifyDestructionProof,
} from "../../evolve/lifecycle/index.js";
import type { DestructionProof, LifecycleProgress } from "../../evolve/lifecycle/index.js";
import {
  analyzePreferences,
  formatLifecycleResult,
  formatLifecycleResultJson,
  formatMemoryStatus,
  formatMemoryStatusJson,
  formatPreferenceReport,
  formatPreferenceReportJson,
  getMemoryStatus,
  runLifecycle,
} from "../../evolve/memory/index.js";
import type { MemoryProgress } from "../../evolve/memory/index.js";
import {
  formatSkillList,
  formatSkillListJson,
  installSkill,
  listSkills,
  removeSkill,
  updateAllSkills,
  updateSkill,
} from "../../evolve/skills/index.js";
import type { SkillProgress } from "../../evolve/skills/index.js";
import {
  availableToolNames,
  formatToolList,
  formatToolListJson,
  installTool,
  listTools,
  removeTool,
} from "../../evolve/tools/index.js";
import { listIntegrations } from "../../evolve/integrate/index.js";
import { createAuditConfig } from "../../secure/audit/index.js";

import { renderError, warnIfNotInstalled } from "../ux.js";

function createSkillProgressHandler(spinner: ReturnType<typeof ora>) {
  return (event: SkillProgress): void => {
    const label = chalk.dim(`[${event.step}]`);
    switch (event.status) {
      case "running":
        spinner.start(`${label} ${event.message}`);
        break;
      case "done":
        spinner.succeed(`${label} ${event.message}`);
        break;
      case "failed":
        spinner.fail(`${label} ${event.message}`);
        break;
      case "skipped":
        spinner.warn(`${label} ${event.message}`);
        break;
    }
  };
}

export function registerEvolveCommands(program: Command, defaultDeployDir: string): void {
  const skill = program.command("skill").description("Manage agent skills");

  skill
    .command("install")
    .description("Install a skill with security vetting")
    .argument("<source>", "Skill source (URL, path, or registry name)")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--auto-approve", "Auto-approve if vetting passes")
    .action(async (source: string, opts: { deployDir: string; autoApprove?: boolean }) => {
      if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
      const spinner = ora();
      const result = await installSkill({
        deployDir: opts.deployDir,
        source,
        autoApprove: opts.autoApprove,
        onProgress: createSkillProgressHandler(spinner),
      });
      if (result.success) {
        console.log(chalk.green(`\nSkill "${result.skillName}" installed and active.`));
      } else {
        console.log(chalk.red(`\nSkill installation failed: ${result.error}`));
        if (result.vetReport && result.vetReport.findings.length > 0) {
          console.log(chalk.dim("\nSecurity findings:"));
          for (const f of result.vetReport.findings) {
            const sev = f.severity === "critical" ? chalk.red(f.severity) : chalk.yellow(f.severity);
            console.log(`  ${sev} ${f.file}:${f.line} — ${f.detail}`);
          }
        }
        process.exit(1);
      }
    });

  skill
    .command("update")
    .description("Update installed skills")
    .argument("[name]", "Skill name (all if omitted)")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (name: string | undefined, opts: { deployDir: string }) => {
      if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
      const spinner = ora();

      if (name) {
        const result = await updateSkill(opts.deployDir, name, createSkillProgressHandler(spinner));
        spinner.stop();
        if (result.success) {
          console.log(chalk.green(`Skill "${name}" updated.`));
        } else if (result.status === "not-found") {
          console.log(chalk.red(`Skill "${name}" not found.`));
          process.exit(1);
        } else {
          console.log(chalk.red(`Failed to update skill "${name}": ${result.error}`));
          if (result.status === "rolled-back") {
            console.log(chalk.yellow("Previous version has been restored."));
          }
          process.exit(1);
        }
      } else {
        const results = await updateAllSkills(opts.deployDir, createSkillProgressHandler(spinner));
        spinner.stop();
        if (results.length === 0) {
          console.log(chalk.yellow("No skills installed."));
          return;
        }
        let hasFailure = false;
        for (const result of results) {
          if (result.success) {
            console.log(chalk.green(`  ✓ ${result.skillName} updated`));
          } else {
            hasFailure = true;
            console.log(chalk.red(`  ✗ ${result.skillName}: ${result.error}`));
          }
        }
        if (hasFailure) {
          process.exit(1);
        }
      }
    });

  skill
    .command("remove")
    .description("Remove an installed skill")
    .argument("<name>", "Skill name")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (name: string, opts: { deployDir: string }) => {
      if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
      const result = await removeSkill(opts.deployDir, name);
      if (result.success) {
        console.log(chalk.green(`Skill "${name}" removed.`));
      } else {
        console.log(chalk.red(`Failed to remove skill: ${result.error}`));
        process.exit(1);
      }
    });

  skill
    .command("list")
    .description("List installed skills")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; json?: boolean }) => {
      if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
      const result = await listSkills({ deployDir: opts.deployDir });
      if (opts.json) {
        console.log(formatSkillListJson(result));
      } else {
        console.log(formatSkillList(result));
      }
    });

  program
    .command("evolve")
    .description("Manage agent capabilities")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; json?: boolean }) => {
      if (warnIfNotInstalled(opts.deployDir)) process.exit(1);

      const [skillsResult, toolsResult, memoryResult] = await Promise.all([
        listSkills({ deployDir: opts.deployDir }).catch(() => null),
        listTools({ deployDir: opts.deployDir }).catch(() => null),
        getMemoryStatus({ deployDir: opts.deployDir }).catch(() => null),
      ]);
      let integrationsResult: { integrations: readonly { name: string; validated: boolean }[]; total: number } | null;
      try {
        integrationsResult = listIntegrations({ deployDir: opts.deployDir });
      } catch {
        integrationsResult = null;
      }

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              skills: skillsResult
                ? { total: skillsResult.total, active: skillsResult.active, names: skillsResult.skills.map((s) => s.name) }
                : null,
              tools: toolsResult
                ? { total: toolsResult.total, names: toolsResult.tools.map((t) => t.name) }
                : null,
              integrations: integrationsResult
                ? { total: integrationsResult.total, names: integrationsResult.integrations.map((i) => i.name) }
                : null,
              memory: memoryResult
                ? { totalEntries: memoryResult.totalEntries, totalSizeBytes: memoryResult.totalSizeBytes }
                : null,
            },
            null,
            2,
          ),
        );
        return;
      }

      const lines: string[] = [];
      lines.push(chalk.bold("\n🔧 Agent Capabilities\n"));

      if (skillsResult) {
        const count = `${skillsResult.active}/${skillsResult.total} active`;
        const names = skillsResult.skills.map((s) => s.name).join(", ") || "none";
        lines.push(`  ${chalk.cyan("Skills")}         ${count}`);
        if (skillsResult.total > 0) lines.push(`                   ${chalk.dim(names)}`);
      } else {
        lines.push(`  ${chalk.cyan("Skills")}         ${chalk.dim("unavailable")}`);
      }

      if (toolsResult) {
        const names = toolsResult.tools.map((t) => t.name).join(", ") || "none";
        lines.push(`  ${chalk.cyan("Tools")}          ${toolsResult.total} installed`);
        if (toolsResult.total > 0) lines.push(`                   ${chalk.dim(names)}`);
      } else {
        lines.push(`  ${chalk.cyan("Tools")}          ${chalk.dim("unavailable")}`);
      }

      if (integrationsResult) {
        const validated = integrationsResult.integrations.filter((i) => i.validated).length;
        const names = integrationsResult.integrations.map((i) => i.name).join(", ") || "none";
        lines.push(`  ${chalk.cyan("Integrations")}   ${integrationsResult.total} connected (${validated} validated)`);
        if (integrationsResult.total > 0) lines.push(`                   ${chalk.dim(names)}`);
      } else {
        lines.push(`  ${chalk.cyan("Integrations")}   ${chalk.dim("unavailable")}`);
      }

      if (memoryResult) {
        const kb = (memoryResult.totalSizeBytes / 1024).toFixed(1);
        lines.push(`  ${chalk.cyan("Memory")}         ${memoryResult.totalEntries} entries (${kb} KB)`);
      } else {
        lines.push(`  ${chalk.cyan("Memory")}         ${chalk.dim("unavailable")}`);
      }

      lines.push("");
      lines.push(chalk.bold("  Commands"));
      lines.push(`    ${chalk.white("clawhq skill list/install/update/remove")}  Manage skills`);
      lines.push(`    ${chalk.white("clawhq tool list/install/remove")}          Manage tools`);
      lines.push(`    ${chalk.white("clawhq integrate list/add/remove/test")}    Manage integrations`);
      lines.push(`    ${chalk.white("clawhq memory status/run/preferences")}     Manage memory`);
      lines.push(`    ${chalk.white("clawhq export")}                            Export agent bundle`);
      lines.push(`    ${chalk.white("clawhq destroy")}                           Verified destruction`);
      lines.push("");

      console.log(lines.join("\n"));
    });

  // ── Memory Commands ────────────────────────────────────────────────────────

  const memory = program.command("memory").description("Manage agent memory tiers");

  memory
    .command("status")
    .description("Show memory tier status")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; json?: boolean }) => {
      if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
      const status = await getMemoryStatus({ deployDir: opts.deployDir });
      if (opts.json) {
        console.log(formatMemoryStatusJson(status));
      } else {
        console.log(formatMemoryStatus(status));
      }
    });

  memory
    .command("run")
    .description("Run memory lifecycle (transition entries between tiers)")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; json?: boolean }) => {
      if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
      const spinner = ora("Running memory lifecycle...").start();
      const result = await runLifecycle({
        deployDir: opts.deployDir,
        onProgress: (p: MemoryProgress) => {
          if (p.status === "running") spinner.text = p.message;
        },
      });
      spinner.stop();
      if (opts.json) {
        console.log(formatLifecycleResultJson(result));
      } else {
        console.log(formatLifecycleResult(result));
      }
      if (!result.success) process.exit(1);
    });

  memory
    .command("preferences")
    .description("Show learned preference patterns")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; json?: boolean }) => {
      if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
      const report = await analyzePreferences({ deployDir: opts.deployDir });
      if (opts.json) {
        console.log(formatPreferenceReportJson(report));
      } else {
        console.log(formatPreferenceReport(report));
      }
    });

  // ── Tool Commands ──────────────────────────────────────────────────────────

  const tool = program.command("tool").description("Manage agent tools");

  tool
    .command("install")
    .description("Install a tool from the registry")
    .argument("<name>", `Tool name (${availableToolNames().join(", ")})`)
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--skip-rebuild", "Skip Stage 2 Docker rebuild")
    .action(async (name: string, opts: { deployDir: string; skipRebuild?: boolean }) => {
      if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
      const spinner = ora(`Installing tool "${name}"...`).start();
      const result = await installTool({
        deployDir: opts.deployDir,
        name,
        skipRebuild: opts.skipRebuild,
      });
      spinner.stop();
      if (result.success) {
        console.log(chalk.green(`Tool "${result.toolName}" installed.`));
        if (result.rebuilt) {
          console.log(chalk.dim("Stage 2 rebuild complete."));
        } else if (result.error) {
          console.log(chalk.yellow(result.error));
        } else if (opts.skipRebuild) {
          console.log(chalk.dim("Rebuild skipped. Run 'clawhq build' to apply changes."));
        }
      } else {
        console.log(chalk.red(`Tool install failed: ${result.error}`));
        process.exit(1);
      }
    });

  tool
    .command("remove")
    .description("Remove an installed tool")
    .argument("<name>", "Tool name")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--skip-rebuild", "Skip Stage 2 Docker rebuild")
    .action(async (name: string, opts: { deployDir: string; skipRebuild?: boolean }) => {
      if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
      const spinner = ora(`Removing tool "${name}"...`).start();
      const result = await removeTool({
        deployDir: opts.deployDir,
        name,
        skipRebuild: opts.skipRebuild,
      });
      spinner.stop();
      if (result.success) {
        console.log(chalk.green(`Tool "${result.toolName}" removed.`));
        if (result.rebuilt) {
          console.log(chalk.dim("Stage 2 rebuild complete."));
        } else if (result.error) {
          console.log(chalk.yellow(result.error));
        } else if (opts.skipRebuild) {
          console.log(chalk.dim("Rebuild skipped. Run 'clawhq build' to apply changes."));
        }
      } else {
        console.log(chalk.red(`Tool remove failed: ${result.error}`));
        process.exit(1);
      }
    });

  tool
    .command("list")
    .description("List installed tools")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; json?: boolean }) => {
      if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
      const result = await listTools({ deployDir: opts.deployDir });
      if (opts.json) {
        console.log(formatToolListJson(result));
      } else {
        console.log(formatToolList(result));
      }
    });

  // ── Approval Commands ──────────────────────────────────────────────────────

  const approval = program.command("approval").description("Manage approval queue for high-stakes actions");

  approval
    .command("list")
    .description("List pending approval items")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; json?: boolean }) => {
      if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
      const pending = await listPending(opts.deployDir);
      if (opts.json) {
        console.log(JSON.stringify(pending, null, 2));
        return;
      }
      if (pending.length === 0) {
        console.log(chalk.dim("No pending approvals."));
        return;
      }
      console.log(chalk.bold(`${pending.length} pending approval(s):\n`));
      for (const item of pending) {
        console.log(`  ${chalk.cyan(item.id)}  ${item.category}  ${item.summary}`);
        if (item.metadata) {
          const meta = Object.entries(item.metadata).map(([k, v]) => `${k}=${v}`).join(", ");
          console.log(`    ${chalk.dim(meta)}`);
        }
        console.log(`    ${chalk.dim(`source: ${item.source}  queued: ${item.createdAt}`)}`);
        console.log();
      }
    });

  approval
    .command("approve")
    .description("Approve a pending item")
    .argument("<id>", "Approval item ID")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (id: string, opts: { deployDir: string }) => {
      if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
      const auditConfig = createAuditConfig(opts.deployDir, "");
      const result = await approveItem(opts.deployDir, id, { resolvedVia: "cli", auditConfig });
      if (result.success) {
        console.log(chalk.green(`Approved: ${id}`));
      } else {
        console.log(chalk.red(result.error ?? "Failed to approve."));
        process.exit(1);
      }
    });

  approval
    .command("reject")
    .description("Reject a pending item")
    .argument("<id>", "Approval item ID")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (id: string, opts: { deployDir: string }) => {
      if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
      const auditConfig = createAuditConfig(opts.deployDir, "");
      const result = await rejectItem(opts.deployDir, id, { resolvedVia: "cli", auditConfig });
      if (result.success) {
        console.log(chalk.green(`Rejected: ${id}`));
      } else {
        console.log(chalk.red(result.error ?? "Failed to reject."));
        process.exit(1);
      }
    });

  approval
    .command("count")
    .description("Count pending approval items")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (opts: { deployDir: string }) => {
      if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
      const count = await countPending(opts.deployDir);
      console.log(String(count));
    });

  approval
    .command("watch")
    .description("Start Telegram approval bot (polls for approve/reject button presses)")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (opts: { deployDir: string }) => {
      if (warnIfNotInstalled(opts.deployDir)) process.exit(1);

      const { readEnvValue } = await import("../../secure/credentials/env-store.js");
      const envPath = join(opts.deployDir, "engine", ".env");
      const botToken = readEnvValue(envPath, "TELEGRAM_BOT_TOKEN");
      const chatId = readEnvValue(envPath, "TELEGRAM_CHAT_ID");

      if (!botToken) {
        console.error(chalk.red("TELEGRAM_BOT_TOKEN not set in .env. Configure via clawhq creds."));
        process.exit(1);
      }
      if (!chatId) {
        console.error(chalk.red("TELEGRAM_CHAT_ID not set in .env. Set the chat ID for approval notifications."));
        process.exit(1);
      }

      const telegramConfig: TelegramConfig = { botToken, chatId };
      const auditConfig = createAuditConfig(opts.deployDir, "");
      const ac = new AbortController();

      process.on("SIGINT", () => ac.abort());
      process.on("SIGTERM", () => ac.abort());

      console.log(chalk.green("Approval bot started. Listening for Telegram callbacks..."));
      console.log(chalk.dim("Press Ctrl+C to stop.\n"));

      await startApprovalBot({
        deployDir: opts.deployDir,
        telegramConfig,
        auditConfig,
        signal: ac.signal,
        onResolution: (itemId, resolution) => {
          const color = resolution === "approved" ? chalk.green : chalk.red;
          console.log(`${color(resolution)}: ${itemId}`);
        },
      });

      console.log(chalk.dim("\nApproval bot stopped."));
    });

  approval
    .command("notify")
    .description("Send Telegram notification for a pending approval item")
    .argument("<id>", "Approval item ID")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (id: string, opts: { deployDir: string }) => {
      if (warnIfNotInstalled(opts.deployDir)) process.exit(1);

      const { readEnvValue } = await import("../../secure/credentials/env-store.js");
      const { getItem } = await import("../../evolve/approval/queue.js");
      const envPath = join(opts.deployDir, "engine", ".env");
      const botToken = readEnvValue(envPath, "TELEGRAM_BOT_TOKEN");
      const chatId = readEnvValue(envPath, "TELEGRAM_CHAT_ID");

      if (!botToken || !chatId) {
        console.error(chalk.red("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env."));
        process.exit(1);
      }

      const item = await getItem(opts.deployDir, id);
      if (!item) {
        console.error(chalk.red(`Approval item "${id}" not found.`));
        process.exit(1);
      }
      if (item.status !== "pending") {
        console.error(chalk.red(`Item "${id}" is already ${item.status}.`));
        process.exit(1);
      }

      const result = await sendApprovalNotification({ botToken, chatId }, item);
      if (result.success) {
        console.log(chalk.green(`Telegram notification sent for ${id}.`));
      } else {
        console.error(chalk.red(`Failed to notify: ${result.error}`));
        process.exit(1);
      }
    });

  // ── Export / Destroy ────────────────────────────────────────────────────────

  program
    .command("export")
    .description("Export portable agent bundle")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("-o, --output <path>", "Output file path")
    .option("--json", "Output as JSON for scripting")
    .action(async (opts: { deployDir: string; output?: string; json?: boolean }) => {
      if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
      const spinner = ora();
      const onProgress = (event: LifecycleProgress): void => {
        const label = `[${event.step}]`;
        switch (event.status) {
          case "running": spinner.start(`${label} ${event.message}`); break;
          case "done": spinner.succeed(`${label} ${event.message}`); break;
          case "failed": spinner.fail(`${label} ${event.message}`); break;
          case "skipped": spinner.warn(`${label} ${event.message}`); break;
        }
      };
      try {
        const result = await exportBundle({ deployDir: opts.deployDir, output: opts.output, onProgress });
        console.log();
        console.log(opts.json ? formatExportJson(result) : formatExportTable(result));
        process.exit(result.success ? 0 : 1);
      } catch (err) {
        spinner.stop();
        console.error(renderError(err));
        process.exit(1);
      }
    });

  program
    .command("destroy")
    .description("Verified agent destruction")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--confirm", "Skip confirmation prompt")
    .option("--json", "Output as JSON for scripting")
    .action(async (opts: { deployDir: string; confirm?: boolean; json?: boolean }) => {
      if (warnIfNotInstalled(opts.deployDir)) process.exit(1);
      if (!opts.confirm) {
        console.log(chalk.red.bold("⚠  WARNING: This will permanently destroy ALL agent data."));
        console.log(chalk.red("   This action cannot be undone.\n"));
        console.log(`   Deploy dir: ${opts.deployDir}\n`);
        console.log(chalk.yellow("   Run with --confirm to proceed."));
        process.exit(1);
      }
      const spinner = ora();
      const onProgress = (event: LifecycleProgress): void => {
        const label = `[${event.step}]`;
        switch (event.status) {
          case "running": spinner.start(`${label} ${event.message}`); break;
          case "done": spinner.succeed(`${label} ${event.message}`); break;
          case "failed": spinner.fail(`${label} ${event.message}`); break;
          case "skipped": spinner.warn(`${label} ${event.message}`); break;
        }
      };
      try {
        const result = await destroyAgent({ deployDir: opts.deployDir, confirm: true, onProgress });
        console.log();
        console.log(opts.json ? formatDestroyJson(result) : formatDestroyTable(result));
        process.exit(result.success ? 0 : 1);
      } catch (err) {
        spinner.stop();
        console.error(renderError(err));
        process.exit(1);
      }
    });

  program
    .command("verify-proof")
    .description("Verify a destruction proof file")
    .argument("<file>", "Path to the destruction proof JSON file")
    .action(async (file: string) => {
      try {
        const { readFile } = await import("node:fs/promises");
        const raw = await readFile(file, "utf-8");
        const proof = JSON.parse(raw) as DestructionProof;
        const valid = verifyDestructionProof(proof);
        console.log(formatVerifyResult(proof, valid));
        process.exit(valid ? 0 : 1);
      } catch (err) {
        console.error(renderError(err));
        process.exit(1);
      }
    });
}
