/**
 * `clawhq dashboard` command.
 *
 * Starts the local web dashboard server and opens the browser.
 */

import { Command } from "commander";

export function createDashboardCommand(): Command {
  return new Command("dashboard")
    .description("Start the web dashboard")
    .option("-p, --port <port>", "Port to listen on", "18790")
    .option("--host <host>", "Host to bind", "127.0.0.1")
    .option("--no-open", "Don't open browser automatically")
    .option("--home <path>", "OpenClaw home directory", "~/.openclaw")
    .action(async (opts: {
      port: string;
      host: string;
      open: boolean;
      home: string;
    }) => {
      const { startServer } = await import("../server/index.js");
      const homePath = opts.home.replace(/^~/, process.env.HOME ?? "~");

      const server = startServer({
        port: parseInt(opts.port, 10),
        host: opts.host,
        openclawHome: homePath,
      });

      console.log(`ClawHQ dashboard running at ${server.url}`);

      if (opts.open) {
        const { exec } = await import("node:child_process");
        const cmd = process.platform === "darwin" ? "open" : "xdg-open";
        exec(`${cmd} ${server.url}`);
      }

      // Keep process alive
      process.on("SIGINT", () => {
        console.log("\nShutting down dashboard...");
        server.close();
        process.exit(0);
      });

      process.on("SIGTERM", () => {
        server.close();
        process.exit(0);
      });
    });
}
