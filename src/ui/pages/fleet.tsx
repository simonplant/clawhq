/**
 * Fleet management page.
 *
 * Multi-agent overview table with status, uptime, resource usage, skills,
 * and pending approvals. Bulk actions for restart-all and backup-all.
 * Fetches from GET /api/v1/fleet.
 */

import type { HtmlEscapedString } from "hono/utils/html";

import { Layout } from "../components/layout.js";

export function renderFleetPage(): HtmlEscapedString {
  return (
    <Layout title="Fleet">
      <hgroup>
        <h1>Fleet Management</h1>
        <p>Multi-agent overview — status, resources, and bulk operations</p>
      </hgroup>

      <div class="bulk-actions">
        <button id="restart-all-btn" class="secondary" onclick="restartAll()">Restart All</button>
        <button id="backup-all-btn" class="secondary" onclick="backupAll()">Backup All</button>
      </div>
      <p id="bulk-status" class="metric-label"></p>

      <div id="fleet-table">
        <p aria-busy="true">Loading fleet status...</p>
      </div>

      <script>{`
        document.addEventListener('DOMContentLoaded', function() {
          loadFleet();
        });

        function loadFleet() {
          var el = document.getElementById('fleet-table');
          el.innerHTML = '<p aria-busy="true">Loading fleet status...</p>';

          fetch('/api/v1/fleet')
            .then(function(r) { return r.json(); })
            .then(function(res) {
              if (!res.ok) {
                el.innerHTML = '<p class="status-error">Error: ' + escapeHtml(res.error || 'Unknown error') + '</p>';
                return;
              }
              renderFleetTable(el, res.data);
            })
            .catch(function(err) {
              el.innerHTML = '<p class="status-error">Failed to load fleet: ' + escapeHtml(err.message) + '</p>';
            });
        }

        function renderFleetTable(el, report) {
          var agents = report.agents || [];
          if (agents.length === 0) {
            el.innerHTML =
              '<article class="empty-state">' +
              '<p>No agents discovered. Configure agents with <code>clawhq agent add</code>.</p>' +
              '</article>';
            return;
          }

          var html =
            '<figure>' +
            '<table role="grid">' +
            '<thead><tr>' +
            '<th>Name</th>' +
            '<th>Template</th>' +
            '<th>Status</th>' +
            '<th>Uptime</th>' +
            '<th>CPU / RAM</th>' +
            '<th>Skills</th>' +
            '<th>Approvals</th>' +
            '<th></th>' +
            '</tr></thead>' +
            '<tbody>';

          agents.forEach(function(entry) {
            var agent = entry.agent || {};
            var status = entry.status || {};
            var workspace = entry.workspace || {};
            var state = status.state || 'unknown';
            var stateClass = 'status-' + state;

            var uptime = status.uptime || '—';
            var cpuRam = '—';
            var skillCount = 0;
            var approvalCount = 0;

            // Workspace may contain skill info via identity files
            var identityFiles = workspace.identityFiles || [];
            skillCount = identityFiles.length;

            html +=
              '<tr>' +
              '<td><strong>' + escapeHtml(agent.id || 'unknown') + '</strong>' +
              (agent.isDefault ? ' <small class="metric-label">(default)</small>' : '') +
              '</td>' +
              '<td class="metric-label">' + escapeHtml(status.image || '—') + '</td>' +
              '<td><span class="status-badge ' + stateClass + '">' + escapeHtml(state.toUpperCase()) + '</span></td>' +
              '<td class="metric-label">' + escapeHtml(uptime) + '</td>' +
              '<td class="metric-label">' + escapeHtml(cpuRam) + '</td>' +
              '<td class="metric-label">' + skillCount + '</td>' +
              '<td class="metric-label">' + approvalCount + '</td>' +
              '<td><a href="/?agent=' + encodeURIComponent(agent.id || '') + '" class="agent-link">View</a></td>' +
              '</tr>';
          });

          html += '</tbody></table></figure>';

          // Summary cards
          var health = report.health || {};
          html +=
            '<div class="dashboard-grid" style="margin-top:1rem;">' +
            '<article>' +
            '<div><span class="metric-value">' + (health.total || 0) + '</span> <span class="metric-label">total agents</span></div>' +
            '<div><span class="metric-value status-running" style="background:none;color:#52b788;">' + (health.running || 0) + '</span> <span class="metric-label">running</span></div>' +
            (health.degraded ? '<div><span class="metric-value" style="color:#e76f51;">' + health.degraded + '</span> <span class="metric-label">degraded</span></div>' : '') +
            (health.stopped ? '<div><span class="metric-value" style="color:#6c757d;">' + health.stopped + '</span> <span class="metric-label">stopped</span></div>' : '') +
            '</article>' +
            '<article>' +
            '<div><span class="metric-value">' + (report.security ? report.security.validCount : 0) + '</span> <span class="metric-label">healthy integrations</span></div>' +
            (report.security && report.security.failingCount ? '<div><span class="metric-value" style="color:#e63946;">' + report.security.failingCount + '</span> <span class="metric-label">failing</span></div>' : '') +
            '</article>' +
            '<article>' +
            (report.cost && report.cost.zeroEgressCount === health.total
              ? '<span class="status-badge zero-egress">ZERO EGRESS</span><p class="metric-label">No data has left any machine</p>'
              : '<div><span class="metric-value">' + (report.cost ? report.cost.totalEgressCalls : 0) + '</span> <span class="metric-label">total egress calls</span></div>') +
            '</article>' +
            '</div>';

          el.innerHTML = html;
        }

        // ── Bulk actions ──

        function restartAll() {
          if (!confirm('Restart all agents? This will briefly interrupt service.')) return;
          var btn = document.getElementById('restart-all-btn');
          var statusEl = document.getElementById('bulk-status');
          btn.disabled = true;
          btn.setAttribute('aria-busy', 'true');
          statusEl.textContent = 'Restarting all agents...';
          statusEl.className = 'metric-label';

          fetch('/api/v1/fleet')
            .then(function(r) { return r.json(); })
            .then(function(res) {
              if (!res.ok) throw new Error(res.error || 'Failed to fetch fleet');
              var agents = res.data.agents || [];
              var promises = agents.map(function(entry) {
                return fetch('/api/v1/deploy/restart', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ agentId: entry.agent.id })
                });
              });
              return Promise.all(promises);
            })
            .then(function(responses) {
              btn.disabled = false;
              btn.removeAttribute('aria-busy');
              statusEl.textContent = 'Restart initiated for all agents.';
              statusEl.className = 'metric-label status-valid';
              setTimeout(loadFleet, 3000);
            })
            .catch(function(err) {
              btn.disabled = false;
              btn.removeAttribute('aria-busy');
              statusEl.textContent = 'Restart failed: ' + err.message;
              statusEl.className = 'metric-label status-error';
            });
        }

        function backupAll() {
          if (!confirm('Create backups for all agents?')) return;
          var btn = document.getElementById('backup-all-btn');
          var statusEl = document.getElementById('bulk-status');
          btn.disabled = true;
          btn.setAttribute('aria-busy', 'true');
          statusEl.textContent = 'Creating backups...';
          statusEl.className = 'metric-label';

          fetch('/api/v1/fleet')
            .then(function(r) { return r.json(); })
            .then(function(res) {
              if (!res.ok) throw new Error(res.error || 'Failed to fetch fleet');
              var agents = res.data.agents || [];
              var promises = agents.map(function(entry) {
                return fetch('/api/v1/backups', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ agentId: entry.agent.id })
                });
              });
              return Promise.all(promises);
            })
            .then(function(responses) {
              btn.disabled = false;
              btn.removeAttribute('aria-busy');
              statusEl.textContent = 'Backups created for all agents.';
              statusEl.className = 'metric-label status-valid';
            })
            .catch(function(err) {
              btn.disabled = false;
              btn.removeAttribute('aria-busy');
              statusEl.textContent = 'Backup failed: ' + err.message;
              statusEl.className = 'metric-label status-error';
            });
        }

        // ── Helpers ──

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
        .bulk-actions {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .bulk-actions button {
          font-size: 0.9rem;
          padding: 0.4rem 1rem;
        }
        .agent-link {
          font-size: 0.85rem;
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
