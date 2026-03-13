/**
 * Check: Docker daemon is running and accessible.
 */

import { DockerClient, DaemonNotRunning } from "../../docker/client.js";
import type { Check, CheckResult, DoctorContext } from "../types.js";

export const dockerDaemonCheck: Check = {
  name: "Docker daemon",

  async run(_ctx: DoctorContext): Promise<CheckResult> {
    const client = new DockerClient();
    try {
      await client.exec(["info"]);
      return {
        name: this.name,
        status: "pass",
        message: "Docker daemon is running",
        fix: "",
      };
    } catch (err: unknown) {
      if (err instanceof DaemonNotRunning) {
        return {
          name: this.name,
          status: "fail",
          message: "Docker daemon is not running",
          fix: "Start the Docker daemon: sudo systemctl start docker",
        };
      }
      return {
        name: this.name,
        status: "fail",
        message: `Docker command failed: ${err instanceof Error ? err.message : String(err)}`,
        fix: "Ensure Docker is installed and accessible",
      };
    }
  },
};
