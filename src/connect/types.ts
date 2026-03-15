/**
 * Channel connection types.
 *
 * Defines the setup flow results, channel status, and test outcomes
 * for the `clawhq connect` command.
 */

import type { WizardIO } from "../init/types.js";

/** Supported channel types. */
export type ChannelType = "telegram" | "whatsapp" | "discord" | "slack" | "matrix";

/** Result of a channel setup flow. */
export interface ChannelSetupResult {
  channel: ChannelType;
  success: boolean;
  /** Human-readable summary of what was configured. */
  message: string;
  /** Env vars that were set during setup. */
  envVarsSet: string[];
  /** Config keys added to openclaw.json channels section. */
  configKeys: string[];
}

/** Result of a bidirectional channel test. */
export interface ChannelTestResult {
  channel: ChannelType;
  success: boolean;
  /** Details of each test step. */
  steps: ChannelTestStep[];
}

export interface ChannelTestStep {
  name: string;
  passed: boolean;
  message: string;
}

/** Channel status for the status dashboard. */
export type ChannelStatus = "connected" | "disconnected" | "error" | "unconfigured";

export interface ChannelHealth {
  channel: ChannelType;
  status: ChannelStatus;
  message: string;
  /** Bot username or display name, if available. */
  displayName?: string;
}

/** Options for the connect command. */
export interface ConnectOptions {
  /** OpenClaw home directory. */
  openclawHome: string;
  /** Path to .env file. */
  envPath: string;
  /** Path to openclaw.json. */
  configPath: string;
}

/** A channel setup flow implementation. */
export interface ChannelSetupFlow {
  channel: ChannelType;
  /** Walk the user through setup, validate credentials, return result. */
  setup(io: WizardIO, options: ConnectOptions): Promise<ChannelSetupResult>;
  /** Test bidirectional message flow. */
  test(options: ConnectOptions): Promise<ChannelTestResult>;
  /** Check current channel health (for status dashboard). */
  health(options: ConnectOptions): Promise<ChannelHealth>;
}
