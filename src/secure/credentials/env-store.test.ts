import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DIR_MODE_SECRET } from "../../config/defaults.js";

import {
  deleteEnvValue,
  getAllEnvValues,
  getEnvValue,
  parseEnv,
  readEnv,
  readEnvValue,
  removeEnvValue,
  serializeEnv,
  setEnvValue,
  verifyEnvPermissions,
  writeEnvAtomic,
  writeEnvValue,
} from "./env-store.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "clawhq-env-test-"));
}

const SAMPLE_ENV = `# Database config
DB_HOST=localhost
DB_PORT=5432
DB_PASSWORD=s3cret

# API keys
API_KEY=abc123
EMPTY_VAR=
QUOTED_VAR="hello world"
SINGLE_QUOTED='raw value'
`;

// ── parseEnv ────────────────────────────────────────────────────────────────

describe("parseEnv", () => {
  it("parses key=value entries", () => {
    const env = parseEnv("FOO=bar\nBAZ=qux\n");
    expect(env.lines).toHaveLength(2);
    expect(env.lines[0]).toEqual({ kind: "entry", key: "FOO", value: "bar", raw: "FOO=bar" });
    expect(env.lines[1]).toEqual({ kind: "entry", key: "BAZ", value: "qux", raw: "BAZ=qux" });
  });

  it("preserves comments", () => {
    const env = parseEnv("# this is a comment\nFOO=bar\n");
    expect(env.lines[0]).toEqual({ kind: "comment", raw: "# this is a comment" });
    expect(env.lines[1]).toEqual({ kind: "entry", key: "FOO", value: "bar", raw: "FOO=bar" });
  });

  it("preserves blank lines", () => {
    const env = parseEnv("FOO=bar\n\nBAZ=qux\n");
    expect(env.lines).toHaveLength(3);
    expect(env.lines[1]).toEqual({ kind: "blank", raw: "" });
  });

  it("handles empty values", () => {
    const env = parseEnv("EMPTY=\n");
    expect(env.lines[0]).toEqual({ kind: "entry", key: "EMPTY", value: "", raw: "EMPTY=" });
  });

  it("handles double-quoted values", () => {
    const env = parseEnv('QUOTED="hello world"\n');
    expect(getEnvValue(env, "QUOTED")).toBe("hello world");
  });

  it("handles single-quoted values", () => {
    const env = parseEnv("SINGLE='raw value'\n");
    expect(getEnvValue(env, "SINGLE")).toBe("raw value");
  });

  it("handles double-quoted escape sequences", () => {
    const env = parseEnv('ESCAPED="line1\\nline2\\ttab"\n');
    expect(getEnvValue(env, "ESCAPED")).toBe("line1\nline2\ttab");
  });

  it("handles literal backslash in double-quoted values", () => {
    const env = parseEnv('PATH="C:\\\\Users\\\\test"\n');
    expect(getEnvValue(env, "PATH")).toBe("C:\\Users\\test");
  });

  it("handles escaped backslash before n (not a newline)", () => {
    const env = parseEnv('VAL="foo\\\\nbar"\n');
    expect(getEnvValue(env, "VAL")).toBe("foo\\nbar");
  });

  it("handles values with inline comments", () => {
    const env = parseEnv("FOO=bar # this is a comment\n");
    expect(getEnvValue(env, "FOO")).toBe("bar");
  });

  it("treats unparseable lines as comments", () => {
    const env = parseEnv("not a valid line\nFOO=bar\n");
    expect(env.lines[0]).toEqual({ kind: "comment", raw: "not a valid line" });
    expect(env.lines[1]).toEqual({ kind: "entry", key: "FOO", value: "bar", raw: "FOO=bar" });
  });

  it("handles the sample env correctly", () => {
    const env = parseEnv(SAMPLE_ENV);
    expect(getAllEnvValues(env)).toEqual({
      DB_HOST: "localhost",
      DB_PORT: "5432",
      DB_PASSWORD: "s3cret",
      API_KEY: "abc123",
      EMPTY_VAR: "",
      QUOTED_VAR: "hello world",
      SINGLE_QUOTED: "raw value",
    });
  });

  it("parses empty content", () => {
    const env = parseEnv("");
    expect(env.lines).toHaveLength(0);
  });

  it("handles keys with underscores and numbers", () => {
    const env = parseEnv("MY_VAR_2=test\n_PRIVATE=yes\n");
    expect(getEnvValue(env, "MY_VAR_2")).toBe("test");
    expect(getEnvValue(env, "_PRIVATE")).toBe("yes");
  });
});

// ── serializeEnv ────────────────────────────────────────────────────────────

describe("serializeEnv", () => {
  it("round-trips simple entries", () => {
    const input = "FOO=bar\nBAZ=qux\n";
    const env = parseEnv(input);
    expect(serializeEnv(env)).toBe(input);
  });

  it("preserves comments and blank lines", () => {
    const env = parseEnv(SAMPLE_ENV);
    const output = serializeEnv(env);
    // Comments and blanks are preserved exactly
    expect(output).toContain("# Database config");
    expect(output).toContain("# API keys");
    expect(output).toContain("\n\n"); // blank line preserved
  });

  it("returns empty string for empty env", () => {
    expect(serializeEnv({ lines: [] })).toBe("");
  });

  it("quotes values that need quoting", () => {
    const env = setEnvValue({ lines: [] }, "SPACED", "hello world");
    const output = serializeEnv(env);
    expect(output).toBe('"hello world"\n'.replace(/^/, "SPACED="));
  });
});

// ── readEnv / writeEnvAtomic ────────────────────────────────────────────────

describe("readEnv", () => {
  it("returns empty for nonexistent file", () => {
    const env = readEnv("/nonexistent/path/.env");
    expect(env.lines).toHaveLength(0);
  });

  it("reads existing .env file", () => {
    const dir = tmpDir();
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "KEY=value\n");

    const env = readEnv(envPath);
    expect(getEnvValue(env, "KEY")).toBe("value");
  });
});

describe("writeEnvAtomic", () => {
  it("writes file with 0600 permissions", () => {
    const dir = tmpDir();
    const envPath = join(dir, ".env");
    const env = parseEnv("SECRET=hunter2\n");

    writeEnvAtomic(envPath, env);

    expect(existsSync(envPath)).toBe(true);
    const stat = statSync(envPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("preserves content through write cycle", () => {
    const dir = tmpDir();
    const envPath = join(dir, ".env");
    const env = parseEnv(SAMPLE_ENV);

    writeEnvAtomic(envPath, env);

    const readBack = readFileSync(envPath, "utf-8");
    expect(readBack).toContain("# Database config");
    expect(readBack).toContain("DB_HOST=localhost");
    expect(readBack).toContain("# API keys");
  });

  it("creates parent directories if needed", () => {
    const dir = tmpDir();
    const envPath = join(dir, "engine", ".env");
    const env = parseEnv("KEY=val\n");

    writeEnvAtomic(envPath, env);
    expect(existsSync(envPath)).toBe(true);
  });

  it("creates parent directory with mode 0700", () => {
    const dir = tmpDir();
    const engineDir = join(dir, "engine");
    const envPath = join(engineDir, ".env");
    const env = parseEnv("SECRET=val\n");

    writeEnvAtomic(envPath, env);

    const stat = statSync(engineDir);
    expect(stat.mode & 0o777).toBe(DIR_MODE_SECRET);
  });

  it("overwrites existing file atomically", () => {
    const dir = tmpDir();
    const envPath = join(dir, ".env");

    // Write initial content
    const initial = parseEnv("OLD=value\n");
    writeEnvAtomic(envPath, initial);

    // Overwrite with new content
    const updated = parseEnv("NEW=value\n");
    writeEnvAtomic(envPath, updated);

    const content = readFileSync(envPath, "utf-8");
    expect(content).toBe("NEW=value\n");
    expect(content).not.toContain("OLD");
  });

  it("leaves no temp files on success", () => {
    const dir = tmpDir();
    const envPath = join(dir, ".env");
    const env = parseEnv("KEY=val\n");

    writeEnvAtomic(envPath, env);

    const files = readdirSync(dir);
    const tmpFiles = files.filter((f) => f.startsWith(".env.tmp."));
    expect(tmpFiles).toHaveLength(0);
  });

  it("maintains 0600 even when umask is permissive", () => {
    const dir = tmpDir();
    const envPath = join(dir, ".env");
    const env = parseEnv("SECRET=val\n");

    writeEnvAtomic(envPath, env);

    expect(verifyEnvPermissions(envPath)).toBe(true);
  });
});

// ── get/set/remove operations ───────────────────────────────────────────────

describe("getEnvValue", () => {
  it("returns value for existing key", () => {
    const env = parseEnv("FOO=bar\n");
    expect(getEnvValue(env, "FOO")).toBe("bar");
  });

  it("returns undefined for missing key", () => {
    const env = parseEnv("FOO=bar\n");
    expect(getEnvValue(env, "MISSING")).toBeUndefined();
  });
});

describe("setEnvValue", () => {
  it("updates existing key in place", () => {
    const env = parseEnv("# header\nFOO=old\nBAR=keep\n");
    const updated = setEnvValue(env, "FOO", "new");

    expect(getEnvValue(updated, "FOO")).toBe("new");
    expect(getEnvValue(updated, "BAR")).toBe("keep");
    // Comment preserved
    expect(updated.lines[0]).toEqual({ kind: "comment", raw: "# header" });
    // Position preserved: FOO is still at index 1
    expect(updated.lines[1]).toEqual(
      expect.objectContaining({ kind: "entry", key: "FOO", value: "new" }),
    );
  });

  it("appends new key at end", () => {
    const env = parseEnv("EXISTING=yes\n");
    const updated = setEnvValue(env, "NEW_KEY", "new_val");

    expect(updated.lines).toHaveLength(2);
    expect(getEnvValue(updated, "NEW_KEY")).toBe("new_val");
    expect(updated.lines[1]).toEqual(
      expect.objectContaining({ kind: "entry", key: "NEW_KEY" }),
    );
  });

  it("does not mutate original", () => {
    const env = parseEnv("FOO=bar\n");
    const updated = setEnvValue(env, "FOO", "baz");

    expect(getEnvValue(env, "FOO")).toBe("bar");
    expect(getEnvValue(updated, "FOO")).toBe("baz");
  });

  it("preserves comments and blank lines", () => {
    const env = parseEnv(SAMPLE_ENV);
    const updated = setEnvValue(env, "DB_HOST", "remote.db.com");

    const output = serializeEnv(updated);
    expect(output).toContain("# Database config");
    expect(output).toContain("# API keys");
    expect(output).toContain("DB_HOST=remote.db.com");
  });
});

describe("removeEnvValue", () => {
  it("removes existing key", () => {
    const env = parseEnv("FOO=bar\nBAZ=qux\n");
    const updated = removeEnvValue(env, "FOO");

    expect(getEnvValue(updated, "FOO")).toBeUndefined();
    expect(getEnvValue(updated, "BAZ")).toBe("qux");
    expect(updated.lines).toHaveLength(1);
  });

  it("preserves comments when removing", () => {
    const env = parseEnv("# header\nFOO=bar\n# footer\n");
    const updated = removeEnvValue(env, "FOO");

    expect(updated.lines).toHaveLength(2);
    expect(updated.lines[0]).toEqual({ kind: "comment", raw: "# header" });
    expect(updated.lines[1]).toEqual({ kind: "comment", raw: "# footer" });
  });

  it("returns unchanged if key not found", () => {
    const env = parseEnv("FOO=bar\n");
    const updated = removeEnvValue(env, "MISSING");

    expect(updated.lines).toHaveLength(1);
  });

  it("does not mutate original", () => {
    const env = parseEnv("FOO=bar\n");
    const updated = removeEnvValue(env, "FOO");

    expect(getEnvValue(env, "FOO")).toBe("bar");
    expect(getEnvValue(updated, "FOO")).toBeUndefined();
  });
});

describe("getAllEnvValues", () => {
  it("returns all entries as record", () => {
    const env = parseEnv("A=1\n# comment\nB=2\n");
    expect(getAllEnvValues(env)).toEqual({ A: "1", B: "2" });
  });

  it("returns empty object for empty env", () => {
    expect(getAllEnvValues({ lines: [] })).toEqual({});
  });
});

// ── High-level convenience functions ────────────────────────────────────────

describe("readEnvValue", () => {
  it("reads a value from disk", () => {
    const dir = tmpDir();
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "TOKEN=abc123\n");

    expect(readEnvValue(envPath, "TOKEN")).toBe("abc123");
  });

  it("returns undefined for missing key", () => {
    const dir = tmpDir();
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "TOKEN=abc123\n");

    expect(readEnvValue(envPath, "MISSING")).toBeUndefined();
  });
});

describe("writeEnvValue", () => {
  it("sets a value on disk with 0600 permissions", () => {
    const dir = tmpDir();
    const envPath = join(dir, ".env");

    writeEnvValue(envPath, "SECRET", "hunter2");

    expect(readEnvValue(envPath, "SECRET")).toBe("hunter2");
    expect(verifyEnvPermissions(envPath)).toBe(true);
  });

  it("preserves existing values when adding new ones", () => {
    const dir = tmpDir();
    const envPath = join(dir, ".env");

    writeEnvValue(envPath, "A", "1");
    writeEnvValue(envPath, "B", "2");

    expect(readEnvValue(envPath, "A")).toBe("1");
    expect(readEnvValue(envPath, "B")).toBe("2");
  });

  it("preserves format when updating", () => {
    const dir = tmpDir();
    const envPath = join(dir, ".env");
    writeFileSync(envPath, SAMPLE_ENV, { mode: 0o600 });

    writeEnvValue(envPath, "DB_HOST", "newhost");

    const content = readFileSync(envPath, "utf-8");
    expect(content).toContain("# Database config");
    expect(content).toContain("DB_HOST=newhost");
    expect(content).toContain("# API keys");
  });
});

describe("deleteEnvValue", () => {
  it("removes a value from disk", () => {
    const dir = tmpDir();
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "A=1\nB=2\n", { mode: 0o600 });

    deleteEnvValue(envPath, "A");

    expect(readEnvValue(envPath, "A")).toBeUndefined();
    expect(readEnvValue(envPath, "B")).toBe("2");
    expect(verifyEnvPermissions(envPath)).toBe(true);
  });
});

// ── verifyEnvPermissions ────────────────────────────────────────────────────

describe("verifyEnvPermissions", () => {
  it("returns true for 0600 file", () => {
    const dir = tmpDir();
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "X=1\n", { mode: 0o600 });

    expect(verifyEnvPermissions(envPath)).toBe(true);
  });

  it("returns false for 0644 file", () => {
    const dir = tmpDir();
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "X=1\n", { mode: 0o644 });

    expect(verifyEnvPermissions(envPath)).toBe(false);
  });

  it("returns false for nonexistent file", () => {
    expect(verifyEnvPermissions("/nonexistent/.env")).toBe(false);
  });
});

// ── Format preservation round-trip ──────────────────────────────────────────

describe("format preservation", () => {
  it("full round-trip preserves structure", () => {
    const dir = tmpDir();
    const envPath = join(dir, ".env");

    // Write the sample env
    writeFileSync(envPath, SAMPLE_ENV, { mode: 0o600 });

    // Read, modify, write back
    const env = readEnv(envPath);
    const updated = setEnvValue(env, "DB_PASSWORD", "newsecret");
    writeEnvAtomic(envPath, updated);

    // Read again and verify structure
    const final = readFileSync(envPath, "utf-8");

    // Comments preserved
    expect(final).toContain("# Database config");
    expect(final).toContain("# API keys");

    // Blank line preserved (between sections)
    expect(final).toMatch(/DB_PASSWORD=newsecret\n\n# API keys/);

    // Updated value correct
    expect(final).toContain("DB_PASSWORD=newsecret");

    // Other values unchanged
    expect(final).toContain("DB_HOST=localhost");
    expect(final).toContain("API_KEY=abc123");
  });

  it("multiple set/remove operations preserve format", () => {
    let env = parseEnv(SAMPLE_ENV);

    env = setEnvValue(env, "DB_HOST", "remote.db.com");
    env = setEnvValue(env, "NEW_VAR", "added");
    env = removeEnvValue(env, "EMPTY_VAR");

    const output = serializeEnv(env);

    expect(output).toContain("# Database config");
    expect(output).toContain("DB_HOST=remote.db.com");
    expect(output).toContain("NEW_VAR=added");
    expect(output).not.toContain("EMPTY_VAR");
    expect(output).toContain("# API keys");
  });
});
