/**
 * `clawhq smoke` command — post-deploy smoke test.
 */

import { Command } from "commander";

import { runSmokeTest } from "../smoke/index.js";

/**
 * Create the `smoke` command.
 */
export function createSmokeCommand(): Command {
  return new Command("smoke")
    .description("Run post-deploy smoke test to verify agent is working")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--config <path>", "Path to openclaw.json", "~/.openclaw/openclaw.json")
    .option("--gateway-host <host>", "Gateway host", "127.0.0.1")
    .option("--gateway-port <port>", "Gateway port", "18789")
    .option("--timeout <ms>", "Response timeout in ms", "30000")
    .option("--json", "Output results as JSON")
    .action(async (opts: {
      home: string;
      config: string;
      gatewayHost: string;
      gatewayPort: string;
      timeout: string;
      json?: boolean;
    }) => {
      const homePath = opts.home.replace(/^~/, process.env.HOME ?? "~");
      const configPath = opts.config.replace(/^~/, process.env.HOME ?? "~");

      const result = await runSmokeTest({
        openclawHome: homePath,
        configPath,
        gatewayHost: opts.gatewayHost,
        gatewayPort: parseInt(opts.gatewayPort, 10),
        responseTimeoutMs: parseInt(opts.timeout, 10),
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        // Table output matching doctor format
        const nameWidth = Math.max(5, ...result.checks.map((c) => c.name.length));
        const statusWidth = 6;

        console.log(`${"CHECK".padEnd(nameWidth)}  ${"STATUS".padEnd(statusWidth)}  MESSAGE`);
        console.log("-".repeat(nameWidth + statusWidth + nameWidth + 10));

        for (const check of result.checks) {
          const icon = check.status.toUpperCase();
          console.log(`${check.name.padEnd(nameWidth)}  ${icon.padEnd(statusWidth)}  ${check.message}`);
        }

        const passCount = result.checks.filter((c) => c.status === "pass").length;
        const failCount = result.checks.filter((c) => c.status === "fail").length;
        const skipCount = result.checks.filter((c) => c.status === "skip").length;

        console.log("");
        console.log(`${passCount} passed, ${failCount} failed, ${skipCount} skipped`);

        if (!result.passed) {
          console.log("");
          console.log("Smoke test failed. Run `clawhq doctor` for full diagnostics.");
        }
      }

      if (!result.passed) {
        process.exitCode = 1;
      }
    });
}
