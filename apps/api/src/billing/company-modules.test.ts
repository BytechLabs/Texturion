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
    expect(isPlanModule("voice")).toBe(true);
    expect(isPlanModule("bogus")).toBe(false);
  });

  it("#103/#121: the catalog is exactly voice + regions_ca — mms and extra_storage are retired", () => {
    expect(PLAN_MODULES).toEqual(["voice", "regions_ca"]);
    expect(isPlanModule("mms")).toBe(false);
    expect(isPlanModule("extra_storage")).toBe(false);
  });

  it("modulePrice resolves the configured id, null when unprovisioned", () => {
    expect(modulePrice(env, "voice")).toBe("price_module_voice_0001");
    const bare = { ...env, STRIPE_MODULE_VOICE_PRICE_ID: undefined };
    expect(modulePrice(bare, "voice")).toBeNull();
  });

  it("retiredModulePrices sweeps BOTH retired price envs when set (#103 mms, #121 extra_storage)", () => {
    // The daily reconcile strips stale line items on these prices with a
    // prorated credit — losing one from this list would silently keep a
    // subscriber paying for a module that no longer exists.
    expect(retiredModulePrices(env)).toEqual([
      "price_module_mms_0001",
      "price_module_extra_storage_0001",
    ]);
    // An unprovisioned env sweeps nothing (and never passes garbage to Stripe).
    const bare = {
      ...env,
      STRIPE_MODULE_MMS_PRICE_ID: undefined,
      STRIPE_MODULE_EXTRA_STORAGE_PRICE_ID: undefined,
    };
    expect(retiredModulePrices(bare)).toEqual([]);
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
  it("returns the enabled modules and drops unknown/retired values defensively", async () => {
    serve(
      modulesStub([
        // #103 'mms' / #121 'extra_storage' are RETIRED values — straggler
        // rows (the migrations delete them, but be defensive) must be
        // dropped like any unknown.
        { module: "mms" },
        { module: "extra_storage" },
        { module: "voice" },
        { module: "legacy_unknown" },
      ]),
    );
    const mods = await enabledModules(getDb(env), COMPANY);
    expect(mods).toEqual<PlanModule[]>(["voice"]);
  });
});

describe("sellable modules (#41)", () => {
  it("regions_ca is catalog-listed but not sellable until multi-region ships", () => {
    // #121: with extra_storage retired, voice is the ONE sellable module.
    expect(SELLABLE_MODULES).toEqual(["voice"]);
    expect(isSellableModule("regions_ca")).toBe(false);
    expect(isSellableModule("voice")).toBe(true);
    // #103 mms / #121 extra_storage are not merely unsellable — they left
    // the module set entirely.
    expect(isPlanModule("mms")).toBe(false);
    expect(isPlanModule("extra_storage")).toBe(false);
  });
});

describe("planModuleReconcile (#17)", () => {
  // #121: with extra_storage retired the catalog is voice + regions_ca; both
  // have configured prices in the test env, so both are billable here.
  const BILLABLE: PlanModule[] = ["voice", "regions_ca"];
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
    // Disabled-row and missing-row re-enables (both paid).
    const plan = planModuleReconcile(
      [
        row("voice", { disabled_at: "2026-06-01T00:00:00Z" }), // paid, off → on
        // regions_ca paid but has NO row at all → on
      ],
      ["voice", "regions_ca"],
      BILLABLE,
    );
    expect(plan.enable.sort()).toEqual(["regions_ca", "voice"]);
    expect(plan.disable).toEqual([]);

    // A paid module that is enabled-but-grandfathered gets the flag cleared
    // (re-upserted); a paid, already-enabled, non-grandfathered row is
    // untouched.
    const grandfathered = planModuleReconcile(
      [row("voice"), row("regions_ca", { grandfathered: true })],
      ["voice", "regions_ca"],
      BILLABLE,
    );
    expect(grandfathered.enable).toEqual(["regions_ca"]);
    expect(grandfathered.disable).toEqual([]);
  });

  it("disables enabled billable modules with no paid line item (the resubscribe leak)", () => {
    const plan = planModuleReconcile(
      [row("voice"), row("regions_ca")],
      [], // base-only resubscribe: no module items on the new subscription
      BILLABLE,
    );
    expect(plan.enable).toEqual([]);
    expect(plan.disable.sort()).toEqual(["regions_ca", "voice"]);
  });

  it("never disables grandfathered seeds, unbillable modules, retired/unknown values, or already-off rows", () => {
    const plan = planModuleReconcile(
      [
        row("voice", { grandfathered: true }), // pre-#12 seed — protected
        row("regions_ca"), // billable, unpaid → the ONE disable
        row("mms"), // #103: retired — not a module anymore, ignored like any unknown
        row("extra_storage"), // #121: retired — same defensive drop
        row("legacy_unknown"), // defensive: not a module at all
      ],
      [],
      BILLABLE,
    );
    expect(plan.enable).toEqual([]);
    expect(plan.disable).toEqual(["regions_ca"]);

    // A module whose price is NOT configured in this environment is never
    // auto-disabled — its paid-ness is unknowable.
    const unbillable = planModuleReconcile([row("voice")], [], []);
    expect(unbillable.disable).toEqual([]);

    // Already-off rows are never re-disabled.
    const offOnly = planModuleReconcile(
      [row("voice", { disabled_at: "2026-06-01T00:00:00Z" })],
      [],
      BILLABLE,
    );
    expect(offOnly.disable).toEqual([]);
  });
});

describe("applyModuleReconcile (#17)", () => {
  it("upserts enables (grandfather cleared) and guard-disables in one pass", async () => {
    const upserts = stubRoute(restMatch(env, "POST", "company_modules"), () => []);
    const disables = stubRoute(
      restMatch(env, "PATCH", "company_modules"),
      () => new Response(null, { status: 204 }),
    );
    const companies = stubRoute(
      restMatch(env, "PATCH", "companies"),
      () => new Response(null, { status: 204 }),
    );
    serve(upserts, disables, companies);

    await applyModuleReconcile(getDb(env), COMPANY, {
      enable: ["regions_ca"],
      disable: ["voice"],
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
    expect(disables.calls).toHaveLength(1);
    const query = disables.calls[0].url.searchParams;
    expect(query.get("company_id")).toBe(`eq.${COMPANY}`);
    expect(query.get("module")).toBe("in.(voice)");
    expect(query.get("disabled_at")).toBe("is.null");
    expect(disables.calls[0].body).toEqual({ disabled_at: expect.any(String) });
    // Disabling voice clears the forwarding capability (cost-protection).
    expect(companies.calls).toHaveLength(1);
    expect(companies.calls[0].body).toEqual({
      forward_to_cell: null,
      mctb_enabled: false,
    });
  });

  it("a no-op plan writes nothing", async () => {
    serve(); // any request would fail loudly as unstubbed
    await applyModuleReconcile(getDb(env), COMPANY, { enable: [], disable: [] });
  });

  it("a non-voice disable never touches the companies row", async () => {
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
  });
});

