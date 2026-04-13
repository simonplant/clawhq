/**
 * Systemd unit file generators for operational automation.
 *
 * Generates .service and .timer files for auto-update, security monitor,
 * and workspace backup. Deployed via `clawhq ops install`.
 */

import {
  OPS_AUTO_UPDATE_SCHEDULE,
  OPS_BACKUP_SCHEDULE,
  OPS_SECURITY_MONITOR_SCHEDULE,
} from "../../config/defaults.js";

// ── Types ──────────────────────────────────────────────────────────────────

interface SystemdUnitPair {
  readonly service: string;
  readonly timer: string;
  readonly serviceName: string;
  readonly timerName: string;
}

// ── Auto-Update Units ──────────────────────────────────────────────────────

/**
 * Generate systemd service + timer for auto-update.
 *
 * @param mode - "notify" (check + Telegram alert) or "apply" (check + apply + notify)
 */
export function generateAutoUpdateUnits(
  deployDir: string,
  schedule: string = OPS_AUTO_UPDATE_SCHEDULE,
  mode: "notify" | "apply" = "notify",
): SystemdUnitPair {
  const scriptPath = `${deployDir}/ops/automation/scripts/clawhq-autoupdate.sh`;

  const service = `[Unit]
Description=ClawHQ Auto-Update (${mode} mode)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=${scriptPath}
User=root
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=AUTO_UPDATE_MODE=${mode}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;

  const timer = `[Unit]
Description=ClawHQ Auto-Update Timer

[Timer]
OnCalendar=${schedule}
RandomizedDelaySec=900
Persistent=true

[Install]
WantedBy=timers.target
`;

  return {
    service,
    timer,
    serviceName: "clawhq-autoupdate.service",
    timerName: "clawhq-autoupdate.timer",
  };
}

// ── Security Monitor Units ─────────────────────────────────────────────────

/**
 * Generate systemd service + timer for security advisory monitoring.
 */
export function generateSecurityMonitorUnits(
  deployDir: string,
  schedule: string = OPS_SECURITY_MONITOR_SCHEDULE,
): SystemdUnitPair {
  const scriptPath = `${deployDir}/ops/automation/scripts/clawhq-security-monitor.sh`;

  const service = `[Unit]
Description=ClawHQ Security Advisory Monitor
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=${scriptPath}
User=root
Environment=PATH=/usr/local/bin:/usr/bin:/bin
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;

  const timer = `[Unit]
Description=ClawHQ Security Monitor Timer

[Timer]
OnCalendar=${schedule}
RandomizedDelaySec=300
Persistent=true

[Install]
WantedBy=timers.target
`;

  return {
    service,
    timer,
    serviceName: "clawhq-security-monitor.service",
    timerName: "clawhq-security-monitor.timer",
  };
}

// ── Workspace Backup Units ─────────────────────────────────────────────────

/**
 * Generate systemd service + timer for workspace backup.
 */
export function generateBackupUnits(
  deployDir: string,
  schedule: string = OPS_BACKUP_SCHEDULE,
): SystemdUnitPair {
  const scriptPath = `${deployDir}/ops/automation/scripts/clawhq-backup.sh`;

  const service = `[Unit]
Description=ClawHQ Workspace Backup
After=local-fs.target

[Service]
Type=oneshot
ExecStart=${scriptPath}
User=root
Environment=PATH=/usr/local/bin:/usr/bin:/bin
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;

  const timer = `[Unit]
Description=ClawHQ Workspace Backup Timer

[Timer]
OnCalendar=${schedule}
RandomizedDelaySec=600
Persistent=true

[Install]
WantedBy=timers.target
`;

  return {
    service,
    timer,
    serviceName: "clawhq-backup.service",
    timerName: "clawhq-backup.timer",
  };
}
