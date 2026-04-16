/**
 * Session archive — safely retire a runaway session.
 *
 * Mirrors the manual recovery performed on 2026-04-16 for the stuck
 * f735a1c7 session:
 *   1. Move the .jsonl, lock file, and checkpoints to sessions/.archived/
 *   2. Remove the session entry from sessions.json so the gateway
 *      does not try to resume it
 *   3. Restart the container so the gateway releases the cached session
 *      (the file is open; just moving the file is not enough).
 *
 * All operations run inside the container via docker exec. Host files
 * are never touched.
 */

import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ArchiveResult } from "./types.js";

const execFileAsync = promisify(execFile);

const CONTAINER_NAME = "engine-openclaw-1";
const SESSIONS_DIR = "/home/node/.openclaw/agents/main/sessions";
const ARCHIVE_DIR = `${SESSIONS_DIR}/.archived`;
const EXEC_TIMEOUT_MS = 15_000;

/**
 * Archive a session by id. Performs the full recovery sequence.
 *
 * If `restart` is false, the caller is responsible for restarting the
 * container; the session will appear healed on disk but the gateway
 * will still hold the in-memory reference until next boot.
 */
export async function archiveSession(
  sessionId: string,
  deployDir: string,
  options: { restart?: boolean; signal?: AbortSignal } = {},
): Promise<ArchiveResult> {
  const restart = options.restart ?? true;
  const signal = options.signal;

  if (!/^[a-f0-9-]{8,}$/i.test(sessionId)) {
    return {
      sessionId,
      success: false,
      message: `Invalid session id: ${sessionId}`,
      archivedFiles: [],
      indexUpdated: false,
      containerRestarted: false,
    };
  }

  const archived: string[] = [];
  let indexUpdated = false;
  let containerRestarted = false;

  // 1. Make sure .archived/ exists, then move all files that match the session id.
  //    Files can include: <id>.jsonl, <id>.jsonl.lock, <id>.*.checkpoint, etc.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const moveScript = `
    set -e
    mkdir -p ${ARCHIVE_DIR}
    cd ${SESSIONS_DIR}
    moved=""
    for f in ${sessionId}.* ${sessionId}; do
      [ -e "$f" ] || continue
      mv "$f" "${ARCHIVE_DIR}/${stamp}__$f"
      moved="$moved $f"
    done
    echo "$moved"
  `;

  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["exec", CONTAINER_NAME, "sh", "-c", moveScript],
      { timeout: EXEC_TIMEOUT_MS, signal },
    );
    for (const name of stdout.trim().split(/\s+/).filter(Boolean)) {
      archived.push(name);
    }
  } catch (err) {
    return {
      sessionId,
      success: false,
      message: `Failed to archive files: ${err instanceof Error ? err.message : String(err)}`,
      archivedFiles: archived,
      indexUpdated,
      containerRestarted,
    };
  }

  if (archived.length === 0) {
    return {
      sessionId,
      success: false,
      message: `No files matched session id ${sessionId}`,
      archivedFiles: [],
      indexUpdated,
      containerRestarted,
    };
  }

  // 2. Strip the session from sessions.json. Uses node inside the container
  //    so we don't depend on jq being installed.
  const indexScript = `
    node -e '
      const fs = require("fs");
      const p = "${SESSIONS_DIR}/sessions.json";
      let data;
      try { data = JSON.parse(fs.readFileSync(p, "utf-8")); } catch { process.exit(0); }
      let changed = false;
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === "object" && v.sessionId === "${sessionId}") {
          delete data[k];
          changed = true;
        }
      }
      if (changed) {
        fs.writeFileSync(p + ".tmp", JSON.stringify(data, null, 2));
        fs.renameSync(p + ".tmp", p);
        console.log("updated");
      }
    '
  `;

  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["exec", CONTAINER_NAME, "sh", "-c", indexScript],
      { timeout: EXEC_TIMEOUT_MS, signal },
    );
    indexUpdated = stdout.trim() === "updated";
  } catch (err) {
    return {
      sessionId,
      success: false,
      message: `Archived files but failed to update sessions.json: ${err instanceof Error ? err.message : String(err)}`,
      archivedFiles: archived,
      indexUpdated,
      containerRestarted,
    };
  }

  // 3. Restart the container so the gateway drops the in-memory session.
  if (restart) {
    const composePath = join(deployDir, "engine", "docker-compose.yml");
    try {
      await execFileAsync(
        "docker",
        ["compose", "-f", composePath, "restart"],
        { timeout: 60_000, signal },
      );
      containerRestarted = true;
    } catch (err) {
      return {
        sessionId,
        success: false,
        message: `Archived files and updated index, but container restart failed: ${err instanceof Error ? err.message : String(err)}`,
        archivedFiles: archived,
        indexUpdated,
        containerRestarted,
      };
    }
  }

  return {
    sessionId,
    success: true,
    message: `Archived ${archived.length} file(s)${indexUpdated ? ", sessions.json updated" : ""}${containerRestarted ? ", container restarted" : ""}`,
    archivedFiles: archived,
    indexUpdated,
    containerRestarted,
  };
}
