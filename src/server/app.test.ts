import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import type { ServerConfig } from "./context.js";

function makeConfig(): ServerConfig {
  return {
    port: 18790,
    host: "127.0.0.1",
    openclawHome: "/tmp/oc",
  };
}

describe("createApp", () => {
  it("returns a Hono app", () => {
    const app = createApp(makeConfig());
    expect(app).toBeDefined();
    expect(typeof app.fetch).toBe("function");
  });

  it("serves the home page at /", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("ClawHQ");
    expect(html).toContain("Dashboard");
    expect(html).toContain("pico.min.css");
    expect(html).toContain("htmx.min.js");
  });

  it("serves static htmx.min.js", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/static/htmx.min.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/javascript");
  });

  it("serves static pico.min.css", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/static/pico.min.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/css");
  });

  it("returns 404 for unknown static files", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/static/evil.js");
    expect(res.status).toBe(404);
  });

  it("includes sidebar navigation with lifecycle phases", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("Operate");
    expect(html).toContain("Deploy");
    expect(html).toContain("Secure");
    expect(html).toContain("Evolve");
    expect(html).toContain("Plan");
  });

  it("home page includes all dashboard cards", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("agent-state");
    expect(html).toContain("integration-health");
    expect(html).toContain("memory-metrics");
    expect(html).toContain("approval-alerts");
    expect(html).toContain("egress-summary");
  });

  it("home page connects to SSE for live updates", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("/sse/status");
    expect(html).toContain("EventSource");
  });

  it("serves the logs page at /logs", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/logs");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Logs");
    expect(html).toContain("log-pane");
  });

  it("logs page includes category filter", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/logs");
    const html = await res.text();
    expect(html).toContain("category-filter");
    expect(html).toContain("Agent");
    expect(html).toContain("Gateway");
    expect(html).toContain("Cron");
    expect(html).toContain("Errors");
  });

  it("logs page includes pause/resume and auto-scroll controls", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/logs");
    const html = await res.text();
    expect(html).toContain("pause-btn");
    expect(html).toContain("autoscroll-toggle");
    expect(html).toContain("togglePause");
  });

  it("logs page connects to SSE /api/v1/logs", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/logs");
    const html = await res.text();
    expect(html).toContain("/api/v1/logs");
    expect(html).toContain("EventSource");
  });

  it("logs page uses established dashboard layout", async () => {
    const app = createApp(makeConfig());
    const res = await app.request("/logs");
    const html = await res.text();
    expect(html).toContain("ClawHQ");
    expect(html).toContain("pico.min.css");
    expect(html).toContain("sidebar");
  });
});
