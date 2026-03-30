import type { Command } from "commander";

import chalk from "chalk";
import ora from "ora";

import type { CloudProvider, DeployUpdateProgress, ProvisionProgress, SnapshotBuildProgress } from "../../cloud/index.js";
import {
  buildSnapshot,
  deleteSnapshot,
  destroyInstance,
  findInstance,
  getClawhqVersion,
  getInstanceStatus,
  isSnapshotStale,
  provision,
  readInstanceRegistry,
  readSnapshotRegistry,
  setProviderCredential,
  updateInstance,
} from "../../cloud/index.js";
import {
  detectSshKeys,
  estimateMonthlyCost,
  executeDeploy,
  getProviderCatalog,
  getProviderInfo,
  hasStoredCredentials,
  storeAndValidateCredentials,
  uploadSshKey,
} from "../../cloud/index.js";
import { DASHBOARD_DEFAULT_PORT } from "../../config/defaults.js";
import {
  allTemplatesToChoices,
  loadAllBuiltinBlueprints,
} from "../../design/blueprints/index.js";
import { startDashboard } from "../../web/index.js";

import { CommandError } from "../errors.js";
import { validatePort } from "../ux.js";

function resolveProviderAlias(input: string): CloudProvider | undefined {
  const aliases: Record<string, CloudProvider> = {
    "digitalocean": "digitalocean",
    "do": "digitalocean",
    "hetzner": "hetzner",
    "hz": "hetzner",
    "aws": "aws",
    "gcp": "gcp",
  };
  return aliases[input.toLowerCase()];
}

function createProvisionProgressHandler(spinner: ReturnType<typeof ora>, json?: boolean) {
  return (event: ProvisionProgress): void => {
    if (json) return;
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
    }
  };
}

function createUpdateProgressHandler(spinner: ReturnType<typeof ora>, json?: boolean) {
  return (event: DeployUpdateProgress): void => {
    if (json) return;
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
    }
  };
}

function createSnapshotProgressHandler(spinner: ReturnType<typeof ora>, json?: boolean) {
  return (event: SnapshotBuildProgress): void => {
    if (json) return;
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
    }
  };
}

async function runDeployWizard(opts: {
  provider?: string;
  name?: string;
  region?: string;
  size?: string;
  blueprint?: string;
  snapshot?: string;
  sshKeys?: string;
  deployDir: string;
  yes?: boolean;
  json?: boolean;
}): Promise<void> {
  const { select, input: inputPrompt, password, confirm } = await import("@inquirer/prompts");
  const isInteractive = !opts.yes || !opts.provider || !opts.name;

  if (!opts.json) {
    console.log("");
    console.log(chalk.bold.cyan("  ╔═══════════════════════════════════════╗"));
    console.log(chalk.bold.cyan("  ║         ClawHQ Deploy                ║"));
    console.log(chalk.bold.cyan("  ║   Zero to cloud agent in one session ║"));
    console.log(chalk.bold.cyan("  ╚═══════════════════════════════════════╝"));
    console.log("");
  }

  // Step 1: Provider
  let provider: CloudProvider;
  if (opts.provider) {
    const resolved = resolveProviderAlias(opts.provider);
    if (!resolved) {
      console.error(chalk.red(`Invalid provider: ${opts.provider}. Must be one of: digitalocean (do), aws, gcp, hetzner (hz)`));
      throw new CommandError("", 1);
    }
    provider = resolved;
  } else {
    const catalog = getProviderCatalog();
    provider = await select({
      message: "Choose a cloud provider",
      choices: catalog.map((p) => ({ name: p.name, value: p.value })),
    }) as CloudProvider;
  }

  const providerInfo = getProviderInfo(provider);
  if (!providerInfo) {
    console.error(chalk.red(`Unknown provider: ${provider}`));
    throw new CommandError("", 1);
  }

  // Step 2: Credentials
  if (!hasStoredCredentials(opts.deployDir, provider)) {
    if (opts.yes) {
      console.error(chalk.red(`No credentials found for ${providerInfo.name}. Set them first:`));
      console.error(chalk.dim(`  clawhq deploy credentials --provider ${provider} --token <your-token>`));
      throw new CommandError("", 1);
    }

    if (!opts.json) {
      console.log(chalk.dim(`\n  No ${providerInfo.name} credentials found.`));
    }

    const token = await password({
      message: `${providerInfo.name} API token`,
      mask: "*",
    });

    const spinner = ora(`Validating ${providerInfo.name} credentials…`);
    if (!opts.json) spinner.start();

    const validation = await storeAndValidateCredentials(opts.deployDir, provider, token);

    if (!opts.json) spinner.stop();

    if (!validation.valid) {
      console.error(chalk.red(`\n  Invalid credentials: ${validation.error}`));
      throw new CommandError("", 1);
    }

    if (!opts.json) {
      console.log(chalk.green(`  Credentials valid${validation.account ? ` (${validation.account})` : ""} — stored securely (mode 0600).`));
    }
  } else if (!opts.json) {
    console.log(chalk.dim(`  Using stored ${providerInfo.name} credentials.`));
  }

  // Step 3: Region
  let region: string;
  if (opts.region) {
    region = opts.region;
  } else if (isInteractive) {
    region = await select({
      message: "Select a region",
      choices: providerInfo.regions.map((r) => ({
        name: `${r.slug} — ${r.label}`,
        value: r.slug,
      })),
      default: providerInfo.defaultRegion,
    });
  } else {
    region = providerInfo.defaultRegion;
  }

  // Step 4: Blueprint
  let blueprint: string | undefined;
  if (opts.blueprint) {
    blueprint = opts.blueprint;
  } else if (isInteractive) {
    const loaded = loadAllBuiltinBlueprints();
    if (loaded.length > 0) {
      const choices = allTemplatesToChoices(loaded);
      blueprint = await select({
        message: "Choose a blueprint for your agent",
        choices: [
          ...choices.map((c) => ({
            name: `${c.name} — ${c.tagline}`,
            value: c.value,
          })),
          { name: "Skip — configure later", value: "__skip__" },
        ],
      });
      if (blueprint === "__skip__") {
        blueprint = undefined;
      }
    }
  }

  // Step 5: Size
  let size: string;
  if (opts.size) {
    size = opts.size;
  } else if (isInteractive) {
    size = await select({
      message: "Select VM size",
      choices: providerInfo.sizes.map((s) => ({
        name: `${s.slug} — ${s.label} — $${s.monthlyCost}/mo`,
        value: s.slug,
      })),
      default: providerInfo.defaultSize,
    });
  } else {
    size = providerInfo.defaultSize;
  }

  // Step 6: Instance name
  let name: string;
  if (opts.name) {
    name = opts.name;
  } else if (opts.yes) {
    name = `clawhq-${Date.now().toString(36)}`;
  } else {
    name = await inputPrompt({
      message: "Instance name",
      default: `clawhq-${Date.now().toString(36)}`,
      validate: (val: string) => {
        if (!val.trim()) return "Name is required";
        if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(val)) return "Name must start with a letter or number and contain only letters, numbers, and hyphens";
        return true;
      },
    });
  }

  // Step 7: SSH key detection and upload
  let sshKeyIds: string[] | undefined;
  if (opts.sshKeys) {
    sshKeyIds = opts.sshKeys.split(",").map((k) => k.trim());
  } else if (isInteractive) {
    const localKeys = detectSshKeys();
    if (localKeys.length > 0) {
      const useLocal = await confirm({
        message: `Found SSH key: ${localKeys[0].path} (${localKeys[0].type}). Upload to ${providerInfo.name} for SSH access?`,
        default: true,
      });

      if (useLocal) {
        const spinner = ora(`Uploading SSH key to ${providerInfo.name}…`);
        if (!opts.json) spinner.start();

        const uploadResult = await uploadSshKey(
          opts.deployDir,
          provider,
          `clawhq-${name}`,
          localKeys[0].publicKey,
        );

        if (!opts.json) spinner.stop();

        if (uploadResult.success && uploadResult.keyId) {
          sshKeyIds = [uploadResult.keyId];
          if (!opts.json) console.log(chalk.green(`  SSH key uploaded.`));
        } else {
          if (!opts.json) console.log(chalk.yellow(`  SSH key upload failed: ${uploadResult.error ?? "unknown"}. Continuing without SSH key.`));
        }
      }
    } else if (!opts.json) {
      console.log(chalk.dim("  No SSH keys found in ~/.ssh/. VM will be accessible via cloud-init credentials only."));
    }
  }

  // Step 8: Cost confirmation
  const monthlyCost = estimateMonthlyCost(provider, size);

  if (!opts.json) {
    console.log("");
    console.log(chalk.bold("  Deployment Summary"));
    console.log(chalk.dim(`  ─────────────────────────────────────`));
    console.log(chalk.dim(`  Provider:  `) + providerInfo.name);
    console.log(chalk.dim(`  Region:    `) + region);
    console.log(chalk.dim(`  Size:      `) + size);
    if (blueprint) {
      console.log(chalk.dim(`  Blueprint: `) + blueprint);
    }
    console.log(chalk.dim(`  Name:      `) + name);
    if (sshKeyIds?.length) {
      console.log(chalk.dim(`  SSH Keys:  `) + sshKeyIds.join(", "));
    }
    if (monthlyCost !== undefined) {
      console.log(chalk.dim(`  Cost:      `) + chalk.bold.green(`$${monthlyCost}/mo`));
    }
    console.log("");
  }

  if (!opts.yes) {
    const proceed = await confirm({
      message: monthlyCost !== undefined
        ? `Provision this VM? Estimated cost: $${monthlyCost}/mo`
        : "Provision this VM?",
      default: true,
    });
    if (!proceed) {
      console.log(chalk.dim("\n  Deploy cancelled. No charges incurred.\n"));
      throw new CommandError("", 0);
    }
  }

  // Step 9: Provision
  const spinner = ora("Provisioning cloud instance…");
  if (!opts.json) {
    console.log("");
    spinner.start();
  }

  const onProgress = createProvisionProgressHandler(spinner, opts.json);

  const result = await executeDeploy({
    provider,
    deployDir: opts.deployDir,
    name,
    region,
    size,
    blueprint,
    sshKeys: sshKeyIds,
    snapshotId: opts.snapshot,
    useSnapshot: !opts.snapshot,
    onProgress,
  });

  if (!opts.json) spinner.stop();

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    if (!result.provision.success) throw new CommandError("", 1);
    return;
  }

  if (result.provision.success) {
    console.log("");
    console.log(chalk.bold.green("  Your agent is deployed!"));
    console.log("");
    console.log(chalk.dim(`  Instance ID:  `) + result.provision.instanceId);
    console.log(chalk.dim(`  IP Address:   `) + result.provision.ipAddress);
    console.log(chalk.dim(`  Healthy:      `) + (result.provision.healthy ? chalk.green("yes") : chalk.yellow("no")));
    if (result.monthlyCost !== undefined) {
      console.log(chalk.dim(`  Monthly cost: `) + chalk.green(`$${result.monthlyCost}/mo`));
    }
    console.log(chalk.dim(`  Trust mode:   `) + (result.trustModeConfigured ? "zero-trust (configured)" : "not configured"));
    console.log(chalk.dim(`  Heartbeat:    `) + (result.heartbeatSent ? "sent" : "skipped"));

    if (sshKeyIds?.length && result.provision.ipAddress) {
      console.log("");
      console.log(chalk.dim(`  SSH access:   `) + chalk.bold(`ssh root@${result.provision.ipAddress}`));
    }

    console.log("");
    console.log(chalk.dim(`  Status:   clawhq deploy status ${result.provision.instanceId}`));
    console.log(chalk.dim(`  List:     clawhq deploy list`));
    console.log(chalk.dim(`  Destroy:  clawhq deploy destroy ${result.provision.instanceId}`));
    console.log("");
  } else {
    console.error(chalk.red(`\n  Deployment failed: ${result.provision.error}`));
    if (result.provision.instanceId) {
      console.error(chalk.dim(`  Instance ID: ${result.provision.instanceId} (partially created)`));
    }
    console.error(chalk.dim("  Mid-flight failures are auto-cleaned. No orphaned resources.\n"));
    throw new CommandError("", 1);
  }
}

export function registerProvisionCommands(program: Command, defaultDeployDir: string): void {
  // ── Dashboard ──────────────────────────────────────────────────────────────

  program
    .command("dashboard")
    .description("Start the web dashboard (Hono + htmx + Pico CSS)")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("-p, --port <port>", "Dashboard port", String(DASHBOARD_DEFAULT_PORT))
    .option("--host <host>", "Hostname to bind to", "localhost")
    .action(async (opts: { deployDir: string; port: string; host: string }) => {
      const port = validatePort(opts.port);

      console.log(chalk.bold("\nclawhq dashboard\n"));
      console.log(chalk.dim(`Starting web dashboard on ${opts.host}:${port}…\n`));

      const server = await startDashboard({
        deployDir: opts.deployDir,
        port,
        hostname: opts.host,
      });

      console.log(chalk.green(`Dashboard running at http://${server.hostname}:${server.port}`));
      console.log(chalk.dim("Press Ctrl+C to stop.\n"));

      // Signal handler for cleanup — legitimately calls process.exit()
      const shutdownServer = () => {
        console.log(chalk.dim("\nShutting down dashboard…"));
        server.close();
        process.exit(0);
      };
      process.on("SIGINT", shutdownServer);
      process.on("SIGTERM", shutdownServer);
    });

  // ── Deploy (Cloud Provisioning) ─────────────────────────────────────────────

  const deployCmd = program
    .command("deploy")
    .description("Provision and manage cloud-hosted agents")
    .option("-p, --provider <provider>", "Cloud provider (digitalocean, do, aws, gcp, hetzner, hz)")
    .option("-n, --name <name>", "Instance name")
    .option("-r, --region <region>", "VM region")
    .option("-s, --size <size>", "VM size")
    .option("-b, --blueprint <name>", "Blueprint to configure the agent with")
    .option("--snapshot <id>", "Use a pre-built snapshot for sub-60s provisioning")
    .option("--ssh-keys <keys>", "Comma-separated SSH key IDs or fingerprints")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("-y, --yes", "Skip confirmation prompts (for automation)")
    .option("--json", "Output as JSON")
    .action(async (opts: {
      provider?: string;
      name?: string;
      region?: string;
      size?: string;
      blueprint?: string;
      snapshot?: string;
      sshKeys?: string;
      deployDir: string;
      yes?: boolean;
      json?: boolean;
    }) => {
      await runDeployWizard(opts);
    });

  deployCmd
    .command("create")
    .description("Provision a new cloud VM with a running agent")
    .requiredOption("-p, --provider <provider>", "Cloud provider (digitalocean, do, aws, gcp, hetzner)")
    .requiredOption("-n, --name <name>", "Instance name")
    .option("-r, --region <region>", "VM region", "nyc3")
    .option("-s, --size <size>", "VM size", "s-2vcpu-4gb")
    .option("--snapshot <id>", "Use a pre-built snapshot for sub-60s provisioning")
    .option("--ssh-keys <keys>", "Comma-separated SSH key IDs (for debugging builder)")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: {
      provider: string;
      name: string;
      region: string;
      size: string;
      snapshot?: string;
      sshKeys?: string;
      deployDir: string;
      json?: boolean;
    }) => {
      const provider = resolveProviderAlias(opts.provider);
      if (!provider) {
        console.error(chalk.red(`Invalid provider: ${opts.provider}. Must be one of: digitalocean (do), aws, gcp, hetzner (hz)`));
        throw new CommandError("", 1);
      }

      const sshKeys = opts.sshKeys ? opts.sshKeys.split(",").map((k) => k.trim()) : undefined;

      const spinner = ora("Provisioning cloud instance…");
      if (!opts.json) spinner.start();

      try {
        const onProgress = createProvisionProgressHandler(spinner, opts.json);

        const result = await provision({
          provider,
          deployDir: opts.deployDir,
          name: opts.name,
          region: opts.region,
          size: opts.size,
          snapshotId: opts.snapshot,
          sshKeys,
          onProgress,
        });

        if (!opts.json) spinner.stop();

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.success) {
          console.log(chalk.green(`\nInstance provisioned successfully.`));
          console.log(chalk.dim(`  ID:       ${result.instanceId}`));
          console.log(chalk.dim(`  IP:       ${result.ipAddress}`));
          console.log(chalk.dim(`  Healthy:  ${result.healthy ? "yes" : "no"}`));
          console.log(chalk.dim(`\n  Destroy:  clawhq deploy destroy ${result.instanceId}`));
          console.log(chalk.dim(`  Status:   clawhq deploy status ${result.instanceId}`));
        } else {
          console.error(chalk.red(`Provisioning failed: ${result.error}`));
          if (result.instanceId) {
            console.error(chalk.dim(`  Instance ID: ${result.instanceId} (partially created)`));
          }
          throw new CommandError("", 1);
        }
      } finally {
        spinner.stop();
      }
    });

  deployCmd
    .command("destroy")
    .description("Destroy a provisioned cloud instance")
    .argument("<instance-id>", "Instance ID to destroy")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (instanceId: string, opts: { deployDir: string; yes?: boolean; json?: boolean }) => {
      const instance = findInstance(opts.deployDir, instanceId);
      if (!instance) {
        console.error(chalk.red(`Instance not found: ${instanceId}`));
        throw new CommandError("", 1);
      }

      if (!opts.yes && !opts.json) {
        const { confirm } = await import("@inquirer/prompts");
        const proceed = await confirm({
          message: `Destroy instance ${instance.name} (${instance.provider}, ${instance.region})? This will terminate the VM and clean up local state.`,
          default: false,
        });
        if (!proceed) {
          console.log(chalk.dim("Destroy cancelled."));
          return;
        }
      }

      const spinner = ora(`Destroying instance ${instance.name}…`);
      if (!opts.json) spinner.start();

      try {
        const result = await destroyInstance({
          deployDir: opts.deployDir,
          instanceId,
        });

        if (!opts.json) spinner.stop();

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.success) {
          console.log(chalk.green(`Instance destroyed: ${instance.name} (${instance.provider})`));
          console.log(chalk.dim("  VM terminated, SSH key removed, local state cleaned."));
        } else {
          console.error(chalk.red(`Failed to destroy instance: ${result.error}`));
          throw new CommandError("", 1);
        }
      } finally {
        spinner.stop();
      }
    });

  deployCmd
    .command("update")
    .description("Push updates to a cloud-deployed agent via SSH")
    .requiredOption("--id <instance-id>", "Instance ID to update")
    .option("--config", "Push updated blueprint vars (rebuild + restart)")
    .option("--version", "Pull latest clawhq, rebuild, and restart")
    .option("--skill", "Run a skill command on the remote (pass subcommand as trailing args)")
    .argument("[skill-args...]", "Skill subcommand args when using --skill (e.g. install <source>)")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (skillArgs: string[], opts: {
      id: string;
      config?: boolean;
      version?: boolean;
      skill?: boolean;
      deployDir: string;
      json?: boolean;
    }) => {
      const modeCount = [opts.config, opts.version, opts.skill].filter(Boolean).length;
      if (modeCount === 0) {
        console.error(chalk.red("Specify an update mode: --config, --version, or --skill <subcommand>"));
        throw new CommandError("", 1);
      }
      if (modeCount > 1) {
        console.error(chalk.red("Specify only one update mode: --config, --version, or --skill"));
        throw new CommandError("", 1);
      }

      if (opts.skill && skillArgs.length === 0) {
        console.error(chalk.red("--skill requires a subcommand (e.g. --skill install <source>)"));
        throw new CommandError("", 1);
      }

      const mode = opts.config ? "config" as const : opts.version ? "version" as const : "skill" as const;

      const spinner = ora("Updating cloud agent…");
      if (!opts.json) spinner.start();

      try {
        const onProgress = createUpdateProgressHandler(spinner, opts.json);

        const result = await updateInstance({
          deployDir: opts.deployDir,
          instanceId: opts.id,
          mode,
          skillArgs: opts.skill ? skillArgs.join(" ") : undefined,
          onProgress,
        });

        if (!opts.json) spinner.stop();

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.success) {
          console.log(chalk.green(`\nUpdate complete.`));
          if (result.output) {
            console.log(chalk.dim(`\nRemote output:\n${result.output}`));
          }
        } else {
          console.error(chalk.red(`Update failed: ${result.error}`));
          throw new CommandError("", 1);
        }
      } finally {
        spinner.stop();
      }
    });

  deployCmd
    .command("status")
    .description("Check status of provisioned instances (all if no ID given)")
    .argument("[instance-id]", "Instance ID to check (omit to show all)")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (instanceId: string | undefined, opts: { deployDir: string; json?: boolean }) => {
      if (!instanceId) {
        const registry = readInstanceRegistry(opts.deployDir);

        if (opts.json) {
          const statuses = await Promise.all(
            registry.instances.map(async (inst) => {
              const status = await getInstanceStatus({ deployDir: opts.deployDir, instanceId: inst.id });
              return { instance: inst, liveStatus: status };
            }),
          );
          console.log(JSON.stringify(statuses, null, 2));
        } else if (registry.instances.length === 0) {
          console.log(chalk.dim("No cloud-deployed agents."));
          console.log(chalk.dim("  Deploy one: clawhq deploy"));
        } else {
          console.log(chalk.bold("\nCloud-Deployed Agents\n"));
          for (const inst of registry.instances) {
            const status = await getInstanceStatus({ deployDir: opts.deployDir, instanceId: inst.id });
            const stateColor = status.state === "active" ? chalk.green : status.state === "error" ? chalk.red : chalk.yellow;
            console.log(`  ${chalk.bold(inst.name)} ${chalk.dim(`(${inst.id.slice(0, 8)}…)`)}`);
            console.log(`    Provider: ${inst.provider}  Region: ${inst.region}  Size: ${inst.size}`);
            console.log(`    IP: ${inst.ipAddress}  State: ${stateColor(status.state)}`);
            console.log(`    Created: ${inst.createdAt}`);
            if (status.error) {
              console.log(`    Error: ${chalk.red(status.error)}`);
            }
            console.log("");
          }
        }
        return;
      }

      const instance = findInstance(opts.deployDir, instanceId);
      if (!instance) {
        console.error(chalk.red(`Instance not found: ${instanceId}`));
        throw new CommandError("", 1);
      }

      const status = await getInstanceStatus({
        deployDir: opts.deployDir,
        instanceId,
      });

      if (opts.json) {
        console.log(JSON.stringify({ instance, liveStatus: status }, null, 2));
      } else {
        console.log(chalk.bold(`\n${instance.name}`));
        console.log(chalk.dim(`  Provider:  ${instance.provider}`));
        console.log(chalk.dim(`  Region:    ${instance.region}`));
        console.log(chalk.dim(`  Size:      ${instance.size}`));
        console.log(chalk.dim(`  IP:        ${instance.ipAddress}`));
        console.log(chalk.dim(`  State:     ${status.state}`));
        console.log(chalk.dim(`  Created:   ${instance.createdAt}`));
        if (status.error) {
          console.log(chalk.red(`  Error:     ${status.error}`));
        }
      }
    });

  deployCmd
    .command("list")
    .description("List all provisioned instances")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: { deployDir: string; json?: boolean }) => {
      const registry = readInstanceRegistry(opts.deployDir);

      if (opts.json) {
        console.log(JSON.stringify(registry, null, 2));
      } else if (registry.instances.length === 0) {
        console.log(chalk.dim("No provisioned instances."));
        console.log(chalk.dim("  Create one: clawhq deploy create --provider digitalocean --name my-agent"));
      } else {
        console.log(chalk.bold("\nProvisioned Instances\n"));
        for (const inst of registry.instances) {
          const statusColor = inst.status === "active" ? chalk.green : inst.status === "error" ? chalk.red : chalk.yellow;
          console.log(`  ${chalk.bold(inst.name)} ${chalk.dim(`(${inst.id.slice(0, 8)}…)`)}`);
          console.log(`    Provider: ${inst.provider}  Region: ${inst.region}  Size: ${inst.size}`);
          console.log(`    IP: ${inst.ipAddress}  Status: ${statusColor(inst.status)}`);
          console.log(`    Created: ${inst.createdAt}\n`);
        }
      }
    });

  deployCmd
    .command("credentials")
    .description("Set up cloud provider credentials")
    .requiredOption("-p, --provider <provider>", "Cloud provider (digitalocean)")
    .requiredOption("-t, --token <token>", "API token")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .action(async (opts: { provider: string; token: string; deployDir: string }) => {
      const provider = resolveProviderAlias(opts.provider);
      if (!provider) {
        console.error(chalk.red(`Invalid provider: ${opts.provider}. Must be one of: digitalocean (do), aws, gcp, hetzner (hz)`));
        throw new CommandError("", 1);
      }

      setProviderCredential(opts.deployDir, provider, opts.token);
      console.log(chalk.green(`Credentials stored for ${provider} (mode 0600).`));
    });

  // ── Snapshot commands ────────────────────────────────────────────────────────

  const snapshotCmd = deployCmd.command("snapshot").description("Manage pre-built VM snapshots for fast provisioning");

  snapshotCmd
    .command("build")
    .description("Build a golden VM snapshot (provision → install → snapshot → destroy)")
    .requiredOption("-p, --provider <provider>", "Cloud provider (digitalocean, do, aws, gcp, hetzner)")
    .option("-r, --region <region>", "Builder VM region", "nyc3")
    .option("-s, --size <size>", "Builder VM size", "s-2vcpu-4gb")
    .option("--ssh-keys <keys>", "Comma-separated SSH key IDs (for debugging builder)")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (opts: {
      provider: string;
      region: string;
      size: string;
      sshKeys?: string;
      deployDir: string;
      json?: boolean;
    }) => {
      const provider = resolveProviderAlias(opts.provider);
      if (!provider) {
        console.error(chalk.red(`Invalid provider: ${opts.provider}. Must be one of: digitalocean (do), aws, gcp, hetzner (hz)`));
        throw new CommandError("", 1);
      }

      const sshKeys = opts.sshKeys ? opts.sshKeys.split(",").map((k) => k.trim()) : undefined;

      const spinner = ora("Building golden VM snapshot…");
      if (!opts.json) spinner.start();

      try {
        const onProgress = createSnapshotProgressHandler(spinner, opts.json);

        const result = await buildSnapshot({
          provider,
          deployDir: opts.deployDir,
          region: opts.region,
          size: opts.size,
          sshKeys,
          onProgress,
        });

        if (!opts.json) spinner.stop();

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.success) {
          console.log(chalk.green(`\nSnapshot built successfully.`));
          console.log(chalk.dim(`  Snapshot ID:  ${result.snapshotId}`));
          console.log(chalk.dim(`  Version:      ${result.clawhqVersion}`));
          console.log(chalk.dim(`\n  Use it:  clawhq deploy create --provider ${provider} --name my-agent --snapshot ${result.snapshotId}`));
          console.log(chalk.dim(`  List:    clawhq deploy snapshot list`));
          console.log(chalk.dim(`  Delete:  clawhq deploy snapshot delete ${result.snapshotId}`));
        } else {
          console.error(chalk.red(`Snapshot build failed: ${result.error}`));
          throw new CommandError("", 1);
        }
      } finally {
        spinner.stop();
      }
    });

  snapshotCmd
    .command("list")
    .description("List pre-built VM snapshots")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action((opts: { deployDir: string; json?: boolean }) => {
      const registry = readSnapshotRegistry(opts.deployDir);
      const currentVersion = getClawhqVersion();

      if (opts.json) {
        console.log(JSON.stringify({ ...registry, currentVersion }, null, 2));
      } else if (registry.snapshots.length === 0) {
        console.log(chalk.dim("No pre-built snapshots."));
        console.log(chalk.dim("  Build one: clawhq deploy snapshot build --provider digitalocean"));
      } else {
        console.log(chalk.bold("\nPre-built VM Snapshots\n"));
        for (const snap of registry.snapshots) {
          const stale = isSnapshotStale(snap, currentVersion);
          const versionTag = stale
            ? chalk.yellow(`v${snap.clawhqVersion} → v${currentVersion} (rebuild needed)`)
            : chalk.green(`v${snap.clawhqVersion} (current)`);
          console.log(`  ${chalk.bold(snap.name)} ${chalk.dim(`(${snap.snapshotId})`)}`);
          console.log(`    Provider: ${snap.provider}  Region: ${snap.region}  Size: ${snap.builderSize}`);
          console.log(`    Version:  ${versionTag}`);
          console.log(`    Built:    ${snap.builtAt}\n`);
        }
      }
    });

  snapshotCmd
    .command("delete")
    .description("Delete a pre-built VM snapshot")
    .argument("<snapshot-id>", "Provider-specific snapshot ID")
    .option("-d, --deploy-dir <path>", "Deployment directory", defaultDeployDir)
    .option("--json", "Output as JSON")
    .action(async (snapshotId: string, opts: { deployDir: string; json?: boolean }) => {
      const result = await deleteSnapshot(opts.deployDir, snapshotId);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.success) {
        console.log(chalk.green(`Snapshot removed: ${snapshotId}`));
      } else {
        console.error(chalk.red(`Failed to delete snapshot: ${result.error}`));
        throw new CommandError("", 1);
      }
    });
}
