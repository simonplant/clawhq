/**
 * Doctor diagnostic engine types.
 *
 * Each check implements the Check interface: a name, a run function that
 * returns a CheckResult, and an optional fix function for auto-remediation.
 */

export type CheckStatus = "pass" | "warn" | "fail";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  fix: string;
}

export interface Check {
  name: string;
  run(ctx: DoctorContext): Promise<CheckResult>;
}

export interface FixableCheck extends Check {
  fix(ctx: DoctorContext): Promise<FixResult>;
}

export interface FixResult {
  name: string;
  fixed: boolean;
  message: string;
}

export interface DoctorContext {
  openclawHome: string;
  configPath: string;
  composePath?: string;
  envPath?: string;
  imageTag?: string;
  baseTag?: string;
  gatewayHost?: string;
  gatewayPort?: number;
}

export interface DoctorReport {
  checks: CheckResult[];
  passed: boolean;
  counts: { pass: number; warn: number; fail: number };
}

export function isFixable(check: Check): check is FixableCheck {
  return "fix" in check && typeof (check as FixableCheck).fix === "function";
}
