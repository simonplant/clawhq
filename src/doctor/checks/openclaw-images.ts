/**
 * Check: OpenClaw container images exist locally.
 */

import { DockerClient } from "../../docker/client.js";
import type { Check, CheckResult, DoctorContext } from "../types.js";

export const openclawImagesCheck: Check = {
  name: "OpenClaw images",

  async run(ctx: DoctorContext): Promise<CheckResult> {
    const client = new DockerClient();
    const baseTag = ctx.baseTag ?? "openclaw:local";
    const finalTag = ctx.imageTag ?? "openclaw:custom";
    const missing: string[] = [];

    for (const tag of [baseTag, finalTag]) {
      try {
        const exists = await client.imageExists(tag);
        if (!exists) missing.push(tag);
      } catch {
        missing.push(tag);
      }
    }

    if (missing.length === 0) {
      return {
        name: this.name,
        status: "pass",
        message: `Images found: ${baseTag}, ${finalTag}`,
        fix: "",
      };
    }

    return {
      name: this.name,
      status: "fail",
      message: `Missing images: ${missing.join(", ")}`,
      fix: "Run `clawhq build` to create the required images",
    };
  },
};
