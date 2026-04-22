import { describe, expect, it } from "vitest";

import { agentImageTag, agentNetworkName } from "../../config/defaults.js";

import { formatHashMismatch, validateBinarySha256 } from "./binary-manifest.js";
import { serializeYaml } from "./build.js";
import { computeStage1Hash, computeStage2Hash } from "./cache.js";
import { generateCompose } from "./compose.js";
import {
  generateStage2Dockerfile,
  validateBinaryDestPath,
  validateBinaryUrl,
} from "./dockerfile.js";
import { createManifest } from "./manifest.js";
import { DEFAULT_POSTURE, getPostureConfig, POSTURE_LEVELS } from "./posture.js";
import type { Stage1Config, Stage2Config } from "./types.js";

// ── Test SHA256 Hashes ─────────────────────────────────────────────────────

const VALID_SHA256 = "a".repeat(64);
const VALID_SHA256_B = "b".repeat(64);

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
        sha256: VALID_SHA256,
      },
    ],
    workspaceTools: ["email", "tasks", "quote"],
    skills: ["morning-brief", "construct"],
  };
}

// ── Posture Tests ───────────────────────────────────────────────────────────

describe("posture", () => {
  it("defaults to hardened", () => {
    expect(DEFAULT_POSTURE).toBe("hardened");  // hardened is the default;
  });

  it("has three posture levels", () => {
    expect(POSTURE_LEVELS).toEqual(["minimal", "hardened", "under-attack"]);
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

  it("hardened posture has read-only rootfs", () => {
    const config = getPostureConfig("hardened");
    expect(config.readOnlyRootfs).toBe(true);
  });

  it("minimal posture allows writable rootfs", () => {
    const config = getPostureConfig("minimal");
    expect(config.readOnlyRootfs).toBe(false);
  });

  it("all non-minimal postures have same resource limits", () => {
    const hardened = getPostureConfig("hardened");
    const underAttack = getPostureConfig("under-attack");

    expect(hardened.resources.cpus).toBe(underAttack.resources.cpus);
    expect(hardened.resources.memoryMb).toBe(underAttack.resources.memoryMb);
  });

  it("minimal posture has no resource limits", () => {
    const config = getPostureConfig("minimal");
    expect(config.resources.cpus).toBe(0);
    expect(config.resources.memoryMb).toBe(0);
  });

  it("hardened and under-attack enable gVisor runtime", () => {
    expect(getPostureConfig("minimal").runtime).toBeUndefined();
    expect(getPostureConfig("hardened").runtime).toBe("runsc");
    expect(getPostureConfig("under-attack").runtime).toBe("runsc");
  });

  it("under-attack enables air-gap and noexec tmpfs", () => {
    expect(getPostureConfig("hardened").airGap).toBe(false);
    expect(getPostureConfig("under-attack").airGap).toBe(true);
    expect(getPostureConfig("under-attack").tmpfs.options).toContain("noexec");
  });

  it("ICC disabled for hardened and above", () => {
    expect(getPostureConfig("minimal").iccDisabled).toBe(false);
    expect(getPostureConfig("hardened").iccDisabled).toBe(true);
    expect(getPostureConfig("under-attack").iccDisabled).toBe(true);
  });
});

// ── Dockerfile Tests ────────────────────────────────────────────────────────

describe("generateStage2Dockerfile", () => {
  it("uses the stage1 tag as base", () => {
    const df = generateStage2Dockerfile("openclaw:local", stage2Config());
    expect(df).toContain("FROM openclaw:local");
  });

  it("installs binary tools with SHA256 verification", () => {
    const df = generateStage2Dockerfile("openclaw:local", stage2Config());
    expect(df).toContain("himalaya");
    expect(df).toContain("curl -fsSL");
    expect(df).toContain("sha256sum -c");
    expect(df).toContain("chmod +x");
    expect(df).toContain(VALID_SHA256);
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

  it("installs llm-wiki CLI from a vendored tarball", () => {
    const df = generateStage2Dockerfile("openclaw:local", stage2Config());
    // Must COPY the vendored tarball from the build context
    expect(df).toMatch(/COPY vendor\/llm-wiki-[\d.]+\.tgz/);
    // Must install globally from the local path (not a remote repo — upstream is private)
    expect(df).toMatch(/npm install -g "\/opt\/vendor\/llm-wiki-[\d.]+\.tgz"/);
    // Must verify the CLI is available post-install so a broken tarball fails the build
    expect(df).toContain("llm-wiki --version");
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
      binaries: [{ name: "bad", url: "http://evil.com/bin", destPath: "/usr/local/bin/bad", sha256: VALID_SHA256 }],
      workspaceTools: [],
      skills: [],
    };
    expect(() => generateStage2Dockerfile("base:tag", config)).toThrow("must use https://");
  });

  it("rejects binaries with unsafe destPath", () => {
    const config: Stage2Config = {
      binaries: [{ name: "bad", url: "https://example.com/bin", destPath: "/bin/bad\nRUN evil", sha256: VALID_SHA256 }],
      workspaceTools: [],
      skills: [],
    };
    expect(() => generateStage2Dockerfile("base:tag", config)).toThrow("unsafe characters");
  });

  it("rejects binaries with invalid SHA256", () => {
    const config: Stage2Config = {
      binaries: [{ name: "bad", url: "https://example.com/bin", destPath: "/usr/local/bin/bad", sha256: "not-a-hash" }],
      workspaceTools: [],
      skills: [],
    };
    expect(() => generateStage2Dockerfile("base:tag", config)).toThrow("Invalid SHA256");
  });

  it("rejects binaries with uppercase SHA256", () => {
    const config: Stage2Config = {
      binaries: [{ name: "bad", url: "https://example.com/bin", destPath: "/usr/local/bin/bad", sha256: "A".repeat(64) }],
      workspaceTools: [],
      skills: [],
    };
    expect(() => generateStage2Dockerfile("base:tag", config)).toThrow("Invalid SHA256");
  });

  it("rejects binaries with short SHA256", () => {
    const config: Stage2Config = {
      binaries: [{ name: "bad", url: "https://example.com/bin", destPath: "/usr/local/bin/bad", sha256: "abc123" }],
      workspaceTools: [],
      skills: [],
    };
    expect(() => generateStage2Dockerfile("base:tag", config)).toThrow("Invalid SHA256");
  });
});

// ── Compose Tests ───────────────────────────────────────────────────────────

describe("generateCompose", () => {
  it("applies hardened posture by default", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq");

    expect(compose.services.openclaw.cap_drop).toContain("ALL");
    expect(compose.services.openclaw.security_opt).toContain("no-new-privileges");
    expect(compose.services.openclaw.read_only).toBe(true);
    expect(compose.services.openclaw.user).toBe("1000:1000");
  });

  it("uses read-only rootfs for hardened posture (LM-12)", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq");

    // Config and identity files are protected by read-only rootfs + chattr +i,
    // not individual :ro volume mounts (catch-all dir mount used instead)
    expect(compose.services.openclaw.read_only).toBe(true);
  });

  it("mounts config and workspace as granular volumes (no blanket mount)", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq");

    const volumes = compose.services.openclaw.volumes;
    // No blanket mount — conflicts with tmpfs at /home/node/.openclaw
    expect(volumes).not.toContain("/home/user/.clawhq:/home/node/.openclaw");
    // Granular mounts for config, credentials, workspace, cron
    expect(volumes).toContain("/home/user/.clawhq/engine/openclaw.json:/home/node/.openclaw/openclaw.json:ro");
    expect(volumes).toContain("/home/user/.clawhq/workspace:/home/node/.openclaw/workspace");
  });

  it("disables ICC for hardened posture (LM-13)", () => {
    const posture = getPostureConfig("hardened");
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

  it("applies resource limits for hardened posture", () => {
    const posture = getPostureConfig("hardened");
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
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq");

    const serviceNetworks = compose.services.openclaw.networks;
    for (const net of serviceNetworks) {
      expect(compose.networks).toHaveProperty(net);
    }
  });

  it("configures tmpfs mount per posture", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq");

    expect(compose.services.openclaw.tmpfs[0]).toContain("256m");
    expect(compose.services.openclaw.tmpfs[0]).toContain("nosuid");
  });
});

// ── Multi-Instance Tests ───────────────────────────────────────────────────

describe("agentNetworkName", () => {
  it("returns 'clawhq_net' when instanceName is undefined", () => {
    expect(agentNetworkName()).toBe("clawhq_net");
  });

  it("returns 'clawhq_net' when instanceName is 'default'", () => {
    expect(agentNetworkName("default")).toBe("clawhq_net");
  });

  it("returns 'clawhq_{name}_net' for custom instanceName", () => {
    expect(agentNetworkName("john")).toBe("clawhq_john_net");
  });
});

describe("agentImageTag", () => {
  it("returns 'openclaw:custom' when instanceName is undefined", () => {
    expect(agentImageTag()).toBe("openclaw:custom");
  });

  it("returns 'openclaw:custom' when instanceName is 'default'", () => {
    expect(agentImageTag("default")).toBe("openclaw:custom");
  });

  it("returns 'openclaw:{name}' for custom instanceName", () => {
    expect(agentImageTag("john")).toBe("openclaw:john");
  });
});

describe("generateCompose with custom networkName", () => {
  it("uses custom network name in service and network declaration", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:john", posture, "/home/user/.clawhq/john", "clawhq_john_net");

    expect(compose.services.openclaw.networks).toContain("clawhq_john_net");
    expect(compose.networks).toHaveProperty("clawhq_john_net");
    expect(compose.networks).not.toHaveProperty("clawhq_net");
  });

  it("defaults to 'clawhq_net' when networkName is omitted", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq");

    expect(compose.services.openclaw.networks).toContain("clawhq_net");
    expect(compose.networks).toHaveProperty("clawhq_net");
  });

  it("ICC is disabled on custom network", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:john", posture, "/home/user/.clawhq/john", "clawhq_john_net");

    const net = compose.networks["clawhq_john_net"];
    expect(net.driver_opts?.["com.docker.network.bridge.enable_icc"]).toBe("false");
  });

  it("two instances produce non-colliding artifacts", () => {
    const posture = getPostureConfig("hardened");
    const compose1 = generateCompose("openclaw:john", posture, "/home/user/.clawhq/john", "clawhq_john_net");
    const compose2 = generateCompose("openclaw:jane", posture, "/home/user/.clawhq/jane", "clawhq_jane_net");

    expect(compose1.services.openclaw.image).toBe("openclaw:john");
    expect(compose2.services.openclaw.image).toBe("openclaw:jane");
    expect(Object.keys(compose1.networks)[0]).toBe("clawhq_john_net");
    expect(Object.keys(compose2.networks)[0]).toBe("clawhq_jane_net");
  });
});

// ── Credential Proxy Sidecar Tests ──────────────────────────────────────────

describe("generateCompose with credential proxy", () => {
  it("does not include cred-proxy service by default", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq");
    expect(compose.services["cred-proxy"]).toBeUndefined();
  });

  it("includes cred-proxy service when enableCredProxy is true", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq", "clawhq_net", {
      enableCredProxy: true,
    });
    expect(compose.services["cred-proxy"]).toBeDefined();
  });

  it("cred-proxy runs as non-root with read-only rootfs", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq", "clawhq_net", {
      enableCredProxy: true,
    });
    const proxy = compose.services["cred-proxy"];
    expect(proxy).toBeDefined();
    expect(proxy?.user).toBe("1000:1000");
    expect(proxy?.read_only).toBe(true);
    expect(proxy?.cap_drop).toContain("ALL");
  });

  it("cred-proxy mounts script and routes read-only", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq", "clawhq_net", {
      enableCredProxy: true,
    });
    const proxy = compose.services["cred-proxy"];
    expect(proxy).toBeDefined();
    const scriptVol = proxy?.volumes.find((v) => v.includes("proxy.js"));
    const routesVol = proxy?.volumes.find((v) => v.includes("routes.json"));
    expect(scriptVol).toContain(":ro");
    expect(routesVol).toContain(":ro");
  });

  it("cred-proxy has healthcheck", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq", "clawhq_net", {
      enableCredProxy: true,
    });
    const proxy = compose.services["cred-proxy"];
    expect(proxy).toBeDefined();
    expect(proxy?.healthcheck).toBeDefined();
    expect(proxy?.healthcheck.test[0]).toBe("CMD");
  });

  it("cred-proxy shares the same network as openclaw", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq", "clawhq_net", {
      enableCredProxy: true,
    });
    const proxy = compose.services["cred-proxy"];
    expect(proxy).toBeDefined();
    expect(proxy?.networks).toContain("clawhq_net");
  });

  it("enables ICC when cred-proxy is active (agent must reach proxy)", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq", "clawhq_net", {
      enableCredProxy: true,
    });
    const net = compose.networks["clawhq_net"];
    // ICC should NOT be disabled when proxy is enabled (agent needs to reach proxy)
    expect(net.driver_opts?.["com.docker.network.bridge.enable_icc"]).toBeUndefined();
  });

  it("cred-proxy gets env_file for API keys", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq", "clawhq_net", {
      enableCredProxy: true,
    });
    const proxy = compose.services["cred-proxy"];
    expect(proxy).toBeDefined();
    expect(proxy?.env_file).toContain(".env");
  });

  it("supports custom script and routes paths", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq", "clawhq_net", {
      enableCredProxy: true,
      credProxyScriptPath: "/custom/proxy.js",
      credProxyRoutesPath: "/custom/routes.json",
    });
    const proxy = compose.services["cred-proxy"];
    expect(proxy).toBeDefined();
    expect(proxy?.volumes.some((v) => v.includes("/custom/proxy.js"))).toBe(true);
    expect(proxy?.volumes.some((v) => v.includes("/custom/routes.json"))).toBe(true);
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
      posture: "hardened",
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
      posture: "hardened",
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
      posture: "hardened",
      stage1Hash: "aaaa",
      stage2Hash: "bbbb",
    });
    const after = new Date().toISOString();

    expect(manifest.builtAt >= before).toBe(true);
    expect(manifest.builtAt <= after).toBe(true);
  });
});

// ── SHA256 Binary Pinning Tests ────────────────────────────────────────────

describe("validateBinarySha256", () => {
  it("accepts valid 64-char lowercase hex hash", () => {
    expect(() => validateBinarySha256(VALID_SHA256)).not.toThrow();
  });

  it("accepts a realistic SHA256 hash", () => {
    expect(() => validateBinarySha256("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")).not.toThrow();
  });

  it("rejects uppercase hex", () => {
    expect(() => validateBinarySha256("A".repeat(64))).toThrow("Invalid SHA256");
  });

  it("rejects too-short hash", () => {
    expect(() => validateBinarySha256("abc123")).toThrow("Invalid SHA256");
  });

  it("rejects too-long hash", () => {
    expect(() => validateBinarySha256("a".repeat(65))).toThrow("Invalid SHA256");
  });

  it("rejects empty string", () => {
    expect(() => validateBinarySha256("")).toThrow("Invalid SHA256");
  });

  it("rejects non-hex characters", () => {
    expect(() => validateBinarySha256("g".repeat(64))).toThrow("Invalid SHA256");
  });
});

describe("SHA256 in Dockerfile generation", () => {
  it("emits sha256sum verification for each binary", () => {
    const config: Stage2Config = {
      binaries: [
        { name: "tool-a", url: "https://example.com/a", destPath: "/usr/local/bin/a", sha256: VALID_SHA256 },
        { name: "tool-b", url: "https://example.com/b", destPath: "/usr/local/bin/b", sha256: VALID_SHA256_B },
      ],
      workspaceTools: [],
      skills: [],
    };
    const df = generateStage2Dockerfile("base:tag", config);

    // Both binaries have sha256sum verification
    expect(df).toContain(`echo "${VALID_SHA256}  /usr/local/bin/a" | sha256sum -c -`);
    expect(df).toContain(`echo "${VALID_SHA256_B}  /usr/local/bin/b" | sha256sum -c -`);
  });

  it("includes SHA256 in Dockerfile comment for auditability", () => {
    const config: Stage2Config = {
      binaries: [
        { name: "himalaya", url: "https://example.com/himalaya", destPath: "/usr/local/bin/himalaya", sha256: VALID_SHA256 },
      ],
      workspaceTools: [],
      skills: [],
    };
    const df = generateStage2Dockerfile("base:tag", config);
    expect(df).toContain(`# Install himalaya (SHA256: ${VALID_SHA256})`);
  });

  it("verification runs between download and chmod", () => {
    const config: Stage2Config = {
      binaries: [
        { name: "tool", url: "https://example.com/tool", destPath: "/usr/local/bin/tool", sha256: VALID_SHA256 },
      ],
      workspaceTools: [],
      skills: [],
    };
    const df = generateStage2Dockerfile("base:tag", config);
    const lines = df.split("\n");

    const curlLine = lines.findIndex((l) => l.includes("curl -fsSL"));
    const sha256Line = lines.findIndex((l) => l.includes("sha256sum -c"));
    const chmodLine = lines.findIndex((l) => l.includes("chmod +x"));

    expect(curlLine).toBeGreaterThan(-1);
    expect(sha256Line).toBeGreaterThan(curlLine);
    expect(chmodLine).toBeGreaterThan(sha256Line);
  });

  it("build fails if sha256 is missing (empty string)", () => {
    const config: Stage2Config = {
      binaries: [
        { name: "bad", url: "https://example.com/bin", destPath: "/usr/local/bin/bad", sha256: "" },
      ],
      workspaceTools: [],
      skills: [],
    };
    expect(() => generateStage2Dockerfile("base:tag", config)).toThrow("Invalid SHA256");
  });
});

describe("SHA256 in cache detection", () => {
  it("stage2 hash changes when binary sha256 changes", () => {
    const config1: Stage2Config = {
      binaries: [{ name: "tool", url: "https://example.com/tool", destPath: "/usr/local/bin/tool", sha256: VALID_SHA256 }],
      workspaceTools: [],
      skills: [],
    };
    const config2: Stage2Config = {
      binaries: [{ name: "tool", url: "https://example.com/tool", destPath: "/usr/local/bin/tool", sha256: VALID_SHA256_B }],
      workspaceTools: [],
      skills: [],
    };
    expect(computeStage2Hash(config1)).not.toBe(computeStage2Hash(config2));
  });
});

// ── 1Password Integration Tests ────────────────────────────────────────────

describe("1Password Docker integration", () => {
  it("generates op CLI install in Stage 2 when enableOnePassword is true", () => {
    const config: Stage2Config = {
      binaries: [],
      workspaceTools: [],
      skills: [],
      enableOnePassword: true,
    };
    const df = generateStage2Dockerfile("base:tag", config);

    expect(df).toContain("1Password CLI");
    expect(df).toContain("op.zip");
    expect(df).toContain("/usr/local/bin/op");
  });

  it("does not generate op CLI install when enableOnePassword is false", () => {
    const config: Stage2Config = {
      binaries: [],
      workspaceTools: [],
      skills: [],
      enableOnePassword: false,
    };
    const df = generateStage2Dockerfile("base:tag", config);

    expect(df).not.toContain("1Password");
    expect(df).not.toContain("op.zip");
  });

  it("does not generate op CLI install when enableOnePassword is omitted", () => {
    const config: Stage2Config = {
      binaries: [],
      workspaceTools: [],
      skills: [],
    };
    const df = generateStage2Dockerfile("base:tag", config);

    expect(df).not.toContain("1Password");
  });

  it("generates Docker secrets section when enableOnePasswordSecret is true", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq", "clawhq_net", {
      enableOnePasswordSecret: true,
    });

    expect(compose.secrets).toBeDefined();
    expect(compose.secrets?.["op_service_account_token"]).toBeDefined();
    expect(compose.secrets?.["op_service_account_token"].file).toBe("./secrets/op_service_account_token");
    expect(compose.services.openclaw.secrets).toContain("op_service_account_token");
  });

  it("does not generate secrets section when not enabled", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq");

    expect(compose.secrets).toBeUndefined();
    expect(compose.services.openclaw.secrets).toBeUndefined();
  });

  it("supports custom token file path", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq", "clawhq_net", {
      enableOnePasswordSecret: true,
      onePasswordTokenFile: "/custom/path/token",
    });

    expect(compose.secrets?.["op_service_account_token"].file).toBe("/custom/path/token");
  });
});

describe("generateCompose with clawdius-trading", () => {
  it("does not include clawdius-trading service by default", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq");
    expect(compose.services["clawdius-trading"]).toBeUndefined();
  });

  it("includes clawdius-trading service when enableClawdiusTrading is true", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq", "clawhq_net", {
      enableClawdiusTrading: true,
    });
    expect(compose.services["clawdius-trading"]).toBeDefined();
  });

  it("clawdius-trading enforces non-root, read-only, cap_drop ALL, no-new-privileges", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq", "clawhq_net", {
      enableClawdiusTrading: true,
    });
    const ct = compose.services["clawdius-trading"];
    expect(ct).toBeDefined();
    expect(ct?.user).toBe("1000:1000");
    expect(ct?.read_only).toBe(true);
    expect(ct?.cap_drop).toContain("ALL");
    expect(ct?.security_opt).toContain("no-new-privileges");
  });

  it("clawdius-trading mounts shared RW and workspace/memory RO", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq", "clawhq_net", {
      enableClawdiusTrading: true,
    });
    const ct = compose.services["clawdius-trading"];
    expect(ct).toBeDefined();
    const sharedVol = ct?.volumes.find((v) => v.includes("/deploy/shared"));
    const memoryVol = ct?.volumes.find((v) => v.includes("/deploy/workspace/memory"));
    expect(sharedVol).toBeDefined();
    expect(sharedVol).not.toContain(":ro"); // shared is writable (SQLite, catchup log)
    expect(memoryVol).toContain(":ro"); // brief read-only
  });

  it("clawdius-trading shares the same network as openclaw", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq", "clawhq_net", {
      enableClawdiusTrading: true,
    });
    const ct = compose.services["clawdius-trading"];
    expect(ct?.networks).toContain("clawhq_net");
  });

  it("clawdius-trading depends on cred-proxy when cred-proxy is enabled", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq", "clawhq_net", {
      enableClawdiusTrading: true,
      enableCredProxy: true,
    });
    const ct = compose.services["clawdius-trading"];
    expect(ct?.depends_on).toHaveProperty("cred-proxy");
    expect(ct?.depends_on?.["cred-proxy"].condition).toBe("service_healthy");
  });

  it("clawdius-trading has no depends_on when cred-proxy is disabled", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq", "clawhq_net", {
      enableClawdiusTrading: true,
      enableCredProxy: false,
    });
    const ct = compose.services["clawdius-trading"];
    expect(ct?.depends_on).toBeUndefined();
  });

  it("clawdius-trading uses a Node-based healthcheck against :8080", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq", "clawhq_net", {
      enableClawdiusTrading: true,
    });
    const ct = compose.services["clawdius-trading"];
    expect(ct?.healthcheck.test[0]).toBe("CMD");
    expect(ct?.healthcheck.test[1]).toBe("node");
    const script = ct?.healthcheck.test.join(" ") ?? "";
    expect(script).toContain("127.0.0.1:8080/health");
  });

  it("clawdius-trading has TRADIER_BASE_URL pointing at cred-proxy", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq", "clawhq_net", {
      enableClawdiusTrading: true,
    });
    const ct = compose.services["clawdius-trading"];
    expect(ct?.environment.TRADIER_BASE_URL).toContain("cred-proxy");
    expect(ct?.environment.TRADIER_BASE_URL).toContain("/tradier");
    expect(ct?.environment.TRADING_DEPLOY_DIR).toBe("/deploy");
  });

  it("clawdius-trading uses build context with Dockerfile", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq", "clawhq_net", {
      enableClawdiusTrading: true,
      clawdiusTradingDir: "/home/user/.clawhq/engine/clawdius-trading",
    });
    const ct = compose.services["clawdius-trading"];
    expect(ct?.build.context).toBe("/home/user/.clawhq/engine/clawdius-trading");
    expect(ct?.build.dockerfile).toBe("Dockerfile");
  });

  it("clawdius-trading has hardened tmpfs with noexec", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq", "clawhq_net", {
      enableClawdiusTrading: true,
    });
    const ct = compose.services["clawdius-trading"];
    const tmp = ct?.tmpfs.find((t) => t.startsWith("/tmp"));
    expect(tmp).toContain("noexec");
    expect(tmp).toContain("nosuid");
  });

  it("serializeYaml emits a clawdius-trading service block when enabled", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq", "clawhq_net", {
      enableClawdiusTrading: true,
      enableCredProxy: true,
      clawdiusTradingDir: "/home/user/.clawhq/engine/clawdius-trading",
    });
    const yaml = serializeYaml(compose);

    // Service block present with correct shape — key-level assertions
    // rather than a golden string to avoid whitespace churn.
    expect(yaml).toContain("clawdius-trading:");
    expect(yaml).toContain("context: /home/user/.clawhq/engine/clawdius-trading");
    expect(yaml).toContain("dockerfile: Dockerfile");
    expect(yaml).toContain('user: "1000:1000"');
    expect(yaml).toContain("read_only: true");
    expect(yaml).toContain("- ALL");
    expect(yaml).toContain("- no-new-privileges");
    expect(yaml).toContain("cred-proxy:");
    expect(yaml).toContain("condition: service_healthy");
    expect(yaml).toContain('"/home/user/.clawhq/shared:/deploy/shared"');
    expect(yaml).toContain('"/home/user/.clawhq/workspace/memory:/deploy/workspace/memory:ro"');
    expect(yaml).toContain("127.0.0.1:8080/health");
  });

  it("serializeYaml omits the block when the sidecar is disabled", () => {
    const posture = getPostureConfig("hardened");
    const compose = generateCompose("openclaw:custom", posture, "/home/user/.clawhq");
    const yaml = serializeYaml(compose);
    expect(yaml).not.toContain("clawdius-trading:");
  });
});

describe("formatHashMismatch", () => {
  it("produces clear error with tool name, expected, and actual hash", () => {
    const msg = formatHashMismatch({
      name: "himalaya",
      expected: VALID_SHA256,
      actual: VALID_SHA256_B,
      ok: false,
    });
    expect(msg).toContain("himalaya");
    expect(msg).toContain(VALID_SHA256);
    expect(msg).toContain(VALID_SHA256_B);
    expect(msg).toContain("expected");
    expect(msg).toContain("actual");
  });
});
