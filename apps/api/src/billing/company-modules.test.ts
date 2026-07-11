/**
 * #12 plan builder — module catalog integrity + the company_modules read gate.
 * Only the network edge (PostgREST over global fetch) is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyModuleReconcile,
  enabledModules,
  isModuleEnabled,
  isSellableModule,
  planModuleReconcile,
  SELLABLE_MODULES,
  type CompanyModuleRow,
} from "./company-modules";
import {
  isPlanModule,
  MODULE_CATALOG,
  modulePrice,
  PLAN_MODULES,
  retiredModulePrices,
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
    expect(isPlanModule("regions_ca")).toBe(true);
    expect(isPlanModule("bogus")).toBe(false);
  });

  it("#103/#121/#134: the catalog is exactly regions_ca — mms, extra_storage, and voice are retired", () => {
    expect(PLAN_MODULES).toEqual(["regions_ca"]);
    expect(isPlanModule("mms")).toBe(false);
    expect(isPlanModule("extra_storage")).toBe(false);
    // #134/D42: calling is INCLUDED on every plan — voice is not a module.
    expect(isPlanModule("voice")).toBe(false);
  });

  it("modulePrice resolves the configured id, null when unprovisioned", () => {
    expect(modulePrice(env, "regions_ca")).toBe("price_module_regions_ca_0001");
    const bare = { ...env, STRIPE_MODULE_REGIONS_CA_PRICE_ID: undefined };
    expect(modulePrice(bare, "regions_ca")).toBeNull();
  });

  it("retiredModulePrices sweeps ALL retired price envs when set (#103 mms, #121 extra_storage, #134 voice)", () => {
    // The daily reconcile strips stale line items on these prices with a
    // prorated credit — losing one from this list would silently keep a
    // subscriber paying for a module that no longer exists.
    expect(retiredModulePrices(env)).toEqual([
      "price_module_mms_0001",
      "price_module_extra_storage_0001",
      "price_module_voice_0001",
    ]);
    // An unprovisioned env sweeps nothing (and never passes garbage to Stripe).
    const bare = {
      ...env,
      STRIPE_MODULE_MMS_PRICE_ID: undefined,
      STRIPE_MODULE_EXTRA_STORAGE_PRICE_ID: undefined,
      STRIPE_MODULE_VOICE_PRICE_ID: undefined,
    };
    expect(retiredModulePrices(bare)).toEqual([]);
  });
});

describe("isModuleEnabled", () => {
  it("true when an enabled row exists", async () => {
    serve(modulesStub([{ module: "regions_ca" }]));
    expect(await isModuleEnabled(getDb(env), COMPANY, "regions_ca")).toBe(true);
  });

  it("false when no row is returned (never enabled or disabled)", async () => {
    serve(modulesStub([]));
    expect(await isModuleEnabled(getDb(env), COMPANY, "regions_ca")).toBe(false);
  });
});

describe("enabledModules", () => {
  it("returns the enabled modules and drops unknown/retired values defensively", async () => {
    serve(
      modulesStub([
        // #103 'mms' / #121 'extra_storage' / #134 'voice' are RETIRED
        // values — straggler rows (the migrations disable them, but be
        // defensive) must be dropped like any unknown.
        { module: "mms" },
        { module: "extra_storage" },
        { module: "voice" },
        { module: "regions_ca" },
        { module: "legacy_unknown" },
      ]),
    );
    const mods = await enabledModules(getDb(env), COMPANY);
    expect(mods).toEqual<PlanModule[]>(["regions_ca"]);
  });
});

describe("sellable modules (#41)", () => {
  it("regions_ca is catalog-listed but not sellable until multi-region ships", () => {
    // #134: with voice retired (calling included on every plan) NOTHING in
    // the catalog is sellable today — regions_ca stays coming-soon.
    expect(SELLABLE_MODULES).toEqual([]);
    expect(isSellableModule("regions_ca")).toBe(false);
    // #103 mms / #121 extra_storage / #134 voice are not merely unsellable —
    // they left the module set entirely.
    expect(isPlanModule("mms")).toBe(false);
    expect(isPlanModule("extra_storage")).toBe(false);
    expect(isPlanModule("voice")).toBe(false);
  });
});

describe("planModuleReconcile (#17)", () => {
  // #134: with voice retired the catalog is regions_ca alone; its price is
  // configured in the test env, so it is billable here.
  const BILLABLE: PlanModule[] = ["regions_ca"];
  const row = (
    module: string,
    overrides: Partial<CompanyModuleRow> = {},
  ): CompanyModuleRow => ({
    module,
    disabled_at: null,
    grandfathered: false,
    ...overrides,
  });

  it("enables missing, disabled, and still-grandfathered paid modules", () => {
    // Disabled-row re-enable (paid).
    const plan = planModuleReconcile(
      [row("regions_ca", { disabled_at: "2026-06-01T00:00:00Z" })],
      ["regions_ca"],
      BILLABLE,
    );
    expect(plan.enable).toEqual(["regions_ca"]);
    expect(plan.disable).toEqual([]);

    // A paid module with NO row at all is enabled too.
    const missing = planModuleReconcile([], ["regions_ca"], BILLABLE);
    expect(missing.enable).toEqual(["regions_ca"]);
    expect(missing.disable).toEqual([]);

    // A paid module that is enabled-but-grandfathered gets the flag cleared
    // (re-upserted).
    const grandfathered = planModuleReconcile(
      [row("regions_ca", { grandfathered: true })],
      ["regions_ca"],
      BILLABLE,
    );
    expect(grandfathered.enable).toEqual(["regions_ca"]);
    expect(grandfathered.disable).toEqual([]);

    // A paid, already-enabled, non-grandfathered row is untouched.
    const settled = planModuleReconcile(
      [row("regions_ca")],
      ["regions_ca"],
      BILLABLE,
    );
    expect(settled.enable).toEqual([]);
    expect(settled.disable).toEqual([]);
  });

  it("disables enabled billable modules with no paid line item (the resubscribe leak)", () => {
    const plan = planModuleReconcile(
      [row("regions_ca")],
      [], // base-only resubscribe: no module items on the new subscription
      BILLABLE,
    );
    expect(plan.enable).toEqual([]);
    expect(plan.disable).toEqual(["regions_ca"]);
  });

  it("never disables grandfathered seeds, unbillable modules, retired/unknown values, or already-off rows", () => {
    const plan = planModuleReconcile(
      [
        row("regions_ca", { grandfathered: true }), // pre-#12 seed — protected
        row("mms"), // #103: retired — not a module anymore, ignored like any unknown
        row("extra_storage"), // #121: retired — same defensive drop
        row("voice"), // #134: retired — calling is included, the row is inert
        row("legacy_unknown"), // defensive: not a module at all
      ],
      [],
      BILLABLE,
    );
    expect(plan.enable).toEqual([]);
    expect(plan.disable).toEqual([]);

    // A billable, unpaid, non-grandfathered row IS the one disable.
    const unpaid = planModuleReconcile([row("regions_ca")], [], BILLABLE);
    expect(unpaid.disable).toEqual(["regions_ca"]);

    // A module whose price is NOT configured in this environment is never
    // auto-disabled — its paid-ness is unknowable.
    const unbillable = planModuleReconcile([row("regions_ca")], [], []);
    expect(unbillable.disable).toEqual([]);

    // Already-off rows are never re-disabled.
    const offOnly = planModuleReconcile(
      [row("regions_ca", { disabled_at: "2026-06-01T00:00:00Z" })],
      [],
      BILLABLE,
    );
    expect(offOnly.disable).toEqual([]);
  });
});

describe("applyModuleReconcile (#17)", () => {
  it("upserts enables with the grandfather flag cleared", async () => {
    const upserts = stubRoute(restMatch(env, "POST", "company_modules"), () => []);
    serve(upserts);

    await applyModuleReconcile(getDb(env), COMPANY, {
      enable: ["regions_ca"],
      disable: [],
    });

    expect(upserts.calls).toHaveLength(1);
    expect(upserts.calls[0].body).toEqual([
      {
        company_id: COMPANY,
        module: "regions_ca",
        enabled_at: expect.any(String),
        disabled_at: null,
        grandfathered: false,
      },
    ]);
  });

  it("a no-op plan writes nothing", async () => {
    serve(); // any request would fail loudly as unstubbed
    await applyModuleReconcile(getDb(env), COMPANY, { enable: [], disable: [] });
  });

  it("guard-disables the row and NEVER touches the companies row (#134: the voice settings-clear branch is gone)", async () => {
    const disables = stubRoute(
      restMatch(env, "PATCH", "company_modules"),
      () => new Response(null, { status: 204 }),
    );
    // Only the module PATCH is stubbed — a companies write would fail loudly.
    serve(disables);
    await applyModuleReconcile(getDb(env), COMPANY, {
      enable: [],
      disable: ["regions_ca"],
    });
    expect(disables.calls).toHaveLength(1);
    const query = disables.calls[0].url.searchParams;
    expect(query.get("company_id")).toBe(`eq.${COMPANY}`);
    expect(query.get("module")).toBe("in.(regions_ca)");
    expect(query.get("disabled_at")).toBe("is.null");
    expect(disables.calls[0].body).toEqual({ disabled_at: expect.any(String) });
  });
});

