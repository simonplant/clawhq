import { describe, expect, it } from "vitest";

import type { ComposeServiceConfig } from "./compose.js";
import {
  applyHardening,
  composeToYaml,
  generateOverride,
  getPostureDefinition,
  mergeComposeConfigs,
  overrideToYaml,
  parseComposeYaml,
  POSTURE_CONTROLS,
  POSTURE_ORDER,
} from "./hardening.js";
import type { SecurityPosture } from "./hardening.js";

// --- SecurityPosture enum ---

describe("SecurityPosture", () => {
  it("defines all four posture levels in ascending strictness", () => {
    expect(POSTURE_ORDER).toEqual(["minimal", "standard", "hardened", "paranoid"]);
  });

  it("has controls for every posture", () => {
    for (const posture of POSTURE_ORDER) {
      const def = POSTURE_CONTROLS[posture];
      expect(def).toBeDefined();
      expect(def.service).toBeDefined();
      expect(def.network).toBeDefined();
    }
  });
});

// --- Posture control definitions ---

describe("POSTURE_CONTROLS", () => {
  it("minimal has no cap_drop or read_only, allows ICC", () => {
    const def = POSTURE_CONTROLS.minimal;
    expect(def.service.capDrop).toBeUndefined();
    expect(def.service.readOnly).toBeUndefined();
    expect(def.service.securityOpt).toContain("no-new-privileges:true");
    expect(def.service.user).toBe("1000:1000");
    expect(def.network.icc).toBe(true);
  });

  it("standard has cap_drop ALL, read_only, 4 CPU / 4 GB, ICC disabled", () => {
    const def = POSTURE_CONTROLS.standard;
    expect(def.service.capDrop).toEqual(["ALL"]);
    expect(def.service.readOnly).toBe(true);
    expect(def.service.securityOpt).toContain("no-new-privileges:true");
    expect(def.service.user).toBe("1000:1000");
    expect(def.service.deploy?.resources?.limits?.cpus).toBe("4");
    expect(def.service.deploy?.resources?.limits?.memory).toBe("4g");
    expect(def.network.icc).toBe(false);
  });

  it("hardened has tighter limits: 2 CPU / 2 GB, ICC disabled, noexec tmpfs", () => {
    const def = POSTURE_CONTROLS.hardened;
    expect(def.service.capDrop).toEqual(["ALL"]);
    expect(def.service.readOnly).toBe(true);
    expect(def.service.tmpfs).toEqual(["/tmp:noexec,nosuid,size=128m"]);
    expect(def.service.deploy?.resources?.limits?.cpus).toBe("2");
    expect(def.service.deploy?.resources?.limits?.memory).toBe("2g");
    expect(def.network.icc).toBe(false);
  });

  it("paranoid has strictest limits: 1 CPU / 1 GB, ICC disabled", () => {
    const def = POSTURE_CONTROLS.paranoid;
    expect(def.service.capDrop).toEqual(["ALL"]);
    expect(def.service.readOnly).toBe(true);
    expect(def.service.tmpfs).toEqual(["/tmp:noexec,nosuid,size=64m"]);
    expect(def.service.deploy?.resources?.limits?.cpus).toBe("1");
    expect(def.service.deploy?.resources?.limits?.memory).toBe("1g");
    expect(def.network.icc).toBe(false);
  });

  it("all postures enforce no-new-privileges", () => {
    for (const posture of POSTURE_ORDER) {
      expect(POSTURE_CONTROLS[posture].service.securityOpt).toContain("no-new-privileges:true");
    }
  });

  it("all postures run as non-root UID 1000", () => {
    for (const posture of POSTURE_ORDER) {
      expect(POSTURE_CONTROLS[posture].service.user).toBe("1000:1000");
    }
  });

  it("resource limits decrease with stricter posture", () => {
    const cpuLimits = POSTURE_ORDER
      .map((p) => POSTURE_CONTROLS[p].service.deploy?.resources?.limits?.cpus)
      .map((c) => (c ? parseFloat(c) : Infinity));

    for (let i = 1; i < cpuLimits.length; i++) {
      expect(cpuLimits[i]).toBeLessThanOrEqual(cpuLimits[i - 1]);
    }
  });
});

// --- applyHardening ---

describe("applyHardening", () => {
  const baseService: ComposeServiceConfig = {
    image: "openclaw:latest",
    containerName: "openclaw-agent",
    ports: ["18789:18789"],
    volumes: ["/data/workspace:/workspace"],
    restart: "unless-stopped",
  };

  it("applies security controls from the posture", () => {
    const result = applyHardening(baseService, {
      posture: "hardened",
      workspacePath: "/data/workspace",
      configPath: "/data/config/openclaw.json",
    });

    expect(result.capDrop).toEqual(["ALL"]);
    expect(result.readOnly).toBe(true);
    expect(result.securityOpt).toEqual(["no-new-privileges:true"]);
    expect(result.user).toBe("1000:1000");
  });

  it("preserves existing service properties", () => {
    const result = applyHardening(baseService, {
      posture: "standard",
      workspacePath: "/data/workspace",
      configPath: "/data/config/openclaw.json",
    });

    expect(result.image).toBe("openclaw:latest");
    expect(result.containerName).toBe("openclaw-agent");
    expect(result.ports).toEqual(["18789:18789"]);
    expect(result.restart).toBe("unless-stopped");
  });

  it("adds read-only config volume mount", () => {
    const result = applyHardening(baseService, {
      posture: "standard",
      workspacePath: "/data/workspace",
      configPath: "/data/config/openclaw.json",
    });

    expect(result.volumes).toContain(
      "/data/config/openclaw.json:/home/openclaw/.openclaw/openclaw.json:ro",
    );
  });

  it("merges with existing volumes", () => {
    const result = applyHardening(baseService, {
      posture: "standard",
      workspacePath: "/data/workspace",
      configPath: "/data/config/openclaw.json",
    });

    expect(result.volumes).toContain("/data/workspace:/workspace");
    expect(result.volumes ?? []).toHaveLength(2);
  });

  it("handles service with no existing volumes", () => {
    const noVolumes: ComposeServiceConfig = {
      image: "openclaw:latest",
      containerName: "test",
    };

    const result = applyHardening(noVolumes, {
      posture: "paranoid",
      workspacePath: "/ws",
      configPath: "/cfg/openclaw.json",
    });

    expect(result.volumes ?? []).toHaveLength(1);
    expect((result.volumes ?? [])[0]).toContain(":ro");
  });

  it("applies different resource limits per posture", () => {
    const standard = applyHardening(baseService, {
      posture: "standard",
      workspacePath: "/ws",
      configPath: "/cfg",
    });

    const paranoid = applyHardening(baseService, {
      posture: "paranoid",
      workspacePath: "/ws",
      configPath: "/cfg",
    });

    expect(standard.deploy?.resources?.limits?.cpus).toBe("4");
    expect(paranoid.deploy?.resources?.limits?.cpus).toBe("1");
  });

  it("applies minimal posture without cap_drop or read_only", () => {
    const result = applyHardening(baseService, {
      posture: "minimal",
      workspacePath: "/ws",
      configPath: "/cfg",
    });

    expect(result.capDrop).toBeUndefined();
    expect(result.readOnly).toBeUndefined();
    expect(result.securityOpt).toContain("no-new-privileges:true");
  });
});

// --- generateOverride ---

describe("generateOverride", () => {
  const options = {
    posture: "hardened" as SecurityPosture,
    workspacePath: "/data/workspace",
    configPath: "/data/config/openclaw.json",
  };

  it("generates override with correct service name", () => {
    const override = generateOverride("openclaw", options);
    const services = override.services as Record<string, unknown>;
    expect(services.openclaw).toBeDefined();
  });

  it("includes all hardened controls in override", () => {
    const override = generateOverride("openclaw", options);
    const svc = (override.services as Record<string, Record<string, unknown>>).openclaw;

    expect(svc["cap_drop"]).toEqual(["ALL"]);
    expect(svc["read_only"]).toBe(true);
    expect(svc["security_opt"]).toContain("no-new-privileges:true");
    expect(svc["user"]).toBe("1000:1000");
    expect(svc["tmpfs"]).toEqual(["/tmp:noexec,nosuid,size=128m"]);
    expect(svc["deploy"]).toEqual({
      resources: { limits: { cpus: "2", memory: "2g" } },
    });
  });

  it("includes config volume as read-only mount", () => {
    const override = generateOverride("openclaw", options);
    const svc = (override.services as Record<string, Record<string, unknown>>).openclaw;

    expect(svc["volumes"]).toContain(
      "/data/config/openclaw.json:/home/openclaw/.openclaw/openclaw.json:ro",
    );
  });

  it("adds ICC-disabled network for non-minimal postures", () => {
    for (const posture of ["standard", "hardened", "paranoid"] as SecurityPosture[]) {
      const override = generateOverride("openclaw", { ...options, posture });
      const networks = override.networks as Record<string, Record<string, unknown>>;

      expect(networks).toBeDefined();
      expect(networks.clawhq).toBeDefined();
      expect(networks.clawhq.driver_opts).toEqual({
        "com.docker.network.bridge.enable_icc": "false",
      });
    }
  });

  it("does not add ICC-disabled network for minimal posture", () => {
    const override = generateOverride("openclaw", { ...options, posture: "minimal" });
    expect(override.networks).toBeUndefined();
  });

  it("generates valid YAML for all postures", () => {
    for (const posture of POSTURE_ORDER) {
      const override = generateOverride("openclaw", { ...options, posture });
      const yaml = overrideToYaml(override);

      expect(yaml).toBeTruthy();
      const parsed = parseComposeYaml(yaml);
      expect(parsed.services).toBeDefined();
    }
  });
});

// --- mergeComposeConfigs ---

describe("mergeComposeConfigs", () => {
  it("merges override into base", () => {
    const base = {
      services: {
        openclaw: {
          image: "openclaw:custom",
          ports: ["18789:18789"],
        },
      },
    };

    const override = {
      services: {
        openclaw: {
          cap_drop: ["ALL"],
          read_only: true,
        },
      },
    };

    const merged = mergeComposeConfigs(base, override);
    const svc = (merged.services as Record<string, Record<string, unknown>>).openclaw;

    expect(svc.image).toBe("openclaw:custom");
    expect(svc.ports).toEqual(["18789:18789"]);
    expect(svc["cap_drop"]).toEqual(["ALL"]);
    expect(svc["read_only"]).toBe(true);
  });

  it("concatenates and deduplicates arrays", () => {
    const base = {
      services: {
        openclaw: {
          volumes: ["/data/workspace:/workspace"],
        },
      },
    };

    const override = {
      services: {
        openclaw: {
          volumes: ["/data/config:/config:ro", "/data/workspace:/workspace"],
        },
      },
    };

    const merged = mergeComposeConfigs(base, override);
    const svc = (merged.services as Record<string, Record<string, unknown>>).openclaw;
    const volumes = svc.volumes as string[];

    expect(volumes).toContain("/data/workspace:/workspace");
    expect(volumes).toContain("/data/config:/config:ro");
    expect(volumes.filter((v) => v === "/data/workspace:/workspace")).toHaveLength(1);
  });

  it("adds networks from override", () => {
    const base = {
      services: { openclaw: { image: "openclaw:custom" } },
    };

    const override = {
      networks: {
        clawhq: {
          driver: "bridge",
          driver_opts: { "com.docker.network.bridge.enable_icc": "false" },
        },
      },
    };

    const merged = mergeComposeConfigs(base, override);
    expect(merged.networks).toBeDefined();
  });

  it("produces valid YAML after merge", () => {
    const base = {
      services: { openclaw: { image: "openclaw:custom", ports: ["18789:18789"] } },
    };

    const override = generateOverride("openclaw", {
      posture: "hardened",
      workspacePath: "/data/workspace",
      configPath: "/data/config/openclaw.json",
    });

    const merged = mergeComposeConfigs(base, override);
    const yaml = composeToYaml(merged);
    const parsed = parseComposeYaml(yaml);

    expect(parsed.services).toBeDefined();
    expect(parsed.networks).toBeDefined();
  });

  it("preserves base properties not in override", () => {
    const base = {
      version: "3.8",
      services: { openclaw: { image: "openclaw:custom", restart: "always" } },
    };

    const override = {
      services: { openclaw: { read_only: true } },
    };

    const merged = mergeComposeConfigs(base, override);
    expect(merged.version).toBe("3.8");
  });
});

// --- getPostureDefinition ---

describe("getPostureDefinition", () => {
  it("returns the definition for each posture", () => {
    for (const posture of POSTURE_ORDER) {
      const def = getPostureDefinition(posture);
      expect(def.service).toBeDefined();
      expect(def.network).toBeDefined();
    }
  });
});

// --- YAML round-trip ---

describe("YAML serialization", () => {
  it("round-trips a compose config through YAML", () => {
    const config = {
      services: {
        openclaw: {
          image: "openclaw:custom",
          cap_drop: ["ALL"],
          read_only: true,
          user: "1000:1000",
        },
      },
    };

    const yaml = composeToYaml(config);
    const parsed = parseComposeYaml(yaml);

    expect(parsed).toEqual(config);
  });
});
