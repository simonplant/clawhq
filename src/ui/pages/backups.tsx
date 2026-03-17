/**
 * Backups page.
 *
 * Table of backup snapshots with date, size, type (full/secrets-only).
 * Create button triggers POST /api/v1/backups. Restore button with
 * confirmation triggers POST /api/v1/backups/:id/restore.
 * Fetches from GET /api/v1/backups.
 */

import type { HtmlEscapedString } from "hono/utils/html";

import { Layout } from "../components/layout.js";

export function renderBackupsPage(): HtmlEscapedString {
  return (
    <Layout title="Backups">
      <hgroup>
        <h1>Backups</h1>
        <p>Encrypted snapshots — create, list, and restore agent state</p>
      </hgroup>

      <div class="backup-actions">
        <button id="create-full-btn" onclick="createBackup(false)">
          Create Full Backup
        </button>
        <button id="create-secrets-btn" class="secondary" onclick="createBackup(true)">
          Secrets Only
        </button>
      </div>
      <p id="backup-status" class="metric-label"></p>

      <div id="backup-table">
        <p aria-busy="true">Loading backups...</p>
      </div>

      <script>{`
        document.addEventListener('DOMContentLoaded', function() {
          loadBackups();
        });

        function loadBackups() {
          var el = document.getElementById('backup-table');
          el.innerHTML = '<p aria-busy="true">Loading backups...</p>';

          fetch('/api/v1/backups')
            .then(function(r) { return r.json(); })
            .then(function(res) {
              if (!res.ok) {
                el.innerHTML = '<p class="status-error">Error: ' + escapeHtml(res.error || 'Unknown error') + '</p>';
                return;
              }
              renderBackupTable(el, res.data);
            })
            .catch(function(err) {
              el.innerHTML = '<p class="status-error">Failed to load backups: ' + escapeHtml(err.message) + '</p>';
            });
        }

        function renderBackupTable(el, backups) {
          if (!backups || backups.length === 0) {
            el.innerHTML =
              '<article class="empty-state">' +
              '<p>No backups found. Create one with the button above or <code>clawhq backup create</code>.</p>' +
              '</article>';
            return;
          }

          var html =
            '<figure>' +
            '<table role="grid">' +
            '<thead><tr>' +
            '<th>Date</th>' +
            '<th>Backup ID</th>' +
            '<th>Type</th>' +
            '<th>Size</th>' +
            '<th></th>' +
            '</tr></thead>' +
            '<tbody>';

          backups.forEach(function(b) {
            var date = new Date(b.timestamp).toLocaleString();
            var type = b.secretsOnly ? 'Secrets only' : 'Full';
            var typeClass = b.secretsOnly ? 'backup-type-secrets' : 'backup-type-full';
            var size = formatBytes(b.totalSize);

            html +=
              '<tr>' +
              '<td class="metric-label">' + escapeHtml(date) + '</td>' +
              '<td><code>' + escapeHtml(b.backupId) + '</code></td>' +
              '<td><span class="status-badge ' + typeClass + '">' + escapeHtml(type) + '</span></td>' +
              '<td class="metric-label">' + escapeHtml(size) + '</td>' +
              '<td><button class="secondary restore-btn" onclick="restoreBackup(\\'' + escapeAttr(b.backupId) + '\\')">Restore</button></td>' +
              '</tr>';
          });

          html += '</tbody></table></figure>';
          el.innerHTML = html;
        }

        function createBackup(secretsOnly) {
          var btnId = secretsOnly ? 'create-secrets-btn' : 'create-full-btn';
          var btn = document.getElementById(btnId);
          var statusEl = document.getElementById('backup-status');
          btn.disabled = true;
          btn.setAttribute('aria-busy', 'true');
          statusEl.textContent = secretsOnly ? 'Creating secrets backup...' : 'Creating full backup...';
          statusEl.className = 'metric-label';

          fetch('/api/v1/backups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secretsOnly: secretsOnly })
          })
            .then(function(r) { return r.json(); })
            .then(function(res) {
              btn.disabled = false;
              btn.removeAttribute('aria-busy');
              if (!res.ok) {
                statusEl.textContent = 'Backup failed: ' + (res.error || 'Unknown error');
                statusEl.className = 'metric-label status-error';
                return;
              }
              statusEl.textContent = 'Backup created: ' + res.data.backupId;
              statusEl.className = 'metric-label status-valid';
              loadBackups();
            })
            .catch(function(err) {
              btn.disabled = false;
              btn.removeAttribute('aria-busy');
              statusEl.textContent = 'Backup failed: ' + err.message;
              statusEl.className = 'metric-label status-error';
            });
        }

        function restoreBackup(backupId) {
          if (!confirm('Restore backup ' + backupId + '? This will overwrite current agent state.')) return;
          var statusEl = document.getElementById('backup-status');
          statusEl.textContent = 'Restoring backup ' + backupId + '...';
          statusEl.className = 'metric-label';

          // Disable all restore buttons during restore
          var btns = document.querySelectorAll('.restore-btn');
          btns.forEach(function(b) { b.disabled = true; });

          fetch('/api/v1/backups/' + encodeURIComponent(backupId) + '/restore', {
            method: 'POST'
          })
            .then(function(r) { return r.json(); })
            .then(function(res) {
              btns.forEach(function(b) { b.disabled = false; });
              if (!res.ok) {
                statusEl.textContent = 'Restore failed: ' + (res.error || 'Unknown error');
                statusEl.className = 'metric-label status-error';
                return;
              }
              var r = res.data;
              var msg = 'Restored ' + r.filesRestored + ' files. ' +
                'Integrity: ' + (r.integrityPassed ? 'passed' : 'FAILED') + '. ' +
                'Doctor: ' + r.doctorChecks.pass + ' pass, ' +
                r.doctorChecks.warn + ' warn, ' +
                r.doctorChecks.fail + ' fail.';
              statusEl.textContent = msg;
              statusEl.className = 'metric-label ' + (r.integrityPassed ? 'status-valid' : 'status-error');
            })
            .catch(function(err) {
              btns.forEach(function(b) { b.disabled = false; });
              statusEl.textContent = 'Restore failed: ' + err.message;
              statusEl.className = 'metric-label status-error';
            });
        }

        function formatBytes(bytes) {
          if (bytes === 0) return '0 B';
          var units = ['B', 'KB', 'MB', 'GB'];
          var i = Math.floor(Math.log(bytes) / Math.log(1024));
          if (i >= units.length) i = units.length - 1;
          return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
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
        .backup-actions {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }
        .backup-actions button {
          font-size: 0.9rem;
          padding: 0.4rem 1rem;
        }
        .restore-btn {
          font-size: 0.8rem;
          padding: 0.25rem 0.75rem;
        }
        .backup-type-full {
          background: #2d6a4f;
          color: #b7e4c7;
        }
        .backup-type-secrets {
          background: #495057;
          color: #adb5bd;
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
