/**
 * Home page — agent overview with status snapshot.
 */

import type { StatusSnapshot } from "../../operate/status/index.js";
import { Layout } from "../layout.js";

export function HomePage({ status, csrfToken }: { status: StatusSnapshot; csrfToken?: string }) {
  return (
    <Layout title="Home" activePath="/" csrfToken={csrfToken}>
      <hgroup>
        <h1>Agent Overview</h1>
        <p>Current status at {new Date(status.timestamp).toLocaleString()}</p>
      </hgroup>

      <div hx-get="/api/status" hx-trigger="every 10s" hx-target="#status-card" hx-swap="innerHTML">
        <article id="status-card">
          <StatusCard status={status} />
        </article>
      </div>
    </Layout>
  );
}

export function StatusCard({ status }: { status: StatusSnapshot }) {
  const healthBadge = status.healthy
    ? <span class="badge badge-ok">Healthy</span>
    : <span class="badge badge-err">Unhealthy</span>;

  return (
    <>
      <header>
        <h3>Agent Health {healthBadge}</h3>
      </header>

      <div class="grid">
        <div>
          <h4>Container</h4>
          {status.container ? (
            <table>
              <tbody>
                <tr><td>Name</td><td>{status.container.name}</td></tr>
                <tr><td>State</td><td>{status.container.state}</td></tr>
                <tr><td>Image</td><td>{status.container.image}</td></tr>
                <tr><td>Uptime</td><td>{status.container.startedAt}</td></tr>
                <tr>
                  <td>Health</td>
                  <td>{status.container.running
                    ? <span class="check-pass">Running</span>
                    : <span class="check-fail">Stopped</span>}
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p><em>Container not found</em></p>
          )}
        </div>

        <div>
          <h4>Gateway</h4>
          <table>
            <tbody>
              <tr>
                <td>Reachable</td>
                <td>{status.gateway.reachable
                  ? <span class="check-pass">Yes</span>
                  : <span class="check-fail">No</span>}
                </td>
              </tr>
              {status.gateway.latencyMs !== undefined && (
                <tr><td>Latency</td><td>{status.gateway.latencyMs}ms</td></tr>
              )}
              {status.gateway.error && (
                <tr><td>Error</td><td class="check-fail">{status.gateway.error}</td></tr>
              )}
            </tbody>
          </table>

          <h4>Config</h4>
          <p>{status.configValid
            ? <span class="check-pass">Valid</span>
            : <span class="check-fail">Invalid ({status.configErrors.length} errors)</span>}
          </p>
          {status.configErrors.length > 0 && (
            <ul>
              {status.configErrors.map((e) => <li class="check-fail">{e}</li>)}
            </ul>
          )}

          {status.disk && (
            <>
              <h4>Disk</h4>
              <p>{status.disk.usedPercent}% used ({status.disk.freeMb}MB free)</p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
