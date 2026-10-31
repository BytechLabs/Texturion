import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * The policy suites run in node against the Guard class, a Map-backed store
 * and an in-memory Telnyx. `cloudflare:workers` is a runtime module node
 * cannot resolve, so the Durable Object entry point maps it to a stand-in;
 * vitest.workerd.config.ts runs the real thing on workerd.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^cloudflare:workers$/,
        replacement: fileURLToPath(new URL("./test/cloudflare-workers-double.ts", import.meta.url)),
      },
    ],
  },
  test: {
    name: "guard",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
