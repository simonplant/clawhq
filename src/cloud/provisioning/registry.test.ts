import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addInstance,
  findInstance,
  findInstanceByName,
  instanceRegistryPath,
  readInstanceRegistry,
  removeInstance,
  updateInstanceSshHostKey,
  updateInstanceStatus,
} from "./registry.js";
import type { CloudProvider } from "./types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "registry-test-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function registryMode(): number {
  const path = instanceRegistryPath(testDir);
  return statSync(path).mode & 0o777;
}

const providers: CloudProvider[] = ["aws", "digitalocean", "gcp", "hetzner"];

// ── Tests ────────────────────────────────────────────────────────────────────

describe("instance registry", () => {
  it("returns empty registry when file does not exist", () => {
    const reg = readInstanceRegistry(testDir);
    expect(reg).toEqual({ version: 1, instances: [] });
  });

  it("adds an instance and reads it back", () => {
    const inst = addInstance(testDir, {
      name: "test-vm",
      provider: "digitalocean",
      providerInstanceId: "drop-123",
      ipAddress: "10.0.0.1",
      region: "nyc1",
      size: "s-1vcpu-1gb",
      status: "active",
    });

    expect(inst.name).toBe("test-vm");
    expect(inst.provider).toBe("digitalocean");

    const reg = readInstanceRegistry(testDir);
    expect(reg.instances).toHaveLength(1);
    expect(reg.instances[0].id).toBe(inst.id);
  });

  it("updates instance status", () => {
    const inst = addInstance(testDir, {
      name: "test-vm",
      provider: "aws",
      providerInstanceId: "i-abc123",
      ipAddress: "10.0.0.2",
      region: "us-east-1",
      size: "t3.micro",
      status: "provisioning",
    });

    const updated = updateInstanceStatus(testDir, inst.id, "active", "10.0.0.3");
    expect(updated?.status).toBe("active");
    expect(updated?.ipAddress).toBe("10.0.0.3");
  });

  it("removes an instance", () => {
    const inst = addInstance(testDir, {
      name: "test-vm",
      provider: "gcp",
      providerInstanceId: "gcp-123",
      ipAddress: "10.0.0.4",
      region: "us-central1",
      size: "e2-micro",
      status: "active",
    });

    expect(removeInstance(testDir, inst.id)).toBe(true);
    expect(readInstanceRegistry(testDir).instances).toHaveLength(0);
  });

  it("finds instance by name", () => {
    addInstance(testDir, {
      name: "named-vm",
      provider: "hetzner",
      providerInstanceId: "hz-456",
      ipAddress: "10.0.0.5",
      region: "fsn1",
      size: "cx11",
      status: "active",
    });

    expect(findInstanceByName(testDir, "named-vm")).toBeDefined();
    expect(findInstanceByName(testDir, "nonexistent")).toBeUndefined();
  });

  it("finds instance by id", () => {
    const inst = addInstance(testDir, {
      name: "id-vm",
      provider: "aws",
      providerInstanceId: "i-xyz",
      ipAddress: "10.0.0.6",
      region: "eu-west-1",
      size: "t3.nano",
      status: "active",
    });

    expect(findInstance(testDir, inst.id)).toBeDefined();
    expect(findInstance(testDir, "bad-id")).toBeUndefined();
  });

  // ── sshKeyPath persistence ─────────────────────────────────────────────────

  it("persists sshKeyPath when provided", () => {
    const inst = addInstance(testDir, {
      name: "ssh-vm",
      provider: "digitalocean",
      providerInstanceId: "drop-ssh-1",
      ipAddress: "10.0.0.20",
      region: "nyc1",
      size: "s-1vcpu-1gb",
      status: "active",
      sshKeyPath: "/home/user/.clawhq/keys/test-id.pem",
    });

    expect(inst.sshKeyPath).toBe("/home/user/.clawhq/keys/test-id.pem");

    const found = findInstance(testDir, inst.id);
    expect(found?.sshKeyPath).toBe("/home/user/.clawhq/keys/test-id.pem");
  });

  it("omits sshKeyPath when not provided (backward compat)", () => {
    const inst = addInstance(testDir, {
      name: "legacy-vm",
      provider: "aws",
      providerInstanceId: "i-legacy",
      ipAddress: "10.0.0.21",
      region: "us-east-1",
      size: "t3.micro",
      status: "active",
    });

    expect(inst.sshKeyPath).toBeUndefined();
  });

  it("uses caller-provided id when given", () => {
    const inst = addInstance(testDir, {
      id: "custom-uuid-12345",
      name: "id-vm",
      provider: "gcp",
      providerInstanceId: "gcp-id-1",
      ipAddress: "10.0.0.22",
      region: "us-central1",
      size: "e2-micro",
      status: "active",
    });

    expect(inst.id).toBe("custom-uuid-12345");
  });

  // ── sshHostKey persistence via updateInstanceSshHostKey ─────────────────

  it("stores sshHostKey via updateInstanceSshHostKey", () => {
    const inst = addInstance(testDir, {
      name: "key-vm",
      provider: "digitalocean",
      providerInstanceId: "drop-key-1",
      ipAddress: "10.0.0.30",
      region: "nyc1",
      size: "s-1vcpu-1gb",
      status: "active",
    });

    expect(inst.sshHostKey).toBeUndefined();

    const updated = updateInstanceSshHostKey(
      testDir,
      inst.id,
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey",
    );

    expect(updated?.sshHostKey).toBe("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey");

    // Verify persisted to disk
    const found = findInstance(testDir, inst.id);
    expect(found?.sshHostKey).toBe("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey");
  });

  it("returns undefined when updating sshHostKey for nonexistent instance", () => {
    addInstance(testDir, {
      name: "other-vm",
      provider: "aws",
      providerInstanceId: "i-other",
      ipAddress: "10.0.0.31",
      region: "us-east-1",
      size: "t3.micro",
      status: "active",
    });

    const result = updateInstanceSshHostKey(testDir, "nonexistent-id", "ssh-ed25519 key");
    expect(result).toBeUndefined();
  });

  it("preserves mode 0600 after updateInstanceSshHostKey", () => {
    const inst = addInstance(testDir, {
      name: "perm-vm",
      provider: "digitalocean",
      providerInstanceId: "drop-perm-1",
      ipAddress: "10.0.0.32",
      region: "nyc1",
      size: "s-1vcpu-1gb",
      status: "active",
    });

    updateInstanceSshHostKey(testDir, inst.id, "ssh-ed25519 AAAAC3key");
    expect(registryMode()).toBe(0o600);
  });

  // ── AC3: All four providers confirm registry written with 0600 ───────────

  describe("file permissions (mode 0600)", () => {
    for (const provider of providers) {
      it(`writes registry with mode 0600 after addInstance (${provider})`, () => {
        addInstance(testDir, {
          name: `${provider}-vm`,
          provider,
          providerInstanceId: `${provider}-001`,
          ipAddress: "10.0.0.10",
          region: "test-region",
          size: "test-size",
          status: "provisioning",
        });

        expect(registryMode()).toBe(0o600);
      });
    }

    for (const provider of providers) {
      it(`preserves mode 0600 after updateInstanceStatus (${provider})`, () => {
        const inst = addInstance(testDir, {
          name: `${provider}-vm`,
          provider,
          providerInstanceId: `${provider}-002`,
          ipAddress: "10.0.0.11",
          region: "test-region",
          size: "test-size",
          status: "provisioning",
        });

        updateInstanceStatus(testDir, inst.id, "active", "10.0.0.12");
        expect(registryMode()).toBe(0o600);
      });
    }

    for (const provider of providers) {
      it(`preserves mode 0600 after removeInstance (${provider})`, () => {
        const inst = addInstance(testDir, {
          name: `${provider}-vm`,
          provider,
          providerInstanceId: `${provider}-003`,
          ipAddress: "10.0.0.13",
          region: "test-region",
          size: "test-size",
          status: "active",
        });

        removeInstance(testDir, inst.id);
        expect(registryMode()).toBe(0o600);
      });
    }
  });
});
