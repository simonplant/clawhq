/**
 * Init Wizard page — browser-based setup flow.
 *
 * The full interactive wizard (inquirer-based) can't run in a browser.
 * This page provides a form-based alternative that collects the same
 * WizardAnswers and calls generateBundle + writeBundle.
 */

import { GATEWAY_DEFAULT_PORT } from "../../config/defaults.js";
import type { Blueprint } from "../../design/blueprints/types.js";
import { Layout } from "../layout.js";

export function InitPage({ blueprints, csrfToken }: { blueprints: readonly Blueprint[]; csrfToken?: string }) {
  return (
    <Layout title="Init Wizard" activePath="/init" csrfToken={csrfToken}>
      <hgroup>
        <h1>Init Wizard</h1>
        <p>Set up a new agent from a blueprint — same as <code>clawhq init --guided</code></p>
      </hgroup>

      <form hx-post="/api/init" hx-target="#init-result" hx-swap="innerHTML" hx-indicator="#init-spinner">
        <article>
          <header><h3>Step 1: Choose Blueprint</h3></header>
          {blueprints.length > 0 ? (
            <select name="blueprint" required>
              <option value="">Select a blueprint...</option>
              {blueprints.map((bp) => (
                <option value={bp.name}>{bp.name} — {bp.use_case_mapping.tagline}</option>
              ))}
            </select>
          ) : (
            <p><em>No blueprints found. Install blueprints first.</em></p>
          )}
        </article>

        <article>
          <header><h3>Step 2: Configuration</h3></header>
          <div class="grid">
            <label>
              Messaging Channel
              <select name="channel">
                <option value="telegram">Telegram</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="discord">Discord</option>
                <option value="signal">Signal</option>
              </select>
            </label>
            <label>
              Model Provider
              <select name="modelProvider">
                <option value="local">Local (Ollama)</option>
                <option value="cloud">Cloud</option>
              </select>
            </label>
          </div>
          <div class="grid">
            <label>
              Local Model
              <input type="text" name="localModel" value="llama3:8b" placeholder="e.g. llama3:8b" />
            </label>
            <label>
              Gateway Port
              <input type="number" name="gatewayPort" value={String(GATEWAY_DEFAULT_PORT)} />
            </label>
          </div>
          <label>
            Deploy Directory
            <input type="text" name="deployDir" value="~/.clawhq" placeholder="~/.clawhq" />
          </label>
          <label>
            <input type="checkbox" name="airGapped" value="true" />
            Air-gapped mode (no internet)
          </label>
        </article>

        <button type="submit">Forge Agent</button>
        <span id="init-spinner" class="htmx-indicator" aria-busy="true">Forging agent...</span>
      </form>

      <div id="init-result"></div>
    </Layout>
  );
}

export function InitResult({ success, message, files }: {
  success: boolean;
  message: string;
  files?: readonly string[];
}) {
  return (
    <article>
      <header>
        {success
          ? <h3 class="check-pass">Agent Forged Successfully</h3>
          : <h3 class="check-fail">Setup Failed</h3>}
      </header>
      <p>{message}</p>
      {files && files.length > 0 && (
        <>
          <h4>Files written:</h4>
          <ul>
            {files.map((f) => <li><code>{f}</code></li>)}
          </ul>
        </>
      )}
    </article>
  );
}
