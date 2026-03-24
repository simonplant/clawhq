import { describe, expect, it } from "vitest";

import { generateCloudInit } from "./cloud-init.js";
import { generateSnapshotInit } from "./snapshot-init.js";

// ── Cloud-init SSH injection ─────────────────────────────────────────────────

describe("generateCloudInit", () => {
  it("injects SSH public key into authorized_keys when provided", () => {
    const script = generateCloudInit({
      name: "test-vm",
      sshPublicKey: "ssh-ed25519 AAAA_TEST_KEY",
    });

    expect(script).toContain("mkdir -p /root/.ssh");
    expect(script).toContain("chmod 700 /root/.ssh");
    expect(script).toContain("echo 'ssh-ed25519 AAAA_TEST_KEY' >> /root/.ssh/authorized_keys");
    expect(script).toContain("chmod 600 /root/.ssh/authorized_keys");
  });

  it("omits SSH key block when sshPublicKey is not provided", () => {
    const script = generateCloudInit({ name: "test-vm" });

    expect(script).not.toContain("authorized_keys");
    expect(script).not.toContain("/root/.ssh");
  });
});

// ── Snapshot-init SSH injection ──────────────────────────────────────────────

describe("generateSnapshotInit", () => {
  it("injects SSH public key into authorized_keys when provided", () => {
    const script = generateSnapshotInit({
      name: "test-vm",
      sshPublicKey: "ssh-ed25519 BBBB_TEST_KEY",
    });

    expect(script).toContain("mkdir -p /root/.ssh");
    expect(script).toContain("chmod 700 /root/.ssh");
    expect(script).toContain("echo 'ssh-ed25519 BBBB_TEST_KEY' >> /root/.ssh/authorized_keys");
    expect(script).toContain("chmod 600 /root/.ssh/authorized_keys");
  });

  it("omits SSH key block when sshPublicKey is not provided", () => {
    const script = generateSnapshotInit({ name: "test-vm" });

    expect(script).not.toContain("authorized_keys");
    expect(script).not.toContain("/root/.ssh");
  });
});
