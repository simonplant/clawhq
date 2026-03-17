/**
 * Dashboard home page.
 *
 * Shows: agent state card, integration health grid, memory metrics,
 * approval/alert badges. Uses htmx + SSE for live status updates every 5s.
 */

import type { HtmlEscapedString } from "hono/utils/html";

import { Layout } from "../components/layout.js";

/**
 * Agent state card — shows container state, uptime, gateway status.
 * Updated via SSE with hx-swap-oob.
 */
function AgentStateCard() {
  return (
    <article id="agent-state">
      <header>
        <hgroup>
          <h3>Agent</h3>
          <p>Container &amp; gateway status</p>
        </hgroup>
      </header>
      <div
        hx-ext="sse"
        sse-connect="/sse/status"
        sse-swap="status"
        hx-swap="innerHTML"
      >
        <p aria-busy="true">Connecting...</p>
      </div>
    </article>
  );
}

/**
 * Integration health grid — shows each integration's status.
 */
function IntegrationHealthCard() {
  return (
    <article id="integration-health">
      <header>
        <hgroup>
          <h3>Integrations</h3>
          <p>Credential &amp; connectivity health</p>
        </hgroup>
      </header>
      <div id="integration-grid">
        <p class="metric-label">Loading via SSE...</p>
      </div>
    </article>
  );
}

/**
 * Memory metrics card — workspace size and token counts.
 */
function MemoryMetricsCard() {
  return (
    <article id="memory-metrics">
      <header>
        <hgroup>
          <h3>Memory</h3>
          <p>Workspace &amp; identity budget</p>
        </hgroup>
      </header>
      <div id="memory-data">
        <p class="metric-label">Loading via SSE...</p>
      </div>
    </article>
  );
}

/**
 * Approval & alert badges — shows pending counts.
 */
function ApprovalAlertCard() {
  return (
    <article id="approval-alerts">
      <header>
        <hgroup>
          <h3>Attention</h3>
          <p>Pending approvals &amp; active alerts</p>
        </hgroup>
      </header>
      <div id="attention-data">
        <p class="metric-label">Loading via SSE...</p>
      </div>
    </article>
  );
}

/**
 * Egress summary card — data leaving the machine.
 */
function EgressCard() {
  return (
    <article id="egress-summary">
      <header>
        <hgroup>
          <h3>Data Egress</h3>
          <p>Outbound API traffic</p>
        </hgroup>
      </header>
      <div id="egress-data">
        <p class="metric-label">Loading via SSE...</p>
      </div>
    </article>
  );
}

/**
 * Render the full home page HTML.
 */
export function renderHomePage(): HtmlEscapedString {
  return (
    <Layout title="Dashboard">
      <hgroup>
        <h1>Dashboard</h1>
        <p>Agent control panel — live status updates every 5s</p>
      </hgroup>

      <div class="dashboard-grid">
        <AgentStateCard />
        <IntegrationHealthCard />
        <MemoryMetricsCard />
        <ApprovalAlertCard />
        <EgressCard />
      </div>

      {/* Client-side SSE handler to distribute status updates to cards */}
      <script>{`
        document.addEventListener('DOMContentLoaded', function() {
          var source = new EventSource('/sse/status');

          source.addEventListener('status', function(e) {
            try {
              var d = JSON.parse(e.data);
              updateAgentCard(d.agent);
              updateIntegrationGrid(d.integrations);
              updateMemoryMetrics(d.workspace);
              updateEgressSummary(d.egress);
            } catch(err) {
              console.error('SSE parse error:', err);
            }
          });

          source.addEventListener('error', function() {
            var el = document.querySelector('#agent-state div');
            if (el) el.innerHTML = '<p>Connection lost. Retrying...</p>';
          });

          function updateAgentCard(agent) {
            if (!agent) return;
            var el = document.querySelector('#agent-state div');
            if (!el) return;
            var stateClass = 'status-' + agent.state;
            el.innerHTML =
              '<div><span class="status-badge ' + stateClass + '">' + agent.state.toUpperCase() + '</span></div>' +
              (agent.uptime ? '<p class="metric-label">Uptime: ' + agent.uptime + '</p>' : '') +
              '<p class="metric-label">Gateway: ' + agent.gatewayStatus +
              (agent.gatewayLatencyMs != null ? ' (' + agent.gatewayLatencyMs + 'ms)' : '') + '</p>';
          }

          function updateIntegrationGrid(integrations) {
            if (!integrations) return;
            var el = document.getElementById('integration-grid');
            if (!el) return;
            var list = integrations.integrations || [];
            if (list.length === 0) {
              el.innerHTML = '<p class="metric-label">No integrations configured</p>';
              return;
            }
            var html = '<table role="grid"><thead><tr><th>Provider</th><th>Status</th></tr></thead><tbody>';
            list.forEach(function(i) {
              html += '<tr><td>' + i.provider + '</td><td class="status-' + i.status + '">' + i.status + '</td></tr>';
            });
            html += '</tbody></table>';
            el.innerHTML = html;
          }

          function updateMemoryMetrics(workspace) {
            if (!workspace) return;
            var el = document.getElementById('memory-data');
            if (!el) return;
            var memKB = Math.round(workspace.totalMemoryBytes / 1024);
            var tokens = workspace.totalIdentityTokens;
            el.innerHTML =
              '<div><span class="metric-value">' + memKB + ' KB</span> <span class="metric-label">total memory</span></div>' +
              '<div><span class="metric-value">' + tokens.toLocaleString() + '</span> <span class="metric-label">identity tokens</span></div>';
          }

          function updateEgressSummary(egress) {
            if (!egress) return;
            var el = document.getElementById('egress-data');
            if (!el) return;
            if (egress.zeroEgress) {
              el.innerHTML = '<span class="status-badge zero-egress">ZERO EGRESS</span><p class="metric-label">No data has left this machine</p>';
              return;
            }
            el.innerHTML =
              '<div><span class="metric-value">' + formatBytes(egress.today.bytes) + '</span> <span class="metric-label">today (' + egress.today.calls + ' calls)</span></div>' +
              '<div><span class="metric-value">' + formatBytes(egress.week.bytes) + '</span> <span class="metric-label">this week</span></div>' +
              '<div><span class="metric-value">' + formatBytes(egress.month.bytes) + '</span> <span class="metric-label">this month</span></div>';
          }

          function formatBytes(bytes) {
            if (bytes === 0) return '0 B';
            var k = 1024;
            var sizes = ['B', 'KB', 'MB', 'GB'];
            var i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
          }
        });
      `}</script>
    </Layout>
  ) as unknown as HtmlEscapedString;
}
