/**
 * Ops automation file generator — produces all scripts and systemd units.
 *
 * Called during `clawhq init` to generate operational scripts in the
 * deployment directory. Scripts are written to ops/automation/.
 */

import { FILE_MODE_CONFIG, FILE_MODE_EXEC } from "../../config/defaults.js";
import type { OpsAutomationConfig } from "../../config/types.js";

import {
  generateAutoUpdateScript,
  generateBackupScript,
  generateSecurityMonitorScript,
} from "./scripts.js";
import {
  generateAutoUpdateUnits,
  generateBackupUnits,
  generateSecurityMonitorUnits,
} from "./systemd.js";
import type { OpsScriptEntry } from "./types.js";

/**
 * Generate all operational automation files for a deployment.
 *
 * Returns scripts and systemd unit files ready for writing.
 */
export function generateOpsAutomationFiles(
  deployDir: string,
  config?: OpsAutomationConfig,
): OpsScriptEntry[] {
  const files: OpsScriptEntry[] = [];

  // Auto-update script + units
  const autoUpdateEnabled = config?.autoUpdate?.enabled !== false;
  if (autoUpdateEnabled) {
    files.push({
      filename: "clawhq-autoupdate.sh",
      content: generateAutoUpdateScript(deployDir),
      mode: FILE_MODE_EXEC,
      relativePath: "ops/automation/scripts/clawhq-autoupdate.sh",
    });

    const autoUpdateUnits = generateAutoUpdateUnits(
      deployDir,
      config?.autoUpdate?.schedule,
      config?.autoUpdate?.mode,
    );
    files.push({
      filename: autoUpdateUnits.serviceName,
      content: autoUpdateUnits.service,
      mode: FILE_MODE_CONFIG,
      relativePath: `ops/automation/systemd/${autoUpdateUnits.serviceName}`,
    });
    files.push({
      filename: autoUpdateUnits.timerName,
      content: autoUpdateUnits.timer,
      mode: FILE_MODE_CONFIG,
      relativePath: `ops/automation/systemd/${autoUpdateUnits.timerName}`,
    });
  }

  // Security monitor script + units
  const securityEnabled = config?.securityMonitor?.enabled !== false;
  if (securityEnabled) {
    files.push({
      filename: "clawhq-security-monitor.sh",
      content: generateSecurityMonitorScript(
        deployDir,
        config?.securityMonitor?.severities,
      ),
      mode: FILE_MODE_EXEC,
      relativePath: "ops/automation/scripts/clawhq-security-monitor.sh",
    });

    const securityUnits = generateSecurityMonitorUnits(
      deployDir,
      config?.securityMonitor?.schedule,
    );
    files.push({
      filename: securityUnits.serviceName,
      content: securityUnits.service,
      mode: FILE_MODE_CONFIG,
      relativePath: `ops/automation/systemd/${securityUnits.serviceName}`,
    });
    files.push({
      filename: securityUnits.timerName,
      content: securityUnits.timer,
      mode: FILE_MODE_CONFIG,
      relativePath: `ops/automation/systemd/${securityUnits.timerName}`,
    });
  }

  // Backup script + units
  const backupEnabled = config?.backup?.enabled !== false;
  if (backupEnabled) {
    files.push({
      filename: "clawhq-backup.sh",
      content: generateBackupScript(
        deployDir,
        config?.backup?.targetDir,
        config?.backup?.retentionDays,
      ),
      mode: FILE_MODE_EXEC,
      relativePath: "ops/automation/scripts/clawhq-backup.sh",
    });

    const backupUnits = generateBackupUnits(
      deployDir,
      config?.backup?.schedule,
    );
    files.push({
      filename: backupUnits.serviceName,
      content: backupUnits.service,
      mode: FILE_MODE_CONFIG,
      relativePath: `ops/automation/systemd/${backupUnits.serviceName}`,
    });
    files.push({
      filename: backupUnits.timerName,
      content: backupUnits.timer,
      mode: FILE_MODE_CONFIG,
      relativePath: `ops/automation/systemd/${backupUnits.timerName}`,
    });
  }

  return files;
}
