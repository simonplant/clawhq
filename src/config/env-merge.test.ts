import { describe, expect, it } from "vitest";

import { mergeEnv, parseEnvFile, protectCredentials } from "./env-merge.js";

describe("parseEnvFile", () => {
  it("parses simple key/value pairs", () => {
    const map = parseEnvFile("A=1\nB=2\n");
    expect(map.get("A")).toBe("1");
    expect(map.get("B")).toBe("2");
  });

  it("strips double-quoted values", () => {
    const map = parseEnvFile(`NAME="value"\n`);
    expect(map.get("NAME")).toBe("value");
  });

  it("handles single-quoted values", () => {
    const map = parseEnvFile(`NAME='value'\n`);
    expect(map.get("NAME")).toBe("value");
  });

  it("strips trailing inline comments after whitespace", () => {
    const map = parseEnvFile("KEY=real   # this is a comment\n");
    expect(map.get("KEY")).toBe("real");
  });

  it("preserves # inside values that are not preceded by whitespace (URL anchors)", () => {
    const map = parseEnvFile("URL=https://x.com/page#anchor\n");
    expect(map.get("URL")).toBe("https://x.com/page#anchor");
  });

  it("ignores blank and comment lines", () => {
    const map = parseEnvFile("# comment\n\nA=1\n# another\n");
    expect(map.size).toBe(1);
    expect(map.get("A")).toBe("1");
  });

  it("handles CRLF line endings", () => {
    const map = parseEnvFile("A=1\r\nB=2\r\n");
    expect(map.get("A")).toBe("1");
    expect(map.get("B")).toBe("2");
  });

  it("handles JSON-quoted values with embedded escapes", () => {
    const map = parseEnvFile(`JSON="{\\"a\\":\\"b\\"}"\n`);
    expect(map.get("JSON")).toBe(`{"a":"b"}`);
  });
});

describe("mergeEnv", () => {
  it("preserves a real existing value when generated is CHANGE_ME", () => {
    const existing = "TOKEN=realvalue\n";
    const generated = "TOKEN=CHANGE_ME\n";
    const merged = mergeEnv(existing, generated);
    expect(merged).toContain("TOKEN=realvalue");
    expect(merged).not.toContain("CHANGE_ME");
  });

  it("uses generated value when existing is CHANGE_ME", () => {
    const existing = "KEY=CHANGE_ME\n";
    const generated = "KEY=newreal\n";
    const merged = mergeEnv(existing, generated);
    expect(merged).toContain("KEY=newreal");
  });

  it("preserves keys that exist on disk but not in the generated template", () => {
    const existing = "KEY=val\nORPHAN=addedlater\n";
    const generated = "KEY=CHANGE_ME\n";
    const merged = mergeEnv(existing, generated);
    expect(merged).toContain("KEY=val");
    expect(merged).toContain("# Preserved from previous configuration");
    expect(merged).toContain("ORPHAN=addedlater");
  });

  it("does not duplicate keys on merge", () => {
    const existing = "TOKEN=real\n";
    const generated = "TOKEN=CHANGE_ME\n";
    const merged = mergeEnv(existing, generated);
    const tokenOccurrences = (merged.match(/^TOKEN=/gm) ?? []).length;
    expect(tokenOccurrences).toBe(1);
  });

  it("survives CRLF in the existing file without producing malformed output", () => {
    const existing = "TOKEN=real\r\nORPHAN=ghost\r\n";
    const generated = "TOKEN=CHANGE_ME\n";
    const merged = mergeEnv(existing, generated);
    expect(merged).toContain("TOKEN=real");
    expect(merged).toContain("ORPHAN=ghost");
    // No stray \r tokens should leak into the merged output.
    expect(merged).not.toContain("\r");
  });

});

describe("protectCredentials", () => {
  it("replaces generated real values with CHANGE_ME where existing has a value", () => {
    const generated = "TOKEN=freshly-generated\n";
    const result = protectCredentials(generated, { TOKEN: "old-real-token" });
    expect(result).toBe("TOKEN=CHANGE_ME");
  });

  it("leaves generated values alone when existing has no value for the key", () => {
    const generated = "NEW_KEY=fresh\n";
    const result = protectCredentials(generated, {});
    expect(result).toContain("NEW_KEY=fresh");
  });

  it("leaves CHANGE_ME placeholders alone", () => {
    const generated = "X=CHANGE_ME\n";
    const result = protectCredentials(generated, { X: "anything" });
    expect(result).toContain("X=CHANGE_ME");
  });

  it("preserves structure: comments and blank lines round-trip", () => {
    const generated = "# header\n\nA=1\nB=CHANGE_ME\n";
    const result = protectCredentials(generated, { A: "other" });
    expect(result).toContain("# header");
    expect(result.split("\n").filter((l) => l === "").length).toBeGreaterThan(0);
  });

});
