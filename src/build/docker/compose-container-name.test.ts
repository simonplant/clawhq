import { describe, expect, it } from "vitest";

import { generateCompose, serializeYaml } from "./compose.js";
import { getPostureConfig } from "./posture.js";

const POSTURE = getPostureConfig("hardened");

describe("generateCompose — instance-scoped container_name", () => {
  it("omits container_name when no instanceId is provided", () => {
    const compose = generateCompose("image:tag", POSTURE, "/deploy", "net");
    expect(compose.services.openclaw.container_name).toBeUndefined();
    const yaml = serializeYaml(compose);
    expect(yaml).not.toMatch(/container_name:/);
  });

  it("sets container_name: openclaw-<shortId> when instanceId is provided", () => {
    const compose = generateCompose("image:tag", POSTURE, "/deploy", "net", {
      instanceId: "01955000-0000-4000-8000-000000000001",
    });
    expect(compose.services.openclaw.container_name).toBe("openclaw-01955000");
    const yaml = serializeYaml(compose);
    expect(yaml).toMatch(/^\s+container_name: openclaw-01955000$/m);
  });

  it("distinct instanceIds yield distinct container_names", () => {
    const a = generateCompose("img", POSTURE, "/deploy", "net", {
      instanceId: "01955000-0000-4000-8000-000000000001",
    });
    const b = generateCompose("img", POSTURE, "/deploy", "net", {
      instanceId: "01966000-0000-4000-8000-000000000002",
    });
    expect(a.services.openclaw.container_name).not.toBe(
      b.services.openclaw.container_name,
    );
  });
});
