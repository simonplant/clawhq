/**
 * Deploy page — deploy controls (up/down/restart).
 */

import type { StatusSnapshot } from "../../operate/status/index.js";
import { Layout } from "../layout.js";

export function DeployPage({ status, csrfToken }: { status: StatusSnapshot; csrfToken?: string }) {
  const isRunning = status.container?.running ?? false;

  return (
    <Layout title="Deploy" activePath="/deploy" csrfToken={csrfToken}>
      <hgroup>
        <h1>Deploy Controls</h1>
        <p>Agent is {isRunning
          ? <span class="badge badge-ok">Running</span>
          : <span class="badge badge-err">Stopped</span>}
        </p>
      </hgroup>

      <div id="deploy-result"></div>

      <div class="grid">
        <article>
          <header><h3>Start Agent</h3></header>
          <p>Run preflight checks, start container, apply firewall, verify health.</p>
          <button
            hx-post="/api/deploy/up"
            hx-target="#deploy-result"
            hx-swap="innerHTML"
            hx-indicator="#deploy-spinner"
            hx-confirm="Start the agent?"
          >
            Start (up)
          </button>
        </article>

        <article>
          <header><h3>Restart Agent</h3></header>
          <p>Graceful restart — stops and re-starts the container.</p>
          <button
            hx-post="/api/deploy/restart"
            hx-target="#deploy-result"
            hx-swap="innerHTML"
            hx-indicator="#deploy-spinner"
            hx-confirm="Restart the agent?"
          >
            Restart
          </button>
        </article>

        <article>
          <header><h3>Stop Agent</h3></header>
          <p>Graceful shutdown of the container.</p>
          <button
            hx-post="/api/deploy/down"
            hx-target="#deploy-result"
            hx-swap="innerHTML"
            hx-indicator="#deploy-spinner"
            hx-confirm="Stop the agent?"
          >
            Stop (down)
          </button>
        </article>
      </div>

      <span id="deploy-spinner" class="htmx-indicator" aria-busy="true">Working...</span>
    </Layout>
  );
}

export function DeployResult({ success, message }: { success: boolean; message: string }) {
  return (
    <article>
      <p>
        {success
          ? <span class="badge badge-ok">Success</span>
          : <span class="badge badge-err">Failed</span>}
        {" "}{message}
      </p>
    </article>
  );
}
