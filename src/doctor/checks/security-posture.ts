/**
 * Check: Running container matches the expected security posture.
 *
 * Inspects the running container and verifies that cap_drop, read_only,
 * no-new-privileges, user, and resource limits match the configured posture.
 */

import { DockerClient } from "../../docker/client.js";
import {
  type SecurityPosture,
  getPostureDefinition,
} from "../../docker/hardening.js";
import type { Check, CheckResult, DoctorContext } from "../types.js";

export interface SecurityPostureContext extends DoctorContext {
  expectedPosture?: SecurityPosture;
}

interface ContainerInspect {
  HostConfig?: {
    CapDrop?: string[];
    ReadonlyRootfs?: boolean;
    SecurityOpt?: string[];
    NanoCpus?: number;
    Memory?: number;
    Tmpfs?: Record<string, string>;
  };
  Config?: {
    User?: string;
  };
}

interface PostureMismatch {
  control: string;
  expected: string;
  actual: string;
}

export const securityPostureCheck: Check = {
  name: "Security posture",

  async run(ctx: DoctorContext): Promise<CheckResult> {
    const postureCtx = ctx as SecurityPostureContext;
    const expectedPosture = postureCtx.expectedPosture ?? "hardened";
    const client = new DockerClient();
    const imageTag = ctx.imageTag ?? "openclaw:custom";

    try {
      const containers = await client.ps();
      const agentContainer = containers.find((c) => c.image === imageTag);

      if (!agentContainer) {
        return {
          name: this.name,
          status: "warn",
          message: "No running container found to verify security posture",
          fix: "Run `clawhq up` to start the agent container",
        };
      }

      const inspectData = await client.inspect(agentContainer.id);
      if (inspectData.length === 0) {
        return {
          name: this.name,
          status: "fail",
          message: "Could not inspect container",
          fix: "Ensure the container is running and Docker is accessible",
        };
      }

      const container = inspectData[0] as unknown as ContainerInspect;
      const mismatches = verifyPosture(container, expectedPosture);

      if (mismatches.length === 0) {
        return {
          name: this.name,
          status: "pass",
          message: `Container matches '${expectedPosture}' security posture`,
          fix: "",
        };
      }

      const details = mismatches
        .map((m) => `${m.control}: expected ${m.expected}, got ${m.actual}`)
        .join("; ");

      return {
        name: this.name,
        status: "fail",
        message: `Security posture '${expectedPosture}' mismatch: ${details}`,
        fix: `Redeploy with \`clawhq up\` to apply the '${expectedPosture}' security posture`,
      };
    } catch (err: unknown) {
      return {
        name: this.name,
        status: "fail",
        message: `Cannot verify security posture: ${err instanceof Error ? err.message : String(err)}`,
        fix: "Ensure Docker is running and the container is accessible",
      };
    }
  },
};

/** Verify that a container's settings match the expected posture. */
function verifyPosture(
  container: ContainerInspect,
  posture: SecurityPosture,
): PostureMismatch[] {
  const definition = getPostureDefinition(posture);
  const expected = definition.service;
  const host = container.HostConfig ?? {};
  const config = container.Config ?? {};
  const mismatches: PostureMismatch[] = [];

  // Check cap_drop
  if (expected.capDrop) {
    const actual = host.CapDrop ?? [];
    const missing = expected.capDrop.filter((c) => !actual.includes(c));
    if (missing.length > 0) {
      mismatches.push({
        control: "cap_drop",
        expected: expected.capDrop.join(","),
        actual: actual.length > 0 ? actual.join(",") : "none",
      });
    }
  }

  // Check read_only rootfs
  if (expected.readOnly !== undefined) {
    const actual = host.ReadonlyRootfs ?? false;
    if (actual !== expected.readOnly) {
      mismatches.push({
        control: "read_only",
        expected: String(expected.readOnly),
        actual: String(actual),
      });
    }
  }

  // Check security_opt (no-new-privileges)
  if (expected.securityOpt) {
    const actual = host.SecurityOpt ?? [];
    for (const opt of expected.securityOpt) {
      if (!actual.includes(opt) && !actual.includes(opt.replace(":", "="))) {
        mismatches.push({
          control: "security_opt",
          expected: opt,
          actual: actual.length > 0 ? actual.join(",") : "none",
        });
      }
    }
  }

  // Check user
  if (expected.user) {
    const actual = config.User ?? "";
    if (actual !== expected.user) {
      mismatches.push({
        control: "user",
        expected: expected.user,
        actual: actual || "root",
      });
    }
  }

  // Check resource limits
  if (expected.deploy?.resources?.limits) {
    const limits = expected.deploy.resources.limits;

    if (limits.cpus) {
      // Docker stores NanoCpus (1 CPU = 1e9 NanoCpus)
      const expectedNano = parseFloat(limits.cpus) * 1e9;
      const actualNano = host.NanoCpus ?? 0;
      if (actualNano !== expectedNano) {
        mismatches.push({
          control: "cpu_limit",
          expected: limits.cpus,
          actual: actualNano > 0 ? String(actualNano / 1e9) : "unlimited",
        });
      }
    }

    if (limits.memory) {
      const expectedBytes = parseMemoryLimit(limits.memory);
      const actualBytes = host.Memory ?? 0;
      if (actualBytes !== expectedBytes) {
        mismatches.push({
          control: "memory_limit",
          expected: limits.memory,
          actual: actualBytes > 0 ? formatBytes(actualBytes) : "unlimited",
        });
      }
    }
  }

  return mismatches;
}

function parseMemoryLimit(limit: string): number {
  const match = limit.match(/^(\d+(?:\.\d+)?)\s*(b|k|m|g|t)?$/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = (match[2] ?? "b").toLowerCase();
  const multipliers: Record<string, number> = {
    b: 1,
    k: 1024,
    m: 1024 * 1024,
    g: 1024 * 1024 * 1024,
    t: 1024 * 1024 * 1024 * 1024,
  };
  return value * (multipliers[unit] ?? 1);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(0)}g`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}m`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}k`;
  return `${bytes}b`;
}

export { verifyPosture, parseMemoryLimit, formatBytes };
