import { describe, expect, it } from "vitest";

import { OPENCLAW_CONTAINER_WORKSPACE } from "../../config/paths.js";

import { computeStage1Hash, computeStage2Hash } from "./cache.js";
import { generateCompose } from "./compose.js";
import {
  generateStage1Dockerfile,
  generateStage2Dockerfile,
  validateBinaryDestPath,
  validateBinaryUrl,
} from "./dockerfile.js";
import { createManifest } from "./manifest.js";
import { DEFAULT_POSTURE, getPostureConfig, POSTURE_LEVELS } from "./posture.js";
import type { Stage1Config, Stage2Config } from "./types.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function stage1Config(): Stage1Config {
  return {
    baseImage: "openclaw/openclaw:latest",
    aptPackages: ["tmux", "ffmpeg", "jq", "ripgrep"],
  };
}

function stage2Config(): Stage2Config {
  return {
    binaries: [
      {
        name: "himalaya",
        url: "https://github.com/pimalaya/himalaya/releases/download/v1.0.0/himalaya-linux-amd64",
        destPath: "/usr/local/bin/himalaya",
      },
    ],
    workspaceTools: ["email", "tasks", "quote"],
    skills: ["morning-brief", "construct"],
  };
}

// ── Posture Tests ───────────────────────────────────────────────────────────

describe("posture", () => {
  it("defaults to standard", () => {
    expect(DEFAULT_POSTURE).toBe("standard");
  });

  it("has four posture levels", () => {
    expect(POSTURE_LEVELS).toEqual(["minimal", "standard", "hardened", "paranoid"]);
  });

  it("all postures drop ALL capabilities", () => {
    for (const level of POSTURE_LEVELS) {
      const config = getPostureConfig(level);
      expect(config.capDrop).toContain("ALL");
    }
  });

  it("all postures use no-new-privileges", () => {
    for (const level of POSTURE_LEVELS) {
      const config = getPostureConfig(level);
      expect(config.securityOpt).toContain("no-new-privileges");
    }
  });

  it("all postures run as UID 1000", () => {
    for (const level of POSTURE_LEVELS) {
      const config = getPostureConfig(level);
      expect(config.user).toBe("1000:1000");
    }
  });

  it("standard posture has read-only rootfs", () => {
    const config = getPostureConfig("standard");
    expect(config.readOnlyRootfs).toBe(true);
  });

  it("minimal posture allows writable rootfs", () => {
    const config = getPostureConfig("minimal");
    expect(config.readOnlyRootfs).toBe(false);
  });

  it("resource limits decrease from standard to paranoid", () => {
    const standard = getPostureConfig("standard");
    const hardened = getPostureConfig("hardened");
    const paranoid = getPostureConfig("paranoid");

    expect(standard.resources.cpus).toBeGreaterThan(hardened.resources.cpus);
    expect(hardened.resources.cpus).toBeGreaterThan(paranoid.resources.cpus);
    expect(standard.resources.memoryMb).toBeGreaterThan(hardened.resources.memoryMb);
    expect(hardened.resources.memoryMb).toBeGreaterThan(paranoid.resources.memoryMb);
  });

  it("minimal posture has no resource limits", () => {
    const config = getPostureConfig("minimal");
    expect(config.resources.cpus).toBe(0);
    expect(config.resources.memoryMb).toBe(0);
  });

  it("ICC disabled for standard and above", () => {
    expect(getPostureConfig("minimal").iccDisabled).toBe(false);
    expect(getPostureConfig("standard").iccDisabled).toBe(true);
    expect(getPostureConfig("hardened").iccDisabled).toBe(true);
    expect(getPostureConfig("paranoid").iccDisabled).toBe(true);
  });
});

// ── Dockerfile Tests ────────────────────────────────────────────────────────

describe("generateStage1Dockerfile", () => {
  it("uses the specified base image", () => {
    const df = generateStage1Dockerfile(stage1Config());
    expect(df).toContain("FROM openclaw/openclaw:latest");
  });

  it("installs apt packages in a single RUN layer", () => {
    const df = generateStage1Dockerfile(stage1Config());
    expect(df).toContain("apt-get install");
    expect(df).toContain("tmux");
    expect(df).toContain("ffmpeg");
    expect(df).toContain("jq");
    expect(df).toContain("ripgrep");
  });

  it("cleans up apt cache", () => {
    const df = generateStage1Dockerfile(stage1Config());
    expect(df).toContain("apt-get clean");
    expect(df).toContain("rm -rf /var/lib/apt/lists/*");
  });

  it("skips apt install when no packages", () => {
    const df = generateStage1Dockerfile({ baseImage: "openclaw:latest", aptPackages: [] });
    expect(df).not.toContain("apt-get install");
  });

  it("creates workspace directory with UID 1000 ownership", () => {
    const df = generateStage1Dockerfile(stage1Config());
    expect(df).toContain(`mkdir -p ${OPENCLAW_CONTAINER_WORKSPACE}`);
    expect(df).toContain("chown -R 1000:1000");
  });
});

describe("generateStage2Dockerfile", () => {
  it("uses the stage1 tag as base", () => {
    const df = generateStage2Dockerfile("openclaw:local", stage2Config());
    expect(df).toContain("FROM openclaw:local");
  });

  it("installs binary tools", () => {
    const df = generateStage2Dockerfile("openclaw:local", stage2Config());
    expect(df).toContain("himalaya");
    expect(df).toContain("curl -fsSL");
    expect(df).toContain("chmod +x");
  });

  it("copies workspace tools", () => {
    const df = generateStage2Dockerfile("openclaw:local", stage2Config());
    expect(df).toContain("COPY --chown=1000:1000 workspace/tools/email");
    expect(df).toContain("COPY --chown=1000:1000 workspace/tools/tasks");
    expect(df).toContain("COPY --chown=1000:1000 workspace/tools/quote");
  });

  it("copies skills", () => {
    const df = generateStage2Dockerfile("openclaw:local", stage2Config());
    expect(df).toContain("COPY --chown=1000:1000 workspace/skills/morning-brief");
    expect(df).toContain("COPY --chown=1000:1000 workspace/skills/construct");
  });

  it("sets USER to 1000:1000", () => {
    const df = generateStage2Dockerfile("openclaw:local", stage2Config());
    expect(df).toContain("USER 1000:1000");
  });
});

// ── Binary Validation Tests ─────────────────────────────────────────────

describe("validateBinaryUrl", () => {
  it("accepts valid https URLs", () => {
    expect(() => validateBinaryUrl("https://github.com/pimalaya/himalaya/releases/download/v1.0.0/himalaya")).not.toThrow();
  });

  it("rejects http URLs", () => {
    expect(() => validateBinaryUrl("http://example.com/binary")).toThrow("must use https://");
  });

  it("rejects ftp URLs", () => {
    expect(() => validateBinaryUrl("ftp://example.com/binary")).toThrow("must use https://");
  });

  it("rejects invalid URLs", () => {
    expect(() => validateBinaryUrl("not-a-url")).toThrow("Invalid binary URL");
  });

  it("rejects empty string", () => {
    expect(() => validateBinaryUrl("")).toThrow("Invalid binary URL");
  });
});

describe("validateBinaryDestPath", () => {
  it("accepts safe absolute paths", () => {
    expect(() => validateBinaryDestPath("/usr/local/bin/himalaya")).not.toThrow();
  });

  it("rejects relative paths", () => {
    expect(() => validateBinaryDestPath("usr/local/bin/himalaya")).toThrow("absolute path");
  });

  it("rejects paths with newlines", () => {
    expect(() => validateBinaryDestPath("/usr/local/bin/bad\nRUN malicious")).toThrow("unsafe characters");
  });

  it("rejects paths with double quotes", () => {
    expect(() => validateBinaryDestPath('/usr/local/bin/"bad')).toThrow("unsafe characters");
  });

  it("rejects paths with single quotes", () => {
    expect(() => validateBinaryDestPath("/usr/local/bin/'bad")).toThrow("unsafe characters");
  });

  it("rejects paths with backslashes", () => {
    expect(() => validateBinaryDestPath("/usr/local/bin\\bad")).toThrow("unsafe characters");
  });

  it("rejects paths with backticks", () => {
    expect(() => validateBinaryDestPath("/usr/local/bin/`whoami`")).toThrow("unsafe characters");
  });

  it("rejects paths with dollar signs", () => {
    expect(() => validateBinaryDestPath("/usr/local/bin/$HOME")).toThrow("unsafe characters");
  });
});

describe("generateStage2Dockerfile binary validation", () => {
  it("rejects binaries with http URLs", () => {
    const config: Stage2Config = {
      binaries: [{ name: "bad", url: "http://evil.com/bin", destPath: "/usr/local/bin/bad" }],
      workspaceTools: [],
      skills: [],
    };
    expect(() => generateStage2Dockerfile("base:tag", config)).toThrow("must use https://");
  });

  it("rejects binaries with unsafe destPath", () => {
    const config: Stage2Config = {
      binaries: [{ name: "bad", url: "https://example.com/bin", destPath: "/bin/bad\nRUN evil" }],
      workspaceTools: [],
      skills: [],
    };
    expect(() => generateStage2Dockerfile("base:tag", config)).toThrow("unsafe characters");
  });
});

// ── Compose Tests ───────────────────────────────────────────────────────────

describe("generateCompose", () => {
  it("applies standard posture by default", () => {
    const posture = getPostureConfig("standard");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq");

    expect(compose.services.openclaw.cap_drop).toContain("ALL");
    expect(compose.services.openclaw.security_opt).toContain("no-new-privileges");
    expect(compose.services.openclaw.read_only).toBe(true);
    expect(compose.services.openclaw.user).toBe("1000:1000");
  });

  it("mounts config files read-only (LM-12)", () => {
    const posture = getPostureConfig("standard");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq");

    const volumes = compose.services.openclaw.volumes;
    const configVol = volumes.find((v) => v.includes("openclaw.json"));
    const credsVol = volumes.find((v) => v.includes("credentials.json"));

    expect(configVol).toContain(":ro");
    expect(credsVol).toContain(":ro");
  });

  it("mounts identity files read-only", () => {
    const posture = getPostureConfig("standard");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq");

    const volumes = compose.services.openclaw.volumes;
    const identityVol = volumes.find((v) => v.includes("identity"));
    expect(identityVol).toContain(":ro");
  });

  it("disables ICC for standard posture (LM-13)", () => {
    const posture = getPostureConfig("standard");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq");

    const net = compose.networks["clawhq_net"];
    expect(net.driver_opts?.["com.docker.network.bridge.enable_icc"]).toBe("false");
  });

  it("does not disable ICC for minimal posture", () => {
    const posture = getPostureConfig("minimal");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq");

    const net = compose.networks["clawhq_net"];
    expect(net.driver_opts).toBeUndefined();
  });

  it("applies resource limits for standard posture", () => {
    const posture = getPostureConfig("standard");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq");

    expect(compose.services.openclaw.deploy).toBeDefined();
    expect(compose.services.openclaw.deploy?.resources.limits.cpus).toBe("4");
    expect(compose.services.openclaw.deploy?.resources.limits.memory).toBe("4096M");
  });

  it("omits resource limits for minimal posture", () => {
    const posture = getPostureConfig("minimal");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq");

    expect(compose.services.openclaw.deploy).toBeUndefined();
  });

  it("declares the network used by the service (LM-10)", () => {
    const posture = getPostureConfig("standard");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq");

    const serviceNetworks = compose.services.openclaw.networks;
    for (const net of serviceNetworks) {
      expect(compose.networks).toHaveProperty(net);
    }
  });

  it("configures tmpfs mount per posture", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq");

    expect(compose.services.openclaw.tmpfs[0]).toContain("128m");
    expect(compose.services.openclaw.tmpfs[0]).toContain("noexec");
  });
});

// ── Cache Detection Tests ───────────────────────────────────────────────────

describe("cache detection", () => {
  it("produces deterministic stage1 hash", () => {
    const hash1 = computeStage1Hash(stage1Config());
    const hash2 = computeStage1Hash(stage1Config());
    expect(hash1).toBe(hash2);
  });

  it("produces deterministic stage2 hash", () => {
    const hash1 = computeStage2Hash(stage2Config());
    const hash2 = computeStage2Hash(stage2Config());
    expect(hash1).toBe(hash2);
  });

  it("stage1 hash changes when base image changes", () => {
    const config = stage1Config();
    const hash1 = computeStage1Hash(config);
    const hash2 = computeStage1Hash({ ...config, baseImage: "openclaw:v2" });
    expect(hash1).not.toBe(hash2);
  });

  it("stage1 hash changes when packages change", () => {
    const config = stage1Config();
    const hash1 = computeStage1Hash(config);
    const hash2 = computeStage1Hash({ ...config, aptPackages: ["tmux", "ffmpeg"] });
    expect(hash1).not.toBe(hash2);
  });

  it("stage1 hash is order-independent for packages", () => {
    const hash1 = computeStage1Hash({ baseImage: "base:v1", aptPackages: ["a", "b", "c"] });
    const hash2 = computeStage1Hash({ baseImage: "base:v1", aptPackages: ["c", "a", "b"] });
    expect(hash1).toBe(hash2);
  });

  it("stage2 hash changes when binaries change", () => {
    const config = stage2Config();
    const hash1 = computeStage2Hash(config);
    const hash2 = computeStage2Hash({ ...config, binaries: [] });
    expect(hash1).not.toBe(hash2);
  });

  it("stage2 hash changes when tools change", () => {
    const config = stage2Config();
    const hash1 = computeStage2Hash(config);
    const hash2 = computeStage2Hash({ ...config, workspaceTools: ["email"] });
    expect(hash1).not.toBe(hash2);
  });

  it("stage2 hash is order-independent for tools", () => {
    const hash1 = computeStage2Hash({ binaries: [], workspaceTools: ["a", "b"], skills: [] });
    const hash2 = computeStage2Hash({ binaries: [], workspaceTools: ["b", "a"], skills: [] });
    expect(hash1).toBe(hash2);
  });

  it("hash is 16 characters", () => {
    const hash = computeStage1Hash(stage1Config());
    expect(hash).toHaveLength(16);
  });
});

// ── Manifest Tests ──────────────────────────────────────────────────────────

describe("createManifest", () => {
  it("computes total size from layers", () => {
    const manifest = createManifest({
      imageId: "sha256:abc123",
      imageTag: "openclaw:custom",
      imageHash: "abc123",
      layers: [
        { id: "layer1", stage: "stage1", sizeBytes: 100_000_000, createdAt: "2026-01-01T00:00:00Z" },
        { id: "layer2", stage: "stage2", sizeBytes: 50_000_000, createdAt: "2026-01-01T00:00:00Z" },
      ],
      posture: "standard",
      stage1Hash: "aaaa",
      stage2Hash: "bbbb",
    });

    expect(manifest.totalSizeBytes).toBe(150_000_000);
  });

  it("records posture in manifest", () => {
    const manifest = createManifest({
      imageId: "sha256:abc123",
      imageTag: "openclaw:custom",
      imageHash: "abc123",
      layers: [],
      posture: "hardened",
      stage1Hash: "aaaa",
      stage2Hash: "bbbb",
    });

    expect(manifest.posture).toBe("hardened");
  });

  it("records stage hashes", () => {
    const manifest = createManifest({
      imageId: "sha256:abc123",
      imageTag: "openclaw:custom",
      imageHash: "abc123",
      layers: [],
      posture: "standard",
      stage1Hash: "stage1hash123456",
      stage2Hash: "stage2hash123456",
    });

    expect(manifest.stage1Hash).toBe("stage1hash123456");
    expect(manifest.stage2Hash).toBe("stage2hash123456");
  });

  it("sets builtAt timestamp", () => {
    const before = new Date().toISOString();
    const manifest = createManifest({
      imageId: "sha256:abc123",
      imageTag: "openclaw:custom",
      imageHash: "abc123",
      layers: [],
      posture: "standard",
      stage1Hash: "aaaa",
      stage2Hash: "bbbb",
    });
    const after = new Date().toISOString();

    expect(manifest.builtAt >= before).toBe(true);
    expect(manifest.builtAt <= after).toBe(true);
  });
});
