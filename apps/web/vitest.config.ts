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
    /**
     * The three REQUIRED public env vars, so a test that renders a page can.
     *
     * `src/env.ts` validates at import time and throws when they are missing —
     * correct in production, where a build without an API URL should fail loudly
     * rather than ship a site whose forms silently do nothing. But it means any
     * page-render sweep breaks the moment the page contains a client component
     * that reads the environment, which is how #312's capture form broke
     * `country-gating.test.tsx`: a test about country copy, failing on a URL.
     *
     * Set here rather than stubbed per test so the next page-render sweep does not
     * have to rediscover this. Deliberately only the required ones: every optional
     * var stays unset, so a test still sees the same "not configured" behaviour a
     * real deploy without it would.
     */
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
      NEXT_PUBLIC_API_URL: "https://api.test",
    },
  },
});
