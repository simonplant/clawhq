import { mkdir, writeFile } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseGoogleAssistantExport } from "./parser.js";

describe("parseGoogleAssistantExport", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `clawhq-ga-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  it("parses routines from a directory with routines.json", async () => {
    const routinesDir = join(testDir, "Google Assistant", "Routines");
    await mkdir(routinesDir, { recursive: true });

    const routines = [
      {
        id: "r1",
        name: "Good Morning",
        trigger: { type: "schedule", time: "07:00", days: ["monday", "friday"] },
        actions: [
          { type: "tell_weather" },
          { type: "tell_calendar_events" },
        ],
      },
      {
        id: "r2",
        name: "Hey Google goodnight",
        trigger: { type: "voice", phrase: "goodnight" },
        actions: [
          { type: "adjust_lights", params: { brightness: 0 } },
        ],
      },
    ];

    await writeFile(join(routinesDir, "routines.json"), JSON.stringify(routines));

    const result = await parseGoogleAssistantExport(testDir);
    expect(result.routines).toHaveLength(2);
    expect(result.routines[0].name).toBe("Good Morning");
    expect(result.routines[0].trigger.type).toBe("schedule");
    expect(result.routines[0].trigger.time).toBe("07:00");
    expect(result.routines[0].actions).toHaveLength(2);
    expect(result.routines[1].trigger.type).toBe("voice");
  });

  it("parses routines from Takeout/ prefixed path", async () => {
    const routinesDir = join(testDir, "Takeout", "Google Assistant", "Routines");
    await mkdir(routinesDir, { recursive: true });

    const routines = [
      {
        id: "r1",
        name: "Daily Brief",
        trigger: { type: "schedule", time: "08:00" },
        actions: [{ type: "tell_news" }],
      },
    ];

    await writeFile(join(routinesDir, "routines.json"), JSON.stringify(routines));

    const result = await parseGoogleAssistantExport(testDir);
    expect(result.routines).toHaveLength(1);
    expect(result.routines[0].name).toBe("Daily Brief");
  });

  it("handles routine-level schedule (alternative format)", async () => {
    const routinesDir = join(testDir, "Google Assistant", "Routines");
    await mkdir(routinesDir, { recursive: true });

    const routines = [
      {
        name: "Alarm Routine",
        trigger: { type: "voice" },
        schedule: { time: "06:30", days: ["monday"], timezone: "US/Eastern" },
        actions: [{ type: "tell_weather" }],
      },
    ];

    await writeFile(join(routinesDir, "routines.json"), JSON.stringify(routines));

    const result = await parseGoogleAssistantExport(testDir);
    expect(result.routines).toHaveLength(1);
    expect(result.routines[0].trigger.type).toBe("schedule");
    expect(result.routines[0].trigger.time).toBe("06:30");
    expect(result.routines[0].trigger.timezone).toBe("US/Eastern");
  });

  it("skips routines with no actions", async () => {
    const routinesDir = join(testDir, "Google Assistant", "Routines");
    await mkdir(routinesDir, { recursive: true });

    const routines = [
      { id: "r1", name: "Empty", trigger: { type: "voice" }, actions: [] },
      { id: "r2", name: "Has action", trigger: { type: "voice" }, actions: [{ type: "tell_weather" }] },
    ];

    await writeFile(join(routinesDir, "routines.json"), JSON.stringify(routines));

    const result = await parseGoogleAssistantExport(testDir);
    expect(result.routines).toHaveLength(1);
    expect(result.routines[0].name).toBe("Has action");
  });

  it("throws when no routine files found", async () => {
    await expect(parseGoogleAssistantExport(testDir)).rejects.toThrow(
      /No routine definitions found/,
    );
  });

  it("throws for non-existent path", async () => {
    await expect(parseGoogleAssistantExport("/tmp/does-not-exist-xxx")).rejects.toThrow(
      /Export path not found/,
    );
  });

  it("throws for invalid JSON", async () => {
    const routinesDir = join(testDir, "Google Assistant", "Routines");
    await mkdir(routinesDir, { recursive: true });
    await writeFile(join(routinesDir, "routines.json"), "not json{{{");

    await expect(parseGoogleAssistantExport(testDir)).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it("assigns default names and IDs to routines missing them", async () => {
    const routinesDir = join(testDir, "Google Assistant", "Routines");
    await mkdir(routinesDir, { recursive: true });

    const routines = [
      { trigger: { type: "schedule", time: "10:00" }, actions: [{ type: "tell_news" }] },
    ];

    await writeFile(join(routinesDir, "routines.json"), JSON.stringify(routines));

    const result = await parseGoogleAssistantExport(testDir);
    expect(result.routines).toHaveLength(1);
    expect(result.routines[0].name).toBe("Routine 1");
    expect(result.routines[0].id).toBe("ga-routine-0");
  });
});
