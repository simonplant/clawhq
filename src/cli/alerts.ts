/**
 * `clawhq alerts` command — show current and predicted health alerts.
 */

import { Command } from "commander";

import {
  formatAlertJson,
  formatAlertTable,
  generateAlerts,
} from "../operate/alerts/index.js";
import { loadHistory as loadAlertHistory } from "../operate/alerts/store.js";

/**
 * Create the `alerts` command.
 */
export function createAlertsCommand(): Command {
  return new Command("alerts")
    .description("Show current and predicted health alerts")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .option("--json", "Output as JSON")
    .action(async (opts: {
      home: string;
      json?: boolean;
    }) => {
      const openclawHome = opts.home.replace(/^~/, process.env.HOME ?? "~");
      const history = await loadAlertHistory(openclawHome);
      const alertReport = generateAlerts(history);

      if (opts.json) {
        console.log(formatAlertJson(alertReport));
      } else {
        console.log(formatAlertTable(alertReport));
      }

      if (alertReport.counts.critical > 0) {
        process.exitCode = 1;
      }
    });
}
