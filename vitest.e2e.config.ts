/**
 * Vitest config for FEAT-018 end-to-end smoke tests.
 *
 * E2E tests are NOT included in the default `npm test` run because they
 * require Docker and an Ollama instance. Run explicitly with:
 *
 *   npm run test:e2e
 *
 * Docker-dependent phases (build/up/doctor/down/destroy) skip gracefully
 * when Docker is not available. Only phases 1-3 (install/init/validate)
 * always run.
 *
 * Timeouts are generous because Docker builds can take several minutes.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/e2e/**/*.test.ts"],
    testTimeout: 600_000, // 10 min — Docker builds + container start
    hookTimeout: 30_000,
    // Run phases sequentially — each depends on the previous
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
