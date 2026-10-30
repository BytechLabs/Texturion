/**
 * D142: `scripts/check-deploy-env-branches.mjs`, proven in both directions,
 * and the claim that everything which is not production or the rig runs as
 * `local`.
 *
 * The guard is imported rather than copied, so these vectors test the rules CI
 * executes. Running it over the real tree here also makes the API test job
 * enforce it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  apiProductionSources,
  coverageProblems,
  deployEnvOffences,
  // @ts-expect-error — a plain .mjs with no types, which is what CI executes.
} from "../../../../scripts/check-deploy-env-branches.mjs";
import { getEnv } from "../env";
import { completeEnv } from "../test/support";
import { deployEnv } from "./mode";

interface Offence {
  path: string;
  line: number;
  rule: string;
}

const REPO = join(import.meta.dirname, "..", "..", "..", "..");
const offences = (files: Array<{ path: string; text: string }>) =>
  deployEnvOffences(files) as Offence[];

describe("check-deploy-env-branches refuses every way of reading DEPLOY_ENV", () => {
  it.each([
    ["a property read", "if (env.DEPLOY_ENV === 'rig') relax();"],
    ["a bracket read", "const mode = env['DEPLOY_ENV'];"],
    ["a destructured read", "const { DEPLOY_ENV } = env;"],
    ["an optional-chained read", "return bindings?.DEPLOY_ENV ?? 'local';"],
    ["a read inside a template", "log(`mode=${env.DEPLOY_ENV}`);"],
  ])("%s outside src/environments/", (_label, line) => {
    expect(offences([{ path: "apps/api/src/routes/x.ts", text: line }])).toEqual([
      expect.objectContaining({ path: "apps/api/src/routes/x.ts", line: 1 }),
    ]);
  });

  it.each([
    ["a static import", `import { deployEnv } from "../environments/mode";`],
    ["an import with the extension", `import { deployEnv } from "../environments/mode.ts";`],
    ["a dynamic import", `const m = await import("../environments/mode");`],
  ])("%s of the reader outside src/environments/", (_label, line) => {
    expect(offences([{ path: "apps/api/src/calls/y.ts", text: line }])).toHaveLength(1);
  });

  it.each([
    [
      "an export that names the deployment, imported to relax a cap",
      `import { sentryEnvironment, servesRigRoutes } from "../environments/policy";\n` +
        `if (sentryEnvironment(env) !== "production") return Infinity;\n` +
        "if (servesRigRoutes(env)) return Infinity;",
      2,
    ],
    ["the same export under another name", `import { servesRigRoutes as isRig } from "../environments/policy";`, 1],
    [
      "the same export inside a longer import",
      `import {\n  outboundDestinationRefusal,\n  type DestinationRefusal,\n  servesRigRoutes,\n} from "../environments/policy";`,
      1,
    ],
    ["the same export taken from a file that passed it on", `import { sentryEnvironment } from "../observability/sentry";`, 1],
    ["a namespace import", `import * as policy from "../environments/policy";`, 1],
    ["a re-export of everything", `export * from "../environments/policy";`, 1],
    ["a dynamic import", `const policy = await import("../environments/policy");`, 1],
  ])("%s outside the files that need it", (_label, text, count) => {
    expect(offences([{ path: "apps/api/src/billing/caps.ts", text }])).toHaveLength(count);
  });

  it("a sanctioned importer passing the name on", () => {
    const text = `export { sentryEnvironment } from "../environments/policy";`;
    expect(
      offences([{ path: "apps/api/src/observability/sentry.ts", text }]).map((o) => o.rule),
    ).toEqual([expect.stringMatching(/^re-exports sentryEnvironment/)]);
  });

  it("a sanctioned importer taking a name it was not given", () => {
    const text = `import { sentryEnvironment } from "./environments/policy";`;
    expect(offences([{ path: "apps/api/src/index.ts", text }])).toHaveLength(1);
  });

  it("a second declaration in env.ts", () => {
    const text = [
      'DEPLOY_ENV: z.enum(["local"]).optional(),',
      'DEPLOY_ENV: z.string().optional(),',
    ].join("\n");
    expect(offences([{ path: "apps/api/src/env.ts", text }]).map((o) => o.rule)).toEqual([
      "declares DEPLOY_ENV more than once",
    ]);
  });
});

describe("check-deploy-env-branches allows what is not a read", () => {
  it.each([
    ["prose in a line comment", "// DEPLOY_ENV is read only by environments/"],
    ["prose in a doc block", "/**\n * Named by DEPLOY_ENV, which ship.yml stamps.\n */\nexport const x = 1;"],
    [
      "a policy question",
      `import { outboundDestinationRefusal, type DestinationRefusal } from "../environments/policy";`,
    ],
    ["a type-only import", `import type { DestinationRefusal } from "../environments/policy";`],
  ])("%s", (_label, text) => {
    expect(offences([{ path: "apps/api/src/routes/x.ts", text }])).toEqual([]);
  });

  it("the deployment's name, in the files that need it", () => {
    expect(
      offences([
        { path: "apps/api/src/index.ts", text: `import { servesRigRoutes } from "./environments/policy";` },
        {
          path: "apps/api/src/observability/sentry.ts",
          text: `import { sentryEnvironment } from "../environments/policy";`,
        },
      ]),
    ).toEqual([]);
  });

  it("the schema key in env.ts", () => {
    const text = '  DEPLOY_ENV: z.enum(["local", "rig", "production"]).optional(),';
    expect(offences([{ path: "apps/api/src/env.ts", text }])).toEqual([]);
  });

  it("anything inside src/environments/ and src/test/", () => {
    const text = "return env.DEPLOY_ENV ?? 'local';";
    expect(
      offences([
        { path: "apps/api/src/environments/mode.ts", text },
        { path: "apps/api/src/test/rig-env.ts", text: 'DEPLOY_ENV: "rig",' },
      ]),
    ).toEqual([]);
  });
});

describe("check-deploy-env-branches on the real tree", () => {
  const files = apiProductionSources(REPO) as Array<{ path: string; text: string }>;

  it("can see what it vouches for", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(coverageProblems(files)).toEqual([]);
  });

  it("finds no reader outside src/environments/", () => {
    expect(offences(files)).toEqual([]);
  });

  it("says so when the reader has moved", () => {
    const moved = files.map((file) =>
      file.path === "apps/api/src/environments/mode.ts"
        ? { ...file, text: "export const nothing = 1;" }
        : file,
    );
    expect(coverageProblems(moved)).not.toEqual([]);
  });

  it("says so when a sanctioned importer no longer imports its name", () => {
    const dropped = files.map((file) =>
      file.path === "apps/api/src/index.ts"
        ? { ...file, text: file.text.replace(/\bservesRigRoutes\b/g, "somethingElse") }
        : file,
    );
    expect(coverageProblems(dropped)).toEqual([
      expect.stringMatching(/^apps\/api\/src\/index\.ts is allowed servesRigRoutes/),
    ]);
  });
});

describe("everything that is not production or the rig runs as local", () => {
  it("the e2e harness never sets DEPLOY_ENV, so it is local", () => {
    const e2e = join(REPO, "apps/api/e2e");
    const files = readdirSync(e2e).filter((name) => name.endsWith(".ts"));
    expect(files).toContain("harness.ts");
    for (const name of files) {
      expect(readFileSync(join(e2e, name), "utf8"), name).not.toMatch(/DEPLOY_ENV/);
    }
  });

  it("the harness's Telnyx stub would be refused in production, and boots as local", () => {
    const harness = readFileSync(join(REPO, "apps/api/e2e/harness.ts"), "utf8");
    expect(harness).toMatch(/TELNYX_API_BASE:\s*telnyx\.origin/);
    const stubbed = { ...completeEnv(), TELNYX_API_BASE: "http://127.0.0.1:8791" };
    expect(deployEnv(getEnv(stubbed))).toBe("local");
    expect(() => getEnv({ ...stubbed, DEPLOY_ENV: "production" })).toThrowError(
      /TELNYX_API_BASE/,
    );
  });

  it("CI's generated .dev.vars and the example both say local", () => {
    const ciVars = readFileSync(join(REPO, "scripts/ci-dev-vars.mjs"), "utf8");
    expect(ciVars).toMatch(/^\s*DEPLOY_ENV: "local",$/m);
    const example = readFileSync(join(REPO, "apps/api/.dev.vars.example"), "utf8");
    expect(example).toMatch(/^DEPLOY_ENV=local$/m);
  });

  it("only the production deploy stamps production, beside GIT_SHA", () => {
    const workflows = join(REPO, ".github/workflows");
    const stamping = readdirSync(workflows).filter((name) =>
      /DEPLOY_ENV:production/.test(readFileSync(join(workflows, name), "utf8")),
    );
    expect(stamping).toEqual(["ship.yml"]);
    const ship = readFileSync(join(workflows, "ship.yml"), "utf8");
    expect(ship).toMatch(
      /wrangler deploy \\\s*\n\s*--var GIT_SHA:"\$\{\{ github\.sha \}\}" \\\s*\n\s*--var DEPLOY_ENV:production\s*\n/,
    );
  });
});
