/**
 * Live log streaming page.
 *
 * Connects to GET /api/v1/logs via SSE (EventSource) and renders live
 * container log output. Supports category filtering, pause/resume,
 * and auto-scroll that disables on manual scroll-up.
 */

import type { HtmlEscapedString } from "hono/utils/html";

import { Layout } from "../components/layout.js";

export function renderLogsPage(): HtmlEscapedString {
  return (
    <Layout title="Logs">
      <hgroup>
        <h1>Logs</h1>
        <p>Live container log streaming</p>
      </hgroup>

      <div id="logs-controls" style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem;">
        <select id="category-filter" onchange="applyFilter()">
          <option value="">All</option>
          <option value="agent">Agent</option>
          <option value="gateway">Gateway</option>
          <option value="cron">Cron</option>
          <option value="error">Errors</option>
        </select>

        <button id="pause-btn" onclick="togglePause()">
          Pause
        </button>

        <label style="display: flex; align-items: center; gap: 0.25rem; margin: 0; font-size: 0.85rem;">
          <input type="checkbox" id="autoscroll-toggle" checked onchange="toggleAutoScroll()" style="margin: 0;" />
          Auto-scroll
        </label>

        <button class="secondary outline" onclick="clearLogs()" style="margin-left: auto;">
          Clear
        </button>

        <span id="connection-status" class="status-badge status-unknown" style="margin-left: 0.5rem;">
          Connecting...
        </span>
      </div>

      <div
        id="log-pane"
        onscroll="handleScroll()"
        style="
          height: calc(100vh - 220px);
          overflow-y: auto;
          background: #1a1a2e;
          border: 1px solid var(--pico-muted-border-color);
          border-radius: 4px;
          padding: 0.5rem;
          font-family: 'Courier New', monospace;
          font-size: 0.8rem;
          line-height: 1.4;
          white-space: pre-wrap;
          word-break: break-all;
        "
      ></div>

      <script>{`
        var eventSource = null;
        var paused = false;
        var autoScroll = true;
        var userScrolledUp = false;
        var MAX_LINES = 5000;

        function connect() {
          if (eventSource) {
            eventSource.close();
          }

          var category = document.getElementById('category-filter').value;
          var url = '/api/v1/logs?tail=100';
          if (category) {
            url += '&category=' + encodeURIComponent(category);
          }

          setStatus('connecting');
          eventSource = new EventSource(url);

          eventSource.addEventListener('logs', function(e) {
            if (paused) return;
            try {
              var lines = JSON.parse(e.data);
              appendLines(lines);
            } catch(err) {
              // ignore parse errors
            }
          });

          eventSource.addEventListener('error', function(e) {
            try {
              var data = JSON.parse(e.data);
              if (data.error) {
                appendLines(['[ERROR] ' + data.error]);
              }
            } catch(err) {
              // SSE connection error
            }
          });

          eventSource.onopen = function() {
            setStatus('connected');
          };

          eventSource.onerror = function() {
            if (eventSource.readyState === EventSource.CLOSED) {
              setStatus('disconnected');
            } else {
              setStatus('reconnecting');
            }
          };
        }

        function appendLines(lines) {
          var pane = document.getElementById('log-pane');
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var el = document.createElement('div');
            el.className = classifyLine(line);
            el.textContent = line;
            pane.appendChild(el);
          }

          // Trim to MAX_LINES
          while (pane.childElementCount > MAX_LINES) {
            pane.removeChild(pane.firstChild);
          }

          if (autoScroll && !userScrolledUp) {
            pane.scrollTop = pane.scrollHeight;
          }
        }

        function classifyLine(line) {
          var lower = line.toLowerCase();
          if (/\\berror\\b|\\bfail\\b|\\bcrash\\b|\\bpanic\\b|\\bexception\\b/.test(lower)) {
            return 'log-error';
          }
          if (/\\bwarn\\b|\\bwarning\\b/.test(lower)) {
            return 'log-warn';
          }
          return 'log-line';
        }

        function handleScroll() {
          var pane = document.getElementById('log-pane');
          var atBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 50;

          if (atBottom) {
            userScrolledUp = false;
            if (!document.getElementById('autoscroll-toggle').checked) {
              document.getElementById('autoscroll-toggle').checked = true;
              autoScroll = true;
            }
          } else {
            userScrolledUp = true;
            if (document.getElementById('autoscroll-toggle').checked) {
              document.getElementById('autoscroll-toggle').checked = false;
              autoScroll = false;
            }
          }
        }

        function toggleAutoScroll() {
          autoScroll = document.getElementById('autoscroll-toggle').checked;
          if (autoScroll) {
            userScrolledUp = false;
            var pane = document.getElementById('log-pane');
            pane.scrollTop = pane.scrollHeight;
          }
        }

        function togglePause() {
          paused = !paused;
          var btn = document.getElementById('pause-btn');
          btn.textContent = paused ? 'Resume' : 'Pause';
          if (paused) {
            btn.className = 'contrast';
          } else {
            btn.className = '';
          }
        }

        function applyFilter() {
          document.getElementById('log-pane').innerHTML = '';
          connect();
        }

        function clearLogs() {
          document.getElementById('log-pane').innerHTML = '';
        }

        function setStatus(state) {
          var el = document.getElementById('connection-status');
          switch (state) {
            case 'connected':
              el.textContent = 'Connected';
              el.className = 'status-badge status-running';
              break;
            case 'connecting':
              el.textContent = 'Connecting...';
              el.className = 'status-badge status-unknown';
              break;
            case 'reconnecting':
              el.textContent = 'Reconnecting...';
              el.className = 'status-badge status-degraded';
              break;
            case 'disconnected':
              el.textContent = 'Disconnected';
              el.className = 'status-badge status-stopped';
              break;
          }
        }

        document.addEventListener('DOMContentLoaded', function() {
          connect();
        });
      `}</script>

      <style>{`
        .log-line {
          color: #c9d1d9;
        }
        .log-error {
          color: #f85149;
        }
        .log-warn {
          color: #d29922;
        }
        #logs-controls select {
          width: auto;
          margin-bottom: 0;
          padding: 0.3rem 0.5rem;
        }
        #logs-controls button {
          margin-bottom: 0;
          padding: 0.3rem 0.75rem;
        }
        #logs-controls label {
          cursor: pointer;
          color: var(--pico-muted-color);
        }
      `}</style>
    </Layout>
  ) as unknown as HtmlEscapedString;
}
