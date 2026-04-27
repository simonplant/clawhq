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
  DNS_RESOLVER_CONF_PATH,
  DNS_RESOLVER_GATEWAY,
  DNS_RESOLVER_IMAGE,
  DNS_RESOLVER_SUBNET,
} from "../../config/defaults.js";
import { instanceOpsDir } from "../../config/ops-paths.js";
import {
  OPENCLAW_CONTAINER_CONFIG,
  OPENCLAW_CONTAINER_CREDENTIALS,
  OPENCLAW_CONTAINER_CRON,
  OPENCLAW_CONTAINER_ROOT,
  OPENCLAW_CONTAINER_WORKSPACE,
} from "../../config/paths.js";
import { sortedEntries } from "../../config/stable-serialize.js";

import { openclawContainerName } from "./container-naming.js";
import type { PostureConfig, WorkspaceManifest } from "./types.js";

/** Options for generating a Docker Compose configuration. */
export interface ComposeOptions {
  /**
   * Unified-registry uuid for this deployment. When set, the openclaw service
   * gets `container_name: openclaw-<shortId(instanceId)>`, making the
   * container name stable, predictable, and distinct across multiple
   * deployments on one host. Required for reliable multi-instance operation;
   * when absent, falls back to Compose's `<project>-<service>-<index>`
   * naming (brittle when two deployments share the same project name).
   */
  readonly instanceId?: string;
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
  /** Enable market-engine sidecar — alert-grade trading assistant. */
  readonly enableMarketEngine?: boolean;
  /** Host path to the staged market-engine source (contains Dockerfile + src/). */
  readonly marketEngineDir?: string;
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
  /**
   * Enable the dns-resolver sidecar. When true (the default), the bridge
   * network is pinned to a stable subnet, dnsmasq runs in host network
   * mode binding the bridge gateway IP, and every other service routes
   * DNS through it. This is required for CDN-fronted APIs whose IPs
   * rotate per query — see `renderDnsmasqConf` and
   * knowledge/wiki/decisions/cdn-dns-aware-egress.md.
   */
  readonly enableDnsResolver?: boolean;
  /**
   * Host path to the rendered dnsmasq.conf. Mounted read-only into the
   * dns-resolver container. Defaults to `${deployDir}/engine/dnsmasq.conf`.
   */
  readonly dnsResolverConfPath?: string;
}

/** Generated docker-compose structure. */
export interface ComposeOutput {
  readonly version: string;
  readonly services: {
    readonly openclaw: ComposeServiceOutput;
    readonly ollama: ComposeOllamaServiceOutput;
    readonly "cred-proxy"?: ComposeCredProxyServiceOutput;
    readonly "market-engine"?: ComposeMarketEngineServiceOutput;
    readonly tailscale?: ComposeTailscaleServiceOutput;
    readonly "dns-resolver"?: ComposeDnsResolverServiceOutput;
  };
  readonly networks: Record<string, ComposeNetworkOutput>;
  readonly secrets?: Record<string, ComposeSecretOutput>;
}

interface ComposeServiceOutput {
  readonly image: string;
  /** Instance-scoped container name: `openclaw-<shortId>` when instanceId is known. */
  readonly container_name?: string;
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
  /** DNS servers used by the container's resolver. Pointed at dns-resolver
   * (host bridge gateway IP) when the resolver sidecar is enabled. */
  readonly dns?: readonly string[];
  /** Service dependencies — wait for dns-resolver health before starting. */
  readonly depends_on?: Record<string, { readonly condition: string }>;
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
  /**
   * Pinned IPAM. Without a pinned subnet/gateway the bridge IP shifts on
   * `docker network rm/create`, which breaks the `dns:` directive on
   * every other service (they hard-code the gateway IP). Pin once,
   * everything stays stable across restarts.
   */
  readonly ipam?: {
    readonly config: ReadonlyArray<{
      readonly subnet: string;
      readonly gateway: string;
    }>;
  };
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
  readonly dns?: readonly string[];
  readonly depends_on?: Record<string, { readonly condition: string }>;
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
  readonly dns?: readonly string[];
  readonly depends_on?: Record<string, { readonly condition: string }>;
  readonly healthcheck: {
    readonly test: readonly string[];
    readonly interval: string;
    readonly timeout: string;
    readonly retries: number;
  };
}

/**
 * dns-resolver sidecar — runs dnsmasq with `--ipset=` to auto-populate the
 * host's `clawhq_egress` ipset on every container DNS query. Required for
 * CDN-fronted APIs that rotate A records (Apigee, CloudFront).
 *
 * Uses `network_mode: host` so the resolver shares the host's network
 * namespace — the only namespace where the host ipset is reachable via
 * netlink. CAP_NET_ADMIN is required for the ipset writes; everything
 * else is dropped.
 */
interface ComposeDnsResolverServiceOutput {
  readonly image: string;
  readonly container_name?: string;
  readonly network_mode: "host";
  readonly cap_drop: readonly string[];
  readonly cap_add: readonly string[];
  readonly security_opt: readonly string[];
  readonly read_only: boolean;
  readonly volumes: readonly string[];
  readonly command: readonly string[];
  readonly restart: string;
  readonly healthcheck: {
    readonly test: readonly string[];
    readonly interval: string;
    readonly timeout: string;
    readonly retries: number;
  };
}

/** Market-engine sidecar — Node/TypeScript alert-grade trading assistant. */
interface ComposeMarketEngineServiceOutput {
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
  readonly dns?: readonly string[];
  readonly depends_on?: Record<string, { readonly condition: string }>;
  readonly healthcheck: {
    readonly test: readonly string[];
    readonly interval: string;
    readonly timeout: string;
    readonly retries: number;
  };
}

/** Ollama GPU sidecar service — local LLM inference for the agent. */
interface ComposeOllamaServiceOutput {
  readonly image: string;
  readonly container_name?: string;
  readonly restart: string;
  readonly init: boolean;
  readonly security_opt: readonly string[];
  readonly volumes: readonly string[];
  readonly ports: readonly string[];
  readonly environment: Record<string, string>;
  readonly networks: readonly string[];
  readonly healthcheck: {
    readonly test: readonly string[];
    readonly interval: string;
    readonly timeout: string;
    readonly retries: number;
    readonly start_period: string;
  };
  readonly mem_limit?: string;
  readonly pids_limit?: number;
  readonly deploy?: {
    readonly resources: {
      readonly reservations?: {
        readonly devices: ReadonlyArray<{
          readonly driver: string;
          readonly count: string | number;
          readonly capabilities: readonly string[];
        }>;
      };
    };
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
  // dns-resolver default: enabled. Egress firewall is on by default and the
  // resolver is what keeps it correct under CDN A-record rotation; without
  // it, every CDN-fronted upstream is one DNS rotation away from a silent
  // drop. Tests opt out.
  const enableDnsResolver = options?.enableDnsResolver ?? true;
  const dnsResolverConfPath = options?.dnsResolverConfPath ?? `${deployDir}/engine/dnsmasq.conf`;
  const dnsServers = enableDnsResolver ? [DNS_RESOLVER_GATEWAY] : undefined;
  // service_started, not service_healthy: dnsmasq comes up in <1s, and we
  // don't want the agent's startup gated on a DNS health probe whose
  // tooling assumptions (nslookup, nc, etc.) depend on the resolver image.
  const dnsResolverDep = enableDnsResolver
    ? { "dns-resolver": { condition: "service_started" } }
    : undefined;

  const service: ComposeServiceOutput = {
    image: imageTag,
    ...(options?.instanceId
      ? { container_name: openclawContainerName(options.instanceId) }
      : {}),
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
    networks: [networkName],
    env_file: [".env"],
    restart: "unless-stopped",
    ...(dnsServers ? { dns: dnsServers } : {}),
    ...(dnsResolverDep ? { depends_on: { ...dnsResolverDep } } : {}),
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

  // When cred-proxy is enabled, ICC must be allowed so agent can reach the proxy.
  // IPAM is pinned when dns-resolver is on so the gateway IP every other
  // service references is stable across `docker network rm/create`.
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
      ...(enableDnsResolver
        ? {
            ipam: {
              config: [
                {
                  subnet: DNS_RESOLVER_SUBNET,
                  gateway: DNS_RESOLVER_GATEWAY,
                },
              ],
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
        security_opt: ["no-new-privileges"],
        volumes: [
          `${credProxyScriptPath}:${CRED_PROXY_SCRIPT_PATH}:ro`,
          `${credProxyRoutesPath}:${CRED_PROXY_ROUTES_PATH}:ro`,
          `${options?.instanceId ? instanceOpsDir(options.instanceId, "audit") : `${deployDir}/ops/audit`}:${CRED_PROXY_AUDIT_DIR}`,
        ],
        networks: [networkName],
        env_file: [".env"],
        command: ["node", CRED_PROXY_SCRIPT_PATH],
        restart: "unless-stopped",
        tmpfs: ["/tmp:size=16m,noexec,nosuid"],
        ...(dnsServers ? { dns: dnsServers } : {}),
        ...(dnsResolverDep ? { depends_on: { ...dnsResolverDep } } : {}),
        healthcheck: {
          test: ["CMD", "node", "-e", `require("http").get("http://localhost:${CRED_PROXY_PORT}/health",(r)=>{process.exit(r.statusCode===200?0:1)}).on("error",()=>process.exit(1))`],
          interval: "30s",
          timeout: "5s",
          retries: 3,
        },
      }
    : undefined;

  // Build dns-resolver sidecar — runs dnsmasq with --ipset so every container
  // DNS query for an allowlisted FQDN auto-populates clawhq_egress before the
  // reply reaches the caller. The container shares the host network namespace
  // (the only place the host ipset is reachable via netlink); CAP_NET_ADMIN
  // is required for ipset writes.
  const dnsResolverContainerName = options?.instanceId
    ? `clawhq-dns-${options.instanceId.slice(0, 8)}`
    : undefined;
  const dnsResolverService: ComposeDnsResolverServiceOutput | undefined =
    enableDnsResolver
      ? {
          image: DNS_RESOLVER_IMAGE,
          ...(dnsResolverContainerName
            ? { container_name: dnsResolverContainerName }
            : {}),
          network_mode: "host",
          cap_drop: ["ALL"],
          // NET_ADMIN — write to host ipset via netlink.
          // NET_BIND_SERVICE — bind dnsmasq to port 53.
          cap_add: ["NET_ADMIN", "NET_BIND_SERVICE"],
          security_opt: ["no-new-privileges"],
          read_only: true,
          volumes: [`${dnsResolverConfPath}:${DNS_RESOLVER_CONF_PATH}:ro`],
          // The 4km3/dnsmasq image's entrypoint is `/usr/sbin/dnsmasq
          // --keep-in-foreground`, so `command:` here only supplies
          // *additional* flags. Putting `dnsmasq` first would double the
          // binary name and fail at startup.
          command: [
            "--no-daemon",
            `--conf-file=${DNS_RESOLVER_CONF_PATH}`,
            "--user=nobody",
            "--group=nobody",
          ],
          restart: "unless-stopped",
          // Config-validation healthcheck: --test parses dnsmasq.conf and
          // exits 0 on success. It does NOT confirm the resolver is
          // serving — that's intentional. Asserting "is the binary alive
          // and is its config sane" is image-independent (no nslookup/nc
          // assumption); depends_on uses service_started anyway.
          healthcheck: {
            test: [
              "CMD",
              "dnsmasq",
              "--test",
              `--conf-file=${DNS_RESOLVER_CONF_PATH}`,
            ],
            interval: "60s",
            timeout: "5s",
            retries: 3,
          },
        }
      : undefined;

  // Build Tailscale sidecar if enabled — secure remote access without port exposure
  const enableTailscale = options?.enableTailscale ?? false;
  const tailscaleStateDir =
    options?.tailscaleStateDir ??
    (options?.instanceId
      ? instanceOpsDir(options.instanceId, "tailscale")
      : `${deployDir}/ops/tailscale`);
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
        ...(dnsServers ? { dns: dnsServers } : {}),
        ...(dnsResolverDep ? { depends_on: { ...dnsResolverDep } } : {}),
        healthcheck: {
          test: ["CMD", "tailscale", "status", "--json"],
          interval: "60s",
          timeout: "10s",
          retries: 3,
        },
      }
    : undefined;

  // Build market-engine sidecar if enabled — alert-grade trading assistant.
  const enableMarketEngine = options?.enableMarketEngine ?? false;
  const marketEngineDir =
    options?.marketEngineDir ?? `${deployDir}/engine/market-engine`;

  const marketEngineService: ComposeMarketEngineServiceOutput | undefined =
    enableMarketEngine
      ? {
          build: {
            context: marketEngineDir,
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
          ...(dnsServers ? { dns: dnsServers } : {}),
          // Merge dns-resolver and cred-proxy dependencies into one map.
          ...((enableCredProxy || dnsResolverDep)
            ? {
                depends_on: {
                  ...(dnsResolverDep ?? {}),
                  ...(enableCredProxy
                    ? { "cred-proxy": { condition: "service_healthy" } }
                    : {}),
                },
              }
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

  // Ollama GPU sidecar — local LLM inference. Lives in the same compose
  // project as openclaw so `clawhq up`/`down` manage its lifecycle. Models
  // persist at `/mnt/data/ollama` across container recreations.
  const ollamaContainerName = options?.instanceId
    ? `ollama-${options.instanceId.slice(0, 8)}`
    : undefined;
  const ollamaService: ComposeOllamaServiceOutput = {
    image: "ollama/ollama:latest",
    ...(ollamaContainerName ? { container_name: ollamaContainerName } : {}),
    restart: "unless-stopped",
    init: true,
    security_opt: ["no-new-privileges"],
    volumes: ["/mnt/data/ollama:/root/.ollama/models"],
    ports: ["127.0.0.1:11434:11434"],
    environment: {
      OLLAMA_HOST: "0.0.0.0:11434",
      OLLAMA_KEEP_ALIVE: "24h",
      OLLAMA_FLASH_ATTENTION: "1",
      OLLAMA_KV_CACHE_TYPE: "q8_0",
      OLLAMA_NUM_PARALLEL: "1",
      OLLAMA_CONTEXT_LENGTH: "16384",
      OLLAMA_MAX_LOADED_MODELS: "1",
    },
    networks: [networkName],
    healthcheck: {
      test: ["CMD", "ollama", "list"],
      interval: "30s",
      timeout: "5s",
      retries: 3,
      start_period: "30s",
    },
    mem_limit: "16g",
    pids_limit: 2048,
    deploy: {
      resources: {
        reservations: {
          devices: [{ driver: "nvidia", count: "all", capabilities: ["gpu"] }],
        },
      },
    },
  };

  return {
    version: "3.8",
    services: {
      openclaw: service,
      ollama: ollamaService,
      ...(credProxyService ? { "cred-proxy": credProxyService } : {}),
      ...(marketEngineService
        ? { "market-engine": marketEngineService }
        : {}),
      ...(tailscaleService ? { tailscale: tailscaleService } : {}),
      ...(dnsResolverService ? { "dns-resolver": dnsResolverService } : {}),
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

// ── YAML Serialization ──────────────────────────────────────────────────────

/**
 * Serialize a ComposeOutput to YAML text suitable for `docker compose up`.
 *
 * Hand-built rather than using a YAML library: the structure is fixed and
 * adding a dep for one emitter would be churn. Kept co-located with
 * generateCompose so the shape of the object and its serialization evolve
 * together; any structural change surfaces here as a compile error, not a
 * silent mis-serialization.
 */
export function serializeYaml(compose: ComposeOutput): string {
  const lines: string[] = [];
  const svc = compose.services.openclaw;

  // Note: 'version' is obsolete in Docker Compose v2+ and produces a warning
  lines.push("services:", "  openclaw:");
  lines.push(`    image: ${svc.image}`);
  if (svc.container_name) lines.push(`    container_name: ${svc.container_name}`);
  lines.push(`    user: "${svc.user}"`);
  lines.push(`    read_only: ${svc.read_only}`);
  lines.push(`    restart: ${svc.restart}`);
  lines.push(`    init: ${svc.init}`);

  lines.push("    command:");
  for (const c of svc.command) lines.push(`      - "${c}"`);

  lines.push("    ports:");
  for (const p of svc.ports) lines.push(`      - "${p}"`);

  lines.push("    extra_hosts:");
  for (const h of svc.extra_hosts) lines.push(`      - "${h}"`);

  lines.push("    environment:");
  for (const [key, val] of sortedEntries(svc.environment)) {
    lines.push(`      ${key}: "${val}"`);
  }

  lines.push("    healthcheck:");
  lines.push("      test:");
  for (const t of svc.healthcheck.test) lines.push(`        - "${t}"`);
  lines.push(`      interval: ${svc.healthcheck.interval}`);
  lines.push(`      timeout: ${svc.healthcheck.timeout}`);
  lines.push(`      retries: ${svc.healthcheck.retries}`);
  lines.push(`      start_period: ${svc.healthcheck.start_period}`);

  lines.push("    cap_drop:");
  for (const cap of svc.cap_drop) lines.push(`      - ${cap}`);

  lines.push("    security_opt:");
  for (const opt of svc.security_opt) lines.push(`      - ${opt}`);

  lines.push("    tmpfs:");
  for (const t of svc.tmpfs) lines.push(`      - "${t}"`);

  lines.push("    volumes:");
  for (const v of svc.volumes) lines.push(`      - "${v}"`);

  lines.push("    networks:");
  for (const n of svc.networks) lines.push(`      - ${n}`);

  lines.push("    env_file:");
  for (const e of svc.env_file) lines.push(`      - ${e}`);

  if (svc.dns && svc.dns.length > 0) {
    lines.push("    dns:");
    for (const d of svc.dns) lines.push(`      - ${d}`);
  }

  if (svc.depends_on && Object.keys(svc.depends_on).length > 0) {
    lines.push("    depends_on:");
    for (const [name, cond] of sortedEntries(svc.depends_on)) {
      lines.push(`      ${name}:`);
      lines.push(`        condition: ${(cond as { condition: string }).condition}`);
    }
  }

  if (svc.secrets && svc.secrets.length > 0) {
    lines.push("    secrets:");
    for (const s of svc.secrets) lines.push(`      - ${s}`);
  }

  if (svc.runtime) {
    lines.push(`    runtime: ${svc.runtime}`);
  }

  if (svc.deploy) {
    lines.push("    deploy:");
    lines.push("      resources:");
    lines.push("        limits:");
    lines.push(`          cpus: "${svc.deploy.resources.limits.cpus}"`);
    lines.push(`          memory: ${svc.deploy.resources.limits.memory}`);
    lines.push(`          pids: ${svc.deploy.resources.limits.pids}`);
  }

  // Ollama GPU sidecar — local LLM inference
  {
    const ol = compose.services.ollama;
    lines.push("", "  ollama:");
    lines.push(`    image: ${ol.image}`);
    if (ol.container_name) lines.push(`    container_name: ${ol.container_name}`);
    lines.push(`    restart: ${ol.restart}`);
    lines.push(`    init: ${ol.init}`);
    lines.push("    security_opt:");
    for (const opt of ol.security_opt) lines.push(`      - ${opt}`);
    lines.push("    volumes:");
    for (const v of ol.volumes) lines.push(`      - "${v}"`);
    lines.push("    ports:");
    for (const p of ol.ports) lines.push(`      - "${p}"`);
    lines.push("    environment:");
    for (const [key, val] of sortedEntries(ol.environment)) {
      lines.push(`      ${key}: "${val}"`);
    }
    lines.push("    networks:");
    for (const n of ol.networks) lines.push(`      - ${n}`);
    lines.push("    healthcheck:");
    lines.push("      test:");
    for (const t of ol.healthcheck.test) lines.push(`        - "${t}"`);
    lines.push(`      interval: ${ol.healthcheck.interval}`);
    lines.push(`      timeout: ${ol.healthcheck.timeout}`);
    lines.push(`      retries: ${ol.healthcheck.retries}`);
    lines.push(`      start_period: ${ol.healthcheck.start_period}`);
    if (ol.mem_limit) lines.push(`    mem_limit: ${ol.mem_limit}`);
    if (ol.pids_limit !== undefined) lines.push(`    pids_limit: ${ol.pids_limit}`);
    if (ol.deploy?.resources.reservations?.devices) {
      lines.push("    deploy:");
      lines.push("      resources:");
      lines.push("        reservations:");
      lines.push("          devices:");
      for (const d of ol.deploy.resources.reservations.devices) {
        lines.push(`            - driver: ${d.driver}`);
        lines.push(`              count: ${typeof d.count === "string" ? `"${d.count}"` : d.count}`);
        lines.push(`              capabilities: [${d.capabilities.join(", ")}]`);
      }
    }
  }

  // Credential proxy sidecar
  if (compose.services["cred-proxy"]) {
    const cp = compose.services["cred-proxy"];
    lines.push("", "  cred-proxy:");
    lines.push(`    image: ${cp.image}`);
    lines.push(`    user: "${cp.user}"`);
    lines.push(`    read_only: ${cp.read_only}`);
    lines.push(`    restart: ${cp.restart}`);
    lines.push("    cap_drop:");
    for (const cap of cp.cap_drop) lines.push(`      - ${cap}`);
    lines.push("    security_opt:");
    for (const opt of cp.security_opt) lines.push(`      - ${opt}`);
    lines.push("    command:");
    for (const c of cp.command) lines.push(`      - "${c}"`);
    lines.push("    volumes:");
    for (const v of cp.volumes) lines.push(`      - "${v}"`);
    lines.push("    networks:");
    for (const n of cp.networks) lines.push(`      - ${n}`);
    lines.push("    env_file:");
    for (const e of cp.env_file) lines.push(`      - ${e}`);
    lines.push("    tmpfs:");
    for (const t of cp.tmpfs) lines.push(`      - "${t}"`);
    if (cp.dns && cp.dns.length > 0) {
      lines.push("    dns:");
      for (const d of cp.dns) lines.push(`      - ${d}`);
    }
    if (cp.depends_on && Object.keys(cp.depends_on).length > 0) {
      lines.push("    depends_on:");
      for (const [name, cond] of sortedEntries(cp.depends_on)) {
        lines.push(`      ${name}:`);
        lines.push(`        condition: ${(cond as { condition: string }).condition}`);
      }
    }
    lines.push("    healthcheck:");
    lines.push("      test:");
    for (const t of cp.healthcheck.test) {
      // Use single-quoted YAML scalar when value contains double quotes
      if (t.includes('"')) {
        lines.push(`        - '${t}'`);
      } else {
        lines.push(`        - "${t}"`);
      }
    }
    lines.push(`      interval: ${cp.healthcheck.interval}`);
    lines.push(`      timeout: ${cp.healthcheck.timeout}`);
    lines.push(`      retries: ${cp.healthcheck.retries}`);
  }

  // Market-engine sidecar
  if (compose.services["market-engine"]) {
    const ct = compose.services["market-engine"];
    lines.push("", "  market-engine:");
    lines.push("    build:");
    lines.push(`      context: ${ct.build.context}`);
    lines.push(`      dockerfile: ${ct.build.dockerfile}`);
    lines.push(`    user: "${ct.user}"`);
    lines.push(`    read_only: ${ct.read_only}`);
    lines.push(`    restart: ${ct.restart}`);
    lines.push("    cap_drop:");
    for (const cap of ct.cap_drop) lines.push(`      - ${cap}`);
    lines.push("    security_opt:");
    for (const opt of ct.security_opt) lines.push(`      - ${opt}`);
    lines.push("    volumes:");
    for (const v of ct.volumes) lines.push(`      - "${v}"`);
    lines.push("    networks:");
    for (const n of ct.networks) lines.push(`      - ${n}`);
    lines.push("    env_file:");
    for (const e of ct.env_file) lines.push(`      - ${e}`);
    lines.push("    environment:");
    for (const [key, val] of sortedEntries(ct.environment)) {
      lines.push(`      ${key}: "${val}"`);
    }
    lines.push("    tmpfs:");
    for (const t of ct.tmpfs) lines.push(`      - "${t}"`);
    if (ct.dns && ct.dns.length > 0) {
      lines.push("    dns:");
      for (const d of ct.dns) lines.push(`      - ${d}`);
    }
    if (ct.depends_on && Object.keys(ct.depends_on).length > 0) {
      lines.push("    depends_on:");
      for (const [svc, cond] of sortedEntries(ct.depends_on)) {
        lines.push(`      ${svc}:`);
        lines.push(`        condition: ${(cond as { condition: string }).condition}`);
      }
    }
    lines.push("    healthcheck:");
    lines.push("      test:");
    for (const t of ct.healthcheck.test) {
      if (t.includes('"')) {
        lines.push(`        - '${t}'`);
      } else {
        lines.push(`        - "${t}"`);
      }
    }
    lines.push(`      interval: ${ct.healthcheck.interval}`);
    lines.push(`      timeout: ${ct.healthcheck.timeout}`);
    lines.push(`      retries: ${ct.healthcheck.retries}`);
  }

  // Tailscale sidecar
  if (compose.services.tailscale) {
    const ts = compose.services.tailscale;
    lines.push("", "  tailscale:");
    lines.push(`    image: ${ts.image}`);
    lines.push(`    hostname: ${ts.hostname}`);
    lines.push(`    restart: ${ts.restart}`);
    lines.push("    cap_drop:");
    for (const cap of ts.cap_drop) lines.push(`      - ${cap}`);
    lines.push("    volumes:");
    for (const v of ts.volumes) lines.push(`      - "${v}"`);
    lines.push("    networks:");
    for (const n of ts.networks) lines.push(`      - ${n}`);
    lines.push("    environment:");
    for (const [key, val] of sortedEntries(ts.environment)) {
      lines.push(`      ${key}: "${val}"`);
    }
    if (ts.dns && ts.dns.length > 0) {
      lines.push("    dns:");
      for (const d of ts.dns) lines.push(`      - ${d}`);
    }
    if (ts.depends_on && Object.keys(ts.depends_on).length > 0) {
      lines.push("    depends_on:");
      for (const [name, cond] of sortedEntries(ts.depends_on)) {
        lines.push(`      ${name}:`);
        lines.push(`        condition: ${(cond as { condition: string }).condition}`);
      }
    }
    lines.push("    healthcheck:");
    lines.push("      test:");
    for (const t of ts.healthcheck.test) lines.push(`        - "${t}"`);
    lines.push(`      interval: ${ts.healthcheck.interval}`);
    lines.push(`      timeout: ${ts.healthcheck.timeout}`);
    lines.push(`      retries: ${ts.healthcheck.retries}`);
  }

  // dns-resolver sidecar — runs dnsmasq in host network ns, populates the
  // host clawhq_egress ipset on every container DNS query.
  if (compose.services["dns-resolver"]) {
    const dr = compose.services["dns-resolver"];
    lines.push("", "  dns-resolver:");
    lines.push(`    image: ${dr.image}`);
    if (dr.container_name) lines.push(`    container_name: ${dr.container_name}`);
    lines.push(`    network_mode: ${dr.network_mode}`);
    lines.push(`    read_only: ${dr.read_only}`);
    lines.push(`    restart: ${dr.restart}`);
    lines.push("    cap_drop:");
    for (const cap of dr.cap_drop) lines.push(`      - ${cap}`);
    lines.push("    cap_add:");
    for (const cap of dr.cap_add) lines.push(`      - ${cap}`);
    lines.push("    security_opt:");
    for (const opt of dr.security_opt) lines.push(`      - ${opt}`);
    lines.push("    volumes:");
    for (const v of dr.volumes) lines.push(`      - "${v}"`);
    lines.push("    command:");
    for (const c of dr.command) lines.push(`      - "${c}"`);
    lines.push("    healthcheck:");
    lines.push("      test:");
    for (const t of dr.healthcheck.test) {
      if (t.includes('"')) {
        lines.push(`        - '${t}'`);
      } else {
        lines.push(`        - "${t}"`);
      }
    }
    lines.push(`      interval: ${dr.healthcheck.interval}`);
    lines.push(`      timeout: ${dr.healthcheck.timeout}`);
    lines.push(`      retries: ${dr.healthcheck.retries}`);
  }

  lines.push("", "networks:");
  for (const [name, net] of sortedEntries(compose.networks)) {
    lines.push(`  ${name}:`);
    if ("external" in net && (net as Record<string, unknown>).external) {
      lines.push("    external: true");
    } else {
      lines.push(`    driver: ${net.driver}`);
      if (net.driver_opts) {
        lines.push("    driver_opts:");
        for (const [key, val] of sortedEntries(net.driver_opts)) {
          lines.push(`      ${key}: "${val}"`);
        }
      }
      if (net.ipam && net.ipam.config.length > 0) {
        lines.push("    ipam:");
        lines.push("      config:");
        for (const cfg of net.ipam.config) {
          lines.push(`        - subnet: ${cfg.subnet}`);
          lines.push(`          gateway: ${cfg.gateway}`);
        }
      }
    }
  }

  // Top-level secrets section
  if (compose.secrets) {
    lines.push("", "secrets:");
    for (const [name, secret] of sortedEntries(compose.secrets)) {
      lines.push(`  ${name}:`);
      lines.push(`    file: ${secret.file}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
