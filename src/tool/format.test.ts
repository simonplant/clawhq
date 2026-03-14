import { describe, expect, it } from "vitest";

import { formatToolList } from "./format.js";
import type { ToolListEntry } from "./tool.js";

describe("formatToolList", () => {
  it("formats a list of tools with mixed statuses", () => {
    const entries: ToolListEntry[] = [
      {
        name: "curl",
        description: "HTTP client",
        installed: true,
        alwaysIncluded: true,
        installedAt: null,
        tags: ["http"],
      },
      {
        name: "himalaya",
        description: "Email client",
        installed: true,
        alwaysIncluded: false,
        installedAt: "2026-03-13T00:00:00Z",
        tags: ["email"],
      },
      {
        name: "ffmpeg",
        description: "Media processing",
        installed: false,
        alwaysIncluded: false,
        installedAt: null,
        tags: ["media"],
      },
    ];

    const output = formatToolList(entries);

    expect(output).toContain("CLI Tools:");
    expect(output).toContain("curl");
    expect(output).toContain("always included");
    expect(output).toContain("himalaya");
    expect(output).toContain("installed");
    expect(output).toContain("ffmpeg");
    expect(output).toContain("available");
    expect(output).toContain("2 installed, 1 available");
  });
});
