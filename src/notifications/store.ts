/**
 * Notification channel store.
 *
 * Persists notification channels to ~/.clawhq/notifications.json.
 * Follows the same versioned JSON pattern as alerts/store.ts.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { NotificationChannel } from "./types.js";

/** Stored format. */
interface NotificationStore {
  version: 1;
  channels: NotificationChannel[];
}

/** Default store file location. */
function defaultStorePath(clawhqHome: string): string {
  const resolved = clawhqHome.replace(/^~/, process.env.HOME ?? "~");
  return join(resolved, "notifications.json");
}

/**
 * Load all notification channels from disk.
 */
export async function loadChannels(
  clawhqHome: string,
  storePath?: string,
): Promise<NotificationChannel[]> {
  const path = storePath ?? defaultStorePath(clawhqHome);
  try {
    const raw = await readFile(path, "utf-8");
    const data = JSON.parse(raw) as NotificationStore;
    if (data.version !== 1 || !Array.isArray(data.channels)) {
      return [];
    }
    return data.channels;
  } catch {
    return [];
  }
}

/**
 * Save all notification channels to disk.
 */
export async function saveChannels(
  channels: NotificationChannel[],
  clawhqHome: string,
  storePath?: string,
): Promise<void> {
  const path = storePath ?? defaultStorePath(clawhqHome);
  const data: NotificationStore = { version: 1, channels };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Add a channel and persist.
 */
export async function addChannel(
  channel: NotificationChannel,
  clawhqHome: string,
  storePath?: string,
): Promise<void> {
  const channels = await loadChannels(clawhqHome, storePath);
  channels.push(channel);
  await saveChannels(channels, clawhqHome, storePath);
}

/**
 * Remove a channel by ID and persist.
 * Returns true if the channel was found and removed.
 */
export async function removeChannel(
  channelId: string,
  clawhqHome: string,
  storePath?: string,
): Promise<boolean> {
  const channels = await loadChannels(clawhqHome, storePath);
  const idx = channels.findIndex((c) => c.id === channelId);
  if (idx === -1) return false;
  channels.splice(idx, 1);
  await saveChannels(channels, clawhqHome, storePath);
  return true;
}

/**
 * Find a channel by ID.
 */
export async function getChannel(
  channelId: string,
  clawhqHome: string,
  storePath?: string,
): Promise<NotificationChannel | undefined> {
  const channels = await loadChannels(clawhqHome, storePath);
  return channels.find((c) => c.id === channelId);
}
