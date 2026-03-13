/**
 * Check: OpenClaw source is acquired, version-pinned, and integrity-verified.
 */

import {
  getSourceStatus,
  resolveSourceConfig,
  SourceError,
  VersionNotPinned,
} from "../../source/index.js";
import type { Check, CheckResult, DoctorContext } from "../types.js";

export const openclawSourceCheck: Check = {
  name: "OpenClaw source",

  async run(_ctx: DoctorContext): Promise<CheckResult> {
    // Resolve source config — we need the clawhq config for this.
    // DoctorContext doesn't carry full config, so we read from known paths.
    const sourceConfig = resolveSourceConfig();

    // No version pinned
    if (!sourceConfig.version) {
      return {
        name: this.name,
        status: "warn",
        message: "No OpenClaw version pinned in config",
        fix: "Set openclaw.source.version in clawhq.yaml (e.g., version: \"v0.14.2\")",
      };
    }

    try {
      const status = await getSourceStatus(sourceConfig);

      if (!status.cached) {
        return {
          name: this.name,
          status: "fail",
          message: `Source not found for pinned version ${sourceConfig.version}`,
          fix: "Run `clawhq build` to acquire OpenClaw source",
        };
      }

      if (!status.integrityOk) {
        return {
          name: this.name,
          status: "fail",
          message: `Integrity check failed for ${sourceConfig.version}`,
          fix: "Run `clawhq build --force` to re-acquire OpenClaw source",
        };
      }

      return {
        name: this.name,
        status: "pass",
        message: `OpenClaw ${sourceConfig.version} — source cached and verified`,
        fix: "",
      };
    } catch (err: unknown) {
      if (err instanceof VersionNotPinned) {
        return {
          name: this.name,
          status: "warn",
          message: "No OpenClaw version pinned",
          fix: err.message,
        };
      }

      const msg = err instanceof SourceError ? err.message : String(err);
      return {
        name: this.name,
        status: "fail",
        message: msg,
        fix: "Check openclaw.source config in clawhq.yaml",
      };
    }
  },
};
