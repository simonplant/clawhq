/**
 * Runaway session detection.
 *
 * Inspects session files inside the running container via `docker exec`.
 * Never touches host files — sessions live on the container's tmpfs.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { RunawayFlag, RunawayThresholds, SessionInfo } from "./types.js";

const execFileAsync = promisify(execFile);

// ── Constants ───────────────────────────────────────────────────────────────

const CONTAINER_NAME = "engine-openclaw-1";
const SESSIONS_DIR = "/home/node/.openclaw/agents/main/sessions";
const EXEC_TIMEOUT_MS = 10_000;

const DEFAULT_THRESHOLDS: Required<RunawayThresholds> = {
  maxMessages: 500,
  maxSizeBytes: 5 * 1024 * 1024, // 5 MB
  maxActiveMs: 24 * 60 * 60 * 1000, // 24h
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * List all sessions inside the container, flagging any that look runaway.
 *
 * Never throws — returns empty array if the container is not running or
 * the sessions directory is missing.
 */
export async function listSessions(
  thresholds?: RunawayThresholds,
  signal?: AbortSignal,
): Promise<SessionInfo[]> {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };

  // Read sessions.json index (maps key → sessionId) for context
  const indexMap = await readSessionsIndex(signal);

  // Enumerate .jsonl files with size + mtime + linecount in a single shell call
  // Format per file: FILE<TAB>SIZE<TAB>MTIME_EPOCH<TAB>LINECOUNT
  const script = `
    cd ${SESSIONS_DIR} 2>/dev/null || exit 0
    for f in *.jsonl; do
      [ -f "$f" ] || continue
      size=$(stat -c %s "$f" 2>/dev/null || echo 0)
      mtime=$(stat -c %Y "$f" 2>/dev/null || echo 0)
      lines=$(wc -l < "$f" 2>/dev/null || echo 0)
      echo "$f\t$size\t$mtime\t$lines"
    done
  `;

  let stdout: string;
  try {
    const res = await execFileAsync(
      "docker",
      ["exec", CONTAINER_NAME, "sh", "-c", script],
      { timeout: EXEC_TIMEOUT_MS, signal },
    );
    stdout = res.stdout;
  } catch {
    return [];
  }

  const now = Date.now();
  const sessions: SessionInfo[] = [];

  for (const line of stdout.trim().split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 4) continue;

    const file = parts[0];
    const sizeBytes = parseInt(parts[1], 10) || 0;
    const mtimeEpoch = parseInt(parts[2], 10) || 0;
    const messageCount = parseInt(parts[3], 10) || 0;

    const id = file.replace(/\.jsonl$/, "");
    const mtime = new Date(mtimeEpoch * 1000).toISOString();
    const ageMs = now - mtimeEpoch * 1000;

    const flags: RunawayFlag[] = [];
    if (messageCount >= t.maxMessages) flags.push("message-count-excessive");
    if (sizeBytes >= t.maxSizeBytes) flags.push("size-excessive");
    // Active-too-long: file still being written (recent mtime) AND the session
    // has been around a long time relative to the session-start (first line mtime
    // is impractical; we approximate by flagging very fresh writes on a large
    // message count). Only apply if there's already some bulk.
    if (ageMs < 5 * 60_000 && messageCount > 200 && sessions.length === 0) {
      // Can't detect start time reliably — skip this heuristic for now.
    }
    // A session where mtime is recent but the message count is high is the
    // dangerous signature; the flags above already catch that.

    sessions.push({
      id,
      file,
      sizeBytes,
      messageCount,
      mtime,
      indexKey: indexMap.get(id),
      flags,
    });
  }

  // Sort: runaway first (most flags, then by size), then healthy by mtime desc.
  sessions.sort((a, b) => {
    if (a.flags.length !== b.flags.length) return b.flags.length - a.flags.length;
    if (a.flags.length > 0) return b.sizeBytes - a.sizeBytes;
    return b.mtime.localeCompare(a.mtime);
  });

  return sessions;
}

/**
 * Read sessions.json from inside the container and build id → indexKey map.
 * sessions.json format: { "<key>": { "sessionId": "<uuid>", ... }, ... }
 */
async function readSessionsIndex(signal?: AbortSignal): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["exec", CONTAINER_NAME, "cat", `${SESSIONS_DIR}/sessions.json`],
      { timeout: EXEC_TIMEOUT_MS, signal },
    );
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (value && typeof value === "object") {
        const sid = (value as Record<string, unknown>)["sessionId"];
        if (typeof sid === "string") map.set(sid, key);
      }
    }
  } catch {
    // Index missing or unreadable — proceed without mapping.
  }
  return map;
}

/** True if any session has at least one runaway flag. */
export function hasRunawaySession(sessions: readonly SessionInfo[]): boolean {
  return sessions.some((s) => s.flags.length > 0);
}
