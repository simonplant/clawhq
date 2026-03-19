/**
 * Dockerfile generation for two-stage Docker build.
 *
 * Stage 1: Base OpenClaw image with apt packages. Cached — rebuilds only
 * when base image or package list changes.
 *
 * Stage 2: Custom tools + skills layer. Fast rebuild — changes frequently
 * as the agent evolves.
 *
 * ClawHQ builds *on top of* OpenClaw's Dockerfiles, not by modifying them.
 */

import {
  OPENCLAW_CONTAINER_ROOT,
  OPENCLAW_CONTAINER_WORKSPACE,
} from "../../config/paths.js";

import type { Stage1Config, Stage2Config } from "./types.js";

// ── Stage 1: Base Image ─────────────────────────────────────────────────────

/**
 * Generate Stage 1 Dockerfile content.
 *
 * Installs apt packages on top of the base OpenClaw image.
 * This layer changes rarely and benefits from Docker cache.
 */
export function generateStage1Dockerfile(config: Stage1Config): string {
  const lines: string[] = [
    `FROM ${config.baseImage}`,
    "",
    "# Stage 1: Base image with system packages (cached layer)",
    "# Rebuilds only when base image or package list changes",
    "",
  ];

  if (config.aptPackages.length > 0) {
    lines.push(
      "RUN apt-get update && \\",
      `    apt-get install -y --no-install-recommends ${config.aptPackages.join(" ")} && \\`,
      "    apt-get clean && \\",
      "    rm -rf /var/lib/apt/lists/*",
      "",
    );
  }

  lines.push(
    "# Ensure workspace directory exists with correct ownership",
    `RUN mkdir -p ${OPENCLAW_CONTAINER_WORKSPACE} && \\`,
    `    chown -R 1000:1000 ${OPENCLAW_CONTAINER_ROOT}`,
    "",
  );

  return lines.join("\n");
}

// ── Stage 2: Custom Layer ───────────────────────────────────────────────────

/**
 * Generate Stage 2 Dockerfile content.
 *
 * Installs binary tools and copies workspace tools/skills.
 * This layer rebuilds frequently as the agent evolves.
 */
export function generateStage2Dockerfile(
  stage1Tag: string,
  config: Stage2Config,
): string {
  const lines: string[] = [
    `FROM ${stage1Tag}`,
    "",
    "# Stage 2: Custom tools + skills (fast rebuild layer)",
    "# Rebuilds when tools, skills, or integrations change",
    "",
  ];

  // Install binary tools from URLs
  for (const binary of config.binaries) {
    lines.push(
      `# Install ${binary.name}`,
      `RUN curl -fsSL "${binary.url}" -o "${binary.destPath}" && \\`,
      `    chmod +x "${binary.destPath}"`,
      "",
    );
  }

  // Copy workspace tools
  if (config.workspaceTools.length > 0) {
    lines.push("# Copy workspace tools");
    for (const tool of config.workspaceTools) {
      lines.push(
        `COPY --chown=1000:1000 workspace/tools/${tool} ${OPENCLAW_CONTAINER_WORKSPACE}/tools/${tool}`,
      );
    }
    lines.push(
      `RUN chmod +x ${OPENCLAW_CONTAINER_WORKSPACE}/tools/*`,
      "",
    );
  }

  // Copy skills
  if (config.skills.length > 0) {
    lines.push("# Copy skills");
    for (const skill of config.skills) {
      lines.push(
        `COPY --chown=1000:1000 workspace/skills/${skill} ${OPENCLAW_CONTAINER_WORKSPACE}/skills/${skill}`,
      );
    }
    lines.push("");
  }

  lines.push(
    "USER 1000:1000",
    "",
  );

  return lines.join("\n");
}
