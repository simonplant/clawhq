/**
 * WhatsApp Business API channel setup flow.
 *
 * Walks the user through WhatsApp Business API credentials setup,
 * validates access token and phone number ID, and stores config.
 */

import type { WizardIO } from "../configure/types.js";

import { readChannelEnv, readOpenClawChannels, writeChannelConfig, writeChannelEnv } from "./config.js";
import type {
  ChannelHealth,
  ChannelSetupFlow,
  ChannelSetupResult,
  ChannelTestResult,
  ChannelTestStep,
  ConnectOptions,
} from "./types.js";

const GRAPH_API = "https://graph.facebook.com/v21.0";
const TIMEOUT_MS = 10_000;
const ENV_TOKEN = "WHATSAPP_ACCESS_TOKEN";
const ENV_PHONE_ID = "WHATSAPP_PHONE_NUMBER_ID";

interface WhatsAppPhoneInfo {
  id: string;
  display_phone_number: string;
  verified_name: string;
}

/**
 * Validate WhatsApp Business API credentials by fetching phone number info.
 */
export async function validateWhatsAppCredentials(
  accessToken: string,
  phoneNumberId: string,
): Promise<{ valid: boolean; phone?: WhatsAppPhoneInfo; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(`${GRAPH_API}/${phoneNumberId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (response.status === 200) {
      const data = (await response.json()) as WhatsAppPhoneInfo;
      if (data.id && data.display_phone_number) {
        return { valid: true, phone: data };
      }
      return { valid: false, error: "Unexpected response — missing phone number fields" };
    }

    if (response.status === 401 || response.status === 403) {
      return { valid: false, error: "Invalid or expired access token" };
    }

    if (response.status === 400) {
      const errData = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { valid: false, error: errData?.error?.message ?? "Invalid phone number ID" };
    }

    return { valid: false, error: `WhatsApp API returned status ${response.status}` };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return { valid: false, error: "Request timed out — check network connectivity" };
    }
    return { valid: false, error: `Network error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export const whatsappFlow: ChannelSetupFlow = {
  channel: "whatsapp",

  async setup(io: WizardIO, options: ConnectOptions): Promise<ChannelSetupResult> {
    io.log("");
    io.log("WhatsApp Business API Setup");
    io.log("===========================");
    io.log("");
    io.log("To connect WhatsApp, you need credentials from Meta's Business API.");
    io.log("");
    io.log("Prerequisites:");
    io.log("  1. Meta Business account (business.facebook.com)");
    io.log("  2. WhatsApp Business API app created in Meta Developer Portal");
    io.log("  3. A phone number registered with the WhatsApp Business API");
    io.log("");
    io.log("You'll need:");
    io.log("  - Access Token (from Meta Developer Portal → Your App → WhatsApp → API Setup)");
    io.log("  - Phone Number ID (shown on the same page)");
    io.log("");

    // Get access token
    const accessToken = await io.prompt("Access Token");
    if (!accessToken) {
      return {
        channel: "whatsapp",
        success: false,
        message: "No access token provided",
        envVarsSet: [],
        configKeys: [],
      };
    }

    // Get phone number ID
    const phoneNumberId = await io.prompt("Phone Number ID");
    if (!phoneNumberId) {
      return {
        channel: "whatsapp",
        success: false,
        message: "No phone number ID provided",
        envVarsSet: [],
        configKeys: [],
      };
    }

    // Validate immediately
    io.log("");
    io.log("Validating credentials...");

    const result = await validateWhatsAppCredentials(accessToken, phoneNumberId);

    if (!result.valid || !result.phone) {
      io.log(`  FAIL: ${result.error}`);
      io.log("");
      io.log("Credential validation failed. Please check your credentials and try again.");
      return {
        channel: "whatsapp",
        success: false,
        message: `Validation failed: ${result.error}`,
        envVarsSet: [],
        configKeys: [],
      };
    }

    const phone = result.phone;
    io.log(`  OK: ${phone.verified_name} (${phone.display_phone_number})`);
    io.log("");

    // Optional: webhook verify token
    const configureWebhook = await io.confirm("Configure webhook verify token?", false);
    let verifyToken: string | undefined;

    if (configureWebhook) {
      io.log("");
      io.log("The verify token is used by Meta to confirm your webhook endpoint.");
      io.log("Choose any string — you'll set the same value in Meta Developer Portal.");
      verifyToken = await io.prompt("Webhook verify token");
    }

    // Store credentials and config
    await writeChannelEnv(options.envPath, ENV_TOKEN, accessToken);
    await writeChannelEnv(options.envPath, ENV_PHONE_ID, phoneNumberId);
    await writeChannelConfig(options.configPath, "whatsapp", {
      enabled: true,
      ...(verifyToken ? { webhookVerifyToken: verifyToken } : {}),
    });

    io.log("");
    io.log(`WhatsApp connected: ${phone.verified_name} (${phone.display_phone_number})`);
    io.log(`  Credentials stored in .env as ${ENV_TOKEN} and ${ENV_PHONE_ID}`);
    io.log("  Channel enabled in openclaw.json");

    return {
      channel: "whatsapp",
      success: true,
      message: `Connected ${phone.verified_name} (${phone.display_phone_number})`,
      envVarsSet: [ENV_TOKEN, ENV_PHONE_ID],
      configKeys: ["channels.whatsapp"],
    };
  },

  async test(options: ConnectOptions): Promise<ChannelTestResult> {
    const steps: ChannelTestStep[] = [];

    // Step 1: Read credentials from .env
    const accessToken = await readChannelEnv(options.envPath, ENV_TOKEN);
    const phoneNumberId = await readChannelEnv(options.envPath, ENV_PHONE_ID);

    if (!accessToken || !phoneNumberId) {
      const missing = [
        !accessToken ? ENV_TOKEN : null,
        !phoneNumberId ? ENV_PHONE_ID : null,
      ].filter(Boolean).join(", ");
      steps.push({
        name: "Read credentials",
        passed: false,
        message: `Missing in .env: ${missing} — run \`clawhq connect whatsapp\` first`,
      });
      return { channel: "whatsapp", success: false, steps };
    }
    steps.push({ name: "Read credentials", passed: true, message: "Credentials found in .env" });

    // Step 2: Validate credentials
    const validation = await validateWhatsAppCredentials(accessToken, phoneNumberId);
    if (!validation.valid || !validation.phone) {
      steps.push({ name: "Validate credentials", passed: false, message: validation.error ?? "Invalid credentials" });
      return { channel: "whatsapp", success: false, steps };
    }
    steps.push({
      name: "Validate credentials",
      passed: true,
      message: `${validation.phone.verified_name} (${validation.phone.display_phone_number})`,
    });

    // Step 3: Check channel config
    const channels = await readOpenClawChannels(options.configPath);
    const whatsappConfig = channels?.whatsapp;
    if (!whatsappConfig?.enabled) {
      steps.push({ name: "Check channel config", passed: false, message: "WhatsApp not enabled in openclaw.json" });
      return { channel: "whatsapp", success: false, steps };
    }
    steps.push({ name: "Check channel config", passed: true, message: "WhatsApp enabled in config" });

    return {
      channel: "whatsapp",
      success: steps.every((s) => s.passed),
      steps,
    };
  },

  async health(options: ConnectOptions): Promise<ChannelHealth> {
    const accessToken = await readChannelEnv(options.envPath, ENV_TOKEN);
    const phoneNumberId = await readChannelEnv(options.envPath, ENV_PHONE_ID);

    if (!accessToken || !phoneNumberId) {
      return { channel: "whatsapp", status: "unconfigured", message: "Not configured" };
    }

    const channels = await readOpenClawChannels(options.configPath);
    if (!channels?.whatsapp?.enabled) {
      return { channel: "whatsapp", status: "disconnected", message: "Disabled in config" };
    }

    const result = await validateWhatsAppCredentials(accessToken, phoneNumberId);
    if (!result.valid || !result.phone) {
      return { channel: "whatsapp", status: "error", message: result.error ?? "Invalid credentials" };
    }

    return {
      channel: "whatsapp",
      status: "connected",
      message: "Connected",
      displayName: result.phone.verified_name,
    };
  },
};
