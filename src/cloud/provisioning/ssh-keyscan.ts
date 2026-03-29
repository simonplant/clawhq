/**
 * SSH host key collection — runs ssh-keyscan against a remote host
 * to capture its ed25519 public key for strict host key verification.
 *
 * Used after provisioning health check passes to populate the
 * sshHostKey field in the instance registry.
 */

import { spawn } from "node:child_process";

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum attempts to collect the host key (port 22 may lag behind port 443). */
const MAX_ATTEMPTS = 5;

/** Delay between retry attempts in milliseconds. */
const RETRY_DELAY_MS = 5_000;

/** Timeout for each ssh-keyscan invocation in seconds. */
const KEYSCAN_TIMEOUT_SECONDS = 5;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Collect the ed25519 host key from a remote host via ssh-keyscan.
 *
 * Retries up to 5 times with 5-second delays — HTTP health check (port 443)
 * often passes before SSH (port 22) is ready.
 *
 * Returns the key in "ssh-ed25519 AAAA..." format (no hostname prefix),
 * or undefined if collection fails after all attempts.
 */
export async function collectHostKey(
  ipAddress: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) return undefined;

    const key = await runKeyscan(ipAddress, signal);
    if (key) return key;

    // Don't delay after the last attempt
    if (attempt < MAX_ATTEMPTS) {
      await delay(RETRY_DELAY_MS, signal);
    }
  }

  return undefined;
}

// ── Internals ───────────────────────────────────────────────────────────────

/** Run a single ssh-keyscan invocation and parse the ed25519 key from output. */
function runKeyscan(
  ipAddress: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve) => {
    const proc = spawn(
      "ssh-keyscan",
      ["-t", "ed25519", "-T", String(KEYSCAN_TIMEOUT_SECONDS), ipAddress],
      { stdio: ["ignore", "pipe", "pipe"], signal },
    );

    let stdout = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.on("error", () => {
      resolve(undefined);
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        resolve(undefined);
        return;
      }

      const key = parseKeyscanOutput(stdout, ipAddress);
      resolve(key);
    });
  });
}

/**
 * Parse ssh-keyscan output to extract the key type and key data.
 *
 * ssh-keyscan outputs lines in known_hosts format:
 *   <host> ssh-ed25519 AAAA...
 *
 * We strip the hostname prefix and return "ssh-ed25519 AAAA..." —
 * the format stored in the registry and used by buildHostKeyArgs().
 */
export function parseKeyscanOutput(
  output: string,
  ipAddress: string,
): string | undefined {
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Expected format: <host> <key-type> <key-data>
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 3 && parts[0] === ipAddress && parts[1] === "ssh-ed25519") {
      return `${parts[1]} ${parts[2]}`;
    }
  }
  return undefined;
}

/** Delay that respects abort signals. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
