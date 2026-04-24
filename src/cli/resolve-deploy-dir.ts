/**
 * CLI-level deployDir resolution — maps the user's invocation context
 * (argv, env, cwd, registry) to the deployDir the lifecycle command should
 * operate on.
 *
 * The resolver sits in front of every `clawhq` invocation; its job is to
 * turn "which agent did the user mean?" into a concrete path, and to
 * error out loudly when the answer is ambiguous (multiple registered, no
 * selector given) rather than silently picking the first clawhq.yaml on
 * the path up from cwd.
 *
 * Precedence:
 *   1. `--agent <name|id-prefix>` in argv
 *   2. `CLAWHQ_DEPLOY_DIR` env var (absolute path override — legacy)
 *   3. Walk up from cwd looking for `clawhq.yaml`; if found AND its dir
 *      matches a registered local instance, use that. Otherwise, if
 *      `clawhq.yaml` is there but not in the registry, use the walked-up
 *      dir as-is (backwards compat — single-deployment users who haven't
 *      registered yet still work).
 *   4. If the registry has exactly one entry, use it.
 *   5. If the registry has >1 entries and nothing else resolved, throw.
 *   6. Otherwise fall back to `~/.clawhq` (fresh install).
 *
 * Pure — all inputs injectable. The caller is responsible for surfacing
 * errors; this function does not call `process.exit`.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { parse as parseYaml } from "yaml";

import {
  listInstances,
  resolveInstance,
  type Instance,
} from "../cloud/instances/index.js";
import {
  InstanceNotFoundError,
  InstanceSelectorRequiredError,
} from "../cloud/instances/resolver.js";

// ── Types ───────────────────────────────────────────────────────────────────

export type DeployDirSource =
  | "agent-flag"
  | "env"
  | "cwd-walk"
  | "single-registered"
  | "fallback";

export interface ResolveDeployDirOptions {
  readonly argv?: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly registryRoot?: string;
}

export interface ResolvedDeployDir {
  readonly deployDir: string;
  readonly source: DeployDirSource;
  /** Present when the deployDir came from a registered instance. */
  readonly instanceId?: string;
  /** Extra guidance for the user when `source` is "fallback" or similar. */
  readonly warning?: string;
}

export class DeployDirAmbiguousError extends Error {
  constructor(readonly registeredNames: readonly string[]) {
    super(
      `multiple agents registered — pass --agent <name> to pick one. Registered: ${registeredNames.join(", ")}`,
    );
    this.name = "DeployDirAmbiguousError";
  }
}

// ── argv parsing ────────────────────────────────────────────────────────────

/** Extract `--agent <value>` or `--agent=<value>` from argv, ignoring position. */
export function extractAgentSelector(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--agent") {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) return next;
      return undefined;
    }
    if (token !== undefined && token.startsWith("--agent=")) {
      return token.slice("--agent=".length);
    }
  }
  return undefined;
}

// ── cwd walk ────────────────────────────────────────────────────────────────

interface CwdWalkResult {
  readonly deployDir: string;
  /** If the yaml carried an `instanceId` top-level field. */
  readonly instanceId?: string;
}

function walkUpForClawhqYaml(startDir: string): CwdWalkResult | undefined {
  let dir = resolve(startDir);
  const ceiling = resolve("/");
  for (let i = 0; i < 32 && dir !== ceiling; i++) {
    const candidate = join(dir, "clawhq.yaml");
    if (existsSync(candidate)) {
      const instanceId = readInstanceIdFromYaml(candidate);
      return instanceId !== undefined
        ? { deployDir: dir, instanceId }
        : { deployDir: dir };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function readInstanceIdFromYaml(path: string): string | undefined {
  try {
    const parsed = parseYaml(readFileSync(path, "utf-8")) as Record<string, unknown> | null;
    const id = parsed?.["instanceId"];
    return typeof id === "string" && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

// ── Resolver ────────────────────────────────────────────────────────────────

/**
 * Resolve the deployDir for the current `clawhq` invocation.
 *
 * Throws `DeployDirAmbiguousError` when the registry has >1 entries and no
 * selector (explicit, env, cwd-match) produced a unique answer. Throws
 * `InstanceNotFoundError` when `--agent` or env var points at a missing
 * instance.
 */
export function resolveDeployDirFromContext(
  options: ResolveDeployDirOptions = {},
): ResolvedDeployDir {
  const argv = options.argv ?? process.argv;
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const root = options.registryRoot;

  const fallback = join(homedir(), ".clawhq");

  // 1. --agent flag
  const agentSelector = extractAgentSelector(argv);
  if (agentSelector !== undefined) {
    const { instance } = resolveInstance({ selector: agentSelector, env, cwd, root });
    return {
      deployDir: deployDirFromInstance(instance),
      source: "agent-flag",
      instanceId: instance.id,
    };
  }

  // 2. CLAWHQ_DEPLOY_DIR env override — legacy absolute-path escape hatch
  const envOverride = env["CLAWHQ_DEPLOY_DIR"];
  if (envOverride !== undefined && envOverride.length > 0) {
    return { deployDir: envOverride, source: "env" };
  }

  // 3. cwd walk-up
  const walked = walkUpForClawhqYaml(cwd);
  if (walked) {
    // If the walked-up clawhq.yaml carries an instanceId, trust it.
    if (walked.instanceId) {
      try {
        const { instance } = resolveInstance({
          selector: walked.instanceId,
          env: {},
          cwd: "/", // suppress further cwd-walk
          root,
        });
        return {
          deployDir: deployDirFromInstance(instance),
          source: "cwd-walk",
          instanceId: instance.id,
        };
      } catch {
        // instanceId in the yaml doesn't match the registry — fall through
        // to structural deployDir match below. Probably a migrated or
        // stale yaml; not an error on its own.
      }
    }
    // Otherwise match a registered local instance by deployDir.
    const match = findLocalByDeployDir(walked.deployDir, root);
    if (match) {
      return {
        deployDir: deployDirFromInstance(match),
        source: "cwd-walk",
        instanceId: match.id,
      };
    }
    // clawhq.yaml exists but nothing in the registry matches — backwards
    // compat for single-deployment users pre-migration. Use the walked-up
    // dir directly.
    return {
      deployDir: walked.deployDir,
      source: "cwd-walk",
      warning: "clawhq.yaml found, but this deployment is not in the instance registry",
    };
  }

  // 4. Single registered instance
  const all = listInstances(root);
  const [only, ...rest] = all;
  if (only && rest.length === 0) {
    return {
      deployDir: deployDirFromInstance(only),
      source: "single-registered",
      instanceId: only.id,
    };
  }

  // 5. Multiple registered — ambiguous
  if (all.length > 1) {
    throw new DeployDirAmbiguousError(all.map((i) => i.name));
  }

  // 6. Empty registry, no clawhq.yaml — fresh install. Use the classic fallback.
  return { deployDir: fallback, source: "fallback" };
}

function deployDirFromInstance(instance: Instance): string {
  if (instance.location.kind === "local") return instance.location.deployDir;
  throw new Error(
    `[cli] instance "${instance.name}" is a ${instance.location.kind} instance; lifecycle commands for cloud agents aren't wired yet`,
  );
}

function findLocalByDeployDir(dir: string, root: string | undefined): Instance | undefined {
  const target = resolve(dir);
  for (const inst of listInstances(root)) {
    if (inst.location.kind === "local" && resolve(inst.location.deployDir) === target) {
      return inst;
    }
  }
  return undefined;
}

// ── Re-exports for convenience ──────────────────────────────────────────────

export { InstanceNotFoundError, InstanceSelectorRequiredError };
