/**
 * #12 plan builder — module catalog integrity + the company_modules read gate.
 * Only the network edge (PostgREST over global fetch) is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { enabledModules, isModuleEnabled } from "./company-modules";
import {
  isPlanModule,
  MODULE_CATALOG,
  PLAN_MODULES,
  type PlanModule,
} from "./modules";
import { restMatch, stubRoute, type Stub } from "../test/messaging-support";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { getDb } from "../db";

const env = completeEnv();
const COMPANY = "aaaaaaaa-0000-4000-8000-00000000000a";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function serve(...stubs: Stub[]) {
  stubFetch(...(stubs.map((s) => s.route) as FetchRoute[]));
}

function modulesStub(rows: { module: string }[]): Stub {
  return stubRoute(restMatch(env, "GET", "company_modules"), () => rows);
}

describe("module catalog", () => {
  it("every module has a complete, unique spec", () => {
    const priceKeys = new Set<string>();
    for (const id of PLAN_MODULES) {
      const spec = MODULE_CATALOG[id];
      expect(spec.id).toBe(id);
      expect(spec.label.length).toBeGreaterThan(0);
      expect(spec.blurb.length).toBeGreaterThan(0);
      expect(spec.monthlyCents).toBeGreaterThan(0);
      expect(spec.priceEnvKey).toMatch(/^STRIPE_MODULE_/);
      priceKeys.add(spec.priceEnvKey);
    }
    // No two modules share a Stripe price env id.
    expect(priceKeys.size).toBe(PLAN_MODULES.length);
  });

  it("isPlanModule narrows known ids and rejects the rest", () => {
    expect(isPlanModule("voice")).toBe(true);
    expect(isPlanModule("bogus")).toBe(false);
  });
});

describe("isModuleEnabled", () => {
  it("true when an enabled row exists", async () => {
    serve(modulesStub([{ module: "voice" }]));
    expect(await isModuleEnabled(getDb(env), COMPANY, "voice")).toBe(true);
  });

  it("false when no row is returned (never enabled or disabled)", async () => {
    serve(modulesStub([]));
    expect(await isModuleEnabled(getDb(env), COMPANY, "voice")).toBe(false);
  });
});

describe("enabledModules", () => {
  it("returns the enabled modules and drops unknown values defensively", async () => {
    serve(
      modulesStub([
        { module: "mms" },
        { module: "voice" },
        { module: "legacy_unknown" },
      ]),
    );
    const mods = await enabledModules(getDb(env), COMPANY);
    expect(mods).toEqual<PlanModule[]>(["mms", "voice"]);
  });
});
