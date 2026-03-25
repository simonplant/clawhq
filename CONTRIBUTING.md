# Contributing to ClawHQ

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
