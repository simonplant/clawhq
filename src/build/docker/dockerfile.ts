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
import { OPENCLAW_CONTAINER_WORKSPACE } from "../../config/paths.js";

import type { Stage2Config } from "./types.js";
import { validateBinarySha256, OP_CLI_URL, OP_CLI_SHA256, OP_CLI_DEST } from "./binary-manifest.js";

// ── Binary Validation ───────────────────────────────────────────────────────

const UNSAFE_PATH_CHARS = /[\n\r"'\\`$]/;

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
    "SHELL [\"/bin/bash\", \"-c\"]",
    "USER root",
    "",
  ];

  // Install 1Password CLI if enabled
  if (config.enableOnePassword) {
    lines.push(
      "# Install 1Password CLI (op) for credential vault access",
      `RUN curl -fsSL "${OP_CLI_URL}" -o /tmp/op.zip && \\`,
      `    echo "${OP_CLI_SHA256}  /tmp/op.zip" | sha256sum -c - && \\`,
      `    unzip -o /tmp/op.zip -d /tmp/op-extract && \\`,
      `    mv /tmp/op-extract/op "${OP_CLI_DEST}" && \\`,
      `    chmod +x "${OP_CLI_DEST}" && \\`,
      "    rm -rf /tmp/op.zip /tmp/op-extract",
      "",
    );
  }

  // Install binary tools from URLs with SHA256 verification
  for (const binary of config.binaries) {
    validateBinaryUrl(binary.url);
    validateBinaryDestPath(binary.destPath);
    validateBinarySha256(binary.sha256);

    if (binary.url.endsWith(".tgz") || binary.url.endsWith(".tar.gz")) {
      // Tarball: download, verify, extract the binary
      const binaryBasename = binary.destPath.split("/").pop() ?? binary.name;
      lines.push(
        `# Install ${binary.name} (SHA256: ${binary.sha256})`,
        `RUN set -euo pipefail && \\`,
        `    curl -fsSL "${binary.url}" -o /tmp/${binary.name}.tgz && \\`,
        `    echo "${binary.sha256}  /tmp/${binary.name}.tgz" | sha256sum -c - && \\`,
        `    tar -xzf /tmp/${binary.name}.tgz -C /usr/local/bin ${binaryBasename} && \\`,
        `    chmod 755 "${binary.destPath}" && \\`,
        `    rm /tmp/${binary.name}.tgz`,
        "",
      );
    } else {
      // Direct binary download
      lines.push(
        `# Install ${binary.name} (SHA256: ${binary.sha256})`,
        `RUN curl -fsSL "${binary.url}" -o "${binary.destPath}" && \\`,
        `    echo "${binary.sha256}  ${binary.destPath}" | sha256sum -c - && \\`,
        `    chmod +x "${binary.destPath}"`,
        "",
      );
    }
  }

  // Copy immutable workspace files (tools, identity, skills, sanitize)
  if (config.workspace && config.workspace.immutable.length > 0) {
    lines.push("# Immutable workspace files (baked into image — agent cannot modify)");

    // Group by top-level directory for cleaner COPY instructions
    const dirs = new Set(
      config.workspace.immutable
        .filter(f => f.includes("/"))
        .map(f => f.split("/")[0])
        .filter((d): d is string => d !== undefined),
    );
    for (const dir of dirs) {
      const dirFiles = config.workspace.immutable.filter(f => f.startsWith(dir + "/"));
      if (dirFiles.length > 0) {
        lines.push(
          `COPY --chown=${CONTAINER_USER} workspace/${dir}/ ${OPENCLAW_CONTAINER_WORKSPACE}/${dir}/`,
        );
      }
    }

    // Copy individual files at workspace root (TOOLS.md, SOUL.md, etc.)
    const rootFiles = config.workspace.immutable.filter(f => !f.includes("/"));
    for (const file of rootFiles) {
      lines.push(
        `COPY --chown=${CONTAINER_USER} workspace/${file} ${OPENCLAW_CONTAINER_WORKSPACE}/${file}`,
      );
    }

    // Make tool scripts executable
    if (config.workspace.immutable.some(f => f.startsWith("tools/"))) {
      lines.push(
        `RUN chmod +x ${OPENCLAW_CONTAINER_WORKSPACE}/tools/*`,
      );
    }
    lines.push("");

    // Integrity manifest — allows runtime tamper detection
    lines.push(
      "# Workspace integrity manifest (SHA256 checksums for tamper detection)",
      "COPY workspace-integrity.json /opt/workspace-integrity.json",
      "RUN chmod 444 /opt/workspace-integrity.json",
      "",
    );
  } else {
    // Fallback: legacy behavior — copy tools and skills individually
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

    if (config.skills.length > 0) {
      lines.push("# Copy skills");
      for (const skill of config.skills) {
        lines.push(
          `COPY --chown=${CONTAINER_USER} workspace/skills/${skill} ${OPENCLAW_CONTAINER_WORKSPACE}/skills/${skill}`,
        );
      }
      lines.push("");
    }
  }

  // ClawWall — immutable security scanning layer
  // Baked into read-only image layer: agent cannot modify, delete, or corrupt.
  // /opt/clawwall/ is NOT on PATH — tools import by absolute path.
  lines.push(
    "# ClawWall — immutable prompt injection firewall (OWASP LLM01 defense)",
    "COPY clawwall/sanitize /opt/clawwall/sanitize",
    "COPY clawwall/sanitize /opt/clawwall/sanitize.py",
    "RUN sha256sum /opt/clawwall/sanitize | cut -d' ' -f1 > /opt/clawwall/sanitize.sha256 && \\",
    "    chown -R root:root /opt/clawwall/ && \\",
    "    chmod 555 /opt/clawwall/ && \\",
    "    chmod 444 /opt/clawwall/sanitize /opt/clawwall/sanitize.py /opt/clawwall/sanitize.sha256",
    "",
    "# curl egress wrapper — scans POST/PUT/PATCH bodies for secret leaks",
    "# Sits at /usr/local/bin/curl (before /usr/bin/curl on PATH)",
    "COPY clawwall/curl-egress-wrapper /usr/local/bin/curl",
    "RUN chown root:root /usr/local/bin/curl && chmod 755 /usr/local/bin/curl",
    "",
  );

  lines.push(
    `USER ${CONTAINER_USER}`,
    "",
  );

  return lines.join("\n");
}
