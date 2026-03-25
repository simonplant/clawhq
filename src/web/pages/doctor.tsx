/**
 * Doctor page — shows same output as CLI `clawhq doctor`.
 */

import type { DoctorReport } from "../../operate/doctor/index.js";
import { Layout } from "../layout.js";

export function DoctorPage({ report, csrfToken }: { report: DoctorReport; csrfToken?: string }) {
  return (
    <Layout title="Doctor" activePath="/doctor" csrfToken={csrfToken}>
      <hgroup>
        <h1>Doctor Diagnostics</h1>
        <p>
          {report.healthy
            ? <span class="badge badge-ok">All checks passed</span>
            : <span class="badge badge-err">{report.errors.length} error(s), {report.warnings.length} warning(s)</span>}
        </p>
      </hgroup>

      <div>
        <button hx-post="/api/doctor" hx-target="#doctor-results" hx-swap="innerHTML" hx-indicator="#doctor-spinner">
          Re-run Checks
        </button>
        <button hx-post="/api/doctor/fix" hx-target="#doctor-results" hx-swap="innerHTML" hx-indicator="#doctor-spinner">
          Run with Auto-fix
        </button>
        <span id="doctor-spinner" class="htmx-indicator" aria-busy="true">Running...</span>
      </div>

      <div id="doctor-results">
        <DoctorResults report={report} />
      </div>
    </Layout>
  );
}

export function DoctorResults({ report }: { report: DoctorReport }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Check</th>
          <th>Status</th>
          <th>Message</th>
          <th>Fix</th>
        </tr>
      </thead>
      <tbody>
        {report.checks.map((check) => (
          <tr>
            <td><code>{check.name}</code></td>
            <td>
              {check.passed
                ? <span class="check-pass">PASS</span>
                : check.severity === "error"
                  ? <span class="check-fail">FAIL</span>
                  : <span class="check-warn">WARN</span>}
            </td>
            <td>{check.message}</td>
            <td>{check.fix ?? "-"}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colspan={4}>
            {report.passed.length} passed, {report.errors.length} errors, {report.warnings.length} warnings
            — {report.timestamp}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
