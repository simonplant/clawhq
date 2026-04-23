/**
 * Plan loader — parses today's brief into ORDER blocks.
 *
 * Source of truth: `memory/trading-YYYY-MM-DD.md`. The brief is a rolling
 * markdown log produced by OpenClaw (morning synthesis, cron scans, EOD
 * review). ORDER blocks live anywhere in the file as plain-text key:value
 * pairs per `configs/references/STANDARD_ORDER_FORMAT.md`.
 *
 * Hand-authored parser against the reference spec. Golden files in
 * `extract/golden/` exercise real-world-shaped inputs. Any change to the
 * parser requires regenerating affected goldens and reviewing the diff.
 *
 * Behavior:
 *   - Block header: `ORDER N | CONVICTION | STATUS`
 *   - Body: two-space-indented `key: value` lines
 *   - Block ends at the next `ORDER` header, a separator, or EOF
 *   - Unparseable blocks are skipped with a warning; other blocks still load
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import {
  CONVICTIONS,
  CONFIRMATIONS,
  ORDER_STATUSES,
  type Account,
  type Confirmation,
  type Conviction,
  type Direction,
  type OrderBlock,
  type OrderStatus,
  type Source,
} from "./types.js";

export interface LoadedPlan {
  path: string;
  loadedAtMs: number;
  orders: OrderBlock[];
  /** Non-fatal parse errors (malformed blocks that were skipped). */
  warnings: string[];
}

export type PlanLoadResult =
  | { ok: true; plan: LoadedPlan }
  | { ok: false; reason: "missing" | "parse-failed"; path: string; error?: string };

/** Load and parse a brief file. Returns a tagged result; never throws. */
export function loadPlan(path: string): PlanLoadResult {
  if (!existsSync(path)) {
    return { ok: false, reason: "missing", path };
  }
  try {
    const text = readFileSync(path, "utf-8");
    const { orders, warnings } = parseOrderBlocks(text);
    return {
      ok: true,
      plan: {
        path,
        loadedAtMs: Date.now(),
        orders,
        warnings,
      },
    };
  } catch (err) {
    return {
      ok: false,
      reason: "parse-failed",
      path,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Parser ───────────────────────────────────────────────────────────────────

const ORDER_HEADER_RE = /^ORDER\s+(\d+)\s*\|\s*([A-Z_]+)\s*\|\s*([A-Z_]+)\s*$/;
const FIELD_RE = /^\s{2,}([a-z_][a-z0-9_]*):\s*(.*)$/;

interface ParseOutput {
  orders: OrderBlock[];
  warnings: string[];
}

/**
 * Extract every ORDER block from the brief text, in document order.
 * Malformed blocks are recorded as warnings and skipped — a single bad
 * block must not prevent the rest of the plan from loading.
 */
export function parseOrderBlocks(text: string): ParseOutput {
  const lines = text.split(/\r?\n/);
  const orders: OrderBlock[] = [];
  const warnings: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const header = ORDER_HEADER_RE.exec(line);
    if (!header) {
      i++;
      continue;
    }

    const seq = Number.parseInt(header[1] ?? "0", 10);
    const convictionRaw = (header[2] ?? "").toUpperCase();
    const statusRaw = (header[3] ?? "").toUpperCase();

    // Collect body lines (indented key:value) until the next header or an
    // un-indented separator line.
    const body: Record<string, string> = {};
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j] ?? "";
      if (ORDER_HEADER_RE.test(next)) break;
      if (isSeparator(next)) break;
      if (next.trim() === "" && j + 1 < lines.length) {
        // Allow one blank line within a block.
        j++;
        continue;
      }
      const field = FIELD_RE.exec(next);
      if (field) {
        const key = (field[1] ?? "").toLowerCase();
        const value = (field[2] ?? "").trim();
        body[key] = value;
      } else if (next.trim() !== "" && !next.startsWith(" ")) {
        // Non-indented, non-empty line outside a body — end the block.
        break;
      }
      j++;
    }

    const parseResult = buildOrder(seq, convictionRaw, statusRaw, body);
    if (parseResult.ok) {
      orders.push(parseResult.order);
    } else {
      warnings.push(`ORDER ${seq}: ${parseResult.reason}`);
    }

    i = j;
  }

  // Duplicate-sequence detection. The sequence number is meant to uniquely
  // identify an order within a plan; two ORDER N blocks in the same plan
  // (usually a copy/paste mistake) would silently coexist under the prior
  // implementation and create a second alert/position for the same
  // intended order. Surface them as warnings and drop the later occurrences.
  const seenSeq = new Set<number>();
  const deduped: OrderBlock[] = [];
  for (const order of orders) {
    if (seenSeq.has(order.sequence)) {
      warnings.push(
        `ORDER ${order.sequence}: duplicate sequence number — keeping first occurrence, dropping this one`,
      );
      continue;
    }
    seenSeq.add(order.sequence);
    deduped.push(order);
  }

  return { orders: deduped, warnings };
}

/** Heuristic: `---`, `===`, or a new `##` heading ends a block. */
function isSeparator(line: string): boolean {
  const t = line.trim();
  if (t.startsWith("---")) return true;
  if (t.startsWith("===")) return true;
  if (t.startsWith("##")) return true;
  return false;
}

// ── Block-level type construction ────────────────────────────────────────────

type BuildResult =
  | { ok: true; order: OrderBlock }
  | { ok: false; reason: string };

function buildOrder(
  sequence: number,
  convictionRaw: string,
  statusRaw: string,
  body: Record<string, string>,
): BuildResult {
  const conviction = coerceEnum<Conviction>(convictionRaw, CONVICTIONS);
  if (!conviction) return { ok: false, reason: `invalid conviction "${convictionRaw}"` };

  const status = coerceEnum<OrderStatus>(statusRaw, ORDER_STATUSES);
  if (!status) return { ok: false, reason: `invalid status "${statusRaw}"` };

  const source = coerceSource(body.source);
  if (!source) return { ok: false, reason: `invalid source "${body.source ?? ""}"` };

  const accounts = parseAccounts(body.accounts);
  if (accounts.length === 0) {
    return { ok: false, reason: "accounts field empty or unrecognized" };
  }

  const ticker = body.ticker;
  if (!ticker) return { ok: false, reason: "missing ticker" };

  const execAs = body.exec_as ?? ticker;

  const direction = coerceDirection(body.direction);
  if (!direction) return { ok: false, reason: `invalid direction "${body.direction ?? ""}"` };

  const entryParsed = parseEntry(body.entry);
  if (!entryParsed) return { ok: false, reason: `invalid entry "${body.entry ?? ""}"` };

  const stopInfo = parsePriceWithSource(body.stop);
  if (!stopInfo) return { ok: false, reason: `invalid stop "${body.stop ?? ""}"` };

  const t1Info = parsePriceWithSource(body.t1);
  if (!t1Info) return { ok: false, reason: `invalid t1 "${body.t1 ?? ""}"` };

  const t2Info = parsePriceWithSource(body.t2);
  if (!t2Info) return { ok: false, reason: `invalid t2 "${body.t2 ?? ""}"` };

  const confirmation = coerceEnum<Confirmation>(
    (body.confirmation ?? "").toUpperCase(),
    CONFIRMATIONS,
  );
  if (!confirmation) {
    return { ok: false, reason: `invalid confirmation "${body.confirmation ?? ""}"` };
  }

  const risk = parseRisk(body.risk);

  const id = synthesizeId(source, ticker, entryParsed.price, direction);

  return {
    ok: true,
    order: {
      id,
      sequence,
      source,
      accounts,
      ticker: ticker.toUpperCase(),
      execAs,
      direction,
      setup: body.setup ?? "",
      why: body.why ?? "",
      entry: entryParsed.price,
      entryOrderType: entryParsed.orderType,
      stop: stopInfo.price,
      stopSource: stopInfo.source,
      t1: t1Info.price,
      t1Source: t1Info.source,
      t2: t2Info.price,
      t2Source: t2Info.source,
      runner: body.runner ?? "",
      riskPerShare: risk.perShare,
      quantity: risk.quantity,
      totalRisk: risk.total,
      confirmation,
      conviction,
      confluence: body.confluence ?? "none",
      caveat: body.caveat ?? "none",
      kills: parseKills(body.kills),
      activation: body.activation ?? "immediate",
      verify: body.verify ?? "none",
      status,
    },
  };
}

// ── Coercion helpers ─────────────────────────────────────────────────────────

function coerceEnum<T extends string>(
  value: string,
  allowed: readonly T[],
): T | undefined {
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function coerceSource(raw: string | undefined): Source | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toLowerCase();
  if (s === "mancini" || s === "dp" || s === "focus25" || s === "scanner") {
    return s;
  }
  return undefined;
}

function coerceDirection(raw: string | undefined): Direction | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toUpperCase();
  if (s === "LONG" || s === "SHORT") return s;
  return undefined;
}

function parseAccounts(raw: string | undefined): Account[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is Account => s === "tos" || s === "ira" || s === "tradier");
}

function parseKills(raw: string | undefined): string[] {
  if (!raw || raw.toLowerCase() === "none") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

interface EntryParsed {
  price: number;
  orderType: "LMT" | "MKT";
}

function parseEntry(raw: string | undefined): EntryParsed | undefined {
  if (!raw) return undefined;
  const m = /^\$?([\d,]+(?:\.\d+)?)\s*(LMT|MKT)?/i.exec(raw);
  if (!m) return undefined;
  const price = numFromStr(m[1]);
  if (price === undefined) return undefined;
  const orderType = (m[2] ?? "LMT").toUpperCase() === "MKT" ? "MKT" : "LMT";
  return { price, orderType };
}

interface PriceWithSource {
  price: number;
  source: string;
}

function parsePriceWithSource(raw: string | undefined): PriceWithSource | undefined {
  if (!raw) return undefined;
  // `7021 (75%) — stated` or `6998 — flush-4` or `7036 — next R`
  const m = /^\$?([\d,]+(?:\.\d+)?)\s*(?:\([^)]*\))?\s*(?:[—–-]\s*(.+))?/.exec(raw);
  if (!m) return undefined;
  const price = numFromStr(m[1]);
  if (price === undefined) return undefined;
  return { price, source: (m[2] ?? "stated").trim() };
}

interface RiskParsed {
  perShare: number;
  quantity: number;
  total: number;
}

/**
 * Parse a risk line like:
 *   "$2.30 per share | 100 shares | $230 total"
 *   "$23/pt | 2 /MES | $230"
 * Fallback: all zeros if unparseable.
 */
function parseRisk(raw: string | undefined): RiskParsed {
  if (!raw) return { perShare: 0, quantity: 0, total: 0 };
  const parts = raw.split("|").map((s) => s.trim());
  const perShare = extractFirstNumber(parts[0] ?? "");
  const quantity = extractFirstNumber(parts[1] ?? "");
  const total = extractFirstNumber(parts[2] ?? "");
  return {
    perShare: perShare ?? 0,
    quantity: quantity ?? 0,
    total: total ?? (perShare && quantity ? perShare * quantity : 0),
  };
}

function extractFirstNumber(s: string): number | undefined {
  const m = /([\d,]+(?:\.\d+)?)/.exec(s);
  return m ? numFromStr(m[1]) : undefined;
}

function numFromStr(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function synthesizeId(
  source: Source,
  ticker: string,
  entry: number,
  direction: Direction,
): string {
  const h = createHash("sha1");
  h.update(`${source}|${ticker.toUpperCase()}|${entry}|${direction}`);
  return `${source}-${ticker.toUpperCase()}-${h.digest("hex").slice(0, 8)}`;
}
