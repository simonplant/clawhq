import chalk from "chalk";
import ora from "ora";
import { stringify as yamlStringify } from "yaml";

import type { DeployProgress } from "../../build/launcher/index.js";
import type { PrereqCheckResult } from "../../build/installer/index.js";
import { FILE_MODE_SECRET } from "../../config/defaults.js";
import { generateAllowlistContent, generateBundle, generateIdentityFiles, generateToolFiles } from "../../design/configure/index.js";
import { generateOpsAutomationFiles } from "../../operate/automation/index.js";

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
    "smoke-test": "[smoke]",
  };
  return chalk.dim(labels[step] ?? `[${step}]`);
}

/** Convert a DeploymentBundle into FileEntry array for the atomic writer. */
export function bundleToFiles(
  bundle: ReturnType<typeof generateBundle>,
  blueprint: import("../../design/blueprints/types.js").Blueprint,
  customizationAnswers: Readonly<Record<string, string>> = {},
  integrationNames: readonly string[] = [],
) {
  const identityFiles = generateIdentityFiles(blueprint, customizationAnswers);

  return [
    {
      relativePath: "engine/openclaw.json",
      content: JSON.stringify(bundle.openclawConfig, null, 2) + "\n",
    },
    {
      relativePath: "engine/docker-compose.yml",
      content: yamlStringify(bundle.composeConfig),
    },
    {
      relativePath: "engine/.env",
      content: Object.entries(bundle.envVars)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") + "\n",
      mode: FILE_MODE_SECRET,
    },
    {
      relativePath: "engine/credentials.json",
      content: JSON.stringify({}, null, 2) + "\n",
      mode: FILE_MODE_SECRET,
    },
    {
      relativePath: "cron/jobs.json",
      content: JSON.stringify(bundle.cronJobs, null, 2) + "\n",
    },
    {
      relativePath: "clawhq.yaml",
      content: yamlStringify(bundle.clawhqConfig),
    },
    // Egress firewall allowlist (compiled from blueprint + integration domains)
    {
      relativePath: "ops/firewall/allowlist.yaml",
      content: generateAllowlistContent(blueprint, integrationNames),
    },
    // Identity files (SOUL.md, AGENTS.md)
    ...identityFiles.map((f) => ({
      relativePath: f.relativePath,
      content: f.content,
    })),
    // Workspace tools (email, ical, todoist, sanitize, etc.)
    ...generateToolFiles(blueprint).map((f) => ({
      relativePath: f.relativePath,
      content: f.content,
      mode: f.mode,
    })),
    // Operational automation scripts + systemd units
    ...generateOpsAutomationFiles(
      bundle.clawhqConfig.paths?.deployDir ?? "~/.clawhq",
      bundle.clawhqConfig.ops,
    ).map((f) => ({
      relativePath: f.relativePath,
      content: f.content,
      mode: f.mode,
    })),
  ];
}
