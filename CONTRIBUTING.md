# Contributing to ClawHQ

## Development-as-Content

Every development action in ClawHQ should produce discoverable content as a byproduct. One-time launch events decay in 72 hours. Compounding content solves the discovery problem without a separate content calendar.

### What generates content

| Development action | Content output |
|---|---|
| Bug fix | Postmortem article: what broke, why, how we fixed it |
| New blueprint | Tutorial walkthrough: what the blueprint does, who it's for |
| OpenClaw breaking change | "What broke and how we fixed it" article |
| New landmine discovered | Addition to PROBLEMS.md + article if substantial |
| Security incident | Entry in docs/security/INCIDENTS.md |

### The article template

All articles live in `docs/articles/` and follow the template at `docs/articles/TEMPLATE.md`:

1. **Title** — problem-first, searchable (what someone would type into Google)
2. **The Problem** — what goes wrong, who it affects, scale data
3. **Context** — why this is non-obvious, prior art, failed approaches
4. **The Fix** — what we did, with enough detail to reproduce or verify
5. **What We Learned** — the generalizable insight
6. **How ClawHQ Handles This** — how it's built into the platform

### PR expectations

Each PR that fixes a landmine, resolves a security issue, or adds a blueprint should include one of:

- A content draft in `docs/articles/` (preferred for substantial fixes)
- An update to `docs/PROBLEMS.md` (for new landmine discoveries)
- An entry in `docs/security/INCIDENTS.md` (for security incidents)
- A narrative entry in `docs/CHANGELOG.md` (minimum for all PRs)

Not every PR needs a full article. Use judgment: if the fix teaches something generalizable, write the article. If it's a routine bug fix, a narrative changelog entry is sufficient.

### CHANGELOG conventions

Changelog entries in `docs/CHANGELOG.md` are narratives, not version lists. Each entry tells the story of what changed, why it mattered, and what it means for operators. See the existing entries for the style.

---

## Running Tests

### Unit Tests

```bash
npm test                  # Run all tests (unit + contract)
```

### Contract Tests

Contract tests validate our cloud provider integrations against realistic API response shapes. They run with recorded fixtures by default — no credentials needed.

```bash
npm run test:contract     # Run contract tests only
```

### Live API Tests

When provider credentials are available, contract tests also run against the real cloud APIs. These tests are **skipped automatically** when credentials are not set.

To enable live tests, export the relevant environment variable:

| Provider     | Environment Variable          | Format                                   |
|-------------|-------------------------------|------------------------------------------|
| DigitalOcean | `CLAWHQ_TEST_DO_TOKEN`       | API token                                |
| Hetzner      | `CLAWHQ_TEST_HETZNER_TOKEN`  | API token                                |
| AWS          | `CLAWHQ_TEST_AWS_TOKEN`      | `ACCESS_KEY_ID:SECRET_ACCESS_KEY`        |
| GCP          | `CLAWHQ_TEST_GCP_TOKEN`      | `PROJECT_ID:ACCESS_TOKEN` or service account JSON |

Example:

```bash
# Run contract tests with live DigitalOcean validation
CLAWHQ_TEST_DO_TOKEN=dop_v1_abc123 npm run test:contract
```

**Safety notes:**

- Live tests only call read-only endpoints (token validation, list SSH keys). They do **not** create or destroy resources.
- Use a dedicated test API token with minimal permissions (read-only when possible).
- Never commit credentials to the repository.
