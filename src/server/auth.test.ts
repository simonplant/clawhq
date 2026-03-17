import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { authMiddleware } from "./auth.js";
import type { ServerConfig, ServerEnv } from "./context.js";

function makeConfig(token?: string): ServerConfig {
  return {
    port: 18790,
    host: "127.0.0.1",
    token,
    openclawHome: "/tmp/oc",
  };
}

function makeApp(token?: string): Hono<ServerEnv> {
  const app = new Hono<ServerEnv>();
  app.use("*", authMiddleware(makeConfig(token)));
  app.get("/test", (c) => c.text("ok"));
  return app;
}

describe("authMiddleware", () => {
  it("passes through when no token is configured", async () => {
    const app = makeApp();
    const res = await app.request("/test");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("returns 401 when token required but not provided", async () => {
    const app = makeApp("secret");
    const res = await app.request("/test");
    expect(res.status).toBe(401);
  });

  it("accepts valid bearer token", async () => {
    const app = makeApp("secret");
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer secret" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects invalid bearer token", async () => {
    const app = makeApp("secret");
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("sets session cookie on successful bearer auth", async () => {
    const app = makeApp("secret");
    const res = await app.request("/test", {
      headers: { Authorization: "Bearer secret" },
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("clawhq_session=secret");
    expect(setCookie).toContain("HttpOnly");
  });

  it("accepts valid session cookie", async () => {
    const app = makeApp("secret");
    const res = await app.request("/test", {
      headers: { Cookie: "clawhq_session=secret" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects invalid session cookie", async () => {
    const app = makeApp("secret");
    const res = await app.request("/test", {
      headers: { Cookie: "clawhq_session=wrong" },
    });
    expect(res.status).toBe(401);
  });
});
