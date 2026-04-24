import { describe, expect, it } from "vitest";

import { openclawContainerName, shortInstanceId } from "./container-naming.js";

describe("shortInstanceId", () => {
  it("strips dashes and returns the leading 8 hex chars", () => {
    expect(shortInstanceId("01955000-0000-4000-8000-000000000001")).toBe("01955000");
  });

  it("is stable per id", () => {
    const id = "abcdef01-2345-6789-abcd-ef0123456789";
    expect(shortInstanceId(id)).toBe(shortInstanceId(id));
    expect(shortInstanceId(id)).toBe("abcdef01");
  });

  it("distinguishes between ids with different leading bytes", () => {
    const a = shortInstanceId("01955000-0000-4000-8000-000000000001");
    const b = shortInstanceId("01966000-0000-4000-8000-000000000002");
    expect(a).not.toBe(b);
  });
});

describe("openclawContainerName", () => {
  it("produces a docker-valid container name", () => {
    const name = openclawContainerName("01955000-0000-4000-8000-000000000001");
    expect(name).toBe("openclaw-01955000");
    expect(name).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/);
  });

  it("generates distinct names for distinct instances", () => {
    const a = openclawContainerName("01955000-0000-4000-8000-000000000001");
    const b = openclawContainerName("01966000-0000-4000-8000-000000000002");
    expect(a).not.toBe(b);
  });
});
