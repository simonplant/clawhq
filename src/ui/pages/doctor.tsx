/**
 * Doctor diagnostics page.
 *
 * Fetches check results from GET /api/v1/doctor and renders a table
 * with pass/warn/fail traffic-light icons. Fix All button triggers
 * POST /api/v1/doctor/fix via htmx and updates the results in-place.
 */

import type { HtmlEscapedString } from "hono/utils/html";

import { Layout } from "../components/layout.js";

export function renderDoctorPage(): HtmlEscapedString {
  return (
    <Layout title="Doctor">
      <hgroup>
        <h1>Doctor</h1>
        <p>Preventive diagnostics — checks every known failure mode</p>
      </hgroup>

      <div id="doctor-controls" style="margin-bottom: 1rem;">
        <button id="run-checks-btn" onclick="runDoctorChecks()">
          Run Checks
        </button>
        <button
          id="fix-all-btn"
          class="secondary"
          hx-post="/api/v1/doctor/fix"
          hx-target="#doctor-results"
          hx-swap="innerHTML"
          hx-indicator="#fix-spinner"
          disabled
        >
          Fix All
        </button>
        <span id="fix-spinner" class="htmx-indicator" aria-busy="true" />
      </div>

      <div id="doctor-summary" style="margin-bottom: 1rem;"></div>
      <div id="doctor-results">
        <p aria-busy="true">Running checks...</p>
      </div>

      <script>{`
        document.addEventListener('DOMContentLoaded', function() {
          runDoctorChecks();
        });

        function runDoctorChecks() {
          var resultsEl = document.getElementById('doctor-results');
          var summaryEl = document.getElementById('doctor-summary');
          var fixBtn = document.getElementById('fix-all-btn');
          resultsEl.innerHTML = '<p aria-busy="true">Running checks...</p>';
          summaryEl.innerHTML = '';
          fixBtn.disabled = true;

          fetch('/api/v1/doctor')
            .then(function(r) { return r.json(); })
            .then(function(res) {
              if (!res.ok) {
                resultsEl.innerHTML = '<p class="status-error">Error: ' + (res.error || 'Unknown error') + '</p>';
                return;
              }
              var report = res.data;
              renderSummary(summaryEl, report.counts, report.passed);
              renderChecksTable(resultsEl, report.checks);
              if (report.counts.fail > 0 || report.counts.warn > 0) {
                fixBtn.disabled = false;
              }
            })
            .catch(function(err) {
              resultsEl.innerHTML = '<p class="status-error">Failed to run checks: ' + err.message + '</p>';
            });
        }

        function renderSummary(el, counts, passed) {
          var cls = passed ? 'status-running' : 'status-degraded';
          var label = passed ? 'ALL CHECKS PASSED' : 'ISSUES FOUND';
          el.innerHTML =
            '<span class="status-badge ' + cls + '">' + label + '</span> ' +
            '<span class="metric-label">' +
            counts.pass + ' passed, ' +
            counts.warn + ' warnings, ' +
            counts.fail + ' failed</span>';
        }

        function statusIcon(status) {
          switch(status) {
            case 'pass': return '<span class="doctor-icon doctor-pass">\\u2713</span>';
            case 'warn': return '<span class="doctor-icon doctor-warn">\\u26A0</span>';
            case 'fail': return '<span class="doctor-icon doctor-fail">\\u2717</span>';
            default: return status;
          }
        }

        function renderChecksTable(el, checks) {
          var html = '<table role="grid">' +
            '<thead><tr>' +
            '<th>Status</th>' +
            '<th>Check</th>' +
            '<th>Message</th>' +
            '<th>Fix</th>' +
            '</tr></thead><tbody>';
          checks.forEach(function(check) {
            html += '<tr>' +
              '<td>' + statusIcon(check.status) + '</td>' +
              '<td>' + escapeHtml(check.name) + '</td>' +
              '<td>' + escapeHtml(check.message) + '</td>' +
              '<td class="metric-label">' + escapeHtml(check.fix || '-') + '</td>' +
              '</tr>';
          });
          html += '</tbody></table>';
          el.innerHTML = html;
        }

        function escapeHtml(str) {
          if (!str) return '';
          var div = document.createElement('div');
          div.textContent = str;
          return div.innerHTML;
        }

        // Handle htmx fix response — re-render as fix results table
        document.body.addEventListener('htmx:beforeSwap', function(evt) {
          if (evt.detail.target.id !== 'doctor-results') return;
          try {
            var res = JSON.parse(evt.detail.xhr.responseText);
            if (res.ok && res.data) {
              var fixes = res.data;
              var html = '<table role="grid">' +
                '<thead><tr><th>Status</th><th>Check</th><th>Result</th></tr></thead><tbody>';
              fixes.forEach(function(f) {
                var icon = f.fixed
                  ? '<span class="doctor-icon doctor-pass">\\u2713</span>'
                  : '<span class="doctor-icon doctor-fail">\\u2717</span>';
                html += '<tr><td>' + icon + '</td>' +
                  '<td>' + escapeHtml(f.name) + '</td>' +
                  '<td>' + escapeHtml(f.message) + '</td></tr>';
              });
              html += '</tbody></table>' +
                '<button onclick="runDoctorChecks()" style="margin-top:0.5rem;">Re-run Checks</button>';
              evt.detail.serverResponse = html;
              evt.detail.shouldSwap = true;
              evt.detail.isError = false;
            }
          } catch(e) { /* let htmx handle raw response */ }
        });
      `}</script>

      <style>{`
        .doctor-icon {
          font-size: 1.1rem;
          font-weight: 700;
        }
        .doctor-pass { color: #52b788; }
        .doctor-warn { color: #e76f51; }
        .doctor-fail { color: #e63946; }
        #doctor-controls button {
          margin-right: 0.5rem;
        }
        .htmx-indicator {
          display: none;
        }
        .htmx-request .htmx-indicator,
        .htmx-request.htmx-indicator {
          display: inline-block;
        }
      `}</style>
    </Layout>
  ) as unknown as HtmlEscapedString;
}
