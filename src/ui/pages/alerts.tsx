/**
 * Alerts page.
 *
 * Cards grouped by severity (critical/warning/info) from
 * GET /api/v1/alerts → generateAlerts(). Dismiss/acknowledge actions
 * per alert. Metric summary at the top.
 */

import type { HtmlEscapedString } from "hono/utils/html";

import { Layout } from "../components/layout.js";

export function renderAlertsPage(): HtmlEscapedString {
  return (
    <Layout title="Alerts">
      <hgroup>
        <h1>Alerts</h1>
        <p>Predictive health alerts — catches problems before they cause failures</p>
      </hgroup>

      <div id="alert-summary" style="margin-bottom: 1rem;"></div>
      <div id="alert-cards">
        <p aria-busy="true">Loading alerts...</p>
      </div>

      <script>{`
        var dismissedAlerts = JSON.parse(localStorage.getItem('clawhq_dismissed_alerts') || '[]');

        document.addEventListener('DOMContentLoaded', function() {
          loadAlerts();
        });

        function loadAlerts() {
          var cardsEl = document.getElementById('alert-cards');
          var summaryEl = document.getElementById('alert-summary');
          cardsEl.innerHTML = '<p aria-busy="true">Loading alerts...</p>';
          summaryEl.innerHTML = '';

          fetch('/api/v1/alerts')
            .then(function(r) { return r.json(); })
            .then(function(res) {
              if (!res.ok) {
                cardsEl.innerHTML = '<p class="status-error">Error: ' + escapeHtml(res.error || 'Unknown error') + '</p>';
                return;
              }
              renderSummary(summaryEl, res.data);
              renderAlertCards(cardsEl, res.data);
            })
            .catch(function(err) {
              cardsEl.innerHTML = '<p class="status-error">Failed to load alerts: ' + escapeHtml(err.message) + '</p>';
            });
        }

        function renderSummary(el, report) {
          var counts = report.counts || {};
          var critical = counts.critical || 0;
          var warning = counts.warning || 0;
          var info = counts.info || 0;
          var total = critical + warning + info;
          var metrics = report.metricSummary || {};

          var cls = critical > 0 ? 'status-degraded' : (warning > 0 ? 'alert-severity-warning' : 'status-running');
          var label = total === 0 ? 'ALL CLEAR' : total + ' ALERT' + (total !== 1 ? 'S' : '');

          el.innerHTML =
            '<div class="dashboard-grid">' +
            '<article>' +
            '<span class="status-badge ' + cls + '">' + label + '</span>' +
            (critical > 0 ? ' <span class="alert-count alert-critical-count">' + critical + ' critical</span>' : '') +
            (warning > 0 ? ' <span class="alert-count alert-warning-count">' + warning + ' warning</span>' : '') +
            (info > 0 ? ' <span class="alert-count alert-info-count">' + info + ' info</span>' : '') +
            '</article>' +
            '<article>' +
            '<span class="metric-value">' + (metrics.tracked || 0) + '</span> <span class="metric-label">metrics tracked</span>' +
            ' &middot; ' +
            '<span class="metric-value">' + (metrics.trending || 0) + '</span> <span class="metric-label">trending</span>' +
            ' &middot; ' +
            '<span class="metric-value">' + (metrics.stable || 0) + '</span> <span class="metric-label">stable</span>' +
            '</article>' +
            '</div>';
        }

        function renderAlertCards(el, report) {
          var alerts = report.alerts || [];

          // Filter out dismissed alerts
          var active = alerts.filter(function(a) {
            return dismissedAlerts.indexOf(a.id) === -1;
          });

          if (active.length === 0) {
            el.innerHTML =
              '<article class="empty-state">' +
              '<p>' + (alerts.length > 0
                ? 'All alerts dismissed. <a href="#" onclick="clearDismissed(); return false;">Show dismissed</a>'
                : 'No alerts. All systems healthy.') +
              '</p>' +
              '</article>';
            return;
          }

          // Group by severity
          var groups = { critical: [], warning: [], info: [] };
          active.forEach(function(a) {
            if (groups[a.severity]) groups[a.severity].push(a);
          });

          var html = '';
          ['critical', 'warning', 'info'].forEach(function(severity) {
            var items = groups[severity];
            if (items.length === 0) return;

            html += '<h3 class="alert-group-header alert-severity-' + severity + '">' +
              severityIcon(severity) + ' ' +
              severity.charAt(0).toUpperCase() + severity.slice(1) +
              ' (' + items.length + ')' +
              '</h3>';

            items.forEach(function(alert) {
              html +=
                '<article class="alert-card alert-card-' + severity + '" id="alert-' + escapeAttr(alert.id) + '">' +
                '<header>' +
                '<strong>' + escapeHtml(alert.title) + '</strong>' +
                '<span class="status-badge alert-severity-' + severity + '" style="margin-left:0.5rem;">' + escapeHtml(alert.category) + '</span>' +
                (alert.projectedTimeline ? '<span class="metric-label" style="margin-left:0.5rem;">' + escapeHtml(alert.projectedTimeline) + '</span>' : '') +
                '</header>' +
                '<p>' + escapeHtml(alert.message) + '</p>';

              if (alert.remediation && alert.remediation.length > 0) {
                html += '<details><summary class="metric-label">Remediation</summary><ul>';
                alert.remediation.forEach(function(step) {
                  html += '<li class="metric-label">' + escapeHtml(step) + '</li>';
                });
                html += '</ul></details>';
              }

              if (alert.trend) {
                var t = alert.trend;
                html += '<p class="metric-label">Trend: ' +
                  escapeHtml(t.direction) + ' at ' +
                  escapeHtml(String(Math.abs(t.slopePerDay).toFixed(2))) + '/day' +
                  ' (R\\u00B2=' + escapeHtml(String(t.rSquared.toFixed(2))) + ', ' +
                  t.dataPoints + ' points)</p>';
              }

              html +=
                '<footer>' +
                '<button class="secondary dismiss-btn" onclick="dismissAlert(\\'' + escapeAttr(alert.id) + '\\')">Dismiss</button>' +
                '<span class="metric-label" style="margin-left:auto;">' + new Date(alert.generatedAt).toLocaleString() + '</span>' +
                '</footer>' +
                '</article>';
            });
          });

          el.innerHTML = html;
        }

        function severityIcon(severity) {
          switch(severity) {
            case 'critical': return '\\u2717';
            case 'warning': return '\\u26A0';
            case 'info': return '\\u2139';
            default: return '';
          }
        }

        function dismissAlert(id) {
          dismissedAlerts.push(id);
          localStorage.setItem('clawhq_dismissed_alerts', JSON.stringify(dismissedAlerts));
          var card = document.getElementById('alert-' + id);
          if (card) card.style.display = 'none';

          // Re-render to update group counts and empty state
          fetch('/api/v1/alerts')
            .then(function(r) { return r.json(); })
            .then(function(res) {
              if (!res.ok) return;
              renderAlertCards(document.getElementById('alert-cards'), res.data);
            })
            .catch(function() {});
        }

        function clearDismissed() {
          dismissedAlerts = [];
          localStorage.setItem('clawhq_dismissed_alerts', '[]');
          loadAlerts();
        }

        function escapeHtml(str) {
          if (!str) return '';
          var div = document.createElement('div');
          div.textContent = str;
          return div.innerHTML;
        }

        function escapeAttr(str) {
          return str.replace(/[&"'<>]/g, function(c) {
            return { '&': '&amp;', '"': '&quot;', "'": '&#39;', '<': '&lt;', '>': '&gt;' }[c];
          });
        }
      `}</script>

      <style>{`
        .alert-group-header {
          margin-top: 1.5rem;
          margin-bottom: 0.5rem;
          font-size: 1rem;
        }
        .alert-severity-critical {
          background: #9d0208;
          color: #ffd6d6;
        }
        .alert-severity-warning {
          background: #e76f51;
          color: #fce4db;
        }
        .alert-severity-info {
          background: #495057;
          color: #adb5bd;
        }
        .alert-card {
          margin-bottom: 0.75rem;
        }
        .alert-card-critical {
          border-left: 4px solid #e63946;
        }
        .alert-card-warning {
          border-left: 4px solid #e76f51;
        }
        .alert-card-info {
          border-left: 4px solid #6c757d;
        }
        .alert-card header {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
        }
        .alert-card footer {
          display: flex;
          align-items: center;
        }
        .alert-count {
          font-size: 0.85rem;
          margin-left: 0.5rem;
          font-weight: 600;
        }
        .alert-critical-count { color: #e63946; }
        .alert-warning-count { color: #e76f51; }
        .alert-info-count { color: #6c757d; }
        .dismiss-btn {
          font-size: 0.8rem;
          padding: 0.2rem 0.6rem;
        }
        .empty-state {
          text-align: center;
          padding: 2rem;
        }
        .empty-state p {
          color: var(--pico-muted-color);
          font-size: 1.1rem;
        }
      `}</style>
    </Layout>
  ) as unknown as HtmlEscapedString;
}
