/**
 * Logs page — stream agent logs via htmx polling.
 */

import { Layout } from "../layout.js";

export function LogsPage({ output, lineCount, csrfToken }: { output: string; lineCount: number; csrfToken?: string }) {
  return (
    <Layout title="Logs" activePath="/logs" csrfToken={csrfToken}>
      <hgroup>
        <h1>Agent Logs</h1>
        <p>{lineCount} lines</p>
      </hgroup>

      <div>
        <button hx-get="/api/logs?lines=100" hx-target="#log-content" hx-swap="innerHTML" hx-indicator="#log-spinner">
          Refresh (100 lines)
        </button>
        <button hx-get="/api/logs?lines=500" hx-target="#log-content" hx-swap="innerHTML" hx-indicator="#log-spinner">
          Load 500 lines
        </button>
        <span id="log-spinner" class="htmx-indicator" aria-busy="true">Loading...</span>
      </div>

      <div id="log-content">
        <LogOutput output={output} />
      </div>
    </Layout>
  );
}

export function LogOutput({ output }: { output: string }) {
  return (
    <pre class="log-output"><code>{output || "No logs available"}</code></pre>
  );
}
