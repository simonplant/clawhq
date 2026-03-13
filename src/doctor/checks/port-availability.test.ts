import { createServer } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import type { DoctorContext } from "../types.js";

import { portAvailabilityCheck } from "./port-availability.js";

function makeCtx(overrides: Partial<DoctorContext> = {}): DoctorContext {
  return {
    openclawHome: "/tmp/openclaw",
    configPath: "/tmp/openclaw/openclaw.json",
    ...overrides,
  };
}

describe("portAvailabilityCheck", () => {
  let server: ReturnType<typeof createServer> | null = null;

  afterEach(async () => {
    if (server) {
      const s = server;
      server = null;
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  it("passes when port is available", async () => {
    // Use a random high port that's very likely available
    const result = await portAvailabilityCheck.run(makeCtx({
      gatewayPort: 49999,
      gatewayHost: "127.0.0.1",
    }));

    expect(result.status).toBe("pass");
    expect(result.message).toContain("available");
  });

  it("warns when port is in use", async () => {
    // Bind a port first
    const srv = createServer();
    server = srv;
    const port = await new Promise<number>((resolve) => {
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    const result = await portAvailabilityCheck.run(makeCtx({
      gatewayPort: port,
      gatewayHost: "127.0.0.1",
    }));

    expect(result.status).toBe("warn");
    expect(result.message).toContain("in use");
  });
});
