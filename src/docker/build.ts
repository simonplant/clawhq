/**
 * Two-stage Docker build orchestration.
 *
 * Stage 1: Base OpenClaw image + apt packages (rebuilt only when upstream changes).
 * Stage 2: Custom tools + skills layer (fast rebuild on config changes).
 *
 * See docs/ARCHITECTURE.md and OPENCLAW-REFERENCE.md for build architecture.
 */

import type { DockerClient, ExecResult } from "./client.js";

export interface BuildStageResult {
  stage: 1 | 2;
  success: boolean;
  imageTag: string;
  result: ExecResult;
}

export interface TwoStageBuildOptions {
  /** Build context directory. */
  context: string;
  /** Base image tag for Stage 1. */
  baseTag: string;
  /** Final image tag for Stage 2. */
  finalTag: string;
  /** Dockerfile path (if not default). */
  dockerfile?: string;
  /** Build args for Stage 1 (e.g., apt packages). */
  stage1Args?: Record<string, string>;
  /** Build args for Stage 2 (e.g., custom tools). */
  stage2Args?: Record<string, string>;
  /** Skip Stage 1 if base image already exists. */
  skipStage1IfExists?: boolean;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
}

export interface TwoStageBuildResult {
  stage1: BuildStageResult | null;
  stage2: BuildStageResult;
}

/**
 * Run a two-stage Docker build.
 *
 * Stage 1 builds the base image (OpenClaw + system packages).
 * Stage 2 builds the final image on top (custom tools + skills).
 */
export async function twoStageBuild(
  client: DockerClient,
  options: TwoStageBuildOptions,
): Promise<TwoStageBuildResult> {
  let stage1: BuildStageResult | null = null;

  // Stage 1: Base image
  const skipStage1 =
    options.skipStage1IfExists && (await client.imageExists(options.baseTag, { signal: options.signal }));

  if (!skipStage1) {
    const result = await client.build(options.context, {
      tag: options.baseTag,
      file: options.dockerfile,
      target: "base",
      buildArgs: options.stage1Args,
      signal: options.signal,
    });
    stage1 = { stage: 1, success: true, imageTag: options.baseTag, result };
  }

  // Stage 2: Custom layer
  const stage2Result = await client.build(options.context, {
    tag: options.finalTag,
    file: options.dockerfile,
    target: "custom",
    buildArgs: {
      ...options.stage2Args,
      BASE_IMAGE: options.baseTag,
    },
    signal: options.signal,
  });

  return {
    stage1,
    stage2: { stage: 2, success: true, imageTag: options.finalTag, result: stage2Result },
  };
}
