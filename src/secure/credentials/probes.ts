/**
 * Built-in credential probes for common integrations.
 *
 * Each probe checks: (1) key is present, (2) key format is plausible,
 * (3) key actually works against the provider's API.
 *
 * Probes never throw — they return a ProbeResult with ok: false and
 * an actionable fix message on failure.
 */

import { ANTHROPIC_API_BASE, ANTHROPIC_API_VERSION, CREDENTIALS_PROBE_TIMEOUT_MS, ONEPASSWORD_API_BASE, OPENAI_API_BASE, TELEGRAM_API_BASE } from "../../config/defaults.js";

import type { CredentialProbe, ProbeResult } from "./probe-types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a missing-key result. */
function missing(integration: string, envKey: string, fix: string): ProbeResult {
  return { integration, envKey, ok: false, message: "Not configured", fix };
}

/** Build a pass result. */
function pass(integration: string, envKey: string, message: string): ProbeResult {
  return { integration, envKey, ok: true, message };
}

/** Build a fail result. */
function fail(integration: string, envKey: string, message: string, fix: string): ProbeResult {
  return { integration, envKey, ok: false, message, fix };
}

/**
 * Lightweight fetch with a short timeout. Returns the response or an error message.
 * Never throws.
 */
async function probeFetch(
  url: string,
  init: RequestInit,
  timeoutMs = CREDENTIALS_PROBE_TIMEOUT_MS,
): Promise<{ response: Response } | { error: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    return { response };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { error: "Request timed out" };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

// ── Anthropic Probe ──────────────────────────────────────────────────────────

/**
 * Validate an Anthropic API key by calling the /v1/models endpoint.
 *
 * Key format: `sk-ant-api03-...` (prefix may vary with key version).
 */
export const probeAnthropic: CredentialProbe = async (env) => {
  const integration = "Anthropic";
  const envKey = "ANTHROPIC_API_KEY";
  const key = env[envKey];

  if (!key) {
    return missing(integration, envKey, `Set ${envKey} in your .env file. Get a key at https://console.anthropic.com/`);
  }

  if (!key.startsWith("sk-ant-")) {
    return fail(integration, envKey, "Key format invalid (expected sk-ant-... prefix)", `Check ${envKey} — it should start with sk-ant-`);
  }

  const result = await probeFetch(`${ANTHROPIC_API_BASE}/v1/models`, {
    method: "GET",
    headers: {
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
  });

  if ("error" in result) {
    return fail(integration, envKey, `API unreachable: ${result.error}`, "Check your network connection or try again later");
  }

  const { response } = result;

  if (response.status === 200) {
    return pass(integration, envKey, "Valid");
  }

  if (response.status === 401) {
    return fail(integration, envKey, "Key rejected (401 Unauthorized)", `Regenerate ${envKey} at https://console.anthropic.com/`);
  }

  if (response.status === 403) {
    return fail(integration, envKey, "Key forbidden (403)", "Check API key permissions or account status at https://console.anthropic.com/");
  }

  return fail(integration, envKey, `Unexpected status ${response.status}`, "Check your Anthropic account status");
};

// ── OpenAI Probe ─────────────────────────────────────────────────────────────

/**
 * Validate an OpenAI API key by calling the /v1/models endpoint.
 *
 * Key format: `sk-...` (typically `sk-proj-...` for project keys).
 */
export const probeOpenAI: CredentialProbe = async (env) => {
  const integration = "OpenAI";
  const envKey = "OPENAI_API_KEY";
  const key = env[envKey];

  if (!key) {
    return missing(integration, envKey, `Set ${envKey} in your .env file. Get a key at https://platform.openai.com/api-keys`);
  }

  if (!key.startsWith("sk-")) {
    return fail(integration, envKey, "Key format invalid (expected sk-... prefix)", `Check ${envKey} — it should start with sk-`);
  }

  const result = await probeFetch(`${OPENAI_API_BASE}/v1/models`, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
  });

  if ("error" in result) {
    return fail(integration, envKey, `API unreachable: ${result.error}`, "Check your network connection or try again later");
  }

  const { response } = result;

  if (response.status === 200) {
    return pass(integration, envKey, "Valid");
  }

  if (response.status === 401) {
    return fail(integration, envKey, "Key rejected (401 Unauthorized)", `Regenerate ${envKey} at https://platform.openai.com/api-keys`);
  }

  if (response.status === 429) {
    return fail(integration, envKey, "Rate limited or quota exceeded (429)", "Check your OpenAI billing and usage limits at https://platform.openai.com/usage");
  }

  return fail(integration, envKey, `Unexpected status ${response.status}`, "Check your OpenAI account status");
};

// ── Telegram Probe ───────────────────────────────────────────────────────────

/**
 * Validate a Telegram Bot token by calling the /getMe endpoint.
 *
 * Token format: `<bot_id>:<alphanumeric_hash>` (e.g., 123456:ABC-DEF...).
 */
export const probeTelegram: CredentialProbe = async (env) => {
  const integration = "Telegram";
  const envKey = "TELEGRAM_BOT_TOKEN";
  const token = env[envKey];

  if (!token) {
    return missing(integration, envKey, `Set ${envKey} in your .env file. Create a bot via @BotFather on Telegram`);
  }

  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    return fail(integration, envKey, "Token format invalid (expected <id>:<hash>)", `Check ${envKey} — format should be 123456789:ABCdefGHI...`);
  }

  const result = await probeFetch(`${TELEGRAM_API_BASE}/bot${token}/getMe`, {
    method: "GET",
  });

  if ("error" in result) {
    return fail(integration, envKey, `API unreachable: ${result.error}`, "Check your network connection or try again later");
  }

  const { response } = result;

  if (response.status === 200) {
    let body: { ok?: boolean; result?: { username?: string } };
    try {
      body = (await response.json()) as { ok?: boolean; result?: { username?: string } };
    } catch (err) {
      // Garbage body from a 200 usually means an intercepting proxy or MITM,
      // not a valid Telegram response. Fail loud rather than assume good —
      // previously we fell through to `pass(... "Valid")` which masked this.
      return fail(
        integration,
        envKey,
        `Telegram returned 200 but body was not valid JSON: ` +
          (err instanceof Error ? err.message : String(err)),
        "Check for a proxy between the agent and api.telegram.org",
      );
    }
    // A 200 with ok=false is Telegram's own "this token is rejected" signal
    // carried in the body (their API uses this for permission errors). The
    // prior implementation returned pass anyway — a real security miss.
    if (body.ok === false) {
      return fail(
        integration,
        envKey,
        "Telegram returned 200 but ok=false",
        `Regenerate token via @BotFather and update ${envKey}`,
      );
    }
    if (body.result?.username) {
      return pass(integration, envKey, `Valid (@${body.result.username})`);
    }
    return pass(integration, envKey, "Valid");
  }

  if (response.status === 401) {
    return fail(integration, envKey, "Token rejected (401 Unauthorized)", `Regenerate token via @BotFather and update ${envKey}`);
  }

  return fail(integration, envKey, `Unexpected status ${response.status}`, "Check your bot token via @BotFather on Telegram");
};

// ── 1Password Probe ─────────────────────────────────────────────────────────

/**
 * Personal-tier 1Password sign-in addresses. Audit-events API is Business-only,
 * so probing it on personal tiers returns 401 regardless of token validity.
 */
const OP_PERSONAL_SIGNIN_ADDRESSES = new Set(["my.1password.com", "my.1password.eu", "my.1password.ca"]);

/**
 * Decode the envelope embedded in an `ops_<base64>` service account token.
 * Returns null if the token can't be decoded (malformed or non-JSON payload).
 */
function decodeOpTokenEnvelope(token: string): { signInAddress?: string } | null {
  if (!token.startsWith("ops_")) return null;
  try {
    const payload = token.slice(4);
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf-8");
    const parsed = JSON.parse(json) as { signInAddress?: unknown };
    if (typeof parsed.signInAddress !== "string") return {};
    return { signInAddress: parsed.signInAddress };
  } catch {
    return null;
  }
}

/**
 * Validate a 1Password service account token.
 *
 * Token format: `ops_<base64-json-envelope>`. The envelope carries a
 * `signInAddress` that tells us the account tier:
 * - `my.1password.com` (and regional variants) → personal/family/teams:
 *   the audit-events API is Business-only and always returns 401 here,
 *   so we stop at structural validation.
 * - Business subdomains (`<org>.1password.com`) → probe audit-events.
 *   A 401 there means a real token problem; a 403 means the service
 *   account lacks the events-reporter grant but the token is still valid.
 */
export const probe1Password: CredentialProbe = async (env) => {
  const integration = "1Password";
  const envKey = "OP_SERVICE_ACCOUNT_TOKEN";
  const token = env[envKey];

  if (!token) {
    return missing(integration, envKey, `Set ${envKey} in your .env file. Create a service account at https://my.1password.com/developer-tools/infrastructure-secrets/serviceaccount`);
  }

  if (!token.startsWith("ops_")) {
    return fail(integration, envKey, "Token format invalid (expected ops_... prefix)", `Check ${envKey} — service account tokens start with ops_`);
  }

  const envelope = decodeOpTokenEnvelope(token);
  if (envelope === null) {
    return fail(integration, envKey, "Token envelope unreadable (base64/JSON decode failed)", `Re-paste ${envKey} — the value may be truncated`);
  }

  const isPersonalTier =
    !envelope.signInAddress || OP_PERSONAL_SIGNIN_ADDRESSES.has(envelope.signInAddress);

  if (isPersonalTier) {
    return pass(
      integration,
      envKey,
      `Format valid (${envelope.signInAddress ?? "personal tier"} — audit-events probe not supported)`,
    );
  }

  const result = await probeFetch(`${ONEPASSWORD_API_BASE}/api/v1/auditevents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ limit: 1 }),
  });

  if ("error" in result) {
    return fail(integration, envKey, `API unreachable: ${result.error}`, "Check your network connection or try again later");
  }

  const { response } = result;

  if (response.status === 200) {
    return pass(integration, envKey, "Valid");
  }

  if (response.status === 401) {
    return fail(integration, envKey, "Token rejected (401 Unauthorized)", `Regenerate ${envKey} in 1Password developer settings`);
  }

  if (response.status === 403) {
    return pass(integration, envKey, "Format valid (events-reporter grant missing — audit-events probe skipped)");
  }

  return fail(integration, envKey, `Unexpected status ${response.status}`, "Check your 1Password service account status");
};

// ── GitHub Probe ────────────────────────────────────────────────────────────

/**
 * Validate a GitHub personal access token by calling the /user endpoint.
 *
 * Key format: `ghp_...` (classic) or `github_pat_...` (fine-grained).
 */
export const probeGitHub: CredentialProbe = async (env) => {
  const integration = "GitHub";
  const envKey = "GH_TOKEN";
  const key = env[envKey];

  if (!key) {
    return missing(integration, envKey, `Set ${envKey} in your .env file. Create a token at https://github.com/settings/tokens`);
  }

  if (!key.startsWith("ghp_") && !key.startsWith("github_pat_")) {
    return fail(integration, envKey, "Token format invalid (expected ghp_... or github_pat_... prefix)", `Check ${envKey} — it should start with ghp_ or github_pat_`);
  }

  const result = await probeFetch("https://api.github.com/user", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/vnd.github+json",
    },
  });

  if ("error" in result) {
    return fail(integration, envKey, `API unreachable: ${result.error}`, "Check your network connection or try again later");
  }

  const { response } = result;

  if (response.status === 200) {
    try {
      const body = (await response.json()) as { login?: string };
      if (body.login) {
        return pass(integration, envKey, `Valid (@${body.login})`);
      }
    } catch {
      // Response parsing failed — still a valid token
    }
    return pass(integration, envKey, "Valid");
  }

  if (response.status === 401) {
    return fail(integration, envKey, "Token rejected (401 Unauthorized)", `Regenerate ${envKey} at https://github.com/settings/tokens`);
  }

  return fail(integration, envKey, `Unexpected status ${response.status}`, "Check your GitHub token permissions");
};

// ── X/Twitter Probe ─────────────────────────────────────────────────────────

/**
 * Validate an X/Twitter bearer token by calling the /2/users/me endpoint.
 *
 * Bearer tokens don't have a standard prefix.
 */
export const probeX: CredentialProbe = async (env) => {
  const integration = "X/Twitter";
  const envKey = "X_BEARER_TOKEN";
  const key = env[envKey];

  if (!key) {
    return missing(integration, envKey, `Set ${envKey} in your .env file. Get a bearer token from https://developer.twitter.com/`);
  }

  const result = await probeFetch("https://api.twitter.com/2/users/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
  });

  if ("error" in result) {
    return fail(integration, envKey, `API unreachable: ${result.error}`, "Check your network connection or try again later");
  }

  const { response } = result;

  if (response.status === 200) {
    return pass(integration, envKey, "Valid");
  }

  if (response.status === 401) {
    return fail(integration, envKey, "Token rejected (401 Unauthorized)", `Regenerate ${envKey} at https://developer.twitter.com/`);
  }

  if (response.status === 403) {
    return fail(integration, envKey, "Token forbidden (403) — check API access level", "Ensure your X developer account has the required access tier");
  }

  return fail(integration, envKey, `Unexpected status ${response.status}`, "Check your X developer account status");
};

// ── Home Assistant Probe ────────────────────────────────────────────────────

/**
 * Validate a Home Assistant long-lived access token by calling the /api/ endpoint.
 *
 * Requires HA_URL to be set alongside HA_TOKEN.
 */
export const probeHomeAssistant: CredentialProbe = async (env) => {
  const integration = "Home Assistant";
  const envKey = "HA_TOKEN";
  const token = env[envKey];
  const url = env["HA_URL"];

  if (!token) {
    return missing(integration, envKey, `Set ${envKey} in your .env file. Create a long-lived access token in HA → Profile → Security`);
  }

  if (!url) {
    return fail(integration, "HA_URL", "HA_URL not configured", "Set HA_URL to your Home Assistant base URL (e.g. http://homeassistant.local:8123)");
  }

  const result = await probeFetch(`${url}/api/`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if ("error" in result) {
    return fail(integration, envKey, `API unreachable: ${result.error}`, `Check HA_URL (${url}) and your network connection`);
  }

  const { response } = result;

  if (response.status === 200) {
    return pass(integration, envKey, "Valid");
  }

  if (response.status === 401) {
    return fail(integration, envKey, "Token rejected (401 Unauthorized)", `Regenerate ${envKey} in HA → Profile → Security`);
  }

  return fail(integration, envKey, `Unexpected status ${response.status}`, "Check your Home Assistant configuration");
};

// ── Probe Registry ───────────────────────────────────────────────────────────

/**
 * All built-in probes. New integrations are added here.
 *
 * The registry is an array rather than a map — probes run in order,
 * and an integration could have multiple probes if needed.
 */
// ── Email Probe ──────────────────────────────────────────────────────────────

/**
 * Validate email credentials by shape only — a real IMAP LOGIN probe would
 * need a TLS socket and the agent's container up, which are both unreliable
 * from the host at probe time. Shape validation catches the common failure
 * modes: missing vars, blank values, malformed user fields. Live reachability
 * is checked by `clawhq verify` from inside the container at deploy time.
 *
 * Multi-slot aware: checks the primary `EMAIL_` slot plus any numbered slots
 * (`EMAIL_2_`, `EMAIL_3_`) present in env. Returns the first failure or a
 * single pass covering every slot that validated.
 */
export const probeEmail: CredentialProbe = async (env) => {
  const integration = "Email";

  // Discover slots from env keys. Primary slot = EMAIL_IMAP_HOST; numbered
  // slots match EMAIL_<N>_IMAP_HOST.
  const slots: string[] = [];
  if (env["EMAIL_IMAP_HOST"] !== undefined || env["EMAIL_IMAP_USER"] !== undefined) slots.push("");
  for (const key of Object.keys(env)) {
    const m = key.match(/^EMAIL_(\d+)_IMAP_HOST$/);
    if (m) slots.push(`${m[1]}_`);
  }

  if (slots.length === 0) {
    return missing(integration, "EMAIL_IMAP_HOST", "No email slots configured. Run `clawhq integrate add email` to connect a mailbox.");
  }

  const required = ["IMAP_HOST", "IMAP_USER", "IMAP_PASS", "SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
  for (const slot of slots) {
    for (const field of required) {
      const key = `EMAIL_${slot}${field}`;
      const value = env[key];
      if (value === undefined || value.trim() === "") {
        return fail(
          integration,
          key,
          `${key} is missing or empty`,
          `Run \`clawhq integrate add email${slot ? ` --slot ${slot.replace("_", "")}` : ""}\` to set credentials.`,
        );
      }
    }
    const user = env[`EMAIL_${slot}IMAP_USER`] ?? "";
    if (!user.includes("@")) {
      return fail(
        integration,
        `EMAIL_${slot}IMAP_USER`,
        `IMAP user "${user}" does not look like an email address`,
        "Most providers (Gmail, iCloud, Outlook, Fastmail) expect the full email address as username.",
      );
    }
  }

  const suffix = slots.length === 1 ? "slot" : "slots";
  return pass(integration, "EMAIL_IMAP_HOST", `${slots.length} ${suffix} validated (shape only; live check via \`clawhq verify\`)`);
};

export const builtinProbes: readonly CredentialProbe[] = [
  probeAnthropic,
  probeOpenAI,
  probeTelegram,
  probe1Password,
  probeGitHub,
  probeX,
  probeHomeAssistant,
  probeEmail,
];
