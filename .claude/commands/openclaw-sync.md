---
description: Self-heal OpenClaw knowledge — inspect the running engine, compute drift against documented version + schema, propose updates, file a dated discovery source, and heal the wiki
---

# /openclaw-sync

You are operating as a wiki maintainer for the OpenClaw knowledge corpus. ClawHQ is tightly coupled to OpenClaw (AD-03), so when the upstream engine moves forward our local docs and schema pages rot. This skill is the self-healing loop: read the running container, compare against what we've documented, and bring the wiki back in sync — without ever mutating OpenClaw itself.

**Boundary (non-negotiable):** READ from the running container, WRITE only to ClawHQ-owned files (`knowledge/raw/`, `knowledge/wiki/`, `knowledge/index.md`, `knowledge/log.md`, and at major-version boundaries only, `docs/OPENCLAW-REFERENCE.md`). All other changes to OpenClaw flow through `clawhq` commands — never bypass that.

## Workflow

1. **Inspect available sources** — record what is accessible and what is not:
   - Running container: `docker ps --filter "name=openclaw" --format '{{.Names}}\t{{.Image}}\t{{.Status}}'`. If multiple agents are registered, resolve via `~/.clawhq/instances.json` and `src/build/docker/container.ts::requireOpenclawContainer`.
   - Installed version: `docker exec <container> cat /app/package.json | jq -r .version` (probe `/app`, `/usr/local/lib/openclaw`, or wherever the engine is installed — adapt if the first path is empty). Note: use `docker exec` (NOT `docker exec -T` — that's `docker compose exec` syntax).
   - Schema dump: `docker exec <container> openclaw config schema` (verified working on v2026.5.7 — 53k-line JSON Schema, regenerable so don't commit the full dump). Also run `openclaw --help` to discover new CLI surface. Note as unavailable if neither works.
   - Documented version: read the `openclaw_version` (or `Minimum OpenClaw version`) line in `docs/OPENCLAW-REFERENCE.md` and the frontmatter of openclaw-tagged wiki pages.
   - Prior sync history: `grep "openclaw-sync" knowledge/log.md` for previous runs.

2. **Compute drift** and present it as a short bullet list:
   - **Version delta** — documented vs running (use the CalVer parser intent: `vYYYY.M.PATCH`).
   - **Schema delta** — if a schema dump succeeded, diff its top-level field names against `knowledge/wiki/openclaw-json-schema.md` (added / removed / renamed).
   - **Stale frontmatter** — list openclaw-tagged wiki pages whose `openclaw_version` is older than the running version.
   - **Component drift** — note any components or paths observed in the container but absent from the wiki.

3. **Discuss before writing** — print the findings as `Proposed updates: ...` and pause. Match the `wiki-ingest` rule: never silently mutate the wiki. Ask the user which proposals to apply.

4. **File a new dated discovery source** at `knowledge/raw/openclaw-discovery-YYYY-MM-DD.md`. Never overwrite a prior discovery — they are provenance. Use this frontmatter:
   ```yaml
   ---
   source_id: openclaw-discovery-YYYY-MM-DD
   source_type: discovery
   ingested: YYYY-MM-DD
   openclaw_version: vYYYY.M.PATCH
   container: <name>
   image: <image:tag>
   status: active
   ---
   ```
   Body: observed version, schema dump (or "unavailable: <reason>"), container metadata, list of probes attempted and their results.

5. **Heal the wiki** (only the items the user approved in step 3):
   - Bump `openclaw_version` in `knowledge/wiki/openclaw-json-schema.md` and other `openclaw/*`-tagged pages that the user confirmed are still accurate.
   - For removed or renamed schema fields, **do not delete** — annotate with `**Superseded:** as of vX.Y.Z, this field is renamed to ...` and cite the discovery source. Provenance > tidiness.
   - For new fields, components, or landmines, add a section (or a new page if substantial) citing `(see [discovery YYYY-MM-DD](../raw/openclaw-discovery-YYYY-MM-DD.md))` — use a relative markdown link, NOT `[[wiki-link]]` syntax, because raw sources are outside the wiki link graph and `llm-wiki lint` will fail. Also record the raw source path in the page's `sources:` frontmatter list.
   - **`docs/OPENCLAW-REFERENCE.md` is touched only at a major-version boundary** (e.g. v2026.x → v2027.x) and even then propose the diff for user review rather than rewriting. Minor/patch drift is absorbed by the wiki.
   - If new pages were added, update `knowledge/index.md` under the appropriate `openclaw/*` category line.

6. **Append a log entry** to `knowledge/log.md`:
   ```
   ## [YYYY-MM-DD] openclaw-sync | <documented> → <running> (notes)

   Discovery: `knowledge/raw/openclaw-discovery-YYYY-MM-DD.md`. Pages updated: [...]. Pending: [...].
   ```

7. **Validate** by running `llm-wiki lint`. Fix any structural issues introduced (broken links, index drift, missing frontmatter).

8. **Report** to the user:
   - What was inspected and which probes succeeded/failed.
   - What was filed (discovery source path) and which wiki pages changed.
   - What is still pending — e.g. "schema dump unavailable: no `openclaw schema` subcommand and Gateway has no introspection RPC. Suggest adding a `--openclaw-schema-dump` capability to clawhq, or fetching upstream schema via `gh api repos/<upstream>/contents/...`."
