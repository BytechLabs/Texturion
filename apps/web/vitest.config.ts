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
    // Auto-undo per-test global state. Without these, any test that spies
    // (vi.spyOn), stubs a global (vi.stubGlobal) or an env var (vi.stubEnv)
    // leaks into whatever file runs next — which made unrelated suites fail
    // depending only on execution order (a red CI that passed locally, and
    // vice versa). Restoring centrally fixes the whole class rather than
    // chasing whichever test happens to surface it.
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
