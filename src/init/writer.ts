/**
 * Atomic config writer.
 *
 * Writes all generated files atomically: writes to temp locations first,
 * then renames into place. If any write fails, no files are committed.
 */

import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { DeploymentBundle } from "../config/schema.js";

export interface WriteResult {
  filesWritten: string[];
  errors: string[];
}

export async function writeBundle(
  bundle: DeploymentBundle,
  outputDir: string,
): Promise<WriteResult> {
  const filesWritten: string[] = [];
  const errors: string[] = [];

  // Collect all file operations: [targetPath, content, mode?]
  const ops: Array<{ path: string; content: string; mode?: number }> = [];

  // openclaw.json
  ops.push({
    path: join(outputDir, "openclaw.json"),
    content: JSON.stringify(bundle.openclawConfig, null, 2) + "\n",
  });

  // .env (600 permissions — secrets)
  if (Object.keys(bundle.envVars).length > 0) {
    const envContent = Object.entries(bundle.envVars)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n";
    ops.push({
      path: join(outputDir, ".env"),
      content: envContent,
      mode: 0o600,
    });
  }

  // docker-compose.yml
  ops.push({
    path: join(outputDir, "docker-compose.yml"),
    content: bundle.dockerCompose,
  });

  // Dockerfile
  if (bundle.dockerfile) {
    ops.push({
      path: join(outputDir, "Dockerfile"),
      content: bundle.dockerfile,
    });
  }

  // Identity files in workspace/
  const workspaceDir = join(outputDir, "workspace");
  for (const [filename, content] of Object.entries(bundle.identityFiles)) {
    ops.push({
      path: join(workspaceDir, filename),
      content,
    });
  }

  // Workspace tools (executable scripts)
  if (bundle.workspaceTools) {
    for (const [toolName, content] of Object.entries(bundle.workspaceTools)) {
      ops.push({
        path: join(workspaceDir, toolName),
        content,
        mode: 0o755,
      });
    }
  }

  // Skills
  if (bundle.skills) {
    for (const [skillName, files] of Object.entries(bundle.skills)) {
      for (const [relativePath, content] of Object.entries(files)) {
        const isScript = /\.(py|sh)$/.test(relativePath);
        ops.push({
          path: join(workspaceDir, "skills", skillName, relativePath),
          content,
          ...(isScript ? { mode: 0o755 } : {}),
        });
      }
    }
  }

  // Memory directories
  for (const tier of ["memory/hot", "memory/warm", "memory/cold"]) {
    ops.push({
      path: join(workspaceDir, tier, ".gitkeep"),
      content: "",
    });
  }

  // cron/jobs.json
  if (bundle.cronJobs.length > 0) {
    const cronDir = join(outputDir, "cron");
    ops.push({
      path: join(cronDir, "jobs.json"),
      content: JSON.stringify(bundle.cronJobs, null, 2) + "\n",
    });
  }

  // Phase 1: Write all to temp files
  const tempSuffix = `.tmp.${Date.now()}`;
  const tempPaths: string[] = [];

  try {
    for (const op of ops) {
      const tempPath = op.path + tempSuffix;
      await mkdir(dirname(tempPath), { recursive: true });
      await writeFile(tempPath, op.content, "utf-8");
      if (op.mode) {
        await chmod(tempPath, op.mode);
      }
      tempPaths.push(tempPath);
    }
  } catch (err: unknown) {
    // Cleanup temp files on failure
    for (const tp of tempPaths) {
      try {
        await rm(tp, { force: true });
      } catch {
        // best-effort cleanup
      }
    }
    errors.push(`Failed to write temp files: ${err instanceof Error ? err.message : String(err)}`);
    return { filesWritten, errors };
  }

  // Phase 2: Rename all temp files into place (atomic per-file)
  for (let i = 0; i < ops.length; i++) {
    try {
      await rename(tempPaths[i], ops[i].path);
      filesWritten.push(ops[i].path);
    } catch (err: unknown) {
      errors.push(
        `Failed to finalize ${ops[i].path}: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Cleanup remaining temp files
      for (let j = i + 1; j < tempPaths.length; j++) {
        try {
          await rm(tempPaths[j], { force: true });
        } catch {
          // best-effort
        }
      }
      break;
    }
  }

  return { filesWritten, errors };
}
