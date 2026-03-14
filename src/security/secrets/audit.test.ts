import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { emitSecretAuditEvent } from "./audit.js";

describe("emitSecretAuditEvent", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "audit-test-"));
  });

  it("writes a JSONL audit event", async () => {
    const envPath = join(tmpDir, ".env");
    await emitSecretAuditEvent(envPath, "rotated", "MY_KEY");

    const auditPath = join(tmpDir, ".env.audit");
    const content = await readFile(auditPath, "utf-8");
    const lines = content.trim().split("\n");

    expect(lines).toHaveLength(1);

    const event = JSON.parse(lines[0]);
    expect(event.event).toBe("rotated");
    expect(event.secret_name).toBe("MY_KEY");
    expect(event.timestamp).toBeTruthy();
  });

  it("appends multiple events", async () => {
    const envPath = join(tmpDir, ".env");
    await emitSecretAuditEvent(envPath, "added", "KEY_A");
    await emitSecretAuditEvent(envPath, "rotated", "KEY_A");
    await emitSecretAuditEvent(envPath, "revoked", "KEY_A");

    const auditPath = join(tmpDir, ".env.audit");
    const content = await readFile(auditPath, "utf-8");
    const lines = content.trim().split("\n");

    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).event).toBe("added");
    expect(JSON.parse(lines[1]).event).toBe("rotated");
    expect(JSON.parse(lines[2]).event).toBe("revoked");
  });
});
