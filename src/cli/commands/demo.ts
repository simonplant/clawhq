import type { Command } from "commander";

import chalk from "chalk";
import ora from "ora";

import { getDemoCostEstimate, runCloudDemo } from "../../demo/cloud.js";
import type { CloudDemoProgress } from "../../demo/cloud.js";
import { runDemo } from "../../demo/index.js";
import type { DemoProgress } from "../../demo/index.js";

import { CommandError } from "../errors.js";

/** Cloud demo CLI action — provisions ephemeral DO droplet, opens browser, destroys on exit. */
async function runCloudDemoAction(opts: { yes?: boolean; region: string }): Promise<void> {
  // 1. Check for DIGITALOCEAN_TOKEN
  const token = process.env.DIGITALOCEAN_TOKEN;
  if (!token) {
    console.error(chalk.red("\n  DIGITALOCEAN_TOKEN environment variable is required for --cloud demo."));
    console.error(chalk.dim("  Get a token at: https://cloud.digitalocean.com/account/api/tokens"));
    console.error(chalk.dim("  Then: export DIGITALOCEAN_TOKEN=<your-token>\n"));
    throw new CommandError("", 1);
  }

  console.log("");
  console.log(chalk.bold.cyan("  ╔═══════════════════════════════════════╗"));
  console.log(chalk.bold.cyan("  ║       ClawHQ Cloud Demo              ║"));
  console.log(chalk.bold.cyan("  ║   No Docker — just a DO token        ║"));
  console.log(chalk.bold.cyan("  ╚═══════════════════════════════════════╝"));
  console.log("");

  // 2. Show cost estimate and confirm
  const cost = getDemoCostEstimate();
  console.log(chalk.dim("  Droplet: ") + cost.description);
  console.log(chalk.dim("  Region:  ") + opts.region);
  console.log(chalk.dim("  Cost:    ") + chalk.green(`~${cost.hourlyCost}/hr (fractions of a cent for a quick demo)`));
  console.log(chalk.dim("  Cleanup: ") + "Droplet auto-destroys when you press Ctrl+C");
  console.log("");

  if (!opts.yes) {
    const { confirm } = await import("@inquirer/prompts");
    const proceed = await confirm({
      message: "Provision an ephemeral DigitalOcean droplet for the demo?",
      default: true,
    });
    if (!proceed) {
      console.log(chalk.dim("\n  Demo cancelled.\n"));
      throw new CommandError("", 0);
    }
    console.log("");
  }

  // 3. Run cloud demo
  const spinner = ora();

  const cloudStepLabels: Record<string, string> = {
    "token-validate": "token",
    "create-droplet": "droplet",
    "wait-boot": "boot",
    "firewall": "firewall",
    "health": "health",
    "ready": "ready",
    "destroy": "cleanup",
  };

  const onProgress = (event: CloudDemoProgress) => {
    const label = chalk.dim(`[${cloudStepLabels[event.step] ?? event.step}]`);
    if (event.status === "running") {
      spinner.start(`${label} ${event.message}`);
    } else if (event.status === "done") {
      spinner.succeed(`${label} ${event.message}`);
    } else if (event.status === "failed") {
      spinner.fail(`${label} ${event.message}`);
    }
  };

  let cloudDemo: { destroy: () => Promise<boolean> } | undefined;
  let destroying = false;

  // Signal handlers for cleanup — these legitimately call process.exit()
  // because they run outside the normal command flow.
  const shutdown = async () => {
    if (destroying) return;
    destroying = true;

    console.log("");
    if (cloudDemo) {
      const success = await cloudDemo.destroy();
      if (!success) {
        console.log(chalk.yellow("\n  WARNING: Droplet may not have been destroyed."));
        console.log(chalk.yellow("  Check your DigitalOcean dashboard and destroy manually if needed."));
        console.log(chalk.yellow("  https://cloud.digitalocean.com/droplets\n"));
      }
      cloudDemo = undefined;
    }
    process.exit(0);
  };

  process.on("SIGINT", () => { void shutdown(); });
  process.on("SIGTERM", () => { void shutdown(); });

  // Best-effort cleanup on crash (AC: "Exit path destroys droplet even on crash")
  const crashHandler = (_reason: unknown) => {
    if (cloudDemo && !destroying) {
      console.error(chalk.red("\n  Process crashed — attempting to destroy demo droplet..."));
      console.error(chalk.yellow("  If this fails, check: https://cloud.digitalocean.com/droplets"));
      void shutdown();
    }
  };
  process.on("uncaughtException", crashHandler);
  process.on("unhandledRejection", crashHandler);

  try {
    cloudDemo = await runCloudDemo({ token, region: opts.region }, onProgress);
    const { chatUrl } = cloudDemo as { chatUrl: string; destroy: () => Promise<boolean> };

    // 4. Open browser
    try {
      const { execFile } = await import("node:child_process");
      const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      execFile(openCmd, [chatUrl]);
    } catch {
      // Browser open is best-effort
    }

    console.log("");
    console.log(chalk.bold.green("  Your cloud agent is ready!"));
    console.log(`  Open: ${chalk.bold.underline.cyan(chatUrl)}`);
    console.log("");
    console.log(chalk.dim("  Press Ctrl+C to destroy the droplet and exit."));
    console.log(chalk.dim("  The droplet is ephemeral — it will be destroyed on exit."));
    console.log(chalk.dim("  For a full agent: clawhq quickstart"));
    console.log("");
  } catch (err) {
    if (err instanceof CommandError) throw err;
    spinner.fail(err instanceof Error ? err.message : "Cloud demo failed");
    throw new CommandError("", 1);
  }
}

export function registerDemoCommand(program: Command): void {
  program
    .command("demo")
    .description("Zero-config demo — talk to a working agent in your browser in 60 seconds")
    .option("-p, --port <port>", "Web chat port", "3838")
    .option("--cloud", "Run demo on an ephemeral DigitalOcean droplet (no Docker needed)")
    .option("-y, --yes", "Skip cost confirmation prompt (for scripting)")
    .option("--region <region>", "DigitalOcean region for cloud demo", "nyc3")
    .action(async (opts: { port: string; cloud?: boolean; yes?: boolean; region: string }) => {
      // ── Cloud demo path ─────────────────────────────────────────────────────
      if (opts.cloud) {
        await runCloudDemoAction(opts);
        return;
      }

      // ── Local demo path (existing) ──────────────────────────────────────────
      const port = parseInt(opts.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        throw new CommandError("Invalid port number");
      }

      console.log("");
      console.log(chalk.bold.magenta("  ╔═══════════════════════════════════════╗"));
      console.log(chalk.bold.magenta("  ║         ClawHQ Demo                  ║"));
      console.log(chalk.bold.magenta("  ║   Zero-config agent in 60 seconds    ║"));
      console.log(chalk.bold.magenta("  ╚═══════════════════════════════════════╝"));
      console.log("");

      const spinner = ora();

      const stepLabels: Record<string, string> = {
        "init": "init",
        "ollama-probe": "ollama",
        "mock-llm": "llm",
        "blueprint": "blueprint",
        "config": "config",
        "chat-server": "server",
        "ready": "ready",
      };

      const onProgress = (event: DemoProgress) => {
        const label = chalk.dim(`[${stepLabels[event.step] ?? event.step}]`);
        if (event.status === "running") {
          spinner.start(`${label} ${event.message}`);
        } else if (event.status === "done") {
          spinner.succeed(`${label} ${event.message}`);
        } else if (event.status === "skipped") {
          spinner.info(chalk.dim(`${label} ${event.message}`));
        }
      };

      let demo: { port: number; close: () => void } | undefined;

      // Signal handler for cleanup — legitimately calls process.exit()
      const shutdown = () => {
        if (demo) {
          console.log("");
          spinner.start("Cleaning up demo...");
          demo.close();
          spinner.succeed("Demo cleaned up. All temporary data removed.");
          demo = undefined;
        }
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      try {
        demo = await runDemo({ port }, onProgress);

        const url = `http://localhost:${demo.port}`;
        console.log("");
        console.log(chalk.bold.green("  Your agent is ready!"));
        console.log(`  Open: ${chalk.bold.underline.cyan(url)}`);
        console.log("");
        console.log(chalk.dim("  Press Ctrl+C to stop the demo."));
        console.log(chalk.dim("  This is ephemeral — no data persists after exit."));
        console.log(chalk.dim("  For a full agent: clawhq quickstart"));
        console.log("");
      } catch (err) {
        spinner.fail(err instanceof Error ? err.message : "Demo failed");
        if (demo) demo.close();
        throw new CommandError("", 1);
      }
    });
}
