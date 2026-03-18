/**
 * Security posture → Docker Compose security options.
 *
 * Maps ClawHQ security posture levels to concrete Docker security settings
 * applied via docker-compose override files.
 *
 * Posture levels (ascending strictness):
 * - minimal:  Basic non-root, no privilege escalation. For dev/testing only.
 * - standard: cap_drop ALL, read-only rootfs, resource limits (4 CPU / 4 GB).
 * - hardened: (default) Tighter limits (2 CPU / 2 GB), ICC disabled, noexec tmpfs.
 * - paranoid: Most restrictive (1 CPU / 1 GB), allowlist-only egress.
 *
 * See docs/ARCHITECTURE.md → Security Architecture → Container Hardening.
 */

import * as YAML from "yaml";

import type { ComposeServiceConfig } from "./compose.js";

export type SecurityPosture = "minimal" | "standard" | "hardened" | "paranoid";

export const POSTURE_ORDER: SecurityPosture[] = ["minimal", "standard", "hardened", "paranoid"];

export interface HardeningOptions {
  posture: SecurityPosture;
  workspacePath: string;
  configPath: string;
}

/** Per-posture network options (ICC control). */
export interface PostureNetworkOptions {
  icc: boolean;
}

/** Full posture definition: service-level controls + network options. */
export interface PostureDefinition {
  service: Partial<ComposeServiceConfig>;
  network: PostureNetworkOptions;
}

/** Security controls per posture level. */
const POSTURE_CONTROLS: Record<SecurityPosture, PostureDefinition> = {
  minimal: {
    service: {
      securityOpt: ["no-new-privileges:true"],
      user: "1000:1000",
      deploy: {
        resources: {
          limits: { cpus: "4", memory: "4g" },
        },
      },
    },
    network: { icc: true },
  },
  standard: {
    service: {
      capDrop: ["ALL"],
      readOnly: true,
      securityOpt: ["no-new-privileges:true"],
      user: "1000:1000",
      tmpfs: ["/tmp:noexec,nosuid,size=256m"],
      deploy: {
        resources: {
          limits: { cpus: "4", memory: "4g" },
        },
      },
    },
    network: { icc: false },
  },
  hardened: {
    service: {
      capDrop: ["ALL"],
      readOnly: true,
      securityOpt: ["no-new-privileges:true"],
      user: "1000:1000",
      tmpfs: ["/tmp:noexec,nosuid,size=128m"],
      deploy: {
        resources: {
          limits: { cpus: "2", memory: "2g" },
        },
      },
    },
    network: { icc: false },
  },
  paranoid: {
    service: {
      capDrop: ["ALL"],
      readOnly: true,
      securityOpt: ["no-new-privileges:true"],
      user: "1000:1000",
      tmpfs: ["/tmp:noexec,nosuid,size=64m"],
      deploy: {
        resources: {
          limits: { cpus: "1", memory: "1g" },
        },
      },
    },
    network: { icc: false },
  },
};

/** Apply security hardening to a compose service config. */
export function applyHardening(
  service: ComposeServiceConfig,
  options: HardeningOptions,
): ComposeServiceConfig {
  const controls = POSTURE_CONTROLS[options.posture].service;
  return {
    ...service,
    ...controls,
    volumes: [
      ...(service.volumes ?? []),
      `${options.configPath}:/home/openclaw/.openclaw/openclaw.json:ro`,
    ],
  };
}

/**
 * Generate a docker-compose override object for the given posture.
 *
 * The override is meant to be merged on top of a base docker-compose.yml
 * via `docker compose -f base.yml -f override.yml`.
 */
export function generateOverride(
  serviceName: string,
  options: HardeningOptions,
): Record<string, unknown> {
  const posture = POSTURE_CONTROLS[options.posture];
  const svc = { ...posture.service } as Record<string, unknown>;

  // Map TypeScript-style keys to docker-compose YAML keys
  const mapped: Record<string, unknown> = {};
  if (svc.capDrop) mapped["cap_drop"] = svc.capDrop;
  if (svc.readOnly !== undefined) mapped["read_only"] = svc.readOnly;
  if (svc.securityOpt) mapped["security_opt"] = svc.securityOpt;
  if (svc.user) mapped["user"] = svc.user;
  if (svc.tmpfs) mapped["tmpfs"] = svc.tmpfs;
  if (svc.deploy) mapped["deploy"] = svc.deploy;

  // Add config volume as read-only mount
  mapped["volumes"] = [
    `${options.configPath}:/home/openclaw/.openclaw/openclaw.json:ro`,
  ];

  const override: Record<string, unknown> = {
    services: {
      [serviceName]: mapped,
    },
  };

  // Add network with ICC control
  if (!posture.network.icc) {
    override["networks"] = {
      clawhq: {
        driver: "bridge",
        driver_opts: {
          "com.docker.network.bridge.enable_icc": "false",
        },
      },
    };
    (mapped as Record<string, unknown>)["networks"] = ["clawhq"];
  }

  return override;
}

/** Serialize a docker-compose override object to YAML. */
export function overrideToYaml(override: Record<string, unknown>): string {
  return YAML.stringify(override, { lineWidth: 120 });
}

/**
 * Merge a base docker-compose config with a security override.
 *
 * Deep-merges the override into the base. Arrays are concatenated
 * (with deduplication for volumes), objects are recursively merged.
 */
export function mergeComposeConfigs(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  return deepMerge(base, override);
}

/** Parse a YAML string into a plain object. */
export function parseComposeYaml(yamlStr: string): Record<string, unknown> {
  return YAML.parse(yamlStr) as Record<string, unknown>;
}

/** Serialize a compose config to YAML. */
export function composeToYaml(config: Record<string, unknown>): string {
  return YAML.stringify(config, { lineWidth: 120 });
}

/** Get the posture definition for inspection/verification. */
export function getPostureDefinition(posture: SecurityPosture): PostureDefinition {
  return POSTURE_CONTROLS[posture];
}

// --- Internal helpers ---

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const targetVal = target[key];
    const sourceVal = source[key];

    if (Array.isArray(sourceVal) && Array.isArray(targetVal)) {
      // Deduplicate merged arrays
      const merged = [...targetVal, ...sourceVal];
      result[key] = [...new Set(merged)];
    } else if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      result[key] = sourceVal;
    }
  }

  return result;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

export { POSTURE_CONTROLS };
