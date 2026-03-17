/**
 * Init wizard page — multi-step web form for agent initialization.
 *
 * 5 steps: basics → template → integrations → model routing → review + generate.
 * Uses htmx-style fetch calls for step transitions, dynamic integration fields,
 * and async credential validation. Client-side JS manages wizard state.
 */

import type { HtmlEscapedString } from "hono/utils/html";

import { Layout } from "../components/layout.js";

export function renderInitWizardPage(): HtmlEscapedString {
  return (
    <Layout title="Setup Wizard">
      <hgroup>
        <h1>Setup Wizard</h1>
        <p>Configure your OpenClaw agent — step by step</p>
      </hgroup>

      {/* Step indicator */}
      <nav class="wizard-steps" aria-label="Wizard progress">
        <ol>
          <li class="wizard-step active" id="step-ind-1"><span class="step-num">1</span> Basics</li>
          <li class="wizard-step" id="step-ind-2"><span class="step-num">2</span> Template</li>
          <li class="wizard-step" id="step-ind-3"><span class="step-num">3</span> Integrations</li>
          <li class="wizard-step" id="step-ind-4"><span class="step-num">4</span> Model Routing</li>
          <li class="wizard-step" id="step-ind-5"><span class="step-num">5</span> Review</li>
        </ol>
      </nav>

      {/* Step 1: Basics */}
      <div id="step-1" class="wizard-panel">
        <article>
          <header>
            <h3>Step 1: Basics</h3>
            <p>Name your agent and set scheduling preferences</p>
          </header>
          <label for="agent-name">
            Agent name
            <input type="text" id="agent-name" value="openclaw" required />
          </label>
          <label for="timezone">
            Timezone
            <input type="text" id="timezone" required />
          </label>
          <div class="form-row">
            <label for="waking-start">
              Waking hours start
              <input type="text" id="waking-start" value="06:00" placeholder="HH:MM" />
            </label>
            <label for="waking-end">
              Waking hours end
              <input type="text" id="waking-end" value="23:00" placeholder="HH:MM" />
            </label>
          </div>
          <footer class="wizard-nav">
            <span></span>
            <button onclick="goStep(2)">Next</button>
          </footer>
        </article>
      </div>

      {/* Step 2: Template Selection */}
      <div id="step-2" class="wizard-panel" style="display:none;">
        <article>
          <header>
            <h3>Step 2: Template Selection</h3>
            <p>Choose a template based on what you're replacing</p>
          </header>
          <div id="template-cards">
            <p aria-busy="true">Loading templates...</p>
          </div>
          <footer class="wizard-nav">
            <button class="secondary" onclick="goStep(1)">Back</button>
            <button onclick="goStep(3)" id="btn-step2-next" disabled>Next</button>
          </footer>
        </article>
      </div>

      {/* Step 3: Integrations */}
      <div id="step-3" class="wizard-panel" style="display:none;">
        <article>
          <header>
            <h3>Step 3: Integrations</h3>
            <p>Configure service credentials — validation runs on blur</p>
          </header>
          <div id="integration-fields">
            <p class="metric-label">Select a template first</p>
          </div>
          <footer class="wizard-nav">
            <button class="secondary" onclick="goStep(2)">Back</button>
            <button onclick="goStep(4)">Next</button>
          </footer>
        </article>
      </div>

      {/* Step 4: Model Routing */}
      <div id="step-4" class="wizard-panel" style="display:none;">
        <article>
          <header>
            <h3>Step 4: Model Routing</h3>
            <p>Local models by default — opt in to cloud APIs per task category</p>
          </header>
          <fieldset>
            <label>
              <input type="checkbox" id="local-only" checked onchange="toggleCloudSection()" />
              Run local-only (no cloud APIs)
            </label>
          </fieldset>
          <div id="cloud-section" style="display:none;">
            <h4>Cloud API Providers</h4>
            <fieldset id="cloud-providers">
              <label>
                <input type="checkbox" class="cloud-provider-toggle" data-provider="anthropic" data-env="ANTHROPIC_API_KEY" onchange="toggleProviderField(this)" />
                Anthropic (Claude)
              </label>
              <div class="provider-field" id="field-anthropic" style="display:none;">
                <input type="password" placeholder="Anthropic API key" data-env="ANTHROPIC_API_KEY" class="cloud-key-input" />
              </div>
              <label>
                <input type="checkbox" class="cloud-provider-toggle" data-provider="openai" data-env="OPENAI_API_KEY" onchange="toggleProviderField(this)" />
                OpenAI (GPT)
              </label>
              <div class="provider-field" id="field-openai" style="display:none;">
                <input type="password" placeholder="OpenAI API key" data-env="OPENAI_API_KEY" class="cloud-key-input" />
              </div>
            </fieldset>
            <h4>Per-Category Cloud Opt-In</h4>
            <fieldset id="category-policies">
              <label><input type="checkbox" class="category-toggle" data-category="email" /> Email triage</label>
              <label><input type="checkbox" class="category-toggle" data-category="calendar" /> Calendar management</label>
              <label><input type="checkbox" class="category-toggle" data-category="research" /> Research</label>
              <label><input type="checkbox" class="category-toggle" data-category="writing" /> Creative writing</label>
              <label><input type="checkbox" class="category-toggle" data-category="coding" /> Code generation</label>
            </fieldset>
          </div>
          <footer class="wizard-nav">
            <button class="secondary" onclick="goStep(3)">Back</button>
            <button onclick="goStep(5)">Next</button>
          </footer>
        </article>
      </div>

      {/* Step 5: Review + Generate */}
      <div id="step-5" class="wizard-panel" style="display:none;">
        <article>
          <header>
            <h3>Step 5: Review &amp; Generate</h3>
            <p>Review your configuration before generating</p>
          </header>
          <div id="review-summary">
            <p class="metric-label">Loading review...</p>
          </div>
          <footer class="wizard-nav">
            <button class="secondary" onclick="goStep(4)">Back</button>
            <button id="btn-generate" onclick="generateBundle()">Generate Configuration</button>
          </footer>
        </article>
      </div>

      {/* Generation result */}
      <div id="generate-result" class="wizard-panel" style="display:none;">
        <article>
          <header>
            <h3>Configuration Generated</h3>
          </header>
          <div id="result-body"></div>
          <footer class="wizard-nav">
            <a href="/" role="button">Go to Dashboard</a>
          </footer>
        </article>
      </div>

      <script>{`
        // ── Wizard state ──
        var wizardState = {
          basics: null,
          selectedTemplateId: null,
          selectedTemplate: null,
          templates: [],
          integrations: [],
          modelRouting: null
        };

        var INTEGRATION_DEFS = [
          { category: 'messaging', label: 'Messaging (Telegram)', envVar: 'TELEGRAM_BOT_TOKEN', promptLabel: 'Telegram bot token' },
          { category: 'email', label: 'Email (IMAP)', envVar: 'EMAIL_PASSWORD', promptLabel: 'Email app password' },
          { category: 'calendar', label: 'Calendar (CalDAV)', envVar: 'CALDAV_PASSWORD', promptLabel: 'CalDAV password' },
          { category: 'tasks', label: 'Tasks (Todoist)', envVar: 'TODOIST_API_KEY', promptLabel: 'Todoist API key' },
          { category: 'code', label: 'Code (GitHub)', envVar: 'GITHUB_TOKEN', promptLabel: 'GitHub personal access token' },
          { category: 'research', label: 'Research (Tavily)', envVar: 'TAVILY_API_KEY', promptLabel: 'Tavily API key' }
        ];

        // ── Init ──
        document.addEventListener('DOMContentLoaded', function() {
          // Set timezone default from browser
          var tzInput = document.getElementById('timezone');
          try { tzInput.value = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch(e) {}

          loadTemplates();
        });

        // ── Step navigation ──
        function goStep(step) {
          // Validate current step before advancing
          if (step > 1 && !collectBasics()) return;
          if (step > 2 && !wizardState.selectedTemplateId) {
            alert('Please select a template.');
            return;
          }
          if (step === 3) renderIntegrationFields();
          if (step === 5) renderReview();

          // Collect integrations when leaving step 3
          if (step > 3) collectIntegrations();
          // Collect model routing when leaving step 4
          if (step > 4) collectModelRouting();

          // Hide all panels, show target
          for (var i = 1; i <= 5; i++) {
            var panel = document.getElementById('step-' + i);
            if (panel) panel.style.display = 'none';
          }
          document.getElementById('generate-result').style.display = 'none';
          var target = document.getElementById('step-' + step);
          if (target) target.style.display = 'block';

          // Update step indicators
          for (var i = 1; i <= 5; i++) {
            var ind = document.getElementById('step-ind-' + i);
            if (ind) {
              ind.classList.remove('active', 'completed');
              if (i < step) ind.classList.add('completed');
              if (i === step) ind.classList.add('active');
            }
          }
        }

        // ── Step 1: Collect basics ──
        function collectBasics() {
          var name = document.getElementById('agent-name').value.trim();
          var tz = document.getElementById('timezone').value.trim();
          var start = document.getElementById('waking-start').value.trim();
          var end = document.getElementById('waking-end').value.trim();

          if (!name) { alert('Agent name is required.'); return false; }
          if (!tz) { alert('Timezone is required.'); return false; }

          var timeRe = /^([01]\\d|2[0-3]):[0-5]\\d$/;
          if (!timeRe.test(start)) { alert('Waking start must be HH:MM format.'); return false; }
          if (!timeRe.test(end)) { alert('Waking end must be HH:MM format.'); return false; }

          wizardState.basics = {
            agentName: name,
            timezone: tz,
            wakingHoursStart: start,
            wakingHoursEnd: end
          };
          return true;
        }

        // ── Step 2: Templates ──
        function loadTemplates() {
          fetch('/api/v1/templates')
            .then(function(r) { return r.json(); })
            .then(function(res) {
              if (!res.ok) {
                document.getElementById('template-cards').innerHTML =
                  '<p class="status-error">Error: ' + escapeHtml(res.error) + '</p>';
                return;
              }
              wizardState.templates = res.data;
              renderTemplateCards(res.data);
            })
            .catch(function(err) {
              document.getElementById('template-cards').innerHTML =
                '<p class="status-error">Failed to load templates</p>';
            });
        }

        function renderTemplateCards(templates) {
          var el = document.getElementById('template-cards');
          if (!templates || templates.length === 0) {
            el.innerHTML = '<p>No templates available.</p>';
            return;
          }
          var html = '<div class="template-grid">';
          templates.forEach(function(t) {
            html +=
              '<article class="template-card" id="tpl-' + escapeAttr(t.id) + '" onclick="selectTemplate(\\'' + escapeAttr(t.id) + '\\')">' +
              '<header><strong>' + escapeHtml(t.name) + '</strong></header>' +
              '<p>' + escapeHtml(t.useCase) + '</p>' +
              '<p class="metric-label">' + escapeHtml(t.description) + '</p>' +
              '<div class="template-meta">' +
              '<span class="status-badge status-' + postureBadge(t.security.posture) + '">' + escapeHtml(t.security.posture) + '</span> ' +
              '<span class="metric-label">Autonomy: ' + escapeHtml(t.autonomy['default']) + '</span>' +
              '</div>' +
              '</article>';
          });
          html += '</div>';
          el.innerHTML = html;
        }

        function postureBadge(posture) {
          switch(posture) {
            case 'standard': return 'running';
            case 'hardened': return 'degraded';
            case 'paranoid': return 'stopped';
            default: return 'unknown';
          }
        }

        function selectTemplate(id) {
          // Deselect previous
          var prev = document.querySelector('.template-card.selected');
          if (prev) prev.classList.remove('selected');

          // Select new
          var card = document.getElementById('tpl-' + id);
          if (card) card.classList.add('selected');

          wizardState.selectedTemplateId = id;
          wizardState.selectedTemplate = wizardState.templates.find(function(t) { return t.id === id; });

          document.getElementById('btn-step2-next').disabled = false;
        }

        // ── Step 3: Integration fields ──
        function renderIntegrationFields() {
          var tpl = wizardState.selectedTemplate;
          if (!tpl) return;

          var el = document.getElementById('integration-fields');
          var allNeeded = (tpl.integrationsRequired || []).concat(tpl.integrationsRecommended || []);
          var seen = {};
          var html = '';

          if (allNeeded.length === 0) {
            el.innerHTML = '<p class="metric-label">This template has no integration requirements.</p>';
            return;
          }

          allNeeded.forEach(function(category) {
            if (seen[category]) return;
            seen[category] = true;

            var def = INTEGRATION_DEFS.find(function(d) { return d.category === category; });
            if (!def) return;

            var isRequired = (tpl.integrationsRequired || []).indexOf(category) >= 0;
            var badge = isRequired
              ? '<span class="status-badge status-degraded">required</span>'
              : '<span class="status-badge status-unknown">recommended</span>';

            // Check if we already have a value from previous visit
            var existingVal = '';
            var existing = wizardState.integrations.find(function(i) { return i.category === category; });
            if (existing) existingVal = existing.credential || '';

            html +=
              '<div class="integration-row" data-category="' + escapeAttr(category) + '" data-env="' + escapeAttr(def.envVar) + '" data-provider="' + escapeAttr(def.label) + '">' +
              '<label>' + escapeHtml(def.label) + ' ' + badge +
              '<div class="credential-row">' +
              '<input type="password" class="cred-input" placeholder="' + escapeAttr(def.promptLabel) + '" value="' + escapeAttr(existingVal) + '" data-env="' + escapeAttr(def.envVar) + '" onblur="validateCredential(this)" />' +
              '<span class="cred-status" id="cred-status-' + escapeAttr(def.envVar) + '"></span>' +
              '</div>' +
              '</label>' +
              '</div>';
          });

          el.innerHTML = html;
        }

        function validateCredential(input) {
          var envVar = input.getAttribute('data-env');
          var value = input.value.trim();
          var statusEl = document.getElementById('cred-status-' + envVar);

          if (!value) {
            statusEl.innerHTML = '';
            return;
          }

          statusEl.innerHTML = '<span aria-busy="true" class="cred-spinner"></span>';

          fetch('/api/v1/wizard/validate-credential', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ envVar: envVar, value: value })
          })
            .then(function(r) { return r.json(); })
            .then(function(res) {
              if (res.ok && res.data.valid) {
                statusEl.innerHTML = '<span class="status-valid">\\u2713 Valid</span>';
              } else {
                statusEl.innerHTML = '<span class="status-expired">\\u2717 ' + escapeHtml(res.data && res.data.status ? res.data.status : 'Invalid') + '</span>';
              }
            })
            .catch(function() {
              statusEl.innerHTML = '<span class="status-missing">\\u2014 Could not validate</span>';
            });
        }

        function collectIntegrations() {
          var rows = document.querySelectorAll('.integration-row');
          var integrations = [];
          rows.forEach(function(row) {
            var input = row.querySelector('.cred-input');
            integrations.push({
              provider: row.getAttribute('data-provider'),
              category: row.getAttribute('data-category'),
              envVar: row.getAttribute('data-env'),
              credential: input ? input.value.trim() : '',
              validated: false
            });
          });
          wizardState.integrations = integrations;
        }

        // ── Step 4: Model routing ──
        function toggleCloudSection() {
          var localOnly = document.getElementById('local-only').checked;
          document.getElementById('cloud-section').style.display = localOnly ? 'none' : 'block';
        }

        function toggleProviderField(checkbox) {
          var provider = checkbox.getAttribute('data-provider');
          var field = document.getElementById('field-' + provider);
          if (field) field.style.display = checkbox.checked ? 'block' : 'none';
        }

        function collectModelRouting() {
          var localOnly = document.getElementById('local-only').checked;

          if (localOnly) {
            wizardState.modelRouting = {
              localOnly: true,
              cloudProviders: [],
              categories: [
                { category: 'email', cloudAllowed: false },
                { category: 'calendar', cloudAllowed: false },
                { category: 'research', cloudAllowed: false },
                { category: 'writing', cloudAllowed: false },
                { category: 'coding', cloudAllowed: false }
              ]
            };
            return;
          }

          var cloudProviders = [];
          document.querySelectorAll('.cloud-provider-toggle').forEach(function(cb) {
            if (cb.checked) {
              var provider = cb.getAttribute('data-provider');
              var envVar = cb.getAttribute('data-env');
              var field = document.getElementById('field-' + provider);
              var input = field ? field.querySelector('.cloud-key-input') : null;
              cloudProviders.push({
                provider: provider,
                envVar: envVar,
                credential: input ? input.value.trim() : '',
                validated: false
              });
            }
          });

          var categories = [];
          document.querySelectorAll('.category-toggle').forEach(function(cb) {
            categories.push({
              category: cb.getAttribute('data-category'),
              cloudAllowed: cb.checked
            });
          });

          wizardState.modelRouting = {
            localOnly: false,
            cloudProviders: cloudProviders,
            categories: categories
          };
        }

        // ── Step 5: Review ──
        function renderReview() {
          var el = document.getElementById('review-summary');
          var b = wizardState.basics;
          var tpl = wizardState.selectedTemplate;

          if (!b || !tpl) {
            el.innerHTML = '<p class="status-error">Missing configuration data.</p>';
            return;
          }

          collectIntegrations();
          collectModelRouting();

          var html =
            '<h4>Agent</h4>' +
            '<table role="grid"><tbody>' +
            '<tr><td><strong>Name</strong></td><td>' + escapeHtml(b.agentName) + '</td></tr>' +
            '<tr><td><strong>Timezone</strong></td><td>' + escapeHtml(b.timezone) + '</td></tr>' +
            '<tr><td><strong>Waking hours</strong></td><td>' + escapeHtml(b.wakingHoursStart) + ' &ndash; ' + escapeHtml(b.wakingHoursEnd) + '</td></tr>' +
            '</tbody></table>' +
            '<h4>Template</h4>' +
            '<table role="grid"><tbody>' +
            '<tr><td><strong>Template</strong></td><td>' + escapeHtml(tpl.name) + '</td></tr>' +
            '<tr><td><strong>Security</strong></td><td>' + escapeHtml(tpl.security.posture) + '</td></tr>' +
            '<tr><td><strong>Autonomy</strong></td><td>' + escapeHtml(tpl.autonomy['default']) + '</td></tr>' +
            '</tbody></table>';

          // Integrations
          var activeIntegrations = wizardState.integrations.filter(function(i) { return i.credential; });
          if (activeIntegrations.length > 0) {
            html += '<h4>Integrations</h4><table role="grid"><tbody>';
            activeIntegrations.forEach(function(i) {
              html += '<tr><td><strong>' + escapeHtml(i.provider) + '</strong></td><td class="status-valid">Configured</td></tr>';
            });
            html += '</tbody></table>';
          } else {
            html += '<h4>Integrations</h4><p class="metric-label">None configured</p>';
          }

          // Model routing
          var mr = wizardState.modelRouting;
          if (mr) {
            html += '<h4>Model Routing</h4>';
            if (mr.localOnly) {
              html += '<p><span class="status-badge status-running">LOCAL ONLY</span> All tasks use local Ollama models</p>';
            } else {
              var providers = mr.cloudProviders.map(function(p) { return p.provider; }).join(', ') || 'none';
              var cloudCats = mr.categories.filter(function(c) { return c.cloudAllowed; }).map(function(c) { return c.category; });
              html += '<p>Cloud providers: <strong>' + escapeHtml(providers) + '</strong></p>';
              html +=
                cloudCats.length > 0
                  ? '<p>Cloud-allowed categories: <strong>' + escapeHtml(cloudCats.join(', ')) + '</strong></p>'
                  : '<p>Cloud-allowed categories: <em>none</em></p>';
            }
          }

          el.innerHTML = html;
        }

        // ── Generate ──
        function generateBundle() {
          var btn = document.getElementById('btn-generate');
          btn.disabled = true;
          btn.setAttribute('aria-busy', 'true');
          btn.textContent = 'Generating...';

          var payload = {
            basics: wizardState.basics,
            templateId: wizardState.selectedTemplateId,
            integrations: wizardState.integrations,
            modelRouting: wizardState.modelRouting
          };

          fetch('/api/v1/wizard/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
            .then(function(r) { return r.json(); })
            .then(function(res) {
              btn.disabled = false;
              btn.removeAttribute('aria-busy');
              btn.textContent = 'Generate Configuration';

              if (!res.ok) {
                document.getElementById('review-summary').innerHTML +=
                  '<p class="status-error">Error: ' + escapeHtml(res.error) + '</p>';
                return;
              }

              showResult(res.data);
            })
            .catch(function(err) {
              btn.disabled = false;
              btn.removeAttribute('aria-busy');
              btn.textContent = 'Generate Configuration';
              document.getElementById('review-summary').innerHTML +=
                '<p class="status-error">Failed: ' + escapeHtml(err.message) + '</p>';
            });
        }

        function showResult(data) {
          // Hide all step panels
          for (var i = 1; i <= 5; i++) {
            document.getElementById('step-' + i).style.display = 'none';
          }

          // Update indicators
          for (var i = 1; i <= 5; i++) {
            var ind = document.getElementById('step-ind-' + i);
            if (ind) ind.classList.add('completed');
            if (ind) ind.classList.remove('active');
          }

          var el = document.getElementById('result-body');
          var html = '';

          if (data.validationPassed) {
            html += '<p><span class="status-badge status-running">VALIDATION PASSED</span></p>';
          } else {
            html += '<p><span class="status-badge status-degraded">VALIDATION FAILED</span></p>';
            if (data.validationErrors && data.validationErrors.length > 0) {
              html += '<ul>';
              data.validationErrors.forEach(function(e) {
                html += '<li class="status-error">' + escapeHtml(e) + '</li>';
              });
              html += '</ul>';
            }
          }

          if (data.filesWritten && data.filesWritten.length > 0) {
            html += '<h4>Files Written</h4><ul>';
            data.filesWritten.forEach(function(f) {
              html += '<li>' + escapeHtml(f) + '</li>';
            });
            html += '</ul>';
          }

          if (data.errors && data.errors.length > 0) {
            html += '<h4>Errors</h4><ul>';
            data.errors.forEach(function(e) {
              html += '<li class="status-error">' + escapeHtml(e) + '</li>';
            });
            html += '</ul>';
          }

          el.innerHTML = html;
          document.getElementById('generate-result').style.display = 'block';
        }

        // ── Helpers ──
        function escapeHtml(str) {
          if (!str) return '';
          var div = document.createElement('div');
          div.textContent = str;
          return div.innerHTML;
        }

        function escapeAttr(str) {
          if (!str) return '';
          return str.replace(/[&"'<>]/g, function(c) {
            return { '&': '&amp;', '"': '&quot;', "'": '&#39;', '<': '&lt;', '>': '&gt;' }[c];
          });
        }
      `}</script>

      <style>{`
        .wizard-steps ol {
          display: flex;
          list-style: none;
          padding: 0;
          margin: 0 0 1.5rem 0;
          gap: 0;
        }
        .wizard-step {
          flex: 1;
          text-align: center;
          padding: 0.5rem 0.25rem;
          font-size: 0.85rem;
          color: var(--pico-muted-color);
          border-bottom: 2px solid var(--pico-muted-border-color);
        }
        .wizard-step.active {
          color: var(--pico-primary);
          border-bottom-color: var(--pico-primary);
          font-weight: 600;
        }
        .wizard-step.completed {
          color: #52b788;
          border-bottom-color: #52b788;
        }
        .step-num {
          display: inline-block;
          width: 1.4rem;
          height: 1.4rem;
          line-height: 1.4rem;
          border-radius: 50%;
          background: var(--pico-muted-border-color);
          color: var(--pico-color);
          font-size: 0.75rem;
          font-weight: 700;
          text-align: center;
          margin-right: 0.3rem;
        }
        .wizard-step.active .step-num {
          background: var(--pico-primary);
          color: #fff;
        }
        .wizard-step.completed .step-num {
          background: #52b788;
          color: #fff;
        }
        .wizard-nav {
          display: flex;
          justify-content: space-between;
          padding: 0;
          margin: 0;
          border: none;
          background: none;
        }
        .wizard-nav button, .wizard-nav a[role="button"] {
          min-width: 6rem;
        }
        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }
        .template-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 1rem;
        }
        .template-card {
          cursor: pointer;
          border: 2px solid transparent;
          transition: border-color 0.15s;
          margin-bottom: 0;
        }
        .template-card:hover {
          border-color: var(--pico-muted-border-color);
        }
        .template-card.selected {
          border-color: var(--pico-primary);
        }
        .template-meta {
          display: flex;
          gap: 0.75rem;
          align-items: center;
          margin-top: 0.5rem;
        }
        .credential-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .credential-row input {
          flex: 1;
          margin-bottom: 0;
        }
        .cred-status {
          white-space: nowrap;
          font-size: 0.85rem;
          min-width: 5rem;
        }
        .cred-spinner {
          display: inline-block;
          width: 1rem;
          height: 1rem;
        }
        .integration-row {
          margin-bottom: 0.5rem;
        }
        .provider-field {
          margin: 0.25rem 0 0.5rem 1.5rem;
        }
        #cloud-providers label {
          margin-bottom: 0.25rem;
        }
        #category-policies label {
          margin-bottom: 0.25rem;
        }
      `}</style>
    </Layout>
  ) as unknown as HtmlEscapedString;
}
