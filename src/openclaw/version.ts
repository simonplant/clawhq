/**
 * OpenClaw version pinning.
 *
 * The CalVer of OpenClaw whose file-surface schemas clawhq's `src/openclaw/`
 * module targets. When upstream ships a schema change, this pin gets bumped
 * deliberately — never silently. Every schema file in this directory tree
 * assumes the pinned version; drift is caught at CI diff time, not runtime.
 *
 * Upstream versioning is CalVer: `vYYYY.M.PATCH` — see `src/operate/updater/
 * calver.ts`.
 */

/** The OpenClaw version this module's schemas target. */
export const OPENCLAW_SCHEMA_VERSION = "2026.4.14" as const;
