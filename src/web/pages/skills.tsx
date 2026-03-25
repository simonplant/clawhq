/**
 * Skills page — list installed skills with install/remove actions.
 */

import type { SkillManifestEntry } from "../../evolve/skills/index.js";
import { Layout } from "../layout.js";

export function SkillsPage({ skills, csrfToken }: { skills: readonly SkillManifestEntry[]; csrfToken?: string }) {
  return (
    <Layout title="Skills" activePath="/skills" csrfToken={csrfToken}>
      <hgroup>
        <h1>Installed Skills</h1>
        <p>{skills.length} skill(s) installed</p>
      </hgroup>

      <article>
        <header><h3>Install New Skill</h3></header>
        <form hx-post="/api/skills/install" hx-target="#skill-result" hx-swap="innerHTML">
          <div class="grid">
            <input
              type="text"
              name="source"
              placeholder="Skill source (path, URL, or registry name)"
              required
            />
            <button type="submit">Install</button>
          </div>
        </form>
        <div id="skill-result"></div>
      </article>

      <div id="skill-list" hx-get="/api/skills" hx-trigger="every 30s" hx-swap="innerHTML">
        <SkillList skills={skills} />
      </div>
    </Layout>
  );
}

export function SkillList({ skills }: { skills: readonly SkillManifestEntry[] }) {
  if (skills.length === 0) {
    return <p><em>No skills installed. Use the form above to install one.</em></p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Status</th>
          <th>Source</th>
          <th>Installed</th>
          <th>Vetting</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {skills.map((skill) => (
          <tr>
            <td><strong>{skill.name}</strong></td>
            <td>
              <span class={`badge ${skill.status === "active" ? "badge-ok" : "badge-warn"}`}>
                {skill.status}
              </span>
            </td>
            <td><code>{skill.source}</code></td>
            <td>{new Date(skill.stagedAt).toLocaleDateString()}</td>
            <td>
              {skill.vetResult
                ? skill.vetResult.passed
                  ? <span class="check-pass">Passed</span>
                  : <span class="check-fail">{skill.vetResult.findingCount} findings</span>
                : "-"}
            </td>
            <td>
              <button
                hx-post={`/api/skills/${encodeURIComponent(skill.name)}/remove`}
                hx-target="#skill-list"
                hx-swap="innerHTML"
                hx-confirm={`Remove skill "${skill.name}"?`}
                class="outline secondary"
              >
                Remove
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SkillResult({ success, message }: { success: boolean; message: string }) {
  return (
    <p>
      {success
        ? <span class="badge badge-ok">Success</span>
        : <span class="badge badge-err">Failed</span>}
      {" "}{message}
    </p>
  );
}
