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
  OPENCLAW_CONTAINER_ROOT,
  OPENCLAW_CONTAINER_WORKSPACE,
} from "../../config/paths.js";

import type { PostureConfig, WorkspaceManifest } from "./types.js";

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
  /** Workspace manifest for granular volume mounts. When set, replaces single workspace mount. */
  readonly workspaceManifest?: WorkspaceManifest;
  /** Enable clawdius-trading sidecar — alert-grade trading assistant. */
  readonly enableClawdiusTrading?: boolean;
  /** Host path to the staged clawdius-trading source (contains Dockerfile + src/). */
  readonly clawdiusTradingDir?: string;
  /** Enable Tailscale sidecar for secure remote access. */
  readonly enableTailscale?: boolean;
  /** Tailscale auth key for automatic node registration. */
  readonly tailscaleAuthKey?: string;
  /** Tailscale hostname for this agent. */
  readonly tailscaleHostname?: string;
  /** Host path to persist Tailscale state across restarts. */
  readonly tailscaleStateDir?: string;
  /**
   * Host supports the OCI runtime requested by the posture (typically gVisor/runsc).
   * Defaults to true to preserve existing behavior. Set false when `docker info`
   * does not list the posture's runtime — the compose generator will omit the
   * `runtime:` directive so `docker compose up` doesn't fail with
   * "unknown or invalid runtime name". Other posture hardening (cap_drop,
   * no-new-privileges, read_only, tmpfs, seccomp) still applies.
   */
  readonly runtimeAvailable?: boolean;
  /**
   * Host directories to expose to the openclaw container as read-only
   * volume mounts under `/host/<basename>`. Use for inbound file drops
   * (e.g. `/media` → `/host/media`) so tools running inside the
   * read-only-rootfs container can read host-managed files without
   * breaking the workspace sandbox.
   *
   * Shape: each string is an absolute host path. Mount target is
   * derived as `/host/<basename>` with mode `:ro`. Paths that don't
   * exist on the host are emitted anyway — docker compose will fail
   * at `up` time with a clear error, which is better than silently
   * dropping the mount.
   */
  readonly readOnlyHostMounts?: readonly string[];
}

/** Generated docker-compose structure. */
export interface ComposeOutput {
  readonly version: string;
  readonly services: {
    readonly openclaw: ComposeServiceOutput;
    readonly "cred-proxy"?: ComposeCredProxyServiceOutput;
    readonly "clawdius-trading"?: ComposeClawdiusTradingServiceOutput;
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
  readonly security_opt: readonly string[];
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

/** Clawdius-trading sidecar — Node/TypeScript alert-grade trading assistant. */
interface ComposeClawdiusTradingServiceOutput {
  readonly build: { readonly context: string; readonly dockerfile: string };
  readonly user: string;
  readonly read_only: boolean;
  readonly cap_drop: readonly string[];
  readonly security_opt: readonly string[];
  readonly volumes: readonly string[];
  readonly networks: readonly string[];
  readonly env_file: readonly string[];
  readonly environment: Record<string, string>;
  readonly restart: string;
  readonly tmpfs: readonly string[];
  readonly depends_on?: Record<string, { readonly condition: string }>;
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
    // Map host.docker.internal for services that live on the Docker host.
    // Do NOT add an "ollama" entry: when Ollama runs as a sibling container on
    // the same user-defined network, Docker's internal DNS resolves the name
    // automatically. An extra_hosts entry would shadow that DNS and route
    // through host-gateway (where nothing is listening unless Ollama also
    // publishes to the host).
    extra_hosts: ["host.docker.internal:host-gateway"],
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
      // XDG-writable $HOME surface. Read-only rootfs preserves anti-persistence
      // for system paths (/usr, /etc) while skills get a predictable, FHS-correct
      // writable home. Each mount owned by the node user (uid/gid=1000) so tools
      // like Node/npm/Python that create cache dirs at runtime just work.
      "/home/node/.config:exec,nosuid,size=64m,uid=1000,gid=1000",
      // 1Password CLI token cache overlays .config with stricter noexec.
      "/home/node/.config/op:noexec,nosuid,size=10m,uid=1000,gid=1000",
      "/home/node/.local:exec,nosuid,size=512m,uid=1000,gid=1000",
      "/home/node/.cache:exec,nosuid,size=512m,uid=1000,gid=1000",
      "/home/node/.npm:exec,nosuid,size=128m,uid=1000,gid=1000",
      // OpenClaw runtime state: exec-approval temp files, plugin state, and
      // directories created at startup (telegram/, agents/, canvas/, logs/).
      // Bind mounts for persistent paths (workspace, cron, config) overlay this.
      `${OPENCLAW_CONTAINER_ROOT}:exec,nosuid,size=256m,uid=1000,gid=1000`,
    ],
    volumes: buildVolumes(deployDir, options),
    networks: [networkName, "ollama-bridge"],
    env_file: [".env"],
    restart: "unless-stopped",
    // OCI runtime override (gVisor kernel isolation for hardened/paranoid postures).
    // Emitted only when the host supports it; otherwise the other posture hardening
    // still applies (cap_drop, no-new-privileges, read_only, tmpfs, seccomp).
    ...(posture.runtime && options?.runtimeAvailable !== false
      ? { runtime: posture.runtime }
      : {}),
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
        security_opt: ["no-new-privileges"],
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

  // Build clawdius-trading sidecar if enabled — alert-grade trading assistant.
  const enableClawdiusTrading = options?.enableClawdiusTrading ?? false;
  const clawdiusTradingDir =
    options?.clawdiusTradingDir ?? `${deployDir}/engine/clawdius-trading`;

  const clawdiusTradingService: ComposeClawdiusTradingServiceOutput | undefined =
    enableClawdiusTrading
      ? {
          build: {
            context: clawdiusTradingDir,
            dockerfile: "Dockerfile",
          },
          user: "1000:1000",
          read_only: true,
          cap_drop: ["ALL"],
          security_opt: ["no-new-privileges"],
          volumes: [
            // Shared dir holds the SQLite DB + any handoff files.
            `${deployDir}/shared:/deploy/shared`,
            // Workspace memory (read-only) — today's brief lives here.
            `${deployDir}/workspace/memory:/deploy/workspace/memory:ro`,
          ],
          networks: [networkName],
          env_file: [".env"],
          environment: {
            TRADING_DEPLOY_DIR: "/deploy",
            TRADIER_BASE_URL: `http://cred-proxy:${CRED_PROXY_PORT}/tradier`,
            TZ: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          restart: "unless-stopped",
          tmpfs: ["/tmp:size=32m,noexec,nosuid"],
          ...(enableCredProxy
            ? { depends_on: { "cred-proxy": { condition: "service_healthy" } } }
            : {}),
          healthcheck: {
            test: [
              "CMD",
              "node",
              "-e",
              "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
            ],
            interval: "15s",
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
      ...(clawdiusTradingService
        ? { "clawdius-trading": clawdiusTradingService }
        : {}),
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

// ── Volume Construction ────────────────────────────────────────────────────

/**
 * Build the volumes array for the openclaw service.
 *
 * When a workspace manifest is provided, the single blanket deploy-dir mount
 * is decomposed into granular mounts so that:
 *   - Immutable paths (tools, identity) come from the image layer — NO mount
 *   - Persistent dirs (memory, state) are mounted read-write
 *   - Config paths are mounted read-only
 *   - The workspace root itself is NOT mounted
 *
 * Without a manifest, falls back to the original blanket mount for
 * backwards compatibility.
 */
function buildVolumes(deployDir: string, options?: ComposeOptions): string[] {
  const volumes: string[] = [];
  const ws = OPENCLAW_CONTAINER_WORKSPACE;
  const manifest = options?.workspaceManifest;

  if (manifest) {
    // Granular mode: mount only what OpenClaw needs outside workspace,
    // then mount workspace subdirs individually.
    //
    // Engine config (read-only — runtime should not modify its own config)
    volumes.push(`${deployDir}/engine/openclaw.json:${OPENCLAW_CONTAINER_CONFIG}:ro`);
    // Credentials (read-only — managed by clawhq creds, never by the agent)
    volumes.push(`${deployDir}/engine/credentials.json:${OPENCLAW_CONTAINER_CREDENTIALS}:ro`);
    // Cron jobs
    volumes.push(`${deployDir}/cron:${OPENCLAW_CONTAINER_CRON}`);

    // Workspace root — bind-mount the whole workspace so tool scripts and
    // other files at the root survive the tmpfs shadow at /home/node/.openclaw.
    // Persistent/config subdirs below are nested binds that overlay this.
    volumes.push(`${deployDir}/workspace:${ws}`);

    // Persistent workspace directories — read-write (nested on top of workspace bind)
    for (const dir of manifest.persistent) {
      volumes.push(`${deployDir}/workspace/${dir}:${ws}/${dir}`);
    }

    // Config workspace paths — read-only
    for (const path of manifest.config) {
      volumes.push(`${deployDir}/workspace/${path}:${ws}/${path}:ro`);
    }

    // Immutable paths: baked into the image layer. Kept even though the
    // workspace bind above re-shadows them — the image copy provides a
    // fallback if the deploy-dir workspace is missing/detached.
    // Ephemeral paths: future tmpfs support (not yet wired).
  } else {
    // No manifest — mount the minimum required paths.
    // Cannot blanket-mount deployDir at OPENCLAW_CONTAINER_ROOT because
    // that conflicts with the tmpfs at the same path (needed for OpenClaw
    // runtime state: telegram/, agents/, canvas/, logs/, exec-approval).
    volumes.push(`${deployDir}/engine/openclaw.json:${OPENCLAW_CONTAINER_CONFIG}:ro`);
    volumes.push(`${deployDir}/engine/credentials.json:${OPENCLAW_CONTAINER_CREDENTIALS}:ro`);
    volumes.push(`${deployDir}/workspace:${ws}`);
    volumes.push(`${deployDir}/cron:${OPENCLAW_CONTAINER_CRON}`);
  }

  // Read-only host mounts — inbound file sources outside the workspace.
  // Mounted under /host/<basename> so they don't collide with container
  // paths and are obvious-by-convention to any tool or skill that reads
  // them. Emitted for both manifest and non-manifest volume modes.
  for (const hostPath of options?.readOnlyHostMounts ?? []) {
    if (!hostPath.startsWith("/")) continue; // ignore relative paths defensively
    const base = hostPath.split("/").filter(Boolean).pop() ?? "";
    if (!base) continue;
    volumes.push(`${hostPath}:/host/${base}:ro`);
  }

  return volumes;
}

/** Check if posture has non-zero resource limits to apply. */
function hasResourceLimits(posture: PostureConfig): boolean {
  return (
    posture.resources.cpus > 0 ||
    posture.resources.memoryMb > 0 ||
    posture.resources.pidsLimit > 0
  );
}
