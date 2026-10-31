import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // The browser tests need Chromium installed; they run as `test:browser`.
    exclude: ["**/node_modules/**", "**/*.browser.test.ts"],
  },
});
