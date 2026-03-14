import { describe, expect, it } from "vitest";

import { ingest, ingestBatch } from "./ingestion.js";
import type { RawConversationEntry } from "./types.js";

function makeRaw(text: string, sessionId = "session-1"): RawConversationEntry {
  return {
    timestamp: new Date().toISOString(),
    text,
    sessionId,
  };
}

describe("ingest", () => {
  it("extracts preferences from conversation text", () => {
    const raw = makeRaw("I prefer emails to be summarized in bullet points. Please always use formal language.");
    const result = ingest(raw);

    expect(result.entries.length).toBeGreaterThan(0);
    const prefs = result.entries.filter((e) => e.category === "preferences");
    expect(prefs.length).toBeGreaterThan(0);
  });

  it("extracts relationships from conversation text", () => {
    const raw = makeRaw("Sarah works with the engineering team. My colleague John handles the backend.");
    const result = ingest(raw);

    const rels = result.entries.filter((e) => e.category === "relationships");
    expect(rels.length).toBeGreaterThan(0);
  });

  it("extracts domain expertise from conversation text", () => {
    const raw = makeRaw("I'm working on kubernetes deployment scripts. Using terraform for infrastructure.");
    const result = ingest(raw);

    const domains = result.entries.filter((e) => e.category === "domain_expertise");
    expect(domains.length).toBeGreaterThan(0);
  });

  it("extracts context from conversation text", () => {
    const raw = makeRaw("Right now I'm focused on the Q4 release. Currently refactoring the auth module.");
    const result = ingest(raw);

    const ctx = result.entries.filter((e) => e.category === "context");
    expect(ctx.length).toBeGreaterThan(0);
  });

  it("deduplicates identical matches", () => {
    const raw = makeRaw("I prefer dark mode. I prefer dark mode.");
    const result = ingest(raw);

    const contents = result.entries.map((e) => e.content);
    const unique = new Set(contents);
    expect(contents.length).toBe(unique.size);
  });

  it("returns token counts", () => {
    const raw = makeRaw("I prefer short summaries. Please always include timestamps.");
    const result = ingest(raw);

    expect(result.rawTokenCount).toBeGreaterThan(0);
    expect(result.structuredTokenCount).toBeGreaterThanOrEqual(0);
  });

  it("returns empty entries for text with no patterns", () => {
    const raw = makeRaw("Hello, how are you?");
    const result = ingest(raw);

    expect(result.entries).toHaveLength(0);
  });

  it("assigns unique IDs to entries", () => {
    const raw = makeRaw("I prefer dark mode. I like fast responses. Please always be concise.");
    const result = ingest(raw);

    const ids = result.entries.map((e) => e.id);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });
});

describe("ingestBatch", () => {
  it("processes multiple raw entries", () => {
    const raws = [
      makeRaw("I prefer bullet points.", "s1"),
      makeRaw("Working on kubernetes.", "s2"),
    ];
    const result = ingestBatch(raws);

    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.rawTokenCount).toBeGreaterThan(0);
  });
});
