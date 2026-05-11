/**
 * Targeted test for the FORWARD-jump attach behavior. Separate from
 * firewall.test.ts because it mocks node:child_process at module scope,
 * which would intercept exec calls in unrelated tests.
 *
 * Regression coverage for the source-build vs hardened-firewall
 * incompatibility: `attachToForward(cmd, cidr)` must emit
 * `-I FORWARD -s <cidr> -j CLAWHQ_FWD`, not the legacy global form.
 * Without scoping, CLAWHQ_FWD on the host's FORWARD chain filters all
 * docker bridge traffic — including `docker build` containers on the
 * default docker0 bridge — and source-builds get DROPped when github.com /
 * registry.npmjs.org aren't in the agent's runtime allowlist.
 */
import { execFile } from "node:child_process";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { attachToForward, CHAIN_NAME } from "./firewall.js";

type ExecCallback = (err: Error | null, stdout: string, stderr: string) => void;

// The firewall module uses promisify(execFile), which relies on
// util.promisify.custom to return { stdout, stderr } rather than the
// default single-value Promise. Attach the well-known symbol on the
// mock so the promisified call resolves to the same shape the real one
// does. vi.mock is hoisted, so the factory must self-contain — no
// referencing module-level imports (which is why we use Symbol.for
// rather than util.promisify.custom).
vi.mock("node:child_process", () => {
  const fn = vi.fn();
  const promisifyCustom = Symbol.for("nodejs.util.promisify.custom");
  (fn as unknown as Record<symbol, unknown>)[promisifyCustom] = (
    cmd: string,
    args: unknown,
    opts: unknown,
  ) =>
    new Promise((resolve, reject) => {
      (fn as unknown as (...a: unknown[]) => void)(
        cmd,
        args,
        opts,
        (err: Error | null, stdout: string, stderr: string) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        },
      );
    });
  return { execFile: fn };
});

const mockExecFile = vi.mocked(execFile);

interface ExecCall {
  cmd: string;
  args: readonly string[];
}

function recordCalls(): ExecCall[] {
  const calls: ExecCall[] = [];
  mockExecFile.mockImplementation(((
    cmd: string,
    args: unknown,
    _opts: unknown,
    cb: ExecCallback,
  ) => {
    calls.push({ cmd, args: args as readonly string[] });
    // -S FORWARD: pretend no existing jumps so cleanup is a no-op.
    if (Array.isArray(args) && args.includes("-S") && args.includes("FORWARD")) {
      cb(null, "", "");
      return;
    }
    cb(null, "", "");
  }) as never);
  return calls;
}

function findInsert(calls: readonly ExecCall[]): readonly string[] | undefined {
  for (const c of calls) {
    if (c.cmd !== "sudo") continue;
    const args = c.args;
    if (
      args.includes("-I") &&
      args.includes("FORWARD") &&
      args.includes("-j") &&
      args.includes(CHAIN_NAME)
    ) {
      return args;
    }
  }
  return undefined;
}

beforeEach(() => {
  mockExecFile.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("attachToForward", () => {
  it("scopes the FORWARD jump to the given source CIDR when provided", async () => {
    const calls = recordCalls();

    await attachToForward("iptables", "172.28.0.0/16");

    const insert = findInsert(calls);
    expect(insert, "expected an iptables -I FORWARD ... -j CLAWHQ_FWD call").toBeDefined();
    expect(insert).toEqual([
      "iptables",
      "-I",
      "FORWARD",
      "-s",
      "172.28.0.0/16",
      "-j",
      CHAIN_NAME,
    ]);
  });

  it("falls back to the legacy global jump when no scope is given", async () => {
    const calls = recordCalls();

    await attachToForward("iptables", undefined);

    const insert = findInsert(calls);
    expect(insert).toEqual(["iptables", "-I", "FORWARD", "-j", CHAIN_NAME]);
  });

  it("emits a v6 attach without source scoping (no pinned v6 subnet)", async () => {
    const calls = recordCalls();

    // applyFirewall always passes undefined for v6, but verify the helper
    // itself doesn't reject a v6 cmd if forwardScopeCidr is undefined.
    await attachToForward("ip6tables", undefined);

    const insert = findInsert(calls);
    expect(insert).toEqual(["ip6tables", "-I", "FORWARD", "-j", CHAIN_NAME]);
  });
});
