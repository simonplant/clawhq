/**
 * Check: Container is running and healthy.
 * Delegates to DockerClient.ps() to find running containers.
 */

import { DockerClient } from "../../../build/docker/client.js";
import type { Check, CheckResult, DoctorContext } from "../types.js";

export const containerHealthCheck: Check = {
  name: "Container health",

  async run(ctx: DoctorContext): Promise<CheckResult> {
    const client = new DockerClient();
    const imageTag = ctx.imageTag ?? "openclaw:custom";

    try {
      const containers = await client.ps();

      if (containers.length === 0) {
        return {
          name: this.name,
          status: "warn",
          message: "No containers running",
          fix: "Run `clawhq up` to start the agent container",
        };
      }

      // Find the OpenClaw container by image tag
      const agentContainer = containers.find((c) => c.image === imageTag);

      if (!agentContainer) {
        return {
          name: this.name,
          status: "warn",
          message: `No container running with image ${imageTag}`,
          fix: "Run `clawhq up` to start the agent container",
        };
      }

      if (agentContainer.state === "running") {
        return {
          name: this.name,
          status: "pass",
          message: `Container ${agentContainer.name} is running (${agentContainer.status})`,
          fix: "",
        };
      }

      return {
        name: this.name,
        status: "fail",
        message: `Container ${agentContainer.name} is ${agentContainer.state} (${agentContainer.status})`,
        fix: "Run `clawhq restart` to restart the agent container",
      };
    } catch (err: unknown) {
      return {
        name: this.name,
        status: "fail",
        message: `Cannot check containers: ${err instanceof Error ? err.message : String(err)}`,
        fix: "Ensure Docker is running and accessible",
      };
    }
  },
};
