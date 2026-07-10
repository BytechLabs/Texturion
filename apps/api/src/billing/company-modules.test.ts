/**
 * #12 plan builder — module catalog integrity + the company_modules read gate.
 * Only the network edge (PostgREST over global fetch) is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyModuleReconcile,
  effectiveStorageBudgets,
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

  it("modulePrice resolves the configured id, null when unprovisioned", () => {
    expect(modulePrice(env, "voice")).toBe("price_module_voice_0001");
    const bare = { ...env, STRIPE_MODULE_VOICE_PRICE_ID: undefined };
    expect(modulePrice(bare, "voice")).toBeNull();
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
        // #103: 'mms' is a RETIRED value — a straggler row (the migration
        // deletes them, but be defensive) must be dropped like any unknown.
        { module: "mms" },
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
    expect(SELLABLE_MODULES).toEqual(["voice", "extra_storage"]);
    expect(isSellableModule("regions_ca")).toBe(false);
    expect(isSellableModule("voice")).toBe(true);
    // #103: mms is not merely unsellable — it left the module set entirely.
    expect(isPlanModule("mms")).toBe(false);
  });
});

describe("planModuleReconcile (#17)", () => {
  const BILLABLE: PlanModule[] = ["voice", "extra_storage"];
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
    const plan = planModuleReconcile(
      [
        row("voice"), // paid + already enabled → untouched
        row("extra_storage", { disabled_at: "2026-06-01T00:00:00Z" }), // paid, off → on
        row("regions_ca", { grandfathered: true }), // paid → flag cleared
      ],
      ["voice", "extra_storage", "regions_ca"],
      ["voice", "extra_storage", "regions_ca"],
    );
    expect(plan.enable.sort()).toEqual(["extra_storage", "regions_ca"]);
    expect(plan.disable).toEqual([]);
  });

  it("disables enabled billable modules with no paid line item (the resubscribe leak)", () => {
    const plan = planModuleReconcile(
      [row("voice"), row("extra_storage")],
      [], // base-only resubscribe: no module items on the new subscription
      BILLABLE,
    );
    expect(plan.enable).toEqual([]);
    expect(plan.disable.sort()).toEqual(["extra_storage", "voice"]);
  });

  it("never disables grandfathered seeds, unbillable modules, retired/unknown values, or already-off rows", () => {
    const plan = planModuleReconcile(
      [
        row("voice", { grandfathered: true }), // pre-#12 seed — protected
        row("extra_storage"), // billable, unpaid → the ONE disable
        row("regions_ca"), // price not configured → paid-ness unknowable
        row("mms"), // #103: retired — not a module anymore, ignored like any unknown
        row("legacy_unknown"), // defensive: not a module at all
      ],
      [],
      BILLABLE, // regions_ca not billable here
    );
    expect(plan.enable).toEqual([]);
    expect(plan.disable).toEqual(["extra_storage"]);

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
      disable: ["voice", "extra_storage"],
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
    expect(query.get("module")).toBe("in.(voice,extra_storage)");
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
    serve(disables);
    await applyModuleReconcile(getDb(env), COMPANY, {
      enable: [],
      disable: ["extra_storage"],
    });
    expect(disables.calls).toHaveLength(1);
  });
});

describe("effectiveStorageBudgets", () => {
  const GB = 1024 * 1024 * 1024;

  it("returns the base plan pools when extra_storage is off", async () => {
    serve(modulesStub([]));
    const budgets = await effectiveStorageBudgets(getDb(env), COMPANY, "starter");
    expect(budgets).toEqual({ attachmentBytes: 5 * GB, mmsBytes: 5 * GB });
  });

  it("grows both pools by 10 GB when extra_storage is on (pro)", async () => {
    serve(modulesStub([{ module: "extra_storage" }]));
    const budgets = await effectiveStorageBudgets(getDb(env), COMPANY, "pro");
    expect(budgets).toEqual({ attachmentBytes: 35 * GB, mmsBytes: 35 * GB });
  });
});
