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

import { CONTAINER_USER } from "../../config/defaults.js";
import {
  OPENCLAW_CONTAINER_ROOT,
  OPENCLAW_CONTAINER_WORKSPACE,
} from "../../config/paths.js";

import type { BuildSecurityPosture, Stage1Config, Stage2Config } from "./types.js";

// ── Binary Validation ───────────────────────────────────────────────────────

const UNSAFE_PATH_CHARS = /[\n\r"'\\`$]/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;

/** Throws if url is not a valid https:// URL. */
export function validateBinaryUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid binary URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Binary URL must use https:// scheme, got: ${parsed.protocol}`);
  }
}

/** Throws if destPath contains newlines, quotes, backslashes, or is not absolute. */
export function validateBinaryDestPath(destPath: string): void {
  if (!destPath.startsWith("/")) {
    throw new Error(`Binary destPath must be an absolute path, got: ${destPath}`);
  }
  if (UNSAFE_PATH_CHARS.test(destPath)) {
    throw new Error(`Binary destPath contains unsafe characters: ${destPath}`);
  }
}

/**
 * Thrown when a binary is missing a sha256 field at a posture level that
 * requires it ("hardened" or "paranoid").
 */
export class MissingBinarySha256Error extends Error {
  constructor(binaryName: string, posture: BuildSecurityPosture) {
    super(
      `Binary "${binaryName}" is missing a sha256 digest. ` +
      `SHA256 pinning is required at posture="${posture}".`,
    );
    this.name = "MissingBinarySha256Error";
  }
}

/**
 * Thrown when a sha256 field is present but is not a valid 64-character
 * lowercase hex string.
 */
export class InvalidBinarySha256Error extends Error {
  constructor(binaryName: string, sha256: string) {
    super(
      `Binary "${binaryName}" has an invalid sha256 digest: "${sha256}". ` +
      `Expected a 64-character hex string.`,
    );
    this.name = "InvalidBinarySha256Error";
  }
}

/**
 * Posture levels that require sha256 pinning for every binary.
 * Binaries without a sha256 field will cause a build-time error.
 */
const POSTURES_REQUIRING_SHA256: ReadonlySet<BuildSecurityPosture> = new Set([
  "hardened",
  "paranoid",
]);

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
    `    chown -R ${CONTAINER_USER} ${OPENCLAW_CONTAINER_ROOT}`,
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
 *
 * @param stage1Tag - The Docker image tag for Stage 1.
 * @param config    - Stage 2 configuration (binaries, tools, skills).
 * @param posture   - Security posture level. At "hardened" and "paranoid",
 *                    every binary must include a sha256 digest or this
 *                    function throws a MissingBinarySha256Error.
 */
export function generateStage2Dockerfile(
  stage1Tag: string,
  config: Stage2Config,
  posture?: BuildSecurityPosture,
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
    validateBinaryUrl(binary.url);
    validateBinaryDestPath(binary.destPath);

    // Validate sha256 format if provided
    if (binary.sha256 !== undefined && !SHA256_HEX_PATTERN.test(binary.sha256)) {
      throw new InvalidBinarySha256Error(binary.name, binary.sha256);
    }

    // Enforce sha256 requirement at hardened/paranoid posture
    if (posture && POSTURES_REQUIRING_SHA256.has(posture) && !binary.sha256) {
      throw new MissingBinarySha256Error(binary.name, posture);
    }

    if (binary.sha256) {
      // Download to a temp path, verify digest, then move to final destination
      const tmpPath = `${binary.destPath}.tmp`;
      lines.push(
        `# Install ${binary.name} (SHA256-pinned)`,
        `RUN curl -fsSL "${binary.url}" -o "${tmpPath}" && \\`,
        `    echo "${binary.sha256}  ${tmpPath}" | sha256sum -c - && \\`,
        `    mv "${tmpPath}" "${binary.destPath}" && \\`,
        `    chmod +x "${binary.destPath}"`,
        "",
      );
    } else {
      lines.push(
        `# Install ${binary.name}`,
        `RUN curl -fsSL "${binary.url}" -o "${binary.destPath}" && \\`,
        `    chmod +x "${binary.destPath}"`,
        "",
      );
    }
  }

  // Copy workspace tools
  if (config.workspaceTools.length > 0) {
    lines.push("# Copy workspace tools");
    for (const tool of config.workspaceTools) {
      lines.push(
        `COPY --chown=${CONTAINER_USER} workspace/tools/${tool} ${OPENCLAW_CONTAINER_WORKSPACE}/tools/${tool}`,
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
        `COPY --chown=${CONTAINER_USER} workspace/skills/${skill} ${OPENCLAW_CONTAINER_WORKSPACE}/skills/${skill}`,
      );
    }
    lines.push("");
  }

  lines.push(
    `USER ${CONTAINER_USER}`,
    "",
  );

  return lines.join("\n");
}
