import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the tsconfig "@/*" path so tests import product code the same
      // way the app does.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // tsconfig has Next's `"jsx": "preserve"`; tests that import .tsx components
  // (e.g. the auth pages) need vite's transform to compile the JSX itself.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
  },
});
