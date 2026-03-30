/**
 * Docker Compose configuration generation with security posture hardening.
 *
 * Generates a docker-compose.yml structure with the correct security
 * controls applied based on the selected posture. Enforces all relevant
 * landmine rules (LM-06, LM-07, LM-10, LM-12, LM-13).
 */

import {
  OPENCLAW_CONTAINER_CONFIG,
  OPENCLAW_CONTAINER_CREDENTIALS,
  OPENCLAW_CONTAINER_CRON,
  OPENCLAW_CONTAINER_WORKSPACE,
} from "../../config/paths.js";

import type { PostureConfig } from "./types.js";

/** Options for generating a Docker Compose configuration. */
export interface ComposeOptions {
  /** Enable 1Password Docker secret injection for OP_SERVICE_ACCOUNT_TOKEN. */
  readonly enableOnePasswordSecret?: boolean;
  /** Path to the 1Password token file on host (relative to compose dir). */
  readonly onePasswordTokenFile?: string;
}

/** Generated docker-compose structure. */
export interface ComposeOutput {
  readonly version: string;
  readonly services: {
    readonly openclaw: ComposeServiceOutput;
  };
  readonly networks: Record<string, ComposeNetworkOutput>;
  readonly secrets?: Record<string, ComposeSecretOutput>;
}

interface ComposeServiceOutput {
  readonly image: string;
  readonly user: string;
  readonly cap_drop: readonly string[];
  readonly security_opt: readonly string[];
  readonly read_only: boolean;
  readonly tmpfs: readonly string[];
  readonly volumes: readonly string[];
  readonly networks: readonly string[];
  readonly env_file: readonly string[];
  readonly restart: string;
  readonly secrets?: readonly string[];
  readonly deploy?: {
    readonly resources: {
      readonly limits: {
        readonly cpus: string;
        readonly memory: string;
        readonly pids: number;
      };
    };
  };
}

interface ComposeNetworkOutput {
  readonly driver: string;
  readonly driver_opts?: Record<string, string>;
}

interface ComposeSecretOutput {
  readonly file: string;
}

// ── Compose Generation ──────────────────────────────────────────────────────

/**
 * Generate a docker-compose configuration with security hardening.
 *
 * Applies the posture's security controls and ensures all landmine
 * rules are satisfied in the output.
 */
export function generateCompose(
  imageTag: string,
  posture: PostureConfig,
  deployDir: string,
  networkName = "clawhq_net",
  options?: ComposeOptions,
): ComposeOutput {
  const enableOp = options?.enableOnePasswordSecret ?? false;
  const opTokenFile = options?.onePasswordTokenFile ?? "./secrets/op_service_account_token";

  const service: ComposeServiceOutput = {
    image: imageTag,
    user: posture.user,
    cap_drop: [...posture.capDrop],
    security_opt: [...posture.securityOpt],
    read_only: posture.readOnlyRootfs,
    tmpfs: [`/tmp:size=${posture.tmpfs.sizeMb}m,${posture.tmpfs.options}`],
    volumes: [
      // Config files read-only (LM-12)
      `${deployDir}/engine/openclaw.json:${OPENCLAW_CONTAINER_CONFIG}:ro`,
      `${deployDir}/engine/credentials.json:${OPENCLAW_CONTAINER_CREDENTIALS}:ro`,
      // Identity files read-only
      `${deployDir}/workspace/identity:${OPENCLAW_CONTAINER_WORKSPACE}/identity:ro`,
      // Workspace writable (tools, skills, memory)
      `${deployDir}/workspace/tools:${OPENCLAW_CONTAINER_WORKSPACE}/tools`,
      `${deployDir}/workspace/skills:${OPENCLAW_CONTAINER_WORKSPACE}/skills`,
      `${deployDir}/workspace/memory:${OPENCLAW_CONTAINER_WORKSPACE}/memory`,
      // Cron
      `${deployDir}/cron:${OPENCLAW_CONTAINER_CRON}`,
    ],
    networks: [networkName],
    env_file: [".env"],
    restart: "unless-stopped",
    // 1Password service account token via Docker secret (never in env vars)
    ...(enableOp ? { secrets: ["op_service_account_token"] } : {}),
    ...(hasResourceLimits(posture)
      ? {
          deploy: {
            resources: {
              limits: {
                cpus: String(posture.resources.cpus),
                memory: `${posture.resources.memoryMb}M`,
                pids: posture.resources.pidsLimit,
              },
            },
          },
        }
      : {}),
  };

  const networks: Record<string, ComposeNetworkOutput> = {
    [networkName]: {
      driver: "bridge",
      ...(posture.iccDisabled
        ? {
            driver_opts: {
              "com.docker.network.bridge.enable_icc": "false",
            },
          }
        : {}),
    },
  };

  return {
    version: "3.8",
    services: { openclaw: service },
    networks,
    // Docker secrets: token file on host → /run/secrets/ in container
    ...(enableOp
      ? {
          secrets: {
            op_service_account_token: {
              file: opTokenFile,
            },
          },
        }
      : {}),
  };
}

/** Check if posture has non-zero resource limits to apply. */
function hasResourceLimits(posture: PostureConfig): boolean {
  return (
    posture.resources.cpus > 0 ||
    posture.resources.memoryMb > 0 ||
    posture.resources.pidsLimit > 0
  );
}
