/**
 * Resolve "which instance am I operating on" for every lifecycle command.
 *
 * Precedence:
 *   1. Explicit selector (`--agent <name|id-prefix>`)
 *   2. `CLAWHQ_AGENT` env var
 *   3. `~/.clawhq/current` pointer file
 *   4. cwd-walk: find `clawhq.yaml`, look up by its containing directory
 *   5. Registry has exactly one entry → use it (single-tenant backwards-compat)
 *   6. Otherwise: throw with the list of registered names
 *
 * Ambiguity is always an error — never a silent default. See
 * knowledge/wiki/instance-registry.md for design rationale.
 *
 * The resolver is a pure function of its injectable inputs (env, cwd, root).
 * Tests construct tmpdir roots; they never touch process-wide state.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { readCurrentPointer } from "./pointer.js";
import {
  findById,
  findByIdPrefix,
  findByName,
  listInstances,
} from "./registry.js";
import type { Instance } from "./types.js";

// Re-exported so the resolver owns the public error surface for callers.
export { AmbiguousInstancePrefixError } from "./types.js";

// ── Errors ──────────────────────────────────────────────────────────────────

/** No instance matches the explicit selector (--agent / env / pointer). */
export class InstanceNotFoundError extends Error {
  constructor(readonly selector: string, readonly registeredNames: readonly string[]) {
    const list = registeredNames.length
      ? `registered: ${registeredNames.join(", ")}`
      : "no instances registered";
    super(`[instances] no instance matches "${selector}" (${list})`);
    this.name = "InstanceNotFoundError";
  }
}

/** Registry has >1 instance and no selector was provided. */
export class InstanceSelectorRequiredError extends Error {
  constructor(readonly registeredNames: readonly string[]) {
    super(
      `[instances] multiple instances registered — pass --agent <name> to pick one. Registered: ${registeredNames.join(", ")}`,
    );
    this.name = "InstanceSelectorRequiredError";
  }
}

/** Registry is empty. */
export class NoInstancesRegisteredError extends Error {
  constructor() {
    super("[instances] no instances registered — run `clawhq init` first");
    this.name = "NoInstancesRegisteredError";
  }
}

// ── Source tracking ─────────────────────────────────────────────────────────

/** How the resolution was reached. Useful for error messages + `--verbose` output. */
export type ResolutionSource =
  | "selector"        // --agent flag
  | "env"             // CLAWHQ_AGENT
  | "current"         // ~/.clawhq/current
  | "cwd"             // walked up and matched a local deployDir
  | "single-default"; // registry had exactly one entry

export interface ResolveOptions {
  /** Explicit `--agent <name|id-prefix>` value. */
  readonly selector?: string;
  /**
   * Env to consult for `CLAWHQ_AGENT`. Injectable for tests.
   * Defaults to `process.env`.
   */
  readonly env?: NodeJS.ProcessEnv;
  /** Starting directory for cwd-walk. Defaults to `process.cwd()`. */
  readonly cwd?: string;
  /** Registry root. Defaults to `~/.clawhq`. */
  readonly root?: string;
}

export interface Resolution {
  readonly instance: Instance;
  readonly source: ResolutionSource;
}

// ── Lookup helper ───────────────────────────────────────────────────────────

/**
 * Resolve a user-supplied selector against the registry. Name match wins;
 * if no name matches, try id-prefix; if no prefix matches, try full id.
 * Returns `undefined` when nothing matches. Propagates
 * `AmbiguousInstancePrefixError` from `findByIdPrefix`.
 */
function findBySelector(selector: string, root: string | undefined): Instance | undefined {
  const byName = findByName(selector, root);
  if (byName) return byName;
  const byPrefix = findByIdPrefix(selector, root);
  if (byPrefix) return byPrefix;
  return findById(selector, root);
}

/** Look for a `clawhq.yaml` walking up from `startDir`. Returns its containing directory. */
function findDeployDirFromCwd(startDir: string): string | undefined {
  let dir = resolve(startDir);
  const ceiling = resolve("/");
  for (let i = 0; i < 32 && dir !== ceiling; i++) {
    if (existsSync(join(dir, "clawhq.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Find a local instance whose `deployDir` matches `dir`. Uses structural
 * equality (string-compare resolved paths); no symlink following.
 */
function findLocalByDeployDir(dir: string, root: string | undefined): Instance | undefined {
  const target = resolve(dir);
  for (const inst of listInstances(root)) {
    if (inst.location.kind === "local" && resolve(inst.location.deployDir) === target) {
      return inst;
    }
  }
  return undefined;
}

// ── Resolver ────────────────────────────────────────────────────────────────

/**
 * Resolve the target instance for a lifecycle command.
 *
 * Throws when:
 *  - a selector is given but nothing matches it → `InstanceNotFoundError`
 *  - an id prefix matches >1 instance → `AmbiguousInstancePrefixError`
 *  - no selector, no pointer, no cwd-match, and registry has >1 entries →
 *    `InstanceSelectorRequiredError`
 *  - registry is empty → `NoInstancesRegisteredError`
 */
export function resolveInstance(options: ResolveOptions = {}): Resolution {
  const env = options.env ?? process.env;
  const root = options.root;

  // 1. Explicit flag
  if (options.selector !== undefined && options.selector.length > 0) {
    const inst = findBySelector(options.selector, root);
    if (inst) return { instance: inst, source: "selector" };
    throw new InstanceNotFoundError(
      options.selector,
      listInstances(root).map((i) => i.name),
    );
  }

  // 2. Env var
  const envValue = env["CLAWHQ_AGENT"];
  if (envValue !== undefined && envValue.length > 0) {
    const inst = findBySelector(envValue, root);
    if (inst) return { instance: inst, source: "env" };
    throw new InstanceNotFoundError(envValue, listInstances(root).map((i) => i.name));
  }

  // 3. Current pointer
  const pointerValue = readCurrentPointer(root);
  if (pointerValue !== undefined) {
    const inst = findBySelector(pointerValue, root);
    if (inst) return { instance: inst, source: "current" };
    throw new InstanceNotFoundError(pointerValue, listInstances(root).map((i) => i.name));
  }

  // 4. cwd-walk
  const startCwd = options.cwd ?? process.cwd();
  const dir = findDeployDirFromCwd(startCwd);
  if (dir) {
    const inst = findLocalByDeployDir(dir, root);
    if (inst) return { instance: inst, source: "cwd" };
    // clawhq.yaml exists but registry has no entry for it — fall through to
    // single-default. Migration is the path that populates these records.
  }

  // 5. Single-default
  const all = listInstances(root);
  if (all.length === 0) throw new NoInstancesRegisteredError();
  const [only, ...rest] = all;
  if (only && rest.length === 0) return { instance: only, source: "single-default" };

  throw new InstanceSelectorRequiredError(all.map((i) => i.name));
}
