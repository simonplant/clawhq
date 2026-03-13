/**
 * Security posture → Docker Compose security options.
 *
 * Maps ClawHQ security posture levels (standard, hardened, paranoid)
 * to concrete Docker security settings applied in docker-compose.yml.
 *
 * See docs/ARCHITECTURE.md → Security Architecture → Container Hardening.
 */

import type { ComposeServiceConfig } from "./compose.js";

export type SecurityPosture = "standard" | "hardened" | "paranoid";

export interface HardeningOptions {
  posture: SecurityPosture;
  workspacePath: string;
  configPath: string;
}

/** Security controls per posture level. */
const POSTURE_CONTROLS: Record<SecurityPosture, Partial<ComposeServiceConfig>> = {
  standard: {
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
  hardened: {
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
  paranoid: {
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
};

/** Apply security hardening to a compose service config. */
export function applyHardening(
  service: ComposeServiceConfig,
  options: HardeningOptions,
): ComposeServiceConfig {
  const controls = POSTURE_CONTROLS[options.posture];
  return {
    ...service,
    ...controls,
    volumes: [
      ...(service.volumes ?? []),
      `${options.configPath}:/home/openclaw/.openclaw/openclaw.json:ro`,
    ],
  };
}

export { POSTURE_CONTROLS };
