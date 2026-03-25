import { createSign, generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DIR_MODE_SECRET, FILE_MODE_SECRET, GATEWAY_DEFAULT_PORT } from "../config/defaults.js";

import {
  commandQueuePath,
  enqueueCommand,
  processNextCommand,
  readQueueState,
} from "./commands/queue.js";
import {
  buildSignatureMessage,
  verifyCommandSignature,
} from "./commands/verify.js";
import {
  collectHealthReport,
  heartbeatPath,
  readHeartbeatState,
  sendHeartbeat,
} from "./heartbeat/index.js";
import {
  connectCloud,
  disconnectCloud,
  readTrustModeState,
  switchTrustMode,
  trustModePath,
} from "./trust-modes/index.js";
import {
  getAllowedCommands,
  getCommandDisposition,
  isArchitecturallyBlocked,
  isCommandSupported,
} from "./trust-modes/policy.js";
import type { SignedCommand } from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function tmpDeployDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "clawhq-cloud-test-"));
  mkdirSync(join(dir, "cloud"), { recursive: true });
  mkdirSync(join(dir, "engine"), { recursive: true });
  mkdirSync(join(dir, "workspace", "memory", "hot"), { recursive: true });
  mkdirSync(join(dir, "workspace", "memory", "warm"), { recursive: true });
  mkdirSync(join(dir, "workspace", "memory", "cold"), { recursive: true });
  return dir;
}

/** Deploy dir without cloud/ subdir — forces code paths to create it. */
function tmpDeployDirNoCloud(): string {
  const dir = mkdtempSync(join(tmpdir(), "clawhq-cloud-test-"));
  mkdirSync(join(dir, "engine"), { recursive: true });
  mkdirSync(join(dir, "workspace", "memory", "hot"), { recursive: true });
  mkdirSync(join(dir, "workspace", "memory", "warm"), { recursive: true });
  mkdirSync(join(dir, "workspace", "memory", "cold"), { recursive: true });
  return dir;
}

/** Fixed "now" for tests using createdAt "2026-03-19T10:00:00Z" — 1 minute after. */
const TEST_NOW = Date.parse("2026-03-19T10:01:00Z");

/** Verify options that pin "now" so old test timestamps don't expire. */
const TEST_VERIFY = { verify: { now: TEST_NOW } } as const;

function generateTestKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

function signCommand(command: Omit<SignedCommand, "signature">, privateKey: string): SignedCommand {
  const message = buildSignatureMessage({ ...command, signature: "" });
  const sign = createSign("SHA256");
  sign.update(message);
  sign.end();
  const signature = sign.sign(privateKey, "base64");
  return { ...command, signature };
}

// ── Trust Mode Tests ─────────────────────────────────────────────────────────

describe("trust modes", () => {
  describe("readTrustModeState", () => {
    it("returns default paranoid state when no file exists", () => {
      const deployDir = tmpDeployDir();
      const state = readTrustModeState(deployDir);
      expect(state.mode).toBe("paranoid");
      expect(state.connected).toBe(false);
    });
  });

  describe("switchTrustMode", () => {
    it("switches from paranoid to zero-trust", () => {
      const deployDir = tmpDeployDir();
      const result = switchTrustMode(deployDir, "zero-trust");
      expect(result.success).toBe(true);
      expect(result.previousMode).toBe("paranoid");
      expect(result.currentMode).toBe("zero-trust");

      const state = readTrustModeState(deployDir);
      expect(state.mode).toBe("zero-trust");
    });

    it("switches from zero-trust to managed", () => {
      const deployDir = tmpDeployDir();
      switchTrustMode(deployDir, "zero-trust");
      const result = switchTrustMode(deployDir, "managed");
      expect(result.success).toBe(true);
      expect(result.previousMode).toBe("zero-trust");
      expect(result.currentMode).toBe("managed");
    });

    it("switching to paranoid forces disconnect", () => {
      const deployDir = tmpDeployDir();
      switchTrustMode(deployDir, "zero-trust");
      connectCloud(deployDir, "test-token");
      const state1 = readTrustModeState(deployDir);
      expect(state1.connected).toBe(true);

      switchTrustMode(deployDir, "paranoid");
      const state2 = readTrustModeState(deployDir);
      expect(state2.connected).toBe(false);
      expect(state2.disconnectedAt).toBeDefined();
    });

    it("no-op when switching to same mode", () => {
      const deployDir = tmpDeployDir();
      const result = switchTrustMode(deployDir, "paranoid");
      expect(result.success).toBe(true);
      expect(result.previousMode).toBe("paranoid");
      expect(result.currentMode).toBe("paranoid");
    });
  });

  describe("connectCloud", () => {
    it("connects in zero-trust mode", () => {
      const deployDir = tmpDeployDir();
      switchTrustMode(deployDir, "zero-trust");
      const result = connectCloud(deployDir, "test-token");
      expect(result.success).toBe(true);

      const state = readTrustModeState(deployDir);
      expect(state.connected).toBe(true);
      expect(state.connectedAt).toBeDefined();
    });

    it("fails to connect in paranoid mode", () => {
      const deployDir = tmpDeployDir();
      const result = connectCloud(deployDir, "test-token");
      expect(result.success).toBe(false);
      expect(result.error).toContain("paranoid");
    });
  });

  describe("disconnectCloud (kill switch)", () => {
    it("disconnects immediately", () => {
      const deployDir = tmpDeployDir();
      switchTrustMode(deployDir, "zero-trust");
      connectCloud(deployDir, "test-token");

      const result = disconnectCloud(deployDir);
      expect(result.success).toBe(true);
      expect(result.wasConnected).toBe(true);

      const state = readTrustModeState(deployDir);
      expect(state.connected).toBe(false);
      expect(state.disconnectedAt).toBeDefined();
    });

    it("succeeds even when not connected", () => {
      const deployDir = tmpDeployDir();
      const result = disconnectCloud(deployDir);
      expect(result.success).toBe(true);
      expect(result.wasConnected).toBe(false);
    });
  });
});

// ── Policy Tests ─────────────────────────────────────────────────────────────

describe("trust mode policy", () => {
  it("blocks all commands in paranoid mode", () => {
    const allowed = getAllowedCommands("paranoid");
    expect(allowed).toHaveLength(0);
  });

  it("allows health-check in zero-trust mode", () => {
    expect(getCommandDisposition("health-check", "zero-trust")).toBe("allowed");
  });

  it("requires approval for trigger-update in zero-trust mode", () => {
    expect(getCommandDisposition("trigger-update", "zero-trust")).toBe("approval");
  });

  it("auto-approves trigger-update in managed mode", () => {
    expect(getCommandDisposition("trigger-update", "managed")).toBe("auto");
  });

  it("blocks content-access commands in all modes", () => {
    const contentCommands = [
      "read-memory-contents",
      "read-conversations",
      "read-credential-values",
      "read-identity-files",
      "shell-access",
    ] as const;

    for (const cmd of contentCommands) {
      expect(isArchitecturallyBlocked(cmd)).toBe(true);
      expect(getCommandDisposition(cmd, "paranoid")).toBe("blocked");
      expect(getCommandDisposition(cmd, "zero-trust")).toBe("blocked");
      expect(getCommandDisposition(cmd, "managed")).toBe("blocked");
    }
  });

  it("isCommandSupported returns false for architecturally blocked commands", () => {
    expect(isCommandSupported("read-conversations")).toBe(false);
    expect(isCommandSupported("health-check")).toBe(true);
  });

  it("allows operational metrics only in managed mode", () => {
    expect(getCommandDisposition("read-operational-metrics", "paranoid")).toBe("blocked");
    expect(getCommandDisposition("read-operational-metrics", "zero-trust")).toBe("blocked");
    expect(getCommandDisposition("read-operational-metrics", "managed")).toBe("allowed");
  });
});

// ── Heartbeat Tests ──────────────────────────────────────────────────────────

describe("heartbeat", () => {
  describe("readHeartbeatState", () => {
    it("returns default state when no file exists", () => {
      const deployDir = tmpDeployDir();
      const state = readHeartbeatState(deployDir);
      expect(state.version).toBe(1);
      expect(state.consecutiveFailures).toBe(0);
      expect(state.lastSentAt).toBeUndefined();
    });
  });

  describe("collectHealthReport", () => {
    it("collects health report with operational metadata only", () => {
      const deployDir = tmpDeployDir();
      // Write a fake openclaw.json so container check finds it
      writeFileSync(
        join(deployDir, "engine", "openclaw.json"),
        JSON.stringify({ gateway: { port: GATEWAY_DEFAULT_PORT } }),
      );
      writeFileSync(
        join(deployDir, "engine", "docker-compose.yml"),
        "version: '3'\n",
      );

      const report = collectHealthReport(deployDir, "zero-trust");

      expect(report.agentId).toHaveLength(16);
      expect(report.trustMode).toBe("zero-trust");
      expect(report.containerRunning).toBe(true);
      expect(report.integrationCount).toBe(0);
      expect(report.memoryTierSizes).toEqual({ hot: 0, warm: 0, cold: 0 });
      expect(report.timestamp).toBeDefined();
    });

    it("reports real disk usage percentage (not hardcoded 0)", () => {
      const deployDir = tmpDeployDir();
      const report = collectHealthReport(deployDir, "zero-trust");
      // Any real filesystem will have some usage
      expect(report.diskUsagePercent).toBeGreaterThan(0);
      expect(report.diskUsagePercent).toBeLessThanOrEqual(100);
    });

    it("returns -1 for disk usage when path does not exist", () => {
      const deployDir = "/tmp/clawhq-nonexistent-" + Date.now();
      const report = collectHealthReport(deployDir, "zero-trust");
      expect(report.diskUsagePercent).toBe(-1);
    });

    it("reports integration count without exposing credentials", () => {
      const deployDir = tmpDeployDir();
      writeFileSync(
        join(deployDir, "engine", "credentials.json"),
        JSON.stringify({
          version: 1,
          credentials: [
            { integration: "email", values: { KEY: "secret" }, storedAt: "2026-01-01" },
            { integration: "calendar", values: { KEY: "secret2" }, storedAt: "2026-01-01" },
          ],
        }),
      );

      const report = collectHealthReport(deployDir, "managed");
      expect(report.integrationCount).toBe(2);
      // Verify no credential values in the report
      const reportStr = JSON.stringify(report);
      expect(reportStr).not.toContain("secret");
    });
  });
});

// ── Command Signature Tests ──────────────────────────────────────────────────

describe("command signature verification", () => {
  it("verifies a valid signature", () => {
    const { publicKey, privateKey } = generateTestKeys();
    const command = signCommand(
      {
        id: "cmd-001",
        type: "health-check",
        createdAt: "2026-03-19T10:00:00Z",
      },
      privateKey,
    );

    const result = verifyCommandSignature(command, publicKey, { now: TEST_NOW });
    expect(result.valid).toBe(true);
  });

  it("rejects a tampered command", () => {
    const { publicKey, privateKey } = generateTestKeys();
    const command = signCommand(
      {
        id: "cmd-002",
        type: "health-check",
        createdAt: "2026-03-19T10:00:00Z",
      },
      privateKey,
    );

    // Tamper with the command
    const tampered = { ...command, type: "shell-access" as const };
    const result = verifyCommandSignature(tampered, publicKey, { now: TEST_NOW });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("tampered");
  });

  it("rejects missing signature", () => {
    const { publicKey } = generateTestKeys();
    const command: SignedCommand = {
      id: "cmd-003",
      type: "health-check",
      createdAt: "2026-03-19T10:00:00Z",
      signature: "",
    };

    const result = verifyCommandSignature(command, publicKey, { now: TEST_NOW });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Missing signature");
  });

  it("verifies signature with payload", () => {
    const { publicKey, privateKey } = generateTestKeys();
    const command = signCommand(
      {
        id: "cmd-004",
        type: "trigger-update",
        createdAt: "2026-03-19T10:00:00Z",
        payload: { version: "2.0.0" },
      },
      privateKey,
    );

    const result = verifyCommandSignature(command, publicKey, { now: TEST_NOW });
    expect(result.valid).toBe(true);
  });
});

// ── Command Queue Tests ──────────────────────────────────────────────────────

describe("command queue", () => {
  describe("readQueueState", () => {
    it("returns empty state when no file exists", () => {
      const deployDir = tmpDeployDir();
      const state = readQueueState(deployDir);
      expect(state.pending).toHaveLength(0);
      expect(state.history).toHaveLength(0);
    });
  });

  describe("enqueueCommand", () => {
    it("adds a command to the pending queue", () => {
      const deployDir = tmpDeployDir();
      const { privateKey } = generateTestKeys();
      const command = signCommand(
        { id: "cmd-010", type: "health-check", createdAt: "2026-03-19T10:00:00Z" },
        privateKey,
      );

      enqueueCommand(deployDir, command);
      const state = readQueueState(deployDir);
      expect(state.pending).toHaveLength(1);
      expect(state.pending[0].id).toBe("cmd-010");
    });
  });

  describe("file mode", () => {
    it("writes commands.json with mode 0600 (FILE_MODE_SECRET)", () => {
      const deployDir = tmpDeployDir();
      const { privateKey } = generateTestKeys();
      const command = signCommand(
        { id: "cmd-mode-001", type: "health-check", createdAt: "2026-03-19T10:00:00Z" },
        privateKey,
      );

      enqueueCommand(deployDir, command);

      const path = commandQueuePath(deployDir);
      const stat = statSync(path);
      expect(stat.mode & 0o777).toBe(FILE_MODE_SECRET);
    });

    it("writes trust-mode.json with mode 0600 (FILE_MODE_SECRET)", () => {
      const deployDir = tmpDeployDir();

      switchTrustMode(deployDir, "zero-trust");

      const path = trustModePath(deployDir);
      const stat = statSync(path);
      expect(stat.mode & 0o777).toBe(FILE_MODE_SECRET);
    });

    it("writes heartbeat.json with mode 0600 (FILE_MODE_SECRET)", async () => {
      const deployDir = tmpDeployDir();

      await sendHeartbeat(deployDir, "zero-trust");

      const path = heartbeatPath(deployDir);
      const stat = statSync(path);
      expect(stat.mode & 0o777).toBe(FILE_MODE_SECRET);
    });
  });

  describe("processNextCommand", () => {
    it("executes allowed commands in managed mode", () => {
      const deployDir = tmpDeployDir();
      const { publicKey, privateKey } = generateTestKeys();
      const command = signCommand(
        { id: "cmd-020", type: "health-check", createdAt: "2026-03-19T10:00:00Z" },
        privateKey,
      );

      enqueueCommand(deployDir, command);
      const result = processNextCommand(deployDir, "managed", publicKey, TEST_VERIFY);

      expect(result).toBeDefined();
      if (!result) throw new Error("Expected result to be defined");
      expect(result.commandId).toBe("cmd-020");
      expect(result.disposition).toBe("allowed");
      expect(result.executed).toBe(true);
    });

    it("blocks all commands in paranoid mode", () => {
      const deployDir = tmpDeployDir();
      const { publicKey, privateKey } = generateTestKeys();
      const command = signCommand(
        { id: "cmd-021", type: "health-check", createdAt: "2026-03-19T10:00:00Z" },
        privateKey,
      );

      enqueueCommand(deployDir, command);
      const result = processNextCommand(deployDir, "paranoid", publicKey, TEST_VERIFY);

      expect(result).toBeDefined();
      if (!result) throw new Error("Expected result to be defined");
      expect(result.disposition).toBe("blocked");
      expect(result.executed).toBe(false);
    });

    it("rejects architecturally blocked commands regardless of mode", () => {
      const deployDir = tmpDeployDir();
      const { publicKey, privateKey } = generateTestKeys();
      const command = signCommand(
        { id: "cmd-022", type: "read-conversations", createdAt: "2026-03-19T10:00:00Z" },
        privateKey,
      );

      enqueueCommand(deployDir, command);
      const result = processNextCommand(deployDir, "managed", publicKey, TEST_VERIFY);

      expect(result).toBeDefined();
      if (!result) throw new Error("Expected result to be defined");
      expect(result.disposition).toBe("blocked");
      expect(result.executed).toBe(false);
      expect(result.error).toContain("Architecturally blocked");
    });

    it("rejects commands with invalid signatures", () => {
      const deployDir = tmpDeployDir();
      const { publicKey } = generateTestKeys();
      const { privateKey: wrongKey } = generateTestKeys();

      const command = signCommand(
        { id: "cmd-023", type: "health-check", createdAt: "2026-03-19T10:00:00Z" },
        wrongKey,
      );

      enqueueCommand(deployDir, command);
      const result = processNextCommand(deployDir, "managed", publicKey, TEST_VERIFY);

      expect(result).toBeDefined();
      if (!result) throw new Error("Expected result to be defined");
      expect(result.executed).toBe(false);
      expect(result.error).toContain("Signature rejected");
    });

    it("returns undefined on empty queue", () => {
      const deployDir = tmpDeployDir();
      const { publicKey } = generateTestKeys();
      const result = processNextCommand(deployDir, "managed", publicKey);
      expect(result).toBeUndefined();
    });

    it("requires approval for trigger-update in zero-trust mode", () => {
      const deployDir = tmpDeployDir();
      const { publicKey, privateKey } = generateTestKeys();
      const command = signCommand(
        { id: "cmd-024", type: "trigger-update", createdAt: "2026-03-19T10:00:00Z" },
        privateKey,
      );

      enqueueCommand(deployDir, command);
      const result = processNextCommand(deployDir, "zero-trust", publicKey, TEST_VERIFY);

      expect(result).toBeDefined();
      if (!result) throw new Error("Expected result to be defined");
      expect(result.disposition).toBe("approval");
      expect(result.executed).toBe(false);
    });

    it("auto-approves trigger-update in managed mode", () => {
      const deployDir = tmpDeployDir();
      const { publicKey, privateKey } = generateTestKeys();
      const command = signCommand(
        { id: "cmd-025", type: "trigger-update", createdAt: "2026-03-19T10:00:00Z" },
        privateKey,
      );

      enqueueCommand(deployDir, command);
      const result = processNextCommand(deployDir, "managed", publicKey, TEST_VERIFY);

      expect(result).toBeDefined();
      if (!result) throw new Error("Expected result to be defined");
      expect(result.disposition).toBe("auto");
      expect(result.executed).toBe(true);
    });
  });
});

// ── Cloud Directory Mode Tests ──────────────────────────────────────────────

describe("cloud directory mode", () => {
  it("queue.ts creates cloud/ dir with mode 0700", () => {
    const deployDir = tmpDeployDirNoCloud();
    const { privateKey } = generateTestKeys();
    const command = signCommand(
      { id: "cmd-dir-001", type: "health-check", createdAt: "2026-03-19T10:00:00Z" },
      privateKey,
    );

    enqueueCommand(deployDir, command);

    const cloudDir = join(deployDir, "cloud");
    const stat = statSync(cloudDir);
    expect(stat.mode & 0o777).toBe(DIR_MODE_SECRET);
  });

  it("switch.ts creates cloud/ dir with mode 0700", () => {
    const deployDir = tmpDeployDirNoCloud();

    switchTrustMode(deployDir, "zero-trust");

    const cloudDir = join(deployDir, "cloud");
    const stat = statSync(cloudDir);
    expect(stat.mode & 0o777).toBe(DIR_MODE_SECRET);
  });

  it("reporter.ts creates cloud/ dir with mode 0700", async () => {
    const deployDir = tmpDeployDirNoCloud();

    await sendHeartbeat(deployDir, "zero-trust");

    const cloudDir = join(deployDir, "cloud");
    const stat = statSync(cloudDir);
    expect(stat.mode & 0o777).toBe(DIR_MODE_SECRET);
  });

  it("corrects existing cloud/ dir with wrong mode", () => {
    const deployDir = tmpDeployDir();
    const cloudDir = join(deployDir, "cloud");
    // Widen to 0755 to simulate a pre-existing misconfigured dir
    chmodSync(cloudDir, 0o755);

    const { privateKey } = generateTestKeys();
    const command = signCommand(
      { id: "cmd-dir-002", type: "health-check", createdAt: "2026-03-19T10:00:00Z" },
      privateKey,
    );

    enqueueCommand(deployDir, command);

    const stat = statSync(cloudDir);
    expect(stat.mode & 0o777).toBe(DIR_MODE_SECRET);
  });
});

// ── Replay Protection Tests ─────────────────────────────────────────────────

describe("replay protection", () => {
  describe("freshness validation", () => {
    it("rejects expired commands (older than max age)", () => {
      const { publicKey, privateKey } = generateTestKeys();
      const command = signCommand(
        { id: "cmd-exp-001", type: "health-check", createdAt: "2026-03-19T10:00:00Z" },
        privateKey,
      );

      // Verify with "now" set 10 minutes after createdAt (exceeds 5-min default)
      const tenMinLater = Date.parse("2026-03-19T10:10:00Z");
      const result = verifyCommandSignature(command, publicKey, { now: tenMinLater });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Command expired");
    });

    it("accepts commands within max age", () => {
      const { publicKey, privateKey } = generateTestKeys();
      const command = signCommand(
        { id: "cmd-exp-002", type: "health-check", createdAt: "2026-03-19T10:00:00Z" },
        privateKey,
      );

      // Verify with "now" set 2 minutes after createdAt (within 5-min default)
      const twoMinLater = Date.parse("2026-03-19T10:02:00Z");
      const result = verifyCommandSignature(command, publicKey, { now: twoMinLater });
      expect(result.valid).toBe(true);
    });

    it("supports configurable max age", () => {
      const { publicKey, privateKey } = generateTestKeys();
      const command = signCommand(
        { id: "cmd-exp-003", type: "health-check", createdAt: "2026-03-19T10:00:00Z" },
        privateKey,
      );

      // 3 minutes later, with a 2-minute max age — should expire
      const threeMinLater = Date.parse("2026-03-19T10:03:00Z");
      const result = verifyCommandSignature(command, publicKey, {
        now: threeMinLater,
        maxAgeMs: 2 * 60 * 1_000,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Command expired");
    });

    it("rejects commands with future timestamps beyond clock skew tolerance", () => {
      const { publicKey, privateKey } = generateTestKeys();
      const command = signCommand(
        { id: "cmd-exp-004", type: "health-check", createdAt: "2026-03-19T10:05:00Z" },
        privateKey,
      );

      // "now" is 2 minutes before createdAt — beyond 30s clock skew tolerance
      const twoMinBefore = Date.parse("2026-03-19T10:03:00Z");
      const result = verifyCommandSignature(command, publicKey, { now: twoMinBefore });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("future");
    });

    it("tolerates minor clock skew (within 30 seconds)", () => {
      const { publicKey, privateKey } = generateTestKeys();
      const command = signCommand(
        { id: "cmd-exp-005", type: "health-check", createdAt: "2026-03-19T10:00:20Z" },
        privateKey,
      );

      // "now" is 20 seconds before createdAt — within 30s tolerance
      const result = verifyCommandSignature(command, publicKey, {
        now: Date.parse("2026-03-19T10:00:00Z"),
      });
      expect(result.valid).toBe(true);
    });

    it("rejects commands with invalid createdAt timestamp", () => {
      const { publicKey } = generateTestKeys();
      const command: SignedCommand = {
        id: "cmd-exp-006",
        type: "health-check",
        createdAt: "not-a-date",
        signature: "dGVzdA==",
      };

      const result = verifyCommandSignature(command, publicKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Invalid createdAt");
    });

    it("rejects expired commands in processNextCommand", () => {
      const deployDir = tmpDeployDir();
      const { publicKey, privateKey } = generateTestKeys();
      const command = signCommand(
        { id: "cmd-exp-010", type: "health-check", createdAt: "2026-03-19T10:00:00Z" },
        privateKey,
      );

      enqueueCommand(deployDir, command);
      // Process with "now" 10 minutes later — command should be rejected as expired
      const result = processNextCommand(deployDir, "managed", publicKey, {
        verify: { now: Date.parse("2026-03-19T10:10:00Z") },
      });

      expect(result).toBeDefined();
      if (!result) throw new Error("Expected result to be defined");
      expect(result.executed).toBe(false);
      expect(result.error).toContain("Command expired");
    });
  });

  describe("nonce tracking (duplicate command ID rejection)", () => {
    it("rejects a replayed command with the same ID", () => {
      const deployDir = tmpDeployDir();
      const { publicKey, privateKey } = generateTestKeys();
      const command = signCommand(
        { id: "cmd-replay-001", type: "health-check", createdAt: "2026-03-19T10:00:00Z" },
        privateKey,
      );

      // Process the command the first time
      enqueueCommand(deployDir, command);
      const result1 = processNextCommand(deployDir, "managed", publicKey, TEST_VERIFY);
      expect(result1).toBeDefined();
      expect(result1!.executed).toBe(true);

      // Enqueue the same command again (replay attack)
      enqueueCommand(deployDir, command);
      const result2 = processNextCommand(deployDir, "managed", publicKey, TEST_VERIFY);
      expect(result2).toBeDefined();
      expect(result2!.executed).toBe(false);
      expect(result2!.error).toContain("Replayed command rejected");
      expect(result2!.error).toContain("duplicate command ID");
    });

    it("allows different commands with unique IDs", () => {
      const deployDir = tmpDeployDir();
      const { publicKey, privateKey } = generateTestKeys();

      const cmd1 = signCommand(
        { id: "cmd-replay-002a", type: "health-check", createdAt: "2026-03-19T10:00:00Z" },
        privateKey,
      );
      const cmd2 = signCommand(
        { id: "cmd-replay-002b", type: "health-check", createdAt: "2026-03-19T10:00:00Z" },
        privateKey,
      );

      enqueueCommand(deployDir, cmd1);
      const result1 = processNextCommand(deployDir, "managed", publicKey, TEST_VERIFY);
      expect(result1!.executed).toBe(true);

      enqueueCommand(deployDir, cmd2);
      const result2 = processNextCommand(deployDir, "managed", publicKey, TEST_VERIFY);
      expect(result2!.executed).toBe(true);
    });

    it("detects replays even for blocked commands", () => {
      const deployDir = tmpDeployDir();
      const { publicKey, privateKey } = generateTestKeys();
      const command = signCommand(
        { id: "cmd-replay-003", type: "health-check", createdAt: "2026-03-19T10:00:00Z" },
        privateKey,
      );

      // First attempt blocked by paranoid mode
      enqueueCommand(deployDir, command);
      const result1 = processNextCommand(deployDir, "paranoid", publicKey, TEST_VERIFY);
      expect(result1!.disposition).toBe("blocked");

      // Second attempt with same ID — replay detected before trust mode check
      enqueueCommand(deployDir, command);
      const result2 = processNextCommand(deployDir, "managed", publicKey, TEST_VERIFY);
      expect(result2!.executed).toBe(false);
      expect(result2!.error).toContain("Replayed command rejected");
    });
  });
});

// ── Handler Dispatch Tests ──────────────────────────────────────────────────

describe("command handler dispatch", () => {
  it("dispatches to registered handler on allowed command", () => {
    const deployDir = tmpDeployDir();
    const { publicKey, privateKey } = generateTestKeys();
    const command = signCommand(
      { id: "cmd-hnd-001", type: "health-check", createdAt: "2026-03-19T10:00:00Z" },
      privateKey,
    );

    let handlerCalled = false;
    const handlers = {
      "health-check": () => {
        handlerCalled = true;
        return { success: true };
      },
    };

    enqueueCommand(deployDir, command);
    const result = processNextCommand(deployDir, "managed", publicKey, {
      ...TEST_VERIFY,
      handlers,
    });

    expect(handlerCalled).toBe(true);
    expect(result!.executed).toBe(true);
  });

  it("reports handler failure without crashing", () => {
    const deployDir = tmpDeployDir();
    const { publicKey, privateKey } = generateTestKeys();
    const command = signCommand(
      { id: "cmd-hnd-002", type: "health-check", createdAt: "2026-03-19T10:00:00Z" },
      privateKey,
    );

    const handlers = {
      "health-check": () => ({ success: false, error: "disk full" }),
    };

    enqueueCommand(deployDir, command);
    const result = processNextCommand(deployDir, "managed", publicKey, {
      ...TEST_VERIFY,
      handlers,
    });

    expect(result!.executed).toBe(false);
    expect(result!.error).toContain("Handler failed");
    expect(result!.error).toContain("disk full");
  });

  it("catches handler exceptions", () => {
    const deployDir = tmpDeployDir();
    const { publicKey, privateKey } = generateTestKeys();
    const command = signCommand(
      { id: "cmd-hnd-003", type: "health-check", createdAt: "2026-03-19T10:00:00Z" },
      privateKey,
    );

    const handlers = {
      "health-check": () => {
        throw new Error("unexpected failure");
      },
    };

    enqueueCommand(deployDir, command);
    const result = processNextCommand(deployDir, "managed", publicKey, {
      ...TEST_VERIFY,
      handlers,
    });

    expect(result!.executed).toBe(false);
    expect(result!.error).toContain("Handler error");
    expect(result!.error).toContain("unexpected failure");
  });

  it("executes without handler when none registered (backward compatible)", () => {
    const deployDir = tmpDeployDir();
    const { publicKey, privateKey } = generateTestKeys();
    const command = signCommand(
      { id: "cmd-hnd-004", type: "health-check", createdAt: "2026-03-19T10:00:00Z" },
      privateKey,
    );

    enqueueCommand(deployDir, command);
    const result = processNextCommand(deployDir, "managed", publicKey, TEST_VERIFY);

    expect(result!.executed).toBe(true);
    expect(result!.disposition).toBe("allowed");
  });

  it("does not dispatch handler for blocked commands", () => {
    const deployDir = tmpDeployDir();
    const { publicKey, privateKey } = generateTestKeys();
    const command = signCommand(
      { id: "cmd-hnd-005", type: "health-check", createdAt: "2026-03-19T10:00:00Z" },
      privateKey,
    );

    let handlerCalled = false;
    const handlers = {
      "health-check": () => {
        handlerCalled = true;
        return { success: true };
      },
    };

    enqueueCommand(deployDir, command);
    processNextCommand(deployDir, "paranoid", publicKey, {
      ...TEST_VERIFY,
      handlers,
    });

    expect(handlerCalled).toBe(false);
  });
});

// ── Manifest Version Validation ─────────────────────────────────────────────

describe("manifest version validation", () => {
  describe("trust mode state", () => {
    it("throws on unsupported version", () => {
      const deployDir = tmpDeployDir();
      writeFileSync(
        join(deployDir, "cloud", "trust-mode.json"),
        JSON.stringify({ version: 2, mode: "paranoid", connected: false, changedAt: "2026-01-01T00:00:00Z" }),
      );
      expect(() => readTrustModeState(deployDir)).toThrow(
        /Unsupported trust mode state version 2 \(expected 1\)/,
      );
    });

    it("throws on missing version field", () => {
      const deployDir = tmpDeployDir();
      writeFileSync(
        join(deployDir, "cloud", "trust-mode.json"),
        JSON.stringify({ mode: "paranoid", connected: false, changedAt: "2026-01-01T00:00:00Z" }),
      );
      expect(() => readTrustModeState(deployDir)).toThrow(
        /Unsupported trust mode state version undefined \(expected 1\)/,
      );
    });
  });

  describe("heartbeat state", () => {
    it("throws on unsupported version", () => {
      const deployDir = tmpDeployDir();
      writeFileSync(
        join(deployDir, "cloud", "heartbeat.json"),
        JSON.stringify({ version: 99, consecutiveFailures: 0 }),
      );
      expect(() => readHeartbeatState(deployDir)).toThrow(
        /Unsupported heartbeat state version 99 \(expected 1\)/,
      );
    });

    it("throws on missing version field", () => {
      const deployDir = tmpDeployDir();
      writeFileSync(
        join(deployDir, "cloud", "heartbeat.json"),
        JSON.stringify({ consecutiveFailures: 0 }),
      );
      expect(() => readHeartbeatState(deployDir)).toThrow(
        /Unsupported heartbeat state version undefined \(expected 1\)/,
      );
    });
  });

  describe("command queue state", () => {
    it("throws on unsupported version", () => {
      const deployDir = tmpDeployDir();
      writeFileSync(
        join(deployDir, "cloud", "commands.json"),
        JSON.stringify({ version: 3, pending: [], history: [] }),
      );
      expect(() => readQueueState(deployDir)).toThrow(
        /Unsupported command queue state version 3 \(expected 1\)/,
      );
    });

    it("throws on missing version field", () => {
      const deployDir = tmpDeployDir();
      writeFileSync(
        join(deployDir, "cloud", "commands.json"),
        JSON.stringify({ pending: [], history: [] }),
      );
      expect(() => readQueueState(deployDir)).toThrow(
        /Unsupported command queue state version undefined \(expected 1\)/,
      );
    });
  });
});
