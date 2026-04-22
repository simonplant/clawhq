import chalk from "chalk";
import ora from "ora";

import type { PrereqCheckResult } from "../../build/installer/index.js";
import type { DeployProgress } from "../../build/launcher/index.js";

export function formatPrereqCheck(check: PrereqCheckResult): void {
  if (check.ok) {
    console.log(chalk.green(`  ✔ ${check.name}`), chalk.dim(check.detail));
  } else {
    console.log(chalk.red(`  ✘ ${check.name}`), check.detail);
  }
}

export function createProgressHandler(spinner: ReturnType<typeof ora>) {
  return (event: DeployProgress): void => {
    const label = stepLabel(event.step);
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

export function createConnectProgressHandler(spinner: ReturnType<typeof ora>) {
  return (event: { step: string; status: string; message: string }): void => {
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

function stepLabel(step: string): string {
  const labels: Record<string, string> = {
    "preflight": "[preflight]",
    "compose-up": "[compose]",
    "firewall": "[firewall]",
    "health-verify": "[health]",
    "verify": "[verify]",
    "smoke-test": "[smoke]",
  };
  return chalk.dim(labels[step] ?? `[${step}]`);
}

export async function resolveGatewayToken(opts: { token?: string; deployDir: string }): Promise<string> {
  const { join } = await import("node:path");
  const { readEnvValue } = await import("../../secure/credentials/env-store.js");
  return opts.token
    ?? process.env["CLAWHQ_GATEWAY_TOKEN"]
    ?? readEnvValue(join(opts.deployDir, "engine", ".env"), "OPENCLAW_GATEWAY_TOKEN")
    ?? "";
}
