/**
 * Per-tool smoke probe specs. Built from the profile's toolbelt plus a
 * small override table for tools where a richer read verb is cheaper
 * and more informative than `--help`.
 *
 * Design invariant: every probe must be READ-ONLY and SAFE. `email send`
 * is not a probe; `email folders` is. If a tool has no safe read verb,
 * `--help` is the default — it exercises the binary and parser without
 * touching network or state.
 */

import type { MissionProfile } from "../../design/catalog/types.js";

import type { SmokeProbeSpec } from "./types.js";

/** Tools whose `--help` is not useful (or is slow). Override the verb. */
const PROBE_OVERRIDES: Record<string, readonly string[]> = {
  // Email — folders is a lightweight list call, returns JSON, exercises
  // IMAP auth end to end in one RPC.
  email: ["folders"],
  // email-fastmail uses --help because folders makes a JMAP session call
  // every time — cheap but not as cheap as --help. Keep smoke fast.
  "email-fastmail": ["--help"],
  // Calendar — `list` hits CalDAV once, exercises auth.
  calendar: ["list"],
  // Tasks — `today` is the lightest Todoist read.
  tasks: ["today"],
  // Backlog — local file, instant.
  backlog: ["list"],
  // X — dedicated cred-check verb, one auth probe.
  x: ["check"],
  // Market calendar — local-only, instant.
  "market-calendar": ["today"],
  // Watchlist — local-only, instant.
  watchlist: ["list"],
};

/**
 * Generate a probe spec for every tool in the profile's toolbelt.
 * Tools not in the profile are not probed — smoke tests what the agent
 * is *expected* to call, not every executable on PATH.
 *
 * sanitize is a security-always-available tool (not in profile tool
 * list) but worth probing; callers can append it explicitly.
 */
export function specsForProfile(profile: MissionProfile): SmokeProbeSpec[] {
  return profile.tools.map((t) => ({
    tool: t.name,
    args: PROBE_OVERRIDES[t.name] ?? ["--help"],
    timeoutSec: 5,
  }));
}

/** Spec for the always-available sanitize tool (not in any profile's
 *  toolbelt — it's a security mandate). */
export const SANITIZE_PROBE: SmokeProbeSpec = {
  tool: "sanitize",
  args: ["--help"],
  timeoutSec: 5,
};
