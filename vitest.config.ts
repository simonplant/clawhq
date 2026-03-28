import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // E2E tests require Docker and are excluded from the default unit test run.
    // Run E2E tests separately: npm run test:e2e
    include: ["src/**/*.test.ts"],
    exclude: ["test/e2e/**"],
  },
});
