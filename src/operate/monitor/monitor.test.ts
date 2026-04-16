/**
 * Tests for monitor daemon — alerts, recovery, digest, notifications.
 */

import * as net from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { analyzeHealth } from "./alerts.js";
import { buildDigest, formatDigestMessage } from "./digest.js";
import {
  formatDigestTable,
  formatMonitorEvent,
  formatMonitorStateJson,
  formatMonitorStateTable,
} from "./format.js";
import { sendNotification } from "./notify.js";
import { RecoveryTracker } from "./recovery.js";
import type {
  DigestContent,
  HealthAlert,
  MonitorEvent,
  MonitorState,
  RecoveryResult,
  ResourceSample,
} from "./types.js";

// ── Alert Analysis Tests ────────────────────────────────────────────────────

describe("analyzeHealth", () => {
  const baseSample: ResourceSample = {
    timestamp: new Date().toISOString(),
    cpuPercent: 10,
    memoryMb: 500,
    memoryLimitMb: 4096,
    diskUsedPercent: 50,
    diskFreeMb: 10000,
  };

  it("returns no alerts for healthy samples", () => {
    const { alerts } = analyzeHealth([baseSample]);
    expect(alerts).toHaveLength(0);
  });

  it("fires disk warning at 80%", () => {
    const sample: ResourceSample = { ...baseSample, diskUsedPercent: 82, diskFreeMb: 500 };
    const { alerts } = analyzeHealth([sample]);
    const diskAlert = alerts.find((a) => a.category === "disk-warning");
    expect(diskAlert).toBeDefined();
    expect(diskAlert?.severity).toBe("warning");
  });

  it("fires disk critical at 90%", () => {
    const sample: ResourceSample = { ...baseSample, diskUsedPercent: 92, diskFreeMb: 100 };
    const { alerts } = analyzeHealth([sample]);
    const diskAlert = alerts.find((a) => a.category === "disk-critical");
    expect(diskAlert).toBeDefined();
    expect(diskAlert?.severity).toBe("critical");
  });

  it("fires memory warning at threshold", () => {
    const sample: ResourceSample = { ...baseSample, memoryMb: 3600, memoryLimitMb: 4096 };
    const { alerts } = analyzeHealth([sample]);
    const memAlert = alerts.find((a) => a.category === "memory-growth");
    expect(memAlert).toBeDefined();
  });

  it("respects custom thresholds", () => {
    const sample: ResourceSample = { ...baseSample, diskUsedPercent: 75, diskFreeMb: 2000 };
    const { alerts } = analyzeHealth([sample], { diskWarningPercent: 70 });
    const diskAlert = alerts.find((a) => a.category === "disk-warning");
    expect(diskAlert).toBeDefined();
  });

  it("detects sustained CPU from trend window", () => {
    const samples = Array.from({ length: 5 }, (_, i) => ({
      ...baseSample,
      timestamp: new Date(Date.now() + i * 30000).toISOString(),
      cpuPercent: 95,
    }));
    const { alerts } = analyzeHealth(samples);
    const cpuAlert = alerts.find((a) => a.category === "cpu-sustained");
    expect(cpuAlert).toBeDefined();
  });

  it("computes resource trends with enough samples", () => {
    const samples = Array.from({ length: 5 }, (_, i) => ({
      ...baseSample,
      timestamp: new Date(Date.now() + i * 30000).toISOString(),
      diskUsedPercent: 50 + i * 2,
      diskFreeMb: 10000 - i * 200,
    }));
    const { trends } = analyzeHealth(samples);
    const diskTrend = trends.find((t) => t.metric === "disk");
    expect(diskTrend).toBeDefined();
    expect(diskTrend?.slope).toBeGreaterThan(0);
  });

  it("returns empty for no samples", () => {
    const { alerts, trends } = analyzeHealth([]);
    expect(alerts).toHaveLength(0);
    expect(trends).toHaveLength(0);
  });
});

// ── Recovery Tracker Tests ──────────────────────────────────────────────────

describe("RecoveryTracker", () => {
  it("allows first attempt", () => {
    const tracker = new RecoveryTracker();
    expect(tracker.canAttempt()).toBe(true);
  });

  it("enforces cooldown between attempts", () => {
    const tracker = new RecoveryTracker();
    tracker.record("container-restart");
    // Immediately after recording, cooldown should block
    expect(tracker.canAttempt({ cooldownMs: 60_000 })).toBe(false);
  });

  it("enforces max attempts per hour", () => {
    const tracker = new RecoveryTracker();
    // Record max attempts
    for (let i = 0; i < 3; i++) {
      tracker.record("container-restart");
    }
    expect(tracker.canAttempt({ maxAttemptsPerHour: 3, cooldownMs: 0 })).toBe(false);
  });

  it("tracks recent count", () => {
    const tracker = new RecoveryTracker();
    tracker.record("container-restart");
    tracker.record("oom-restart");
    expect(tracker.recentCount).toBe(2);
  });

  it("respects enabled flag", () => {
    const tracker = new RecoveryTracker();
    expect(tracker.canAttempt({ enabled: false })).toBe(false);
  });
});

// ── Digest Tests ────────────────────────────────────────────────────────────

describe("buildDigest", () => {
  const sampleAlert: HealthAlert = {
    id: "test-1",
    timestamp: new Date().toISOString(),
    severity: "warning",
    category: "disk-warning",
    message: "Disk usage high: 82%",
  };

  const sampleRecovery: RecoveryResult = {
    action: "container-restart",
    success: true,
    timestamp: new Date().toISOString(),
    message: "Container restarted successfully",
    durationMs: 5000,
  };

  const sampleResource: ResourceSample = {
    timestamp: new Date().toISOString(),
    cpuPercent: 25,
    memoryMb: 1024,
    memoryLimitMb: 4096,
    diskUsedPercent: 60,
    diskFreeMb: 8000,
  };

  it("builds digest with correct summary", () => {
    const digest = buildDigest([sampleAlert], [sampleRecovery], sampleResource, new Date(Date.now() - 86_400_000).toISOString());
    expect(digest.summary.alertsFired).toBe(1);
    expect(digest.summary.recoveriesAttempted).toBe(1);
    expect(digest.summary.recoveriesSucceeded).toBe(1);
    expect(digest.resourceSnapshot).toEqual(sampleResource);
  });

  it("reports healthy when no critical alerts", () => {
    const digest = buildDigest([sampleAlert], [], null, new Date().toISOString());
    expect(digest.healthy).toBe(true);
  });

  it("reports unhealthy with critical alerts", () => {
    const criticalAlert: HealthAlert = {
      ...sampleAlert,
      severity: "critical",
      category: "container-down",
    };
    const digest = buildDigest([criticalAlert], [], null, new Date().toISOString());
    expect(digest.healthy).toBe(false);
  });

  it("filters alerts to last 24h only", () => {
    const oldAlert: HealthAlert = {
      ...sampleAlert,
      timestamp: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    };
    const digest = buildDigest([oldAlert], [], null, new Date().toISOString());
    expect(digest.summary.alertsFired).toBe(0);
  });
});

describe("formatDigestMessage", () => {
  it("produces readable digest text", () => {
    const digest: DigestContent = {
      timestamp: new Date().toISOString(),
      period: {
        from: new Date(Date.now() - 86_400_000).toISOString(),
        to: new Date().toISOString(),
      },
      summary: {
        uptime: "24h 0m",
        alertsFired: 2,
        recoveriesAttempted: 1,
        recoveriesSucceeded: 1,
      },
      alerts: [],
      recoveries: [],
      resourceSnapshot: null,
      healthy: true,
    };

    const text = formatDigestMessage(digest);
    expect(text).toContain("Agent Daily Digest");
    expect(text).toContain("Healthy");
    expect(text).toContain("Alerts: 2 fired");
    expect(text).toContain("Recoveries: 1/1 succeeded");
  });

  it("shows 'All quiet' when no events", () => {
    const digest: DigestContent = {
      timestamp: new Date().toISOString(),
      period: { from: new Date().toISOString(), to: new Date().toISOString() },
      summary: { uptime: "1h 0m", alertsFired: 0, recoveriesAttempted: 0, recoveriesSucceeded: 0 },
      alerts: [],
      recoveries: [],
      resourceSnapshot: null,
      healthy: true,
    };

    const text = formatDigestMessage(digest);
    expect(text).toContain("All quiet");
  });
});

// ── Formatter Tests ─────────────────────────────────────────────────────────

describe("formatMonitorStateTable", () => {
  it("renders monitor state", () => {
    const state: MonitorState = {
      running: false,
      startedAt: "2026-03-19T08:00:00Z",
      lastCheck: "2026-03-19T09:00:00Z",
      alertsToday: 3,
      recoveriesToday: 1,
      digestSentToday: true,
    };
    const output = formatMonitorStateTable(state);
    expect(output).toContain("Monitor Daemon Status");
    expect(output).toContain("Alerts today:     3");
    expect(output).toContain("Recoveries today: 1");
    expect(output).toContain("Digest sent:      yes");
  });
});

describe("formatMonitorStateJson", () => {
  it("produces valid JSON", () => {
    const state: MonitorState = {
      running: true,
      startedAt: "2026-03-19T08:00:00Z",
      lastCheck: null,
      alertsToday: 0,
      recoveriesToday: 0,
      digestSentToday: false,
    };
    const parsed = JSON.parse(formatMonitorStateJson(state));
    expect(parsed.running).toBe(true);
    expect(parsed.alertsToday).toBe(0);
  });
});

describe("formatMonitorEvent", () => {
  it("formats event with timestamp", () => {
    const event: MonitorEvent = {
      type: "alert",
      timestamp: "2026-03-19T08:30:00Z",
      message: "Disk usage critical",
    };
    const output = formatMonitorEvent(event);
    expect(output).toContain("alert");
    expect(output).toContain("Disk usage critical");
  });
});

describe("formatDigestTable", () => {
  it("renders digest table", () => {
    const digest: DigestContent = {
      timestamp: new Date().toISOString(),
      period: {
        from: new Date(Date.now() - 86_400_000).toISOString(),
        to: new Date().toISOString(),
      },
      summary: {
        uptime: "24h 0m",
        alertsFired: 0,
        recoveriesAttempted: 0,
        recoveriesSucceeded: 0,
      },
      alerts: [],
      recoveries: [],
      resourceSnapshot: {
        timestamp: new Date().toISOString(),
        cpuPercent: 15.5,
        memoryMb: 1024,
        memoryLimitMb: 4096,
        diskUsedPercent: 55,
        diskFreeMb: 8000,
      },
      healthy: true,
    };
    const output = formatDigestTable(digest);
    expect(output).toContain("Daily Digest");
    expect(output).toContain("HEALTHY");
    expect(output).toContain("CPU:");
    expect(output).toContain("Memory:");
    expect(output).toContain("Disk:");
  });
});

// ── Type Tests ──────────────────────────────────────────────────────────────

describe("types", () => {
  it("HealthAlert has required fields", () => {
    const alert: HealthAlert = {
      id: "test",
      timestamp: new Date().toISOString(),
      severity: "critical",
      category: "container-down",
      message: "Container is not running",
    };
    expect(alert.severity).toBe("critical");
    expect(alert.category).toBe("container-down");
  });

  it("RecoveryResult has required fields", () => {
    const result: RecoveryResult = {
      action: "container-restart",
      success: true,
      timestamp: new Date().toISOString(),
      message: "Restarted",
      durationMs: 5000,
    };
    expect(result.action).toBe("container-restart");
    expect(result.success).toBe(true);
  });

  it("ResourceSample has all metrics", () => {
    const sample: ResourceSample = {
      timestamp: new Date().toISOString(),
      cpuPercent: 50,
      memoryMb: 2048,
      memoryLimitMb: 4096,
      diskUsedPercent: 60,
      diskFreeMb: 5000,
    };
    expect(sample.cpuPercent).toBe(50);
    expect(sample.memoryMb).toBe(2048);
  });
});

// ── Email Notification Tests ───────────────────────────────────────────

/**
 * Creates a minimal mock SMTP server that records received messages.
 * Returns the server, the port it listens on, and the received data.
 */
function createMockSmtpServer(options?: {
  rejectAuth?: boolean;
}): Promise<{ server: net.Server; port: number; received: string[] }> {
  return new Promise((resolve) => {
    const received: string[] = [];
    const server = net.createServer((socket) => {
      let inData = false;
      let dataBuffer = "";
      let awaitingAuthCreds = 0; // 1 = waiting for username, 2 = waiting for password

      socket.write("220 mock-smtp ready\r\n");

      socket.on("data", (data) => {
        const lines = data.toString();

        if (inData) {
          dataBuffer += lines;
          if (dataBuffer.includes("\r\n.\r\n")) {
            received.push(dataBuffer.replace(/\r\n\.\r\n$/, ""));
            inData = false;
            socket.write("250 OK message accepted\r\n");
          }
          return;
        }

        for (const line of lines.split("\r\n").filter(Boolean)) {
          if (awaitingAuthCreds > 0) {
            // Consume base64 auth credential lines
            if (awaitingAuthCreds === 1) {
              // Got username, ask for password
              awaitingAuthCreds = 2;
              socket.write("334 UGFzc3dvcmQ6\r\n");
            } else {
              // Got password
              awaitingAuthCreds = 0;
              socket.write("235 Authentication successful\r\n");
            }
          } else if (line.startsWith("EHLO")) {
            socket.write("250-mock-smtp\r\n250 OK\r\n");
          } else if (line.startsWith("STARTTLS")) {
            socket.write("502 STARTTLS not supported\r\n");
          } else if (line.startsWith("AUTH LOGIN")) {
            if (options?.rejectAuth) {
              socket.write("535 Authentication failed\r\n");
            } else {
              awaitingAuthCreds = 1;
              socket.write("334 VXNlcm5hbWU6\r\n");
            }
          } else if (line.startsWith("MAIL FROM:")) {
            socket.write("250 OK\r\n");
          } else if (line.startsWith("RCPT TO:")) {
            socket.write("250 OK\r\n");
          } else if (line === "DATA") {
            inData = true;
            dataBuffer = "";
            socket.write("354 Start mail input\r\n");
          } else if (line === "QUIT") {
            socket.write("221 Bye\r\n");
            socket.end();
          }
        }
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      resolve({ server, port: addr.port, received });
    });
  });
}

describe("sendNotification — email channel", () => {
  const servers: net.Server[] = [];

  afterEach(() => {
    for (const s of servers) {
      s.close();
    }
    servers.length = 0;
  });

  it("sends email via SMTP successfully", async () => {
    const { server, port, received } = await createMockSmtpServer();
    servers.push(server);

    const results = await sendNotification(
      [
        {
          type: "email",
          enabled: true,
          smtpHost: "127.0.0.1",
          smtpPort: port,
          smtpUser: "testuser",
          smtpPass: "testpass",
          from: "monitor@clawhq.local",
          to: "admin@example.com",
        },
      ],
      "Alert: container-down",
      "Container is not running — agent claw-1 — severity: critical",
    );

    expect(results).toHaveLength(1);
    expect(results[0].channel).toBe("email");
    expect(results[0].success).toBe(true);
    expect(results[0].error).toBeUndefined();

    // Verify the email was received with correct content
    expect(received).toHaveLength(1);
    expect(received[0]).toContain("Subject: Alert: container-down");
    expect(received[0]).toContain("From: monitor@clawhq.local");
    expect(received[0]).toContain("To: admin@example.com");
    expect(received[0]).toContain("severity: critical");
  });

  it("reports connection failure as channel error", async () => {
    const results = await sendNotification(
      [
        {
          type: "email",
          enabled: true,
          smtpHost: "127.0.0.1",
          smtpPort: 19999, // nothing listening
          smtpUser: "user",
          smtpPass: "pass",
          from: "monitor@clawhq.local",
          to: "admin@example.com",
        },
      ],
      "Alert: disk-critical",
      "Disk usage at 95%",
    );

    expect(results).toHaveLength(1);
    expect(results[0].channel).toBe("email");
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBeDefined();
    expect(results[0].error).toMatch(/ECONNREFUSED|timed out|error/i);
  });

  it("reports auth failure as channel error", async () => {
    const { server, port } = await createMockSmtpServer({ rejectAuth: true });
    servers.push(server);

    const results = await sendNotification(
      [
        {
          type: "email",
          enabled: true,
          smtpHost: "127.0.0.1",
          smtpPort: port,
          smtpUser: "baduser",
          smtpPass: "badpass",
          from: "monitor@clawhq.local",
          to: "admin@example.com",
        },
      ],
      "Alert: gateway-unreachable",
      "Gateway is not responding",
    );

    expect(results).toHaveLength(1);
    expect(results[0].channel).toBe("email");
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBeDefined();
    expect(results[0].error).toMatch(/535|auth|failed/i);
  });
});
