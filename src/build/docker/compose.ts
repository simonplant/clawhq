/**
 * Docker Compose configuration generation with security posture hardening.
 *
 * Generates a docker-compose.yml structure with the correct security
 * controls applied based on the selected posture. Enforces all relevant
 * landmine rules (LM-06, LM-07, LM-10, LM-12, LM-13).
 */

import {
  CRED_PROXY_AUDIT_DIR,
  CRED_PROXY_IMAGE,
  CRED_PROXY_PORT,
  CRED_PROXY_ROUTES_PATH,
  CRED_PROXY_SCRIPT_PATH,
} from "../../config/defaults.js";
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
  /** Enable credential proxy sidecar — secrets stay on host, never in agent container. */
  readonly enableCredProxy?: boolean;
  /** Host path to the generated proxy server script. */
  readonly credProxyScriptPath?: string;
  /** Host path to the proxy routes config file. */
  readonly credProxyRoutesPath?: string;
}

/** Generated docker-compose structure. */
export interface ComposeOutput {
  readonly version: string;
  readonly services: {
    readonly openclaw: ComposeServiceOutput;
    readonly "cred-proxy"?: ComposeCredProxyServiceOutput;
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

/** Credential proxy sidecar service output. */
interface ComposeCredProxyServiceOutput {
  readonly image: string;
  readonly user: string;
  readonly read_only: boolean;
  readonly cap_drop: readonly string[];
  readonly volumes: readonly string[];
  readonly networks: readonly string[];
  readonly env_file: readonly string[];
  readonly command: readonly string[];
  readonly restart: string;
  readonly tmpfs: readonly string[];
  readonly healthcheck: {
    readonly test: readonly string[];
    readonly interval: string;
    readonly timeout: string;
    readonly retries: number;
  };
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
  const enableCredProxy = options?.enableCredProxy ?? false;
  const credProxyScriptPath = options?.credProxyScriptPath ?? `${deployDir}/engine/cred-proxy.js`;
  const credProxyRoutesPath = options?.credProxyRoutesPath ?? `${deployDir}/engine/cred-proxy-routes.json`;

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
      // Credentials read-only — when cred-proxy is enabled, the agent container
      // still mounts credentials.json for OpenClaw runtime (model provider keys).
      // Tool-level API tokens are proxied and never reach the container env.
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

  // When cred-proxy is enabled, ICC must be allowed so agent can reach the proxy
  const networks: Record<string, ComposeNetworkOutput> = {
    [networkName]: {
      driver: "bridge",
      ...(posture.iccDisabled && !enableCredProxy
        ? {
            driver_opts: {
              "com.docker.network.bridge.enable_icc": "false",
            },
          }
        : {}),
    },
  };

  // Build cred-proxy sidecar service if enabled
  const credProxyService: ComposeCredProxyServiceOutput | undefined = enableCredProxy
    ? {
        image: CRED_PROXY_IMAGE,
        user: "1000:1000",
        read_only: true,
        cap_drop: ["ALL"],
        volumes: [
          `${credProxyScriptPath}:${CRED_PROXY_SCRIPT_PATH}:ro`,
          `${credProxyRoutesPath}:${CRED_PROXY_ROUTES_PATH}:ro`,
          `${deployDir}/ops/audit:${CRED_PROXY_AUDIT_DIR}`,
        ],
        networks: [networkName],
        env_file: [".env"],
        command: ["node", CRED_PROXY_SCRIPT_PATH],
        restart: "unless-stopped",
        tmpfs: ["/tmp:size=16m,noexec,nosuid"],
        healthcheck: {
          test: ["CMD", "node", "-e", `require("http").get("http://localhost:${CRED_PROXY_PORT}/health",(r)=>{process.exit(r.statusCode===200?0:1)}).on("error",()=>process.exit(1))`],
          interval: "30s",
          timeout: "5s",
          retries: 3,
        },
      }
    : undefined;

  return {
    version: "3.8",
    services: {
      openclaw: service,
      ...(credProxyService ? { "cred-proxy": credProxyService } : {}),
    },
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
