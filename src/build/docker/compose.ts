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
  /** Enable Tailscale sidecar for secure remote access. */
  readonly enableTailscale?: boolean;
  /** Tailscale auth key for automatic node registration. */
  readonly tailscaleAuthKey?: string;
  /** Tailscale hostname for this agent. */
  readonly tailscaleHostname?: string;
  /** Host path to persist Tailscale state across restarts. */
  readonly tailscaleStateDir?: string;
}

/** Generated docker-compose structure. */
export interface ComposeOutput {
  readonly version: string;
  readonly services: {
    readonly openclaw: ComposeServiceOutput;
    readonly "cred-proxy"?: ComposeCredProxyServiceOutput;
    readonly tailscale?: ComposeTailscaleServiceOutput;
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
  readonly command: readonly string[];
  readonly ports: readonly string[];
  readonly environment: Record<string, string>;
  readonly init: boolean;
  readonly extra_hosts: readonly string[];
  readonly healthcheck: {
    readonly test: readonly string[];
    readonly interval: string;
    readonly timeout: string;
    readonly retries: number;
    readonly start_period: string;
  };
  readonly secrets?: readonly string[];
  /** OCI runtime override (e.g. "runsc" for gVisor). */
  readonly runtime?: string;
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
  readonly driver?: string;
  readonly driver_opts?: Record<string, string>;
  readonly external?: boolean;
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

/** Tailscale sidecar service — secure remote access without exposing ports. Runs in userspace mode. */
interface ComposeTailscaleServiceOutput {
  readonly image: string;
  readonly hostname: string;
  readonly cap_drop: readonly string[];
  readonly volumes: readonly string[];
  readonly networks: readonly string[];
  readonly environment: Record<string, string>;
  readonly restart: string;
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
    // Gateway command — must use --bind lan for Docker bridge port forwarding
    command: ["node", "dist/index.js", "gateway", "--bind", "lan", "--port", "18789"],
    ports: ["127.0.0.1:18789:18789"],
    init: true,
    // Map hostnames to host gateway for Ollama and other host services
    // Note: host firewall must allow Docker bridge traffic to port 11434
    // clawhq doctor checks this and provides the fix command
    extra_hosts: ["host.docker.internal:host-gateway", "ollama:host-gateway"],
    environment: {
      HOME: "/home/node",
      TERM: "xterm-256color",
      TZ: Intl.DateTimeFormat().resolvedOptions().timeZone,
      PATH: "/home/node/.openclaw/workspace:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      XDG_CONFIG_HOME: "/home/node/.config",
      // Gateway token passed via env_file (.env)
      OPENCLAW_GATEWAY_TOKEN: "${OPENCLAW_GATEWAY_TOKEN:-}",
    },
    healthcheck: {
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:18789/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],
      interval: `${posture.healthcheckIntervalSecs}s`,
      timeout: "5s",
      retries: 5,
      start_period: "20s",
    },
    tmpfs: [
      `/tmp:size=${posture.tmpfs.sizeMb}m,${posture.tmpfs.options}`,
      "/home/node/.config/op:noexec,nosuid,size=10m,uid=1000,gid=1000",
      "/home/node/.local:exec,nosuid,size=512m",
      "/home/node/.cache:exec,nosuid,size=512m",
    ],
    volumes: [
      // Deploy dir as OpenClaw root (writable — OpenClaw creates temp files, state dirs)
      `${deployDir}:/home/node/.openclaw`,
      // Workspace writable
      `${deployDir}/workspace:/home/node/.openclaw/workspace`,
      // Cron
      `${deployDir}/cron:${OPENCLAW_CONTAINER_CRON}`,
    ],
    networks: [networkName, "ollama-bridge"],
    env_file: [".env"],
    restart: "unless-stopped",
    // OCI runtime override (gVisor kernel isolation for hardened/paranoid postures)
    ...(posture.runtime ? { runtime: posture.runtime } : {}),
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
    "ollama-bridge": {
      external: true,
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

  // Build Tailscale sidecar if enabled — secure remote access without port exposure
  const enableTailscale = options?.enableTailscale ?? false;
  const tailscaleStateDir = options?.tailscaleStateDir ?? `${deployDir}/ops/tailscale`;
  const tailscaleHostname = options?.tailscaleHostname ?? "clawhq-agent";

  const tailscaleService: ComposeTailscaleServiceOutput | undefined = enableTailscale
    ? {
        image: "ghcr.io/tailscale/tailscale:latest",
        hostname: tailscaleHostname,
        cap_drop: ["ALL"],
        volumes: [
          `${tailscaleStateDir}:/var/lib/tailscale`,
        ],
        networks: [networkName],
        environment: {
          TS_AUTHKEY: "${TS_AUTHKEY:-}",
          TS_HOSTNAME: tailscaleHostname,
          TS_STATE_DIR: "/var/lib/tailscale",
          TS_USERSPACE: "true",
        },
        restart: "unless-stopped",
        healthcheck: {
          test: ["CMD", "tailscale", "status", "--json"],
          interval: "60s",
          timeout: "10s",
          retries: 3,
        },
      }
    : undefined;

  return {
    version: "3.8",
    services: {
      openclaw: service,
      ...(credProxyService ? { "cred-proxy": credProxyService } : {}),
      ...(tailscaleService ? { tailscale: tailscaleService } : {}),
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
