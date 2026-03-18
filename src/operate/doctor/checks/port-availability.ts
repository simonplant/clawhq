/**
 * Check: Port 18789 (Gateway) is not already bound by another process.
 * Uses net.createServer to test if the port is available.
 */

import { createServer } from "node:net";

import type { Check, CheckResult, DoctorContext } from "../types.js";

function checkPort(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => {
      resolve(false); // Port is in use
    });
    server.once("listening", () => {
      server.close(() => resolve(true)); // Port is available
    });
    server.listen(port, host);
  });
}

export const portAvailabilityCheck: Check = {
  name: "Port availability",

  async run(ctx: DoctorContext): Promise<CheckResult> {
    const port = ctx.gatewayPort ?? 18789;
    const host = ctx.gatewayHost ?? "127.0.0.1";

    const available = await checkPort(port, host);

    if (available) {
      return {
        name: this.name,
        status: "pass",
        message: `Port ${port} is available`,
        fix: "",
      };
    }

    // Port in use — could be the Gateway itself (which is fine) or a conflict
    return {
      name: this.name,
      status: "warn",
      message: `Port ${port} is in use (may be the Gateway or another process)`,
      fix: `Check what is using port ${port}: lsof -i :${port}`,
    };
  },
};
