/**
 * Skills & Tools management page.
 *
 * Two-tab layout: Skills tab shows installed skills with install/remove/toggle,
 * Tools tab shows workspace tools with health status. Fetches from
 * GET /api/v1/skills and GET /api/v1/tools.
 */

import type { HtmlEscapedString } from "hono/utils/html";

import { Layout } from "../components/layout.js";

export function renderSkillsPage(): HtmlEscapedString {
  return (
    <Layout title="Skills & Tools">
      <hgroup>
        <h1>Skills & Tools</h1>
        <p>Manage agent capabilities — install, remove, and monitor</p>
      </hgroup>

      <div class="tabs">
        <button class="tab-btn active" id="tab-skills-btn" onclick="switchTab('skills')">Skills</button>
        <button class="tab-btn" id="tab-tools-btn" onclick="switchTab('tools')">Tools</button>
      </div>

      <div id="tab-skills" class="tab-panel">
        <article class="install-form-card">
          <div class="install-row">
            <input type="text" id="skill-source" placeholder="Skill source (registry name, URL, or local path)" />
            <button id="install-btn" onclick="installSkill()">Install</button>
          </div>
          <p id="install-status" class="metric-label"></p>
        </article>

        <div id="skills-list">
          <p aria-busy="true">Loading skills...</p>
        </div>
      </div>

      <div id="tab-tools" class="tab-panel" style="display:none;">
        <div id="tools-list">
          <p aria-busy="true">Loading tools...</p>
        </div>
      </div>

      <script>{`
        document.addEventListener('DOMContentLoaded', function() {
          loadSkills();
          loadTools();
        });

        function switchTab(tab) {
          var skillsPanel = document.getElementById('tab-skills');
          var toolsPanel = document.getElementById('tab-tools');
          var skillsBtn = document.getElementById('tab-skills-btn');
          var toolsBtn = document.getElementById('tab-tools-btn');

          if (tab === 'skills') {
            skillsPanel.style.display = 'block';
            toolsPanel.style.display = 'none';
            skillsBtn.classList.add('active');
            toolsBtn.classList.remove('active');
          } else {
            skillsPanel.style.display = 'none';
            toolsPanel.style.display = 'block';
            toolsBtn.classList.add('active');
            skillsBtn.classList.remove('active');
          }
        }

        // ── Skills ──

        function loadSkills() {
          var listEl = document.getElementById('skills-list');
          listEl.innerHTML = '<p aria-busy="true">Loading skills...</p>';

          fetch('/api/v1/skills')
            .then(function(r) { return r.json(); })
            .then(function(res) {
              if (!res.ok) {
                listEl.innerHTML = '<p class="status-error">Error: ' + escapeHtml(res.error || 'Unknown error') + '</p>';
                return;
              }
              renderSkills(listEl, res.data);
            })
            .catch(function(err) {
              listEl.innerHTML = '<p class="status-error">Failed to load skills: ' + escapeHtml(err.message) + '</p>';
            });
        }

        function renderSkills(el, registry) {
          var skills = registry.skills || [];
          if (skills.length === 0) {
            el.innerHTML =
              '<article class="empty-state">' +
              '<p>No skills installed yet. Use the form above to install one.</p>' +
              '</article>';
            return;
          }

          var html = '<div class="card-grid">';
          skills.forEach(function(skill) {
            html += renderSkillCard(skill);
          });
          html += '</div>';
          el.innerHTML = html;
        }

        function renderSkillCard(skill) {
          var statusClass = skill.status === 'active' ? 'skill-active' : 'skill-disabled';
          var statusBadgeClass = skill.status === 'active' ? 'status-running' : 'status-stopped';

          return (
            '<article class="skill-card ' + statusClass + '" id="skill-' + escapeAttr(skill.name) + '">' +
            '<header>' +
            '<div class="card-header-row">' +
            '<strong>' + escapeHtml(skill.name) + '</strong>' +
            '<span class="status-badge ' + statusBadgeClass + '">' + skill.status.toUpperCase() + '</span>' +
            '</div>' +
            '</header>' +
            '<p class="metric-label">Version: ' + escapeHtml(skill.version) + '</p>' +
            '<p class="metric-label">Source: ' + escapeHtml(skill.source) + (skill.sourceUri ? ' — ' + escapeHtml(skill.sourceUri) : '') + '</p>' +
            '<p class="metric-label">Installed: ' + formatTime(skill.installedAt) + '</p>' +
            (skill.lastUsed ? '<p class="metric-label">Last used: ' + formatTime(skill.lastUsed) + '</p>' : '') +
            (skill.requiresContainerDeps ? '<p class="metric-label">Requires container rebuild</p>' : '') +
            '<footer class="card-actions">' +
            '<button class="remove-btn secondary outline" onclick="removeSkill(\\'' + escapeAttr(skill.name) + '\\')">Remove</button>' +
            '</footer>' +
            '</article>'
          );
        }

        function installSkill() {
          var input = document.getElementById('skill-source');
          var statusEl = document.getElementById('install-status');
          var btn = document.getElementById('install-btn');
          var source = input.value.trim();

          if (!source) {
            statusEl.textContent = 'Please enter a skill source.';
            statusEl.className = 'metric-label status-error';
            return;
          }

          btn.disabled = true;
          btn.setAttribute('aria-busy', 'true');
          statusEl.textContent = 'Installing...';
          statusEl.className = 'metric-label';

          fetch('/api/v1/skills', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: source })
          })
            .then(function(r) { return r.json(); })
            .then(function(res) {
              btn.disabled = false;
              btn.removeAttribute('aria-busy');
              if (!res.ok) {
                statusEl.textContent = 'Error: ' + (res.error || 'Install failed');
                statusEl.className = 'metric-label status-error';
                return;
              }
              statusEl.textContent = 'Installed ' + res.data.manifest.name + ' v' + res.data.manifest.version;
              statusEl.className = 'metric-label status-valid';
              input.value = '';
              loadSkills();
            })
            .catch(function(err) {
              btn.disabled = false;
              btn.removeAttribute('aria-busy');
              statusEl.textContent = 'Failed: ' + err.message;
              statusEl.className = 'metric-label status-error';
            });
        }

        function removeSkill(name) {
          if (!confirm('Remove skill "' + name + '"? A rollback snapshot will be kept for 30 days.')) return;

          var card = document.getElementById('skill-' + name);
          var footer = card ? card.querySelector('.card-actions') : null;
          if (footer) footer.innerHTML = '<p aria-busy="true">Removing...</p>';

          fetch('/api/v1/skills/' + encodeURIComponent(name), { method: 'DELETE' })
            .then(function(r) { return r.json(); })
            .then(function(res) {
              if (!res.ok) {
                if (footer) footer.innerHTML = '<p class="status-error">Error: ' + escapeHtml(res.error) + '</p>';
                return;
              }
              loadSkills();
            })
            .catch(function(err) {
              if (footer) footer.innerHTML = '<p class="status-error">' + escapeHtml(err.message) + '</p>';
            });
        }

        // ── Tools ──

        function loadTools() {
          var listEl = document.getElementById('tools-list');
          listEl.innerHTML = '<p aria-busy="true">Loading tools...</p>';

          fetch('/api/v1/tools')
            .then(function(r) { return r.json(); })
            .then(function(res) {
              if (!res.ok) {
                listEl.innerHTML = '<p class="status-error">Error: ' + escapeHtml(res.error || 'Unknown error') + '</p>';
                return;
              }
              renderTools(listEl, res.data);
            })
            .catch(function(err) {
              listEl.innerHTML = '<p class="status-error">Failed to load tools: ' + escapeHtml(err.message) + '</p>';
            });
        }

        function renderTools(el, tools) {
          if (!tools || tools.length === 0) {
            el.innerHTML =
              '<article class="empty-state">' +
              '<p>No workspace tools found. Tools are generated during agent initialization.</p>' +
              '</article>';
            return;
          }

          var html =
            '<figure>' +
            '<table role="grid">' +
            '<thead><tr>' +
            '<th>Tool</th>' +
            '<th>Dependencies</th>' +
            '<th>Status</th>' +
            '</tr></thead>' +
            '<tbody>';

          tools.forEach(function(tool) {
            var statusClass = tool.exists ? 'status-valid' : 'status-missing';
            var statusText = tool.exists ? 'Installed' : 'Missing';
            html +=
              '<tr>' +
              '<td><strong>' + escapeHtml(tool.name) + '</strong></td>' +
              '<td class="metric-label">' + escapeHtml((tool.dependencies || []).join(', ') || 'none') + '</td>' +
              '<td><span class="' + statusClass + '">' + statusText + '</span></td>' +
              '</tr>';
          });

          html += '</tbody></table></figure>';
          el.innerHTML = html;
        }

        // ── Helpers ──

        function formatTime(iso) {
          try {
            var d = new Date(iso);
            return d.toLocaleString();
          } catch(e) {
            return iso || '';
          }
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
        .tabs {
          display: flex;
          gap: 0;
          border-bottom: 2px solid var(--pico-muted-border-color);
          margin-bottom: 1rem;
        }
        .tab-btn {
          padding: 0.5rem 1.25rem;
          border: none;
          border-bottom: 2px solid transparent;
          background: none;
          color: var(--pico-muted-color);
          cursor: pointer;
          font-size: 0.95rem;
          margin-bottom: -2px;
        }
        .tab-btn.active {
          color: var(--pico-primary);
          border-bottom-color: var(--pico-primary);
        }
        .tab-btn:hover {
          color: var(--pico-primary);
        }
        .install-form-card {
          padding: 1rem;
          margin-bottom: 1rem;
        }
        .install-row {
          display: flex;
          gap: 0.5rem;
          align-items: flex-start;
        }
        .install-row input {
          flex: 1;
          margin-bottom: 0;
        }
        .install-row button {
          white-space: nowrap;
        }
        .card-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 1rem;
        }
        .skill-card {
          margin-bottom: 0;
        }
        .skill-active {
          border-left: 3px solid #52b788;
        }
        .skill-disabled {
          border-left: 3px solid #6c757d;
          opacity: 0.7;
        }
        .card-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .card-actions {
          display: flex;
          gap: 0.5rem;
          padding: 0;
          margin: 0;
          border: none;
          background: none;
        }
        .remove-btn {
          font-size: 0.85rem;
          padding: 0.25rem 0.75rem;
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
