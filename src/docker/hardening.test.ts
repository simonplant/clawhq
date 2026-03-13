import { describe, expect, it } from "vitest";

import type { ComposeServiceConfig } from "./compose.js";
import { applyHardening, POSTURE_CONTROLS } from "./hardening.js";
import type { SecurityPosture } from "./hardening.js";

describe("POSTURE_CONTROLS", () => {
  it("defines controls for all three posture levels", () => {
    expect(POSTURE_CONTROLS).toHaveProperty("standard");
    expect(POSTURE_CONTROLS).toHaveProperty("hardened");
    expect(POSTURE_CONTROLS).toHaveProperty("paranoid");
  });

  it("all postures drop all capabilities", () => {
    for (const posture of ["standard", "hardened", "paranoid"] as SecurityPosture[]) {
      expect(POSTURE_CONTROLS[posture].capDrop).toEqual(["ALL"]);
    }
  });

  it("all postures enforce read-only rootfs", () => {
    for (const posture of ["standard", "hardened", "paranoid"] as SecurityPosture[]) {
      expect(POSTURE_CONTROLS[posture].readOnly).toBe(true);
    }
  });

  it("all postures enforce no-new-privileges", () => {
    for (const posture of ["standard", "hardened", "paranoid"] as SecurityPosture[]) {
      expect(POSTURE_CONTROLS[posture].securityOpt).toEqual(["no-new-privileges:true"]);
    }
  });

  it("all postures run as non-root UID 1000", () => {
    for (const posture of ["standard", "hardened", "paranoid"] as SecurityPosture[]) {
      expect(POSTURE_CONTROLS[posture].user).toBe("1000:1000");
    }
  });

  it("resource limits decrease with stricter posture", () => {
    const standardLimits = POSTURE_CONTROLS.standard.deploy?.resources?.limits;
    const hardenedLimits = POSTURE_CONTROLS.hardened.deploy?.resources?.limits;
    const paranoidLimits = POSTURE_CONTROLS.paranoid.deploy?.resources?.limits;

    expect(Number(standardLimits?.cpus)).toBeGreaterThan(Number(hardenedLimits?.cpus));
    expect(Number(hardenedLimits?.cpus)).toBeGreaterThan(Number(paranoidLimits?.cpus));

    expect(parseInt(standardLimits?.memory ?? "0")).toBeGreaterThan(parseInt(hardenedLimits?.memory ?? "0"));
    expect(parseInt(hardenedLimits?.memory ?? "0")).toBeGreaterThan(parseInt(paranoidLimits?.memory ?? "0"));
  });
});

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

    // Should have original volume plus the config mount
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
});
