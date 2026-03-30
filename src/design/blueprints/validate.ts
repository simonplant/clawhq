/**
 * Blueprint validation — 70+ structural and security checks.
 *
 * Every check returns a BlueprintValidationResult. Checks are grouped by
 * blueprint section and cover:
 * - Required field presence
 * - Type correctness (string, array, object, enum values)
 * - Security baseline enforcement
 * - Cross-section consistency
 * - Value constraints (non-empty strings, valid formats)
 */

import type {
  BlueprintValidationReport,
  BlueprintValidationResult,
  BlueprintValidationSeverity,
} from "./types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

type RawBlueprint = Record<string, unknown>;

function pass(check: string, message: string): BlueprintValidationResult {
  return { check, passed: true, severity: "error", message };
}

function fail(
  check: string,
  message: string,
  severity: BlueprintValidationSeverity = "error",
): BlueprintValidationResult {
  return { check, passed: false, severity, message };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function isNonEmptyStr(v: unknown): v is string {
  return isStr(v) && v.trim().length > 0;
}

function isStrArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isStr);
}

function isBool(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function checkRequiredString(
  obj: Record<string, unknown>,
  field: string,
  section: string,
): BlueprintValidationResult {
  const check = `${section}.${field}`;
  const val = obj[field];
  if (val === undefined) return fail(check, `Missing required field: ${section}.${field}`);
  if (!isNonEmptyStr(val)) return fail(check, `${section}.${field} must be a non-empty string`);
  return pass(check, `${section}.${field} is present`);
}

function checkEnum(
  obj: Record<string, unknown>,
  field: string,
  section: string,
  allowed: readonly string[],
): BlueprintValidationResult {
  const check = `${section}.${field}`;
  const val = obj[field];
  if (val === undefined) return fail(check, `Missing required field: ${section}.${field}`);
  if (!isStr(val) || !allowed.includes(val)) {
    return fail(check, `${section}.${field} must be one of: ${allowed.join(", ")} (got "${String(val)}")`);
  }
  return pass(check, `${section}.${field} is valid`);
}

function checkStringArray(
  obj: Record<string, unknown>,
  field: string,
  section: string,
): BlueprintValidationResult {
  const check = `${section}.${field}`;
  const val = obj[field];
  if (val === undefined) return fail(check, `Missing required field: ${section}.${field}`);
  if (!isStrArray(val)) return fail(check, `${section}.${field} must be an array of strings`);
  return pass(check, `${section}.${field} is valid`);
}

// ── Top-Level Checks ────────────────────────────────────────────────────────

function checkTopLevel(raw: RawBlueprint): BlueprintValidationResult[] {
  return [
    // 1: name
    checkRequiredString(raw, "name", "blueprint"),
    // 2: version
    checkRequiredString(raw, "version", "blueprint"),
  ];
}

// ── Required Sections ───────────────────────────────────────────────────────

const REQUIRED_SECTIONS = [
  "use_case_mapping",
  "personality",
  "security_posture",
  "monitoring",
  "memory_policy",
  "cron_config",
  "autonomy_model",
  "model_routing_strategy",
  "integration_requirements",
  "channels",
  "skill_bundle",
  "toolbelt",
] as const;

function checkRequiredSections(raw: RawBlueprint): BlueprintValidationResult[] {
  // 3-14: each required section must be an object
  return REQUIRED_SECTIONS.map((section) => {
    const check = `section.${section}`;
    const val = raw[section];
    if (val === undefined) return fail(check, `Missing required section: ${section}`);
    if (!isObj(val)) return fail(check, `${section} must be an object`);
    return pass(check, `${section} section present`);
  });
}

// ── use_case_mapping (checks 15-18) ─────────────────────────────────────────

function checkUseCaseMapping(raw: RawBlueprint): BlueprintValidationResult[] {
  const section = raw.use_case_mapping;
  if (!isObj(section)) return [];
  return [
    checkRequiredString(section, "replaces", "use_case_mapping"),
    checkRequiredString(section, "tagline", "use_case_mapping"),
    checkRequiredString(section, "description", "use_case_mapping"),
    checkRequiredString(section, "day_in_the_life", "use_case_mapping"),
  ];
}

// ── personality (checks 19-22 + dimension validation) ───────────────────────

const DIMENSION_IDS = [
  "directness", "warmth", "verbosity",
  "proactivity", "caution", "formality", "analyticalDepth",
] as const;

function isValidDimensionValue(v: unknown): v is 1 | 2 | 3 | 4 | 5 {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;
}

function checkPersonality(raw: RawBlueprint): BlueprintValidationResult[] {
  const section = raw.personality;
  if (!isObj(section)) return [];

  const results = [
    checkRequiredString(section, "tone", "personality"),
    checkRequiredString(section, "style", "personality"),
    checkRequiredString(section, "relationship", "personality"),
    checkRequiredString(section, "boundaries", "personality"),
  ];

  // Optional dimensions validation
  const dims = section.dimensions;
  if (dims !== undefined) {
    if (!isObj(dims)) {
      results.push(fail("personality.dimensions", "personality.dimensions must be an object"));
    } else {
      for (const dimId of DIMENSION_IDS) {
        const check = `personality.dimensions.${dimId}`;
        const val = dims[dimId];
        if (val === undefined) {
          results.push(fail(check, `Missing dimension: ${dimId}`));
        } else if (!isValidDimensionValue(val)) {
          results.push(fail(check, `${dimId} must be an integer 1-5 (got ${String(val)})`));
        } else {
          results.push(pass(check, `${dimId} is valid (${val})`));
        }
      }
    }
  }

  return results;
}

// ── security_posture (checks 23-25) ─────────────────────────────────────────

function checkSecurityPosture(raw: RawBlueprint): BlueprintValidationResult[] {
  const section = raw.security_posture;
  if (!isObj(section)) return [];
  return [
    checkEnum(section, "posture", "security_posture", ["standard", "hardened", "paranoid"]),
    checkEnum(section, "egress", "security_posture", ["default", "restricted", "allowlist-only"]),
    checkStringArray(section, "egress_domains", "security_posture"),
    checkEnum(section, "identity_mount", "security_posture", ["read-only"]),
  ];
}

// ── monitoring (checks 26-29) ───────────────────────────────────────────────

function checkMonitoring(raw: RawBlueprint): BlueprintValidationResult[] {
  const section = raw.monitoring;
  if (!isObj(section)) return [];
  return [
    checkRequiredString(section, "heartbeat_frequency", "monitoring"),
    checkStringArray(section, "checks", "monitoring"),
    checkRequiredString(section, "quiet_hours", "monitoring"),
    checkStringArray(section, "alert_on", "monitoring"),
  ];
}

// ── memory_policy (checks 30-34) ────────────────────────────────────────────

function checkMemoryPolicy(raw: RawBlueprint): BlueprintValidationResult[] {
  const section = raw.memory_policy;
  if (!isObj(section)) return [];
  return [
    checkRequiredString(section, "hot_max", "memory_policy"),
    checkRequiredString(section, "hot_retention", "memory_policy"),
    checkRequiredString(section, "warm_retention", "memory_policy"),
    checkRequiredString(section, "cold_retention", "memory_policy"),
    checkEnum(section, "summarization", "memory_policy", ["aggressive", "balanced", "conservative"]),
  ];
}

// ── Known Model Names ──────────────────────────────────────────────────────

/** Model identifiers recognized by ClawHQ for cron job routing. */
const KNOWN_MODELS = new Set([
  // Anthropic Claude family
  "haiku", "sonnet", "opus",
  // OpenAI family
  "gpt-4", "gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo",
  // Local / Ollama models
  "llama3:8b", "llama3:70b", "mistral:7b", "mixtral:8x7b", "codellama:7b", "codellama:34b",
  "phi3:mini", "phi3:medium", "gemma:7b", "gemma:2b", "qwen2:7b",
]);

// ── cron_config (checks 35-37 + model_routing) ─────────────────────────────

function checkModelRouting(
  routing: Record<string, unknown>,
  jobName: string,
): BlueprintValidationResult[] {
  const results: BlueprintValidationResult[] = [];
  const prefix = `cron_config.model_routing.${jobName}`;

  if (!isObj(routing)) {
    results.push(fail(prefix, `${prefix} must be an object with model and optional fallbacks`));
    return results;
  }

  // model is required within a routing entry
  const model = routing.model;
  if (!isNonEmptyStr(model)) {
    results.push(fail(`${prefix}.model`, `${prefix}.model must be a non-empty string`));
  } else {
    if (!KNOWN_MODELS.has(model)) {
      results.push(fail(`${prefix}.model`, `${prefix}.model "${model}" is not a recognized model — known models: ${[...KNOWN_MODELS].slice(0, 6).join(", ")}…`));
    } else {
      results.push(pass(`${prefix}.model`, `${prefix}.model is valid`));
    }
  }

  // fallbacks is optional — if present, must be a string array with known models
  const fallbacks = routing.fallbacks;
  if (fallbacks !== undefined) {
    if (!isStrArray(fallbacks)) {
      results.push(fail(`${prefix}.fallbacks`, `${prefix}.fallbacks must be an array of strings`));
    } else {
      for (const fb of fallbacks) {
        if (!KNOWN_MODELS.has(fb)) {
          results.push(fail(
            `${prefix}.fallbacks`,
            `${prefix}.fallbacks contains unknown model "${fb}" — known models: ${[...KNOWN_MODELS].slice(0, 6).join(", ")}…`,
          ));
        }
      }
      if (results.every((r) => r.passed || !r.check.includes("fallbacks"))) {
        results.push(pass(`${prefix}.fallbacks`, `${prefix}.fallbacks are valid`));
      }
    }
  }

  return results;
}

function checkCronConfig(raw: RawBlueprint): BlueprintValidationResult[] {
  const section = raw.cron_config;
  if (!isObj(section)) return [];

  const results: BlueprintValidationResult[] = [
    (() => {
      const check = "cron_config.heartbeat";
      const val = section.heartbeat;
      if (val === undefined) return fail(check, "Missing required field: cron_config.heartbeat");
      if (!isStr(val)) return fail(check, "cron_config.heartbeat must be a string");
      return pass(check, "cron_config.heartbeat is present");
    })(),
    (() => {
      const check = "cron_config.work_session";
      const val = section.work_session;
      if (val === undefined) return fail(check, "Missing required field: cron_config.work_session");
      if (!isStr(val)) return fail(check, "cron_config.work_session must be a string");
      return pass(check, "cron_config.work_session is present");
    })(),
    (() => {
      const check = "cron_config.morning_brief";
      const val = section.morning_brief;
      if (val === undefined) return fail(check, "Missing required field: cron_config.morning_brief");
      if (!isStr(val)) return fail(check, "cron_config.morning_brief must be a string");
      return pass(check, "cron_config.morning_brief is present");
    })(),
  ];

  // Optional model_routing validation
  const routing = section.model_routing;
  if (routing !== undefined) {
    if (!isObj(routing)) {
      results.push(fail("cron_config.model_routing", "cron_config.model_routing must be an object"));
    } else {
      const JOB_NAMES = ["heartbeat", "work_session", "morning_brief"] as const;
      for (const jobName of JOB_NAMES) {
        const entry = routing[jobName];
        if (entry !== undefined) {
          results.push(...checkModelRouting(entry as Record<string, unknown>, jobName));
        }
      }
    }
  }

  return results;
}

// ── autonomy_model (checks 38-39 + delegation validation) ──────────────────

const DELEGATION_TIERS = ["execute", "propose", "approve"] as const;

function checkAutonomyModel(raw: RawBlueprint): BlueprintValidationResult[] {
  const section = raw.autonomy_model;
  if (!isObj(section)) return [];

  const results: BlueprintValidationResult[] = [
    checkEnum(section, "default", "autonomy_model", ["low", "medium", "high"]),
    checkStringArray(section, "requires_approval", "autonomy_model"),
  ];

  // Optional delegation validation
  const delegation = section.delegation;
  if (delegation !== undefined) {
    if (!Array.isArray(delegation)) {
      results.push(fail("autonomy_model.delegation", "autonomy_model.delegation must be an array"));
    } else {
      results.push(pass("autonomy_model.delegation", "autonomy_model.delegation is an array"));

      for (let i = 0; i < delegation.length; i++) {
        const rule = delegation[i] as unknown;
        const prefix = `autonomy_model.delegation[${i}]`;

        if (!isObj(rule)) {
          results.push(fail(prefix, `${prefix} must be an object`));
          continue;
        }

        results.push(checkRequiredString(rule, "action", prefix));
        results.push(checkEnum(rule, "tier", prefix, [...DELEGATION_TIERS]));
        results.push(checkRequiredString(rule, "example", prefix));
      }

      // Delegation action names must be unique
      const actions = delegation
        .filter(isObj)
        .map((r) => r.action)
        .filter(isStr);
      const actionSet = new Set(actions);
      if (actionSet.size === actions.length) {
        results.push(pass("autonomy_model.delegation.unique_actions", "All delegation action names are unique"));
      } else {
        const dupes = actions.filter((a, i) => actions.indexOf(a) !== i);
        results.push(
          fail("autonomy_model.delegation.unique_actions", `Duplicate delegation actions: ${[...new Set(dupes)].join(", ")}`),
        );
      }
    }
  }

  return results;
}

// ── model_routing_strategy (checks 40-43) ───────────────────────────────────

function checkModelRoutingStrategy(raw: RawBlueprint): BlueprintValidationResult[] {
  const section = raw.model_routing_strategy;
  if (!isObj(section)) return [];
  return [
    checkEnum(section, "default_provider", "model_routing_strategy", ["local", "cloud"]),
    checkRequiredString(section, "local_model_preference", "model_routing_strategy"),
    checkStringArray(section, "cloud_escalation_categories", "model_routing_strategy"),
    checkEnum(section, "quality_threshold", "model_routing_strategy", ["low", "medium", "high"]),
  ];
}

// ── integration_requirements (checks 44-46) ─────────────────────────────────

function checkIntegrationRequirements(raw: RawBlueprint): BlueprintValidationResult[] {
  const section = raw.integration_requirements;
  if (!isObj(section)) return [];
  return [
    checkStringArray(section, "required", "integration_requirements"),
    checkStringArray(section, "recommended", "integration_requirements"),
    checkStringArray(section, "optional", "integration_requirements"),
  ];
}

// ── channels (checks 47-48) ─────────────────────────────────────────────────

function checkChannels(raw: RawBlueprint): BlueprintValidationResult[] {
  const section = raw.channels;
  if (!isObj(section)) return [];

  const results: BlueprintValidationResult[] = [
    checkStringArray(section, "supported", "channels"),
    checkRequiredString(section, "default", "channels"),
  ];

  // 49: default channel must be in supported list
  const supported = section.supported;
  const defaultCh = section.default;
  if (isStrArray(supported) && isStr(defaultCh)) {
    const check = "channels.default_in_supported";
    if (supported.includes(defaultCh)) {
      results.push(pass(check, "Default channel is in supported list"));
    } else {
      results.push(
        fail(check, `Default channel "${defaultCh}" is not in supported channels: ${supported.join(", ")}`),
      );
    }
  }

  return results;
}

// ── skill_bundle (checks 50-51) ─────────────────────────────────────────────

function checkSkillBundle(raw: RawBlueprint): BlueprintValidationResult[] {
  const section = raw.skill_bundle;
  if (!isObj(section)) return [];
  return [
    checkStringArray(section, "included", "skill_bundle"),
    checkStringArray(section, "recommended", "skill_bundle"),
  ];
}

// ── toolbelt (checks 52-55 + per-tool/skill checks) ────────────────────────

function checkToolbelt(raw: RawBlueprint): BlueprintValidationResult[] {
  const section = raw.toolbelt;
  if (!isObj(section)) return [];

  const results: BlueprintValidationResult[] = [
    checkRequiredString(section, "role", "toolbelt"),
    checkRequiredString(section, "description", "toolbelt"),
  ];

  // 54: tools must be an array
  const tools = section.tools;
  if (tools === undefined) {
    results.push(fail("toolbelt.tools", "Missing required field: toolbelt.tools"));
  } else if (!Array.isArray(tools)) {
    results.push(fail("toolbelt.tools", "toolbelt.tools must be an array"));
  } else {
    results.push(pass("toolbelt.tools", "toolbelt.tools is an array"));

    // Per-tool validation (checks 56-59 per tool)
    for (let i = 0; i < tools.length; i++) {
      const tool = tools[i] as unknown;
      const prefix = `toolbelt.tools[${i}]`;

      if (!isObj(tool)) {
        results.push(fail(prefix, `${prefix} must be an object`));
        continue;
      }

      results.push(checkRequiredString(tool, "name", prefix));
      results.push(checkRequiredString(tool, "category", prefix));
      results.push(checkRequiredString(tool, "description", prefix));

      const reqCheck = `${prefix}.required`;
      if (tool.required === undefined) {
        results.push(fail(reqCheck, `Missing required field: ${prefix}.required`));
      } else if (!isBool(tool.required)) {
        results.push(fail(reqCheck, `${prefix}.required must be a boolean`));
      } else {
        results.push(pass(reqCheck, `${prefix}.required is valid`));
      }
    }
  }

  // 55: skills must be an array
  const skills = section.skills;
  if (skills === undefined) {
    results.push(fail("toolbelt.skills", "Missing required field: toolbelt.skills"));
  } else if (!Array.isArray(skills)) {
    results.push(fail("toolbelt.skills", "toolbelt.skills must be an array"));
  } else {
    results.push(pass("toolbelt.skills", "toolbelt.skills is an array"));

    // Per-skill validation (checks 60-62 per skill)
    for (let i = 0; i < skills.length; i++) {
      const skill = skills[i] as unknown;
      const prefix = `toolbelt.skills[${i}]`;

      if (!isObj(skill)) {
        results.push(fail(prefix, `${prefix} must be an object`));
        continue;
      }

      results.push(checkRequiredString(skill, "name", prefix));
      results.push(checkRequiredString(skill, "description", prefix));

      const reqCheck = `${prefix}.required`;
      if (skill.required === undefined) {
        results.push(fail(reqCheck, `Missing required field: ${prefix}.required`));
      } else if (!isBool(skill.required)) {
        results.push(fail(reqCheck, `${prefix}.required must be a boolean`));
      } else {
        results.push(pass(reqCheck, `${prefix}.required is valid`));
      }
    }
  }

  return results;
}

// ── customization_questions (optional, checks 77-82) ────────────────────────

function checkCustomizationQuestions(raw: RawBlueprint): BlueprintValidationResult[] {
  const section = raw.customization_questions;

  // Optional field — skip if absent
  if (section === undefined) return [];

  const results: BlueprintValidationResult[] = [];

  // Must be an array
  if (!Array.isArray(section)) {
    results.push(fail("customization_questions", "customization_questions must be an array"));
    return results;
  }

  results.push(pass("customization_questions", "customization_questions is an array"));

  // Max 3 questions
  if (section.length > 3) {
    results.push(
      fail("customization_questions.max_count", `customization_questions has ${section.length} items — maximum is 3`),
    );
  } else if (section.length > 0) {
    results.push(pass("customization_questions.max_count", `customization_questions has ${section.length} item(s)`));
  }

  // Per-question validation
  for (let i = 0; i < section.length; i++) {
    const q = section[i] as unknown;
    const prefix = `customization_questions[${i}]`;

    if (!isObj(q)) {
      results.push(fail(prefix, `${prefix} must be an object`));
      continue;
    }

    results.push(checkRequiredString(q, "id", prefix));
    results.push(checkRequiredString(q, "prompt", prefix));
    results.push(checkEnum(q, "type", prefix, ["select", "input"]));

    // If type is "select", options must be a non-empty string array
    if (q.type === "select") {
      const optCheck = `${prefix}.options`;
      if (!isStrArray(q.options)) {
        results.push(fail(optCheck, `${prefix}.options must be an array of strings when type is "select"`));
      } else if ((q.options as string[]).length === 0) {
        results.push(fail(optCheck, `${prefix}.options must not be empty when type is "select"`));
      } else {
        results.push(pass(optCheck, `${prefix}.options is valid`));
      }
    }

    // Default is optional — if present, must be a string
    if (q.default !== undefined && !isStr(q.default)) {
      results.push(fail(`${prefix}.default`, `${prefix}.default must be a string`));
    }
  }

  // Question IDs must be unique
  const ids = section.filter(isObj).map((q) => q.id).filter(isStr);
  const idSet = new Set(ids);
  if (idSet.size === ids.length) {
    results.push(pass("customization_questions.unique_ids", "All question IDs are unique"));
  } else {
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    results.push(
      fail("customization_questions.unique_ids", `Duplicate question IDs: ${[...new Set(dupes)].join(", ")}`),
    );
  }

  return results;
}

// ── runbooks (optional, checks 83-86) ──────────────────────────────────────

function checkRunbooks(raw: RawBlueprint): BlueprintValidationResult[] {
  const section = raw.runbooks;

  // Optional field — skip if absent
  if (section === undefined) return [];

  const results: BlueprintValidationResult[] = [];

  // Must be an array
  if (!Array.isArray(section)) {
    results.push(fail("runbooks", "runbooks must be an array"));
    return results;
  }

  results.push(pass("runbooks", "runbooks is an array"));

  // Per-runbook validation
  for (let i = 0; i < section.length; i++) {
    const rb = section[i] as unknown;
    const prefix = `runbooks[${i}]`;

    if (!isObj(rb)) {
      results.push(fail(prefix, `${prefix} must be an object`));
      continue;
    }

    // name is required and must end in .md
    const nameCheck = checkRequiredString(rb, "name", prefix);
    results.push(nameCheck);
    if (nameCheck.passed && isStr(rb.name)) {
      if (!rb.name.endsWith(".md")) {
        results.push(fail(`${prefix}.name_suffix`, `${prefix}.name must end in .md (got "${rb.name}")`));
      } else {
        results.push(pass(`${prefix}.name_suffix`, `${prefix}.name has .md suffix`));
      }
    }

    // content is required
    results.push(checkRequiredString(rb, "content", prefix));
  }

  // Runbook names must be unique
  const names = section.filter(isObj).map((rb) => rb.name).filter(isStr);
  const nameSet = new Set(names);
  if (nameSet.size === names.length) {
    results.push(pass("runbooks.unique_names", "All runbook names are unique"));
  } else {
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    results.push(
      fail("runbooks.unique_names", `Duplicate runbook names: ${[...new Set(dupes)].join(", ")}`),
    );
  }

  return results;
}

// ── Security Baseline Enforcement ───────────────────────────────────────────

function checkSecurityBaseline(raw: RawBlueprint): BlueprintValidationResult[] {
  const results: BlueprintValidationResult[] = [];

  // 63: identity_mount must always be read-only
  const secPosture = isObj(raw.security_posture) ? raw.security_posture : {};
  const identityMount = secPosture.identity_mount;
  if (isStr(identityMount) && identityMount !== "read-only") {
    results.push(
      fail(
        "security.identity_mount_readonly",
        `Identity mount must be "read-only" — agents cannot modify their own personality (got "${identityMount}")`,
      ),
    );
  } else if (identityMount === "read-only") {
    results.push(pass("security.identity_mount_readonly", "Identity mount is read-only"));
  }

  // 64: posture must not be below "hardened" for production safety (warning)
  const posture = secPosture.posture;
  if (isStr(posture) && posture === "standard") {
    results.push(
      fail(
        "security.posture_minimum",
        'Security posture is "standard" — consider "hardened" or "paranoid" for production use',
        "warning",
      ),
    );
  } else if (isStr(posture)) {
    results.push(pass("security.posture_minimum", `Security posture is "${posture}"`));
  }

  // 65: egress must not be "default" for hardened/paranoid postures
  const egress = secPosture.egress;
  if (
    isStr(posture) &&
    (posture === "hardened" || posture === "paranoid") &&
    isStr(egress) &&
    egress === "default"
  ) {
    results.push(
      fail(
        "security.egress_matches_posture",
        `Egress is "default" but posture is "${posture}" — use "restricted" or "allowlist-only"`,
        "warning",
      ),
    );
  } else if (isStr(egress) && isStr(posture)) {
    results.push(pass("security.egress_matches_posture", "Egress policy matches security posture"));
  }

  return results;
}

// ── Cross-Section Consistency ───────────────────────────────────────────────

function checkCrossSection(raw: RawBlueprint): BlueprintValidationResult[] {
  const results: BlueprintValidationResult[] = [];

  // 66: messaging must be in required or recommended integrations (every agent needs a channel)
  const integrations = isObj(raw.integration_requirements)
    ? raw.integration_requirements
    : {};
  const required = isStrArray(integrations.required) ? integrations.required : [];
  const recommended = isStrArray(integrations.recommended) ? integrations.recommended : [];
  const allIntegrations = [...required, ...recommended];

  if (allIntegrations.includes("messaging")) {
    results.push(pass("cross.messaging_integration", "Messaging is in required/recommended integrations"));
  } else {
    results.push(
      fail(
        "cross.messaging_integration",
        "Messaging must be in required or recommended integrations — every agent needs a communication channel",
        "warning",
      ),
    );
  }

  // 67: skill_bundle.included skills should appear in toolbelt.skills
  const skillBundle = isObj(raw.skill_bundle) ? raw.skill_bundle : {};
  const includedSkills = isStrArray(skillBundle.included) ? skillBundle.included : [];
  const toolbelt = isObj(raw.toolbelt) ? raw.toolbelt : {};
  const toolbeltSkills = Array.isArray(toolbelt.skills) ? toolbelt.skills : [];
  const toolbeltSkillNames = toolbeltSkills
    .filter(isObj)
    .map((s) => s.name)
    .filter(isStr);

  for (const skill of includedSkills) {
    const check = `cross.included_skill_in_toolbelt.${skill}`;
    if (toolbeltSkillNames.includes(skill)) {
      results.push(pass(check, `Included skill "${skill}" has a toolbelt entry`));
    } else {
      results.push(
        fail(
          check,
          `Included skill "${skill}" is not defined in toolbelt.skills — add a skill entry with name, description, and required fields`,
          "warning",
        ),
      );
    }
  }

  // 68: at least one tool must be required
  const toolbeltTools = Array.isArray(toolbelt.tools) ? toolbelt.tools : [];
  const hasRequiredTool = toolbeltTools
    .filter(isObj)
    .some((t) => t.required === true);

  if (hasRequiredTool) {
    results.push(pass("cross.has_required_tool", "At least one tool is marked required"));
  } else {
    results.push(
      fail(
        "cross.has_required_tool",
        "No tools are marked as required — blueprint should have at least one required tool",
        "warning",
      ),
    );
  }

  // 69: version should follow semver pattern
  const version = raw.version;
  if (isStr(version)) {
    const semverish = /^\d+\.\d+\.\d+$/;
    if (semverish.test(version)) {
      results.push(pass("cross.version_format", "Version follows semver format"));
    } else {
      results.push(
        fail("cross.version_format", `Version "${version}" should follow semver format (e.g., "1.0.0")`, "warning"),
      );
    }
  }

  // 70: quiet_hours format should be "HH:MM-HH:MM"
  const monitoring = isObj(raw.monitoring) ? raw.monitoring : {};
  const quietHours = monitoring.quiet_hours;
  if (isStr(quietHours) && quietHours.length > 0) {
    const qhPattern = /^\d{2}:\d{2}-\d{2}:\d{2}$/;
    if (qhPattern.test(quietHours)) {
      results.push(pass("cross.quiet_hours_format", "Quiet hours format is valid"));
    } else {
      results.push(
        fail(
          "cross.quiet_hours_format",
          `Quiet hours "${quietHours}" should be in "HH:MM-HH:MM" format`,
          "warning",
        ),
      );
    }
  }

  // 71: hot_max should include a unit suffix
  const memPolicy = isObj(raw.memory_policy) ? raw.memory_policy : {};
  const hotMax = memPolicy.hot_max;
  if (isStr(hotMax) && hotMax.length > 0) {
    const unitPattern = /^\d+\s*[KkMm][Bb]$/;
    if (unitPattern.test(hotMax)) {
      results.push(pass("cross.hot_max_unit", "hot_max has a valid size unit"));
    } else {
      results.push(
        fail("cross.hot_max_unit", `hot_max "${hotMax}" should include a size unit (e.g., "100KB")`, "warning"),
      );
    }
  }

  // 72: retention values should include a duration suffix
  for (const field of ["hot_retention", "warm_retention", "cold_retention"] as const) {
    const val = memPolicy[field];
    if (isStr(val) && val.length > 0) {
      const durationPattern = /^\d+[dDwWmMyY]$/;
      const check = `cross.${field}_duration`;
      if (durationPattern.test(val)) {
        results.push(pass(check, `${field} has a valid duration unit`));
      } else {
        results.push(
          fail(check, `${field} "${val}" should include a duration unit (e.g., "7d", "90d", "365d")`, "warning"),
        );
      }
    }
  }

  // 75: toolbelt tool names should be unique
  const toolNames = toolbeltTools
    .filter(isObj)
    .map((t) => t.name)
    .filter(isStr);
  const toolNameSet = new Set(toolNames);
  if (toolNameSet.size === toolNames.length) {
    results.push(pass("cross.unique_tool_names", "All tool names are unique"));
  } else {
    const dupes = toolNames.filter((n, i) => toolNames.indexOf(n) !== i);
    results.push(
      fail("cross.unique_tool_names", `Duplicate tool names: ${[...new Set(dupes)].join(", ")}`),
    );
  }

  // 76: toolbelt skill names should be unique
  const skillNames = toolbeltSkills
    .filter(isObj)
    .map((s) => s.name)
    .filter(isStr);
  const skillNameSet = new Set(skillNames);
  if (skillNameSet.size === skillNames.length) {
    results.push(pass("cross.unique_skill_names", "All skill names are unique"));
  } else {
    const dupes = skillNames.filter((n, i) => skillNames.indexOf(n) !== i);
    results.push(
      fail("cross.unique_skill_names", `Duplicate skill names: ${[...new Set(dupes)].join(", ")}`),
    );
  }

  return results;
}

// ── Full Validation ─────────────────────────────────────────────────────────

/**
 * Run all validation checks against a parsed blueprint.
 *
 * Returns a report with individual results, aggregated errors and warnings.
 */
export function validateBlueprint(
  raw: Record<string, unknown>,
): BlueprintValidationReport {
  const name = isStr(raw.name) ? raw.name : "<unknown>";

  const results: BlueprintValidationResult[] = [
    ...checkTopLevel(raw),
    ...checkRequiredSections(raw),
    ...checkUseCaseMapping(raw),
    ...checkPersonality(raw),
    ...checkSecurityPosture(raw),
    ...checkMonitoring(raw),
    ...checkMemoryPolicy(raw),
    ...checkCronConfig(raw),
    ...checkAutonomyModel(raw),
    ...checkModelRoutingStrategy(raw),
    ...checkIntegrationRequirements(raw),
    ...checkChannels(raw),
    ...checkSkillBundle(raw),
    ...checkToolbelt(raw),
    ...checkCustomizationQuestions(raw),
    ...checkRunbooks(raw),
    ...checkSecurityBaseline(raw),
    ...checkCrossSection(raw),
  ];

  const errors = results.filter((r) => !r.passed && r.severity === "error");
  const warnings = results.filter((r) => !r.passed && r.severity === "warning");

  return {
    valid: errors.length === 0,
    blueprintName: name,
    results,
    errors,
    warnings,
  };
}
