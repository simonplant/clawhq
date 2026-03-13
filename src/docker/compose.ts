/**
 * Docker Compose generation and management.
 *
 * Generates docker-compose.yml from deployment config, applying
 * security hardening based on the selected posture.
 */

import type { DockerClient, ExecResult } from "./client.js";

export interface ComposeServiceConfig {
  image: string;
  containerName: string;
  ports?: string[];
  volumes?: string[];
  environment?: Record<string, string>;
  envFile?: string[];
  restart?: "no" | "always" | "unless-stopped" | "on-failure";
  networks?: string[];
  securityOpt?: string[];
  capDrop?: string[];
  readOnly?: boolean;
  user?: string;
  tmpfs?: string[];
  deploy?: {
    resources?: {
      limits?: {
        cpus?: string;
        memory?: string;
      };
    };
  };
}

export interface ComposeConfig {
  services: Record<string, ComposeServiceConfig>;
  networks?: Record<string, { external?: boolean; driver?: string }>;
}

/** Validate a docker-compose.yml by running `docker compose config`. */
export async function validateCompose(
  client: DockerClient,
  options: { signal?: AbortSignal } = {},
): Promise<ExecResult> {
  return client.composeExec(["config"], { signal: options.signal });
}

/** Pull images referenced in docker-compose.yml. */
export async function pullImages(
  client: DockerClient,
  options: { signal?: AbortSignal } = {},
): Promise<ExecResult> {
  return client.composeExec(["pull"], { signal: options.signal });
}
