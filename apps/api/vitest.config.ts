import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

/**
 * Cross-track contract boundary (integration decision): the billing and
 * messaging tracks' suites assert against typed vi.fn doubles of the telnyx
 * CONTRACT modules (src/test/telnyx-doubles/*), while the telnyx track's own
 * suites — plus the integration suite (src/mount.test.ts), which must
 * exercise the REAL fully-wired app and cron map — resolve the real modules
 * with only global fetch stubbed (D13). The split is kept deliberately at
 * integration: a billing test proving "day 30 invokes
 * releaseCompanyNumbers(env, companyId)" asserts the cross-track contract;
 * driving the real §4.3 saga's full Telnyx HTTP sequence from a billing suite
 * would only re-test the telnyx track's own (already covered) internals and
 * couple every consumer suite to the saga's wire format.
 *
 * The doubles must export every name the contract modules expose to other
 * tracks (index.ts's imports resolve to them inside the "cross-track-doubles"
 * project) — vitest fails loudly on a missing export.
 */
const telnyxDouble = (name: string) =>
  fileURLToPath(new URL(`./src/test/telnyx-doubles/${name}.ts`, import.meta.url));

/** Suites that must resolve the REAL telnyx modules. */
const REAL_TELNYX_TESTS = [
  "src/telnyx/**/*.test.ts",
  "src/routes/registration.test.ts",
  "src/routes/numbers.test.ts",
  "src/routes/porting.test.ts",
  // The integration suite asserts the real exported app + §11 cron map.
  "src/mount.test.ts",
];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "telnyx",
          environment: "node",
          include: REAL_TELNYX_TESTS,
        },
      },
      {
        resolve: {
          alias: [
            { find: /^.*\/telnyx\/provisioning$/, replacement: telnyxDouble("provisioning") },
            { find: /^.*\/telnyx\/registration$/, replacement: telnyxDouble("registration") },
            { find: /^.*\/telnyx\/porting$/, replacement: telnyxDouble("porting") },
            // verify double implements the REAL Ed25519 contract algorithm so the
            // messaging webhook suites verify genuine signatures (D13).
            { find: /^.*\/telnyx\/verify$/, replacement: telnyxDouble("verify") },
          ],
        },
        test: {
          name: "cross-track-doubles",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, ...REAL_TELNYX_TESTS],
        },
      },
    ],
  },
});
