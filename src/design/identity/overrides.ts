/**
 * Identity template overrides — Layer 2 user-editable identity fragments.
 *
 * By default every compiled workspace file is the output of a renderer in
 * `src/design/identity/` or `src/design/catalog/compiler.ts`. Users who need
 * to pin the content of a specific fragment (e.g. a custom SOUL.md that
 * survives every `clawhq apply`) can drop a file at one of two locations:
 *
 *   - `~/.clawhq/templates/identity/<FRAGMENT>.md`
 *     machine-global default — applies to every managed instance on this host
 *
 *   - `~/.clawhq/instances/<instanceId>/templates/identity/<FRAGMENT>.md`
 *     per-instance override — takes precedence over the machine-global default
 *
 * When either file exists, its exact contents are used verbatim as the
 * compiled workspace file. The renderer output is discarded for that
 * fragment. Templates are Layer 2 ([[ownership-layers]]) — ClawHQ metadata,
 * not agent content. Compiled outputs remain at `workspace/<FRAGMENT>.md`
 * inside the agent (Layer 4).
 *
 * Override files are a power-user feature. Removing required sections (or
 * exceeding the `bootstrapMaxChars` budget) can break the agent — the
 * user has explicitly opted in by placing the file.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TEMPLATES_SUBDIR = "templates";
const IDENTITY_SUBDIR = "identity";
const INSTANCES_SUBDIR = "instances";
const CLAWHQ_ROOT_NAME = ".clawhq";

function clawhqRootPath(): string {
  return join(homedir(), CLAWHQ_ROOT_NAME);
}

/** Directory path for machine-global identity fragment overrides. */
export function globalIdentityTemplatesDir(): string {
  return join(clawhqRootPath(), TEMPLATES_SUBDIR, IDENTITY_SUBDIR);
}

/** Directory path for per-instance identity fragment overrides. */
export function instanceIdentityTemplatesDir(instanceId: string): string {
  return join(
    clawhqRootPath(),
    INSTANCES_SUBDIR,
    instanceId,
    TEMPLATES_SUBDIR,
    IDENTITY_SUBDIR,
  );
}

/**
 * Read an identity fragment override for the given filename (e.g. `SOUL.md`).
 * Precedence: per-instance > machine-global > undefined (no override).
 */
export function readIdentityOverride(
  fragmentName: string,
  instanceId?: string,
): string | undefined {
  const roots: string[] = [];
  if (instanceId) roots.push(instanceIdentityTemplatesDir(instanceId));
  roots.push(globalIdentityTemplatesDir());

  for (const root of roots) {
    const path = join(root, fragmentName);
    if (existsSync(path)) {
      try {
        return readFileSync(path, "utf-8");
      } catch {
        // Unreadable override is treated as absent rather than fatal —
        // users who've lost filesystem access to their overrides still
        // get a working agent from the renderer defaults.
        continue;
      }
    }
  }

  return undefined;
}

/**
 * Apply an identity-fragment override if one exists. Otherwise returns
 * `rendered` (the renderer's output) unchanged. Convenience wrapper for the
 * common call-site pattern.
 */
export function withIdentityOverride(
  fragmentName: string,
  rendered: string,
  instanceId?: string,
): string {
  const override = readIdentityOverride(fragmentName, instanceId);
  return override ?? rendered;
}
