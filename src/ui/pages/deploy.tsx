/**
 * Deploy controls page.
 *
 * Three action buttons (Up, Down, Restart) with confirmation dialogs.
 * Each triggers the corresponding SSE endpoint and streams step-by-step
 * progress into a status pane with spinner → pass/fail icons.
 */

import type { HtmlEscapedString } from "hono/utils/html";

import { Layout } from "../components/layout.js";

export function renderDeployPage(): HtmlEscapedString {
  return (
    <Layout title="Deploy">
      <hgroup>
        <h1>Deploy Controls</h1>
        <p>Manage agent container lifecycle — up, down, restart</p>
      </hgroup>

      <div id="deploy-controls" style="margin-bottom: 1.5rem; display: flex; gap: 0.5rem;">
        <button id="btn-up" onclick="deployAction('up')">
          Up
        </button>
        <button id="btn-restart" class="secondary" onclick="deployAction('restart')">
          Restart
        </button>
        <button id="btn-down" class="contrast" onclick="deployAction('down')">
          Down
        </button>
      </div>

      <div id="deploy-status"></div>

      <script>{`
        var activeSource = null;

        var confirmMessages = {
          up: 'Deploy the agent? This will run pre-flight checks, start containers, apply firewall, and verify health.',
          down: 'Shut down the agent? Containers will be stopped gracefully.',
          restart: 'Restart the agent? This will stop and restart containers, reapply firewall, and re-verify health.'
        };

        function deployAction(action) {
          if (!confirm(confirmMessages[action])) return;

          // Abort any active stream
          if (activeSource) {
            activeSource.close();
            activeSource = null;
          }

          setButtonsDisabled(true);

          var statusEl = document.getElementById('deploy-status');
          statusEl.innerHTML =
            '<h3>' + actionLabel(action) + '</h3>' +
            '<table role="grid" id="steps-table">' +
            '<thead><tr><th style="width:3rem">Status</th><th>Step</th></tr></thead>' +
            '<tbody id="steps-body"></tbody>' +
            '</table>';

          // Use fetch with ReadableStream to consume SSE from POST endpoint
          fetch('/api/v1/deploy/' + action, { method: 'POST' })
            .then(function(response) {
              if (!response.ok) {
                throw new Error('HTTP ' + response.status);
              }
              var reader = response.body.getReader();
              var decoder = new TextDecoder();
              var buffer = '';

              function pump() {
                return reader.read().then(function(result) {
                  if (result.done) {
                    setButtonsDisabled(false);
                    return;
                  }
                  buffer += decoder.decode(result.value, { stream: true });
                  var lines = buffer.split('\\n');
                  buffer = lines.pop() || '';
                  processSSELines(lines);
                  return pump();
                });
              }
              return pump();
            })
            .catch(function(err) {
              statusEl.innerHTML += '<p class="status-error">Error: ' + escapeHtml(err.message) + '</p>';
              setButtonsDisabled(false);
            });
        }

        // Track known steps so we can update their status in-place
        var stepRows = {};

        function processSSELines(lines) {
          var eventType = '';
          var dataStr = '';
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.indexOf('event:') === 0) {
              eventType = line.substring(6).trim();
            } else if (line.indexOf('data:') === 0) {
              dataStr = line.substring(5).trim();
            } else if (line === '') {
              if (dataStr) {
                handleSSEEvent(eventType, dataStr);
              }
              eventType = '';
              dataStr = '';
            }
          }
        }

        function handleSSEEvent(eventType, dataStr) {
          try {
            var data = JSON.parse(dataStr);
          } catch(e) {
            return;
          }

          if (eventType === 'step') {
            renderStep(data);
          } else if (eventType === 'done') {
            renderDone(data);
            setButtonsDisabled(false);
          } else if (eventType === 'error') {
            var statusEl = document.getElementById('deploy-status');
            statusEl.innerHTML += '<p class="status-error">Error: ' + escapeHtml(data.error || 'Unknown error') + '</p>';
            setButtonsDisabled(false);
          }
        }

        function renderStep(step) {
          var tbody = document.getElementById('steps-body');
          if (!tbody) return;
          var name = step.name;
          var status = step.status;

          if (stepRows[name]) {
            // Update existing row
            var row = stepRows[name];
            row.cells[0].innerHTML = stepIcon(status);
          } else {
            // New row
            var row = tbody.insertRow();
            row.insertCell(0).innerHTML = stepIcon(status);
            row.insertCell(1).textContent = name;
            stepRows[name] = row;
          }
        }

        function renderDone(data) {
          var statusEl = document.getElementById('deploy-status');
          var result = data.data;
          if (!result) return;

          // Update all steps with final results (includes message and duration)
          if (result.steps) {
            for (var i = 0; i < result.steps.length; i++) {
              var s = result.steps[i];
              renderStep(s);
            }
          }

          var cls = result.success ? 'status-running' : 'status-degraded';
          var label = result.success ? 'DEPLOY SUCCEEDED' : 'DEPLOY FAILED';
          statusEl.innerHTML +=
            '<div style="margin-top:1rem;">' +
            '<span class="status-badge ' + cls + '">' + label + '</span>' +
            '</div>';

          // Reset step tracking for next run
          stepRows = {};
        }

        function stepIcon(status) {
          switch(status) {
            case 'running': return '<span class="step-icon step-running" aria-busy="true"></span>';
            case 'done': return '<span class="step-icon step-done">\\u2713</span>';
            case 'failed': return '<span class="step-icon step-failed">\\u2717</span>';
            default: return '<span class="step-icon">' + escapeHtml(status) + '</span>';
          }
        }

        function actionLabel(action) {
          switch(action) {
            case 'up': return 'Deploying...';
            case 'down': return 'Shutting down...';
            case 'restart': return 'Restarting...';
            default: return action;
          }
        }

        function setButtonsDisabled(disabled) {
          document.getElementById('btn-up').disabled = disabled;
          document.getElementById('btn-down').disabled = disabled;
          document.getElementById('btn-restart').disabled = disabled;
        }

        function escapeHtml(str) {
          if (!str) return '';
          var div = document.createElement('div');
          div.textContent = str;
          return div.innerHTML;
        }
      `}</script>

      <style>{`
        .step-icon {
          font-size: 1.1rem;
          font-weight: 700;
        }
        .step-done { color: #52b788; }
        .step-failed { color: #e63946; }
        .step-running {
          display: inline-block;
          width: 1rem;
          height: 1rem;
        }
        #deploy-controls button {
          min-width: 6rem;
        }
      `}</style>
    </Layout>
  ) as unknown as HtmlEscapedString;
}
