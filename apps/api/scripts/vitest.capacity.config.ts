import { defineConfig } from "vitest/config";

/**
 * #251's hosted driver is an operator-side Node program, not Worker code.
 * Keeping its tests in a separate project gives it Node's fetch/Buffer types
 * without making the ordinary API suite load an opt-in operations surface.
 */
export default defineConfig({
  test: {
    name: "capacity-deployed",
    environment: "node",
    include: ["scripts/deployed-capacity.test.ts"],
  },
});
