import { describe, expect, it } from "vitest";

import {
  buildCronExpression,
  convertRoutine,
  convertRoutines,
  suggestAlternative,
} from "./converter.js";
import type { RoutineEntry } from "./types.js";

describe("buildCronExpression", () => {
  it("builds a basic cron expression from time", () => {
    expect(buildCronExpression("07:30")).toBe("30 7 * * *");
  });

  it("builds expression with specific days", () => {
    expect(buildCronExpression("08:00", ["monday", "wednesday", "friday"]))
      .toBe("0 8 * * 1,3,5");
  });

  it("handles all days as wildcard", () => {
    const allDays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    expect(buildCronExpression("09:00", allDays)).toBe("0 9 * * *");
  });

  it("handles short day names", () => {
    expect(buildCronExpression("06:00", ["mon", "tue", "wed"]))
      .toBe("0 6 * * 1,2,3");
  });

  it("returns null for invalid time format", () => {
    expect(buildCronExpression("invalid")).toBeNull();
    expect(buildCronExpression("25:00")).toBeNull();
    expect(buildCronExpression("12:60")).toBeNull();
  });

  it("handles midnight", () => {
    expect(buildCronExpression("00:00")).toBe("0 0 * * *");
  });

  it("handles single-digit hour", () => {
    expect(buildCronExpression("7:00")).toBe("0 7 * * *");
  });

  it("handles empty days array as every day", () => {
    expect(buildCronExpression("12:00", [])).toBe("0 12 * * *");
  });
});

describe("suggestAlternative", () => {
  it("flags smart home actions", () => {
    const result = suggestAlternative({ type: "adjust_lights" });
    expect(result).toBeDefined();
    expect(result?.suggestion).toContain("Home Assistant");
  });

  it("flags broadcast action", () => {
    const result = suggestAlternative({ type: "broadcast" });
    expect(result).toBeDefined();
    expect(result?.suggestion).toContain("Telegram");
  });

  it("returns null for mappable actions", () => {
    expect(suggestAlternative({ type: "tell_weather" })).toBeNull();
    expect(suggestAlternative({ type: "tell_calendar_events" })).toBeNull();
    expect(suggestAlternative({ type: "tell_news" })).toBeNull();
  });

  it("returns null for custom_command", () => {
    expect(suggestAlternative({ type: "custom_command", command: "Do something" })).toBeNull();
  });

  it("flags unknown action types", () => {
    const result = suggestAlternative({ type: "some_unknown_action" });
    expect(result).toBeDefined();
    expect(result?.reason).toContain("Unknown");
  });
});

describe("convertRoutine", () => {
  it("converts a schedule-based routine to cron job", () => {
    const routine: RoutineEntry = {
      id: "r1",
      name: "Good Morning",
      trigger: {
        type: "schedule",
        time: "07:00",
        days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      },
      actions: [
        { type: "tell_weather" },
        { type: "tell_calendar_events" },
      ],
      enabled: true,
    };

    const result = convertRoutine(routine);
    expect(result.mappable).toBe(true);
    expect(result.cronJob).toBeDefined();
    const cron = result.cronJob;
    expect(cron?.expr).toBe("0 7 * * 1,2,3,4,5");
    expect(cron?.kind).toBe("cron");
    expect(cron?.enabled).toBe(true);
    expect(cron?.task).toContain("weather");
    expect(cron?.task).toContain("calendar");
  });

  it("rejects voice-triggered routines", () => {
    const routine: RoutineEntry = {
      id: "r2",
      name: "Hey Google",
      trigger: { type: "voice", phrase: "good morning" },
      actions: [{ type: "tell_weather" }],
      enabled: true,
    };

    const result = convertRoutine(routine);
    expect(result.mappable).toBe(false);
    expect(result.reason).toContain("voice");
  });

  it("flags unmappable actions within a mappable routine", () => {
    const routine: RoutineEntry = {
      id: "r3",
      name: "Morning Mix",
      trigger: { type: "schedule", time: "07:30" },
      actions: [
        { type: "tell_weather" },
        { type: "adjust_lights" },
      ],
      enabled: true,
    };

    const result = convertRoutine(routine);
    expect(result.mappable).toBe(true);
    expect(result.unmappableActions).toHaveLength(1);
    expect(result.unmappableActions[0].action.type).toBe("adjust_lights");
    expect(result.unmappableActions[0].suggestion).toContain("Home Assistant");
  });

  it("rejects routine where all actions are unmappable", () => {
    const routine: RoutineEntry = {
      id: "r4",
      name: "Smart Home Only",
      trigger: { type: "schedule", time: "08:00" },
      actions: [
        { type: "adjust_lights" },
        { type: "adjust_thermostat" },
      ],
      enabled: true,
    };

    const result = convertRoutine(routine);
    expect(result.mappable).toBe(false);
    expect(result.reason).toContain("No mappable actions");
  });

  it("includes timezone in activeHours when available", () => {
    const routine: RoutineEntry = {
      id: "r5",
      name: "Timed",
      trigger: {
        type: "schedule",
        time: "09:00",
        timezone: "America/Los_Angeles",
      },
      actions: [{ type: "tell_news" }],
      enabled: true,
    };

    const result = convertRoutine(routine);
    expect(result.cronJob?.activeHours?.tz).toBe("America/Los_Angeles");
  });

  it("converts custom_command actions", () => {
    const routine: RoutineEntry = {
      id: "r6",
      name: "Custom",
      trigger: { type: "schedule", time: "10:00" },
      actions: [{ type: "custom_command", command: "Check my email inbox" }],
      enabled: true,
    };

    const result = convertRoutine(routine);
    expect(result.mappable).toBe(true);
    expect(result.cronJob?.task).toBe("Check my email inbox");
  });

  it("generates stable cron IDs from routine name", () => {
    const routine: RoutineEntry = {
      id: "r7",
      name: "Good Morning Routine!",
      trigger: { type: "schedule", time: "07:00" },
      actions: [{ type: "tell_weather" }],
      enabled: true,
    };

    const result = convertRoutine(routine);
    expect(result.cronJob?.id).toBe("ga-good-morning-routine");
  });
});

describe("convertRoutines", () => {
  it("converts multiple routines", () => {
    const routines: RoutineEntry[] = [
      {
        id: "r1",
        name: "Morning",
        trigger: { type: "schedule", time: "07:00" },
        actions: [{ type: "tell_weather" }],
        enabled: true,
      },
      {
        id: "r2",
        name: "Voice Only",
        trigger: { type: "voice", phrase: "hello" },
        actions: [{ type: "tell_news" }],
        enabled: true,
      },
    ];

    const results = convertRoutines(routines);
    expect(results).toHaveLength(2);
    expect(results[0].mappable).toBe(true);
    expect(results[1].mappable).toBe(false);
  });
});
