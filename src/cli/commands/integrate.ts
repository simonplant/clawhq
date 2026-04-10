import type { Command } from "commander";

import chalk from "chalk";
import ora from "ora";

import {
  addIntegration,
  availableIntegrationNames,
  formatIntegrationList,
  formatIntegrationListJson,
  getIntegrationDef,
  listIntegrations,
  removeIntegrationCmd,
  testIntegration,
} from "../../evolve/integrate/index.js";
import type { IntegrationProgress } from "../../evolve/integrate/index.js";
import {
  addProvider,
  availableProviderNames,
  formatProviderList,
  formatProviderListJson,
  listProviders,
  removeProviderCmd,
} from "../../evolve/provider/index.js";
import type { ProviderProgress } from "../../evolve/provider/index.js";
import {
  addRole,
  assignRoleToIntegration,
  checkRole,
  formatRoleCheck,
  formatRoleList,
  formatRoleListJson,
  listRoles,
  removeRoleCmd,
} from "../../evolve/role/index.js";
import type { Permission } from "../../evolve/role/index.js";

import { CommandError } from "../errors.js";
import { renderError, ensureInstalled } from "../ux.js";

function createIntegrationProgressHandler(spinner: ReturnType<typeof ora>) {
  return (event: IntegrationProgress): void => {
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

function createProviderProgressHandler(spinner: ReturnType<typeof ora>) {
  return (event: ProviderProgress): void => {
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

export function registerIntegrateCommands(program: Command, defaultDeployDir: string): void {
  const integrate = program.command("integrate").description("Manage service integrations");

  integrate
    .command("add")
    .description("Connect a new service with live validation")
    .argument("<name>", `Integration name (${availableIntegrationNames().join(", ")})`)
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--skip-validation", "Skip live credential validation")
    .action(async (name: string, opts: { deployDir: string; skipValidation?: boolean }) => {
      ensureInstalled(opts.deployDir);

      const def = getIntegrationDef(name);
      if (!def) {
        console.error(chalk.red(`Unknown integration: ${name}`));
        console.error(chalk.dim(`Available: ${availableIntegrationNames().join(", ")}`));
        throw new CommandError("", 1);
      }

      try {
        const { input, password } = await import("@inquirer/prompts");
        console.log(chalk.bold(`\nclawhq integrate add ${name}\n`));
        console.log(chalk.dim(`${def.description}\n`));

        const credentials: Record<string, string> = {};
        for (const envKey of def.envKeys) {
          const prompt = envKey.secret ? password : input;
          const value = await prompt({
            message: `${envKey.label}:`,
            ...(envKey.defaultValue ? { default: envKey.defaultValue } : {}),
            ...(envKey.secret ? { mask: "*" } : {}),
          });
          if (value) credentials[envKey.key] = value;
        }

        const spinner = ora();
        const onProgress = createIntegrationProgressHandler(spinner);

        const result = await addIntegration({
          deployDir: opts.deployDir,
          name,
          credentials,
          skipValidation: opts.skipValidation,
          onProgress,
        });

        spinner.stop();

        if (result.success) {
          console.log(chalk.green(`\n✔ Integration "${name}" connected`));
          if (result.validated) {
            console.log(chalk.green("✔ Live validation passed"));
          } else if (!opts.skipValidation) {
            console.log(chalk.yellow("⚠ Live validation failed — credentials stored, retry with: clawhq integrate test " + name));
          }

          // Auto-apply to regenerate config with new integration
          if (result.needsApply) {
            console.log(chalk.dim("\nRegenerating config to include new integration…"));
            const { apply } = await import("../../evolve/apply/index.js");
            const applyResult = await apply({ deployDir: opts.deployDir });
            if (applyResult.success) {
              const changed = applyResult.report.added.length + applyResult.report.changed.length;
              console.log(chalk.green(`✔ Config updated (${changed} file(s))`));
              console.log(chalk.dim("  Run: clawhq apply --restart to activate"));
            }
          }
        } else {
          console.error(chalk.red(`\n✘ ${result.error}`));
          throw new CommandError("", 1);
        }
      } catch (error) {
        if (error instanceof CommandError) throw error;
        if (error instanceof Error && error.name === "ExitPromptError") {
          console.log(chalk.yellow("\nCancelled."));
          throw new CommandError("", 0);
        }
        console.error(renderError(error));
        throw new CommandError("", 1);
      }
    });

  integrate
    .command("remove")
    .description("Remove a configured integration")
    .argument("<name>", "Integration name")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--keep-credentials", "Keep credentials in .env")
    .action(async (name: string, opts: { deployDir: string; keepCredentials?: boolean }) => {
      ensureInstalled(opts.deployDir);
      const result = await removeIntegrationCmd({
        deployDir: opts.deployDir,
        name,
        keepCredentials: opts.keepCredentials,
      });
      if (result.success) {
        console.log(chalk.green(`Integration "${name}" removed.`));
        if (result.envKeysRemoved.length > 0) {
          console.log(chalk.dim(`  Removed env keys: ${result.envKeysRemoved.join(", ")}`));
        }
      } else {
        console.error(chalk.red(result.error ?? "Failed to remove."));
        throw new CommandError("", 1);
      }
    });

  integrate
    .command("list")
    .description("List configured integrations")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; json?: boolean }) => {
      ensureInstalled(opts.deployDir);
      const result = listIntegrations({ deployDir: opts.deployDir });
      if (opts.json) {
        console.log(formatIntegrationListJson(result));
      } else {
        console.log(formatIntegrationList(result));
      }
    });

  integrate
    .command("test")
    .description("Test an integration's credentials with live validation")
    .argument("<name>", "Integration name")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (name: string, opts: { deployDir: string }) => {
      ensureInstalled(opts.deployDir);
      const spinner = ora(`Testing ${name} credentials…`).start();
      try {
        const result = await testIntegration({ deployDir: opts.deployDir, name });
        spinner.stop();
        if (result.success) {
          console.log(chalk.green(`✔ ${result.message}`));
        } else {
          console.error(chalk.red(`✘ ${result.error}`));
          throw new CommandError("", 1);
        }
      } finally {
        spinner.stop();
      }
    });

  // ── Provider Commands ──────────────────────────────────────────────────────

  const provider = program.command("provider").description("Manage cloud API credential routing");

  provider
    .command("add")
    .description("Add and validate a model provider")
    .argument("<name>", `Provider name (${availableProviderNames().join(", ")})`)
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("-k, --api-key <key>", "API key")
    .option("-m, --model <model>", "Model ID override")
    .option("--route <categories>", "Comma-separated task categories to route")
    .option("--skip-validation", "Skip live validation")
    .action(async (name: string, opts: {
      deployDir: string;
      apiKey?: string;
      model?: string;
      route?: string;
      skipValidation?: boolean;
    }) => {
      ensureInstalled(opts.deployDir);

      const spinner = ora();
      const onProgress = createProviderProgressHandler(spinner);

      const routeCategories = opts.route ? opts.route.split(",").map((s) => s.trim()) : undefined;

      try {
        const result = await addProvider({
          deployDir: opts.deployDir,
          name,
          apiKey: opts.apiKey,
          model: opts.model,
          routeCategories,
          skipValidation: opts.skipValidation,
          onProgress,
        });

        spinner.stop();

        if (result.success) {
          console.log(chalk.green(`\n✔ Provider "${name}" configured`));
          if (result.validated) {
            console.log(chalk.green("✔ Live validation passed"));
          } else if (!opts.skipValidation) {
            console.log(chalk.yellow("⚠ Live validation failed — credentials stored"));
          }
        } else {
          console.error(chalk.red(`\n✘ ${result.error}`));
          throw new CommandError("", 1);
        }
      } finally {
        spinner.stop();
      }
    });

  provider
    .command("remove")
    .description("Remove a configured provider")
    .argument("<name>", "Provider name")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--keep-credentials", "Keep API key in .env")
    .action(async (name: string, opts: { deployDir: string; keepCredentials?: boolean }) => {
      ensureInstalled(opts.deployDir);
      const result = await removeProviderCmd({
        deployDir: opts.deployDir,
        name,
        keepCredentials: opts.keepCredentials,
      });
      if (result.success) {
        console.log(chalk.green(`Provider "${name}" removed.`));
      } else {
        console.error(chalk.red(result.error ?? "Failed to remove."));
        throw new CommandError("", 1);
      }
    });

  provider
    .command("list")
    .description("List configured providers")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; json?: boolean }) => {
      ensureInstalled(opts.deployDir);
      const result = listProviders({ deployDir: opts.deployDir });
      if (opts.json) {
        console.log(formatProviderListJson(result));
      } else {
        console.log(formatProviderList(result));
      }
    });

  // ── Role Commands ──────────────────────────────────────────────────────────

  const role = program.command("role").description("Identity governance and access control");

  role
    .command("add")
    .description("Define a new role")
    .argument("<name>", "Role name")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--description <desc>", "Role description", "")
    .option("--permissions <perms>", "Comma-separated permissions (read,write,execute,send,receive,admin)")
    .option("--categories <cats>", "Comma-separated integration categories this role applies to")
    .option("--max-egress <n>", "Maximum egress domains allowed", "0")
    .action(async (name: string, opts: {
      deployDir: string;
      description: string;
      permissions?: string;
      categories?: string;
      maxEgress: string;
    }) => {
      ensureInstalled(opts.deployDir);

      if (!opts.permissions) {
        console.error(chalk.red("Error: --permissions is required (e.g., --permissions read,write,send)"));
        throw new CommandError("", 1);
      }

      const permissions = opts.permissions.split(",").map((s) => s.trim()) as Permission[];
      const categories = opts.categories ? opts.categories.split(",").map((s) => s.trim()) : undefined;

      const maxEgressDomains = parseInt(opts.maxEgress, 10);
      if (isNaN(maxEgressDomains)) {
        throw new CommandError("Invalid --max-egress value: must be a number");
      }

      const result = await addRole({
        deployDir: opts.deployDir,
        name,
        description: opts.description,
        permissions,
        categories,
        maxEgressDomains,
      });

      if (result.success) {
        console.log(chalk.green(`Role "${name}" created.`));
      } else {
        console.error(chalk.red(result.error ?? "Failed to create role."));
        throw new CommandError("", 1);
      }
    });

  role
    .command("remove")
    .description("Remove a custom role")
    .argument("<name>", "Role name")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (name: string, opts: { deployDir: string }) => {
      ensureInstalled(opts.deployDir);
      const result = await removeRoleCmd({ deployDir: opts.deployDir, name });
      if (result.success) {
        console.log(chalk.green(`Role "${name}" removed.`));
        if (result.unassigned.length > 0) {
          console.log(chalk.dim(`  Unassigned from: ${result.unassigned.join(", ")}`));
        }
      } else {
        console.error(chalk.red(result.error ?? "Failed to remove."));
        throw new CommandError("", 1);
      }
    });

  role
    .command("assign")
    .description("Assign a role to an integration")
    .argument("<role>", "Role name")
    .argument("<integration>", "Integration name")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (roleName: string, integrationName: string, opts: { deployDir: string }) => {
      ensureInstalled(opts.deployDir);
      const result = await assignRoleToIntegration({
        deployDir: opts.deployDir,
        roleName,
        integrationName,
      });
      if (result.success) {
        console.log(chalk.green(`Role "${roleName}" assigned to integration "${integrationName}".`));
      } else {
        console.error(chalk.red(result.error ?? "Failed to assign."));
        throw new CommandError("", 1);
      }
    });

  role
    .command("list")
    .description("List all roles and assignments")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; json?: boolean }) => {
      ensureInstalled(opts.deployDir);
      const result = listRoles({ deployDir: opts.deployDir });
      if (opts.json) {
        console.log(formatRoleListJson(result));
      } else {
        console.log(formatRoleList(result));
      }
    });

  role
    .command("check")
    .description("Check what permissions an integration has")
    .argument("<integration>", "Integration name")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (integrationName: string, opts: { deployDir: string }) => {
      ensureInstalled(opts.deployDir);
      const result = checkRole({ deployDir: opts.deployDir, integrationName });
      console.log(formatRoleCheck(result.integrationName, result.roleName, result.permissions));
    });
}
