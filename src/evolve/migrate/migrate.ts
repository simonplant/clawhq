/**
 * Migration import orchestrator.
 *
 * Coordinates the full import pipeline:
 * 1. Parse export data (ChatGPT or Google Assistant)
 * 2. Extract preferences via local Ollama
 * 3. Map routines to cron jobs
 * 4. Apply PII masking to all extracted data
 * 5. Write results to the deployment directory
 *
 * All processing is local — zero network calls. PII is masked
 * before anything is persisted.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CronJobDefinition } from "../../config/types.js";
import {
  emptyMaskReport,
  maskPii,
  mergeMaskResult,
} from "../lifecycle/mask.js";
import type { PiiMaskReport } from "../lifecycle/types.js";

import { parseChatGPTExport } from "./chatgpt-parser.js";
import { mapRoutinesToCron } from "./cron-mapper.js";
import { extractPreferences } from "./extract.js";
import { parseGoogleAssistantExport } from "./google-parser.js";
import type {
  ExtractedPreference,
  MigrationOptions,
  MigrationProgress,
  MigrationResult,
  ParsedRoutine,
  ParseResult,
} from "./types.js";

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the full migration import pipeline.
 *
 * Parses the export, extracts preferences, maps routines to cron,
 * masks PII, and writes results to the deployment directory.
 * All processing is local — no network calls.
 */
export async function runMigration(
  options: MigrationOptions,
): Promise<MigrationResult> {
  const {
    exportPath,
    source,
    deployDir,
    ollamaUrl,
    ollamaModel,
    onProgress,
  } = options;

  const progress = (p: MigrationProgress) => onProgress?.(p);

  // ── Step 1: Parse ──────────────────────────────────────────────────────
  progress({ step: "parse", status: "running", message: `Parsing ${source} export…` });

  let parseResult: ParseResult;
  if (source === "chatgpt") {
    parseResult = await parseChatGPTExport(exportPath);
  } else {
    parseResult = await parseGoogleAssistantExport(exportPath);
  }

  if (!parseResult.success) {
    progress({ step: "parse", status: "failed", message: parseResult.error ?? "Parse failed" });
    return failureResult(source, parseResult.error ?? "Parse failed");
  }

  progress({
    step: "parse",
    status: "done",
    message: `Parsed ${parseResult.itemCount} items, ${parseResult.messages.length} messages, ${parseResult.routines.length} routines`,
  });

  // ── Step 2: Extract preferences ────────────────────────────────────────
  progress({ step: "extract", status: "running", message: "Extracting preferences via Ollama…" });

  const extraction = await extractPreferences(parseResult.messages, {
    ollamaUrl,
    ollamaModel,
  });

  if (extraction.success) {
    progress({
      step: "extract",
      status: "done",
      message: `Extracted ${extraction.preferences.length} preferences`,
    });
  } else {
    // Non-fatal — we still import routines even without preference extraction
    progress({
      step: "extract",
      status: "failed",
      message: extraction.error ?? "Extraction failed (non-fatal)",
    });
  }

  // ── Step 3: Map routines to cron ───────────────────────────────────────
  progress({ step: "map-cron", status: "running", message: "Mapping routines to cron jobs…" });

  const cronMapping = mapRoutinesToCron(parseResult.routines);

  progress({
    step: "map-cron",
    status: "done",
    message: `Mapped ${cronMapping.mappings.length} routines, ${cronMapping.unmapped.length} unmapped`,
  });

  // ── Step 4: Mask PII ───────────────────────────────────────────────────
  progress({ step: "mask-pii", status: "running", message: "Masking PII in extracted data…" });

  const maskedPreferences = maskPreferences(extraction.preferences);
  const maskedRoutines = maskRoutines(cronMapping.unmapped);
  const maskedCronJobs = maskCronJobs(
    cronMapping.mappings.map((m) => m.cronJob),
  );

  const piiReport = buildPiiReport(
    maskedPreferences.report,
    maskedRoutines.report,
    maskedCronJobs.report,
  );

  progress({
    step: "mask-pii",
    status: "done",
    message: `Masked ${piiReport.totalMasked} PII instances`,
  });

  // ── Step 5: Write to deployment directory ──────────────────────────────
  progress({ step: "write", status: "running", message: "Writing import results…" });

  await writeImportResults(deployDir, {
    preferences: maskedPreferences.items,
    cronJobs: maskedCronJobs.items,
    unmappedRoutines: maskedRoutines.items,
    source,
  });

  progress({ step: "write", status: "done", message: "Import complete" });

  return {
    success: true,
    source,
    itemsParsed: parseResult.itemCount,
    preferences: maskedPreferences.items,
    cronJobs: maskedCronJobs.items,
    piiReport,
    unmappedRoutines: maskedRoutines.items,
  };
}

// ── PII Masking Helpers ──────────────────────────────────────────────────────

interface MaskedItems<T> {
  readonly items: T[];
  readonly report: PiiMaskReport;
}

/** Mask PII in extracted preferences. */
function maskPreferences(
  preferences: readonly ExtractedPreference[],
): MaskedItems<ExtractedPreference> {
  let report = emptyMaskReport();
  const items: ExtractedPreference[] = [];

  for (const pref of preferences) {
    const result = maskPii(pref.preference);
    report = mergeMaskResult(report, "preferences", result);
    items.push({
      ...pref,
      preference: result.text,
    });
  }

  return { items, report };
}

/** Mask PII in unmapped routines. */
function maskRoutines(
  routines: readonly ParsedRoutine[],
): MaskedItems<ParsedRoutine> {
  let report = emptyMaskReport();
  const items: ParsedRoutine[] = [];

  for (const routine of routines) {
    const nameResult = maskPii(routine.name);
    const descResult = maskPii(routine.description);
    report = mergeMaskResult(report, "routines", nameResult);
    report = mergeMaskResult(report, "routines", descResult);
    items.push({
      ...routine,
      name: nameResult.text,
      description: descResult.text,
    });
  }

  return { items, report };
}

/** Mask PII in cron job task descriptions. */
function maskCronJobs(
  cronJobs: readonly CronJobDefinition[],
): MaskedItems<CronJobDefinition> {
  let report = emptyMaskReport();
  const items: CronJobDefinition[] = [];

  for (const job of cronJobs) {
    const taskResult = maskPii(job.payload.message);
    report = mergeMaskResult(report, "cron-jobs", taskResult);
    items.push({
      ...job,
      payload: { ...job.payload, message: taskResult.text },
    });
  }

  return { items, report };
}

/** Combine PII reports from all masking passes. */
function buildPiiReport(...reports: readonly PiiMaskReport[]): PiiMaskReport {
  let combined = emptyMaskReport();

  for (const report of reports) {
    combined = {
      totalMasked: combined.totalMasked + report.totalMasked,
      byCategory: {
        email: combined.byCategory.email + report.byCategory.email,
        phone: combined.byCategory.phone + report.byCategory.phone,
        ssn: combined.byCategory.ssn + report.byCategory.ssn,
        credit_card: combined.byCategory.credit_card + report.byCategory.credit_card,
        ip_address: combined.byCategory.ip_address + report.byCategory.ip_address,
        api_key: combined.byCategory.api_key + report.byCategory.api_key,
      },
      files: [...combined.files, ...report.files],
    };
  }

  return combined;
}

// ── File Writing ─────────────────────────────────────────────────────────────

/** Write import results to the deployment directory. */
async function writeImportResults(
  deployDir: string,
  data: {
    readonly preferences: readonly ExtractedPreference[];
    readonly cronJobs: readonly CronJobDefinition[];
    readonly unmappedRoutines: readonly ParsedRoutine[];
    readonly source: string;
  },
): Promise<void> {
  const importDir = join(deployDir, "workspace", "memory", "hot");
  const cronDir = join(deployDir, "cron");

  await mkdir(importDir, { recursive: true });
  await mkdir(cronDir, { recursive: true });

  // Write preferences as a memory file
  if (data.preferences.length > 0) {
    const preferencesContent = formatPreferencesMarkdown(
      data.preferences,
      data.source,
    );
    await writeFile(
      join(importDir, `import-preferences-${data.source}.md`),
      preferencesContent,
      "utf-8",
    );
  }

  // Merge imported cron jobs with existing jobs
  if (data.cronJobs.length > 0) {
    await mergeCronJobs(cronDir, data.cronJobs);
  }

  // Write unmapped routines for user review
  if (data.unmappedRoutines.length > 0) {
    const unmappedContent = JSON.stringify(data.unmappedRoutines, null, 2);
    await writeFile(
      join(importDir, `import-unmapped-routines-${data.source}.json`),
      unmappedContent,
      "utf-8",
    );
  }
}

/** Format preferences as a markdown memory file. */
function formatPreferencesMarkdown(
  preferences: readonly ExtractedPreference[],
  source: string,
): string {
  const lines: string[] = [
    `# Imported Preferences (${source})`,
    "",
    `> Extracted from ${source} export on ${new Date().toISOString().split("T")[0]}`,
    "",
  ];

  // Group by category
  const byCategory = new Map<string, ExtractedPreference[]>();
  for (const pref of preferences) {
    const existing = byCategory.get(pref.category) ?? [];
    existing.push(pref);
    byCategory.set(pref.category, existing);
  }

  for (const [category, prefs] of byCategory) {
    lines.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)}`);
    lines.push("");
    for (const pref of prefs) {
      const badge = pref.confidence === "high" ? "**" : pref.confidence === "low" ? "_" : "";
      const close = badge;
      lines.push(`- ${badge}${pref.preference}${close} (${pref.confidence})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Merge imported cron jobs into the existing jobs.json. */
async function mergeCronJobs(
  cronDir: string,
  newJobs: readonly CronJobDefinition[],
): Promise<void> {
  const jobsPath = join(cronDir, "jobs.json");

  let existingJobs: CronJobDefinition[] = [];
  try {
    const raw = await readFile(jobsPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      existingJobs = parsed as CronJobDefinition[];
    } else if (parsed && typeof parsed === "object" && "jobs" in parsed && Array.isArray((parsed as Record<string, unknown>).jobs)) {
      existingJobs = (parsed as Record<string, unknown>).jobs as CronJobDefinition[];
    }
  } catch (err) {
  }

  // Don't duplicate jobs by ID
  const existingIds = new Set(existingJobs.map((j) => j.id));
  const mergedJobs = [
    ...existingJobs,
    ...newJobs.filter((j) => !existingIds.has(j.id)),
  ];

  await writeFile(jobsPath, JSON.stringify({ version: 1, jobs: mergedJobs }, null, 2) + "\n", "utf-8");
}

// ── Failure Helper ───────────────────────────────────────────────────────────

function failureResult(
  source: MigrationOptions["source"],
  error: string,
): MigrationResult {
  return {
    success: false,
    source,
    itemsParsed: 0,
    preferences: [],
    cronJobs: [],
    piiReport: emptyMaskReport(),
    unmappedRoutines: [],
    error,
  };
}
