import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

import {
  provisionCompanyNumber,
  reconcileNumbers,
  releaseCompanyNumbers,
  resumeProvisioning,
  suspendCompanyNumbers,
  type PhoneNumberRow,
} from "./provisioning";
import {
  FakeRest,
  registerProvisioningRpcs,
  resendRoute,
  TelnyxMock,
  telnyxError,
  type SentEmailCapture,
} from "./test-support";
import { completeEnv, stubFetch } from "../test/support";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const CHECKOUT = "cs_test_0001";

const NUMBER_DEFAULTS = {
  status: "provisioning",
  source: "provisioned",
  requested_area_code: null,
  number_e164: null,
  telnyx_phone_number_id: null,
  telnyx_order_id: null,
  provision_attempts: 0,
  last_provision_error: null,
  suspended_at: null,
  released_at: null,
};

function setup(companyOverrides: Record<string, unknown> = {}) {
  const env = completeEnv();
  const rest = new FakeRest(env);
  rest.table("companies");
  rest.table("phone_numbers", NUMBER_DEFAULTS);
  rest.table("company_members");
  rest.table("messaging_registrations");
  // reconcileNumbers now excludes in-flight ports from the orphan scan
  // (PORTING.md §5.2) — the table must exist for the query even when empty.
  rest.table("port_requests");
  // §4.3 double-order fail-safe: the saga claims a per-row lease + a per-order
  // idempotency key via these RPCs on every run.
  registerProvisioningRpcs(rest);
  rest.user(OWNER_ID, "owner@acme.example");
  rest.insert("companies", {
    id: COMPANY_ID,
    name: "Acme Plumbing",
    country: "US",
    requested_area_code: "212",
    telnyx_messaging_profile_id: null,
    subscription_status: "active",
    us_texting_enabled: true,
    ...companyOverrides,
  });
  rest.insert("company_members", {
    company_id: COMPANY_ID,
    user_id: OWNER_ID,
    role: "owner",
    deactivated_at: null,
  });

  const telnyx = new TelnyxMock();
  const emails: SentEmailCapture[] = [];
  stubFetch(rest.route(), telnyx.route(), resendRoute(emails));
  return { env, rest, telnyx, emails };
}

/** Handlers for the full happy-path saga: profile, search, order, lookup. */
function happyPathTelnyx(telnyx: TelnyxMock, e164 = "+12125550123") {
  telnyx.on("POST", /^\/v2\/messaging_profiles$/, () => ({
    data: { id: "profile-1" },
  }));
  telnyx.on("GET", /^\/v2\/available_phone_numbers$/, () => ({
    data: [{ phone_number: e164 }],
  }));
  telnyx.on("POST", /^\/v2\/number_orders$/, () => ({
    data: { id: "order-1", status: "success", phone_numbers: [{ phone_number: e164 }] },
  }));
  telnyx.on("GET", /^\/v2\/phone_numbers$/, (call) => {
    if (call.query.get("filter[phone_number]") === e164) {
      return { data: [{ id: "pn-1", phone_number: e164 }] };
    }
    return { data: [], meta: { total_pages: 1 } };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provisionCompanyNumber — §4.3 saga happy path", () => {
  it("creates profile, searches by NDC, orders, and activates the row", async () => {
    const { env, rest, telnyx } = setup();
    happyPathTelnyx(telnyx);

    const row = await provisionCompanyNumber(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: CHECKOUT,
    });

    expect(row).not.toBeNull();
    expect(row?.status).toBe("active");
    expect(row?.number_e164).toBe("+12125550123");
    expect(row?.telnyx_phone_number_id).toBe("pn-1");
    expect(row?.telnyx_order_id).toBe("order-1");
    expect(row?.provisioning_key).toBe(CHECKOUT);
    expect(row?.requested_area_code).toBe("212");

    // S1: messaging profile per SPEC — webhook URLs + US/CA geo-permissions.
    const profile = telnyx.callsTo("POST", /messaging_profiles/)[0];
    expect(profile.body).toEqual({
      name: COMPANY_ID,
      webhook_url: "https://api.loonext.com/webhooks/telnyx",
      webhook_failover_url: "https://api.loonext.com/webhooks/telnyx",
      whitelisted_destinations: ["US", "CA"],
    });
    expect(
      rest.rows("companies")[0].telnyx_messaging_profile_id,
    ).toBe("profile-1");

    // S2: search filters exactly as SPEC names them.
    const search = telnyx.callsTo("GET", /available_phone_numbers/)[0];
    expect(search.query.get("filter[country_code]")).toBe("US");
    expect(search.query.get("filter[features]")).toBe("sms");
    expect(search.query.get("filter[phone_number_type]")).toBe("local");
    expect(search.query.get("filter[national_destination_code]")).toBe("212");

    // S3: order carries messaging_profile_id + customer_reference.
    const order = telnyx.callsTo("POST", /number_orders/)[0];
    expect(order.body).toEqual({
      phone_numbers: [{ phone_number: "+12125550123" }],
      messaging_profile_id: "profile-1",
      customer_reference: COMPANY_ID,
    });
  });

  it("skips S1 when the company already has a messaging profile", async () => {
    const { env, telnyx } = setup({ telnyx_messaging_profile_id: "profile-9" });
    happyPathTelnyx(telnyx);
    await provisionCompanyNumber(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: CHECKOUT,
    });
    expect(telnyx.callsTo("POST", /messaging_profiles/)).toHaveLength(0);
    const order = telnyx.callsTo("POST", /number_orders/)[0];
    expect((order.body as { messaging_profile_id: string }).messaging_profile_id).toBe(
      "profile-9",
    );
  });

  it("leaves the row provisioning (order id persisted) when the order is still pending", async () => {
    const { env, rest, telnyx } = setup();
    telnyx.on("POST", /^\/v2\/messaging_profiles$/, () => ({ data: { id: "profile-1" } }));
    telnyx.on("GET", /^\/v2\/available_phone_numbers$/, () => ({
      data: [{ phone_number: "+12125550123" }],
    }));
    telnyx.on("POST", /^\/v2\/number_orders$/, () => ({
      data: { id: "order-1", status: "pending", phone_numbers: [] },
    }));
    telnyx.on("GET", /^\/v2\/phone_numbers$/, () => ({ data: [] }));

    const row = await provisionCompanyNumber(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: CHECKOUT,
    });
    expect(row?.status).toBe("provisioning");
    expect(row?.telnyx_order_id).toBe("order-1");
    expect(rest.rows("phone_numbers")[0].telnyx_order_id).toBe("order-1");
  });
});

describe("provisionCompanyNumber — idempotency (§4.3, §9)", () => {
  it("no-ops on a duplicate provisioning key (duplicate webhook delivery)", async () => {
    const { env, rest, telnyx } = setup();
    happyPathTelnyx(telnyx);
    const first = await provisionCompanyNumber(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: CHECKOUT,
    });
    const second = await provisionCompanyNumber(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: CHECKOUT,
    });
    expect(second?.id).toBe(first?.id);
    expect(second?.status).toBe("active");
    // Never ordered twice.
    expect(telnyx.callsTo("POST", /number_orders/)).toHaveLength(1);
    expect(rest.rows("phone_numbers")).toHaveLength(1);
  });

  it("skips entirely when a non-released number exists under another key (resubscribe-within-grace)", async () => {
    const { env, rest, telnyx } = setup();
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      provisioning_key: "cs_previous",
      country: "US",
      number_e164: "+12125550999",
      telnyx_phone_number_id: "pn-old",
    });

    const result = await provisionCompanyNumber(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: "cs_new",
    });
    expect(result).toBeNull();
    expect(rest.rows("phone_numbers")).toHaveLength(1);
    expect(telnyx.calls).toHaveLength(0);
  });

  it("still skips a NORMAL call when the company's pending port row exists (webhook regression)", async () => {
    // The paid-checkout webhook relies on exactly this: a port-only signup has
    // a source='ported' row at webhook time, and the plain (non-bridge) call
    // must NOT buy a number over it.
    const { env, rest, telnyx } = setup();
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      source: "ported",
      provisioning_key: "port-idempotency-key",
      country: "US",
    });

    const result = await provisionCompanyNumber(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: "cs_paid",
    });
    expect(result).toBeNull();
    expect(rest.rows("phone_numbers")).toHaveLength(1);
    expect(telnyx.calls).toHaveLength(0);
  });
});

describe("provisionCompanyNumber — bridge number (PORTING.md D16 opt-in)", () => {
  const PORT_KEY = "port-idempotency-key";
  const BRIDGE_KEY = "cs_paid:bridge:port-1";

  function seedPortRow(rest: ReturnType<typeof setup>["rest"]) {
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      source: "ported",
      provisioning_key: PORT_KEY,
      country: "US",
    });
  }

  it("provisions the bridge even though the port's own ported row exists", async () => {
    const { env, rest, telnyx } = setup();
    seedPortRow(rest);
    happyPathTelnyx(telnyx);

    const row = await provisionCompanyNumber(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: BRIDGE_KEY,
      bridge: true,
    });

    expect(row).not.toBeNull();
    expect(row?.status).toBe("active");
    expect(row?.number_e164).toBe("+12125550123");
    expect(row?.provisioning_key).toBe(BRIDGE_KEY);
    expect(row?.source).toBe("provisioned"); // a bridge is a NORMAL bought number

    // The port row is untouched — its saga still owns it.
    const rows = rest.rows("phone_numbers");
    expect(rows).toHaveLength(2);
    const ported = rows.find((r) => r.source === "ported");
    expect(ported?.status).toBe("provisioning");
    expect(ported?.number_e164 ?? null).toBeNull();
  });

  it("duplicate bridge deliveries converge on ONE bridge row (provisioning_key idempotency)", async () => {
    const { env, rest, telnyx } = setup();
    seedPortRow(rest);
    happyPathTelnyx(telnyx);

    const first = await provisionCompanyNumber(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: BRIDGE_KEY,
      bridge: true,
    });
    const second = await provisionCompanyNumber(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: BRIDGE_KEY,
      bridge: true,
    });

    expect(second?.id).toBe(first?.id);
    expect(telnyx.callsTo("POST", /number_orders/)).toHaveLength(1);
    expect(rest.rows("phone_numbers")).toHaveLength(2); // ported + ONE bridge
  });

  it("a bridge call still skips when a foreign PROVISIONED number exists (§9 guard kept)", async () => {
    // Resubscribe-within-grace shape: the company already holds a live bought
    // number under a previous key — it can already text, so buying a bridge
    // would be a silent cost leak.
    const { env, rest, telnyx } = setup();
    seedPortRow(rest);
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      provisioning_key: "cs_previous",
      country: "US",
      number_e164: "+12125550999",
      telnyx_phone_number_id: "pn-old",
    });

    const result = await provisionCompanyNumber(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: BRIDGE_KEY,
      bridge: true,
    });
    expect(result).toBeNull();
    expect(rest.rows("phone_numbers")).toHaveLength(2); // nothing new inserted
    expect(telnyx.calls).toHaveLength(0);
  });
});

describe("S2 region fallback (§4.3)", () => {
  it("falls back to the NANP region when the area code has no inventory", async () => {
    const { env, telnyx } = setup();
    telnyx.on("POST", /^\/v2\/messaging_profiles$/, () => ({ data: { id: "profile-1" } }));
    telnyx.on("GET", /^\/v2\/available_phone_numbers$/, (call) => {
      if (call.query.get("filter[national_destination_code]") === "212") {
        return { data: [] };
      }
      if (call.query.get("filter[administrative_area]") === "NY") {
        return { data: [{ phone_number: "+13475550123" }] };
      }
      return { data: [] };
    });
    telnyx.on("POST", /^\/v2\/number_orders$/, () => ({
      data: {
        id: "order-2",
        status: "success",
        phone_numbers: [{ phone_number: "+13475550123" }],
      },
    }));
    telnyx.on("GET", /^\/v2\/phone_numbers$/, (call) => {
      // The orphan-adoption pre-step (customer_reference listing) sees no
      // orphan; the post-order id lookup resolves the purchased number.
      if (call.query.get("filter[phone_number]") === "+13475550123") {
        return { data: [{ id: "pn-2", phone_number: "+13475550123" }] };
      }
      return { data: [] };
    });

    const row = await provisionCompanyNumber(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: CHECKOUT,
    });
    expect(row?.status).toBe("active");
    expect(row?.number_e164).toBe("+13475550123");

    const searches = telnyx.callsTo("GET", /available_phone_numbers/);
    expect(searches).toHaveLength(2);
    // 212 is New York — the shared NANP table drives the fallback region.
    expect(searches[1].query.get("filter[administrative_area]")).toBe("NY");
    expect(searches[1].query.get("filter[national_destination_code]")).toBeNull();
  });
});

describe("S2 no-inventory 400 (Telnyx code 10031) is not fatal", () => {
  // Telnyx answers an unsatisfiable filter with a 400 (code 10031), NOT an
  // empty 200 — the real failure that stranded a paid company on an exhausted
  // area code (416 Toronto). The saga must fall through, not abort.
  it("falls back to the region when the NDC search 400s with no inventory", async () => {
    const { env, telnyx } = setup();
    telnyx.on("POST", /^\/v2\/messaging_profiles$/, () => ({ data: { id: "profile-1" } }));
    telnyx.on("GET", /^\/v2\/available_phone_numbers$/, (call) => {
      if (call.query.get("filter[national_destination_code]") === "212") {
        return telnyxError(400, "10031");
      }
      if (call.query.get("filter[administrative_area]") === "NY") {
        return { data: [{ phone_number: "+13475550123" }] };
      }
      return { data: [] };
    });
    telnyx.on("POST", /^\/v2\/number_orders$/, () => ({
      data: { id: "order-2", status: "success", phone_numbers: [{ phone_number: "+13475550123" }] },
    }));
    telnyx.on("GET", /^\/v2\/phone_numbers$/, (call) =>
      call.query.get("filter[phone_number]") === "+13475550123"
        ? { data: [{ id: "pn-2", phone_number: "+13475550123" }] }
        : { data: [] },
    );

    const row = await provisionCompanyNumber(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: CHECKOUT,
    });
    expect(row?.status).toBe("active");
    expect(row?.number_e164).toBe("+13475550123");
    expect(telnyx.callsTo("GET", /available_phone_numbers/)).toHaveLength(2);
  });

  it("falls back to a country-wide search when NDC and region both 400", async () => {
    const { env, telnyx } = setup();
    telnyx.on("POST", /^\/v2\/messaging_profiles$/, () => ({ data: { id: "profile-1" } }));
    telnyx.on("GET", /^\/v2\/available_phone_numbers$/, (call) => {
      if (
        call.query.get("filter[national_destination_code]") ||
        call.query.get("filter[administrative_area]")
      ) {
        return telnyxError(400, "10031");
      }
      return { data: [{ phone_number: "+16045550111" }] };
    });
    telnyx.on("POST", /^\/v2\/number_orders$/, () => ({
      data: { id: "order-3", status: "success", phone_numbers: [{ phone_number: "+16045550111" }] },
    }));
    telnyx.on("GET", /^\/v2\/phone_numbers$/, (call) =>
      call.query.get("filter[phone_number]") === "+16045550111"
        ? { data: [{ id: "pn-3", phone_number: "+16045550111" }] }
        : { data: [] },
    );

    const row = await provisionCompanyNumber(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: CHECKOUT,
    });
    expect(row?.status).toBe("active");
    expect(row?.number_e164).toBe("+16045550111");
    const searches = telnyx.callsTo("GET", /available_phone_numbers/);
    expect(searches).toHaveLength(3);
    // Final search drops geography but keeps features strict (never unusable).
    expect(searches[2].query.get("filter[national_destination_code]")).toBeNull();
    expect(searches[2].query.get("filter[administrative_area]")).toBeNull();
    expect(searches[2].query.get("filter[features]")).toBe("sms");
    expect(searches[2].query.get("filter[phone_number_type]")).toBe("local");
  });

  it("records provision_failed only when every search 400s with no inventory", async () => {
    const { env, telnyx } = setup();
    telnyx.on("POST", /^\/v2\/messaging_profiles$/, () => ({ data: { id: "profile-1" } }));
    telnyx.on("GET", /^\/v2\/available_phone_numbers$/, () => telnyxError(400, "10031"));
    telnyx.on("GET", /^\/v2\/phone_numbers$/, () => ({ data: [] }));

    const row = await provisionCompanyNumber(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: CHECKOUT,
    });
    expect(row?.status).toBe("provision_failed");
    expect(row?.last_provision_error).toContain("no US inventory");
    expect(telnyx.callsTo("GET", /available_phone_numbers/)).toHaveLength(3);
  });

  it("propagates a non-inventory error (503) instead of falling through", async () => {
    const { env, telnyx } = setup();
    telnyx.on("POST", /^\/v2\/messaging_profiles$/, () => ({ data: { id: "profile-1" } }));
    telnyx.on("GET", /^\/v2\/available_phone_numbers$/, () =>
      telnyxError(503, "service_unavailable"),
    );
    telnyx.on("GET", /^\/v2\/phone_numbers$/, () => ({ data: [] }));

    const row = await provisionCompanyNumber(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: CHECKOUT,
    });
    // A transient 503 aborts the saga (the §11 cron retries) — it must NOT be
    // swallowed as "no inventory", so only the first (NDC) search runs.
    expect(row?.status).toBe("provision_failed");
    expect(telnyx.callsTo("GET", /available_phone_numbers/)).toHaveLength(1);
  });
});

describe("chosen-number ordering (choose-your-number)", () => {
  it("orders the EXACT chosen number and skips the inventory search", async () => {
    const { env, rest, telnyx } = setup();
    telnyx.on("POST", /^\/v2\/messaging_profiles$/, () => ({ data: { id: "profile-1" } }));
    // Deliberately NO available_phone_numbers handler: if the saga searches,
    // the mock 404s and the test fails — proving the chosen number is ordered
    // directly.
    telnyx.on("POST", /^\/v2\/number_orders$/, () => ({
      data: {
        id: "order-c",
        status: "success",
        phone_numbers: [{ phone_number: "+12125550188" }],
      },
    }));
    telnyx.on("GET", /^\/v2\/phone_numbers$/, (call) =>
      call.query.get("filter[phone_number]") === "+12125550188"
        ? { data: [{ id: "pn-c", phone_number: "+12125550188" }] }
        : { data: [] },
    );
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      provisioning_key: "cs_choose",
      country: "US",
      requested_area_code: "212",
      chosen_number_e164: "+12125550188",
    });
    const row = rest.rows("phone_numbers").at(-1) as unknown as PhoneNumberRow;

    const result = await resumeProvisioning(env, row);
    expect(result.status).toBe("active");
    expect(result.number_e164).toBe("+12125550188");
    const order = telnyx.callsTo("POST", /number_orders/)[0];
    expect(order.body).toMatchObject({
      phone_numbers: [{ phone_number: "+12125550188" }],
    });
    expect(telnyx.callsTo("GET", /available_phone_numbers/)).toHaveLength(0);
    // The pick is consumed on success.
    expect(result.chosen_number_e164).toBeNull();
  });

  it("falls back to an in-region search when the chosen number is taken (4xx), never double-buying", async () => {
    const { env, rest, telnyx } = setup();
    telnyx.on("POST", /^\/v2\/messaging_profiles$/, () => ({ data: { id: "profile-1" } }));
    telnyx.on("POST", /^\/v2\/number_orders$/, (call) => {
      const num = (call.body as { phone_numbers: { phone_number: string }[] })
        .phone_numbers[0].phone_number;
      // The chosen number was taken in the seconds since the pick.
      if (num === "+12125550188") return telnyxError(422, "10015");
      return {
        data: { id: "order-f", status: "success", phone_numbers: [{ phone_number: num }] },
      };
    });
    telnyx.on("GET", /^\/v2\/available_phone_numbers$/, (call) =>
      call.query.get("filter[national_destination_code]") === "212"
        ? { data: [{ phone_number: "+12125550200" }] }
        : { data: [] },
    );
    telnyx.on("GET", /^\/v2\/phone_numbers$/, (call) =>
      call.query.get("filter[phone_number]") === "+12125550200"
        ? { data: [{ id: "pn-f", phone_number: "+12125550200" }] }
        : { data: [] },
    );
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      provisioning_key: "cs_taken",
      country: "US",
      requested_area_code: "212",
      chosen_number_e164: "+12125550188",
    });
    const row = rest.rows("phone_numbers").at(-1) as unknown as PhoneNumberRow;

    const result = await resumeProvisioning(env, row);
    expect(result.status).toBe("active");
    // A nearby local number in the SAME area code the user picked from.
    expect(result.number_e164).toBe("+12125550200");
    // Exactly two order attempts: the taken pick, then the fallback — never a
    // duplicate of a successful order.
    expect(telnyx.callsTo("POST", /number_orders/)).toHaveLength(2);
    const search = telnyx.callsTo("GET", /available_phone_numbers/)[0];
    expect(search.query.get("filter[national_destination_code]")).toBe("212");
  });
});

describe("masked inventory (numbers not orderable at this Telnyx account level)", () => {
  it("never orders a masked number — fails honestly instead of looping on 10027", async () => {
    const { env, telnyx } = setup();
    telnyx.on("POST", /^\/v2\/messaging_profiles$/, () => ({ data: { id: "profile-1" } }));
    // Telnyx MASKS un-orderable inventory (as it does for Canada): "+18253------".
    telnyx.on("GET", /^\/v2\/available_phone_numbers$/, () => ({
      data: [
        { phone_number: "+18253------" },
        { phone_number: "+18253------" },
      ],
    }));
    telnyx.on("GET", /^\/v2\/phone_numbers$/, () => ({ data: [] }));

    const row = await provisionCompanyNumber(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: CHECKOUT,
    });
    expect(row?.status).toBe("provision_failed");
    // The masked number is NEVER ordered — no 10027 loop, no false "still setting up".
    expect(telnyx.callsTo("POST", /number_orders/)).toHaveLength(0);
    expect(row?.provision_failure_reason).toBe("no_inventory");
    expect(row?.last_provision_error).toContain("masked");
  });
});

describe("failure handling (§4.3)", () => {
  it("records provision_failed + emails the owner on the first failure", async () => {
    const { env, rest, telnyx, emails } = setup();
    telnyx.on("POST", /^\/v2\/messaging_profiles$/, () => ({ data: { id: "profile-1" } }));
    telnyx.on("GET", /^\/v2\/available_phone_numbers$/, () => ({ data: [] }));
    telnyx.on("GET", /^\/v2\/phone_numbers$/, () => ({ data: [] }));

    const row = await provisionCompanyNumber(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: CHECKOUT,
    });
    expect(row?.status).toBe("provision_failed");
    expect(row?.provision_attempts).toBe(1);
    expect(row?.last_provision_error).toContain("no US inventory");
    // Classified into a coarse, customer-safe reason for the honest-status UI.
    expect(row?.provision_failure_reason).toBe("no_inventory");

    expect(emails).toHaveLength(1);
    expect(emails[0].to).toContain("owner@acme.example");
    expect(emails[0].subject).toContain("still setting up");
    expect(emails[0].text).toContain("You don't need to do anything");

    // A later failure does NOT email again.
    const stored = rest.rows("phone_numbers")[0] as unknown as PhoneNumberRow;
    await resumeProvisioning(env, stored);
    expect(emails).toHaveLength(1);
  });

  it("preserves telnyx_order_id on a transient order-GET failure (no double purchase)", async () => {
    const { env, rest, telnyx } = setup();
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      provisioning_key: CHECKOUT,
      requested_area_code: "212",
      country: "US",
      telnyx_order_id: "order-inflight",
    });
    // The order may still be PENDING at Telnyx; the recovery GET fails transiently.
    telnyx.on("GET", /^\/v2\/number_orders\/order-inflight$/, () =>
      telnyxError(503, "service_unavailable"),
    );

    const stored = rest.rows("phone_numbers")[0] as unknown as PhoneNumberRow;
    const row = await resumeProvisioning(env, stored);

    // The failure is recorded, but the order id is KEPT so the next retry
    // re-GETs the SAME order — never orders a second number against a possibly
    // still-succeeding one.
    expect(row.status).toBe("provision_failed");
    expect(row.telnyx_order_id).toBe("order-inflight");
    expect(rest.rows("phone_numbers")[0].telnyx_order_id).toBe("order-inflight");
    // Crucially: no fresh number order was placed during this failed resume.
    expect(telnyx.callsTo("POST", /number_orders/)).toHaveLength(0);
  });

  it("clears telnyx_order_id when Telnyx authoritatively reports the order dead", async () => {
    const { env, rest, telnyx } = setup();
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      provisioning_key: CHECKOUT,
      requested_area_code: "212",
      country: "US",
      telnyx_order_id: "order-dead",
    });
    // Telnyx says the order failed — no live order to double-buy against.
    telnyx.on("GET", /^\/v2\/number_orders\/order-dead$/, () => ({
      data: { id: "order-dead", status: "failed", phone_numbers: [] },
    }));

    const stored = rest.rows("phone_numbers")[0] as unknown as PhoneNumberRow;
    const row = await resumeProvisioning(env, stored);

    // The dead order id is cleared so the retry path can order fresh.
    expect(row.telnyx_order_id).toBeNull();
    expect(rest.rows("phone_numbers")[0].telnyx_order_id).toBeNull();
  });
});

describe("reconcileNumbers — §11 crash-window recovery", () => {
  it("completes a row whose order id was persisted before a crash", async () => {
    const { env, rest, telnyx } = setup();
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      provisioning_key: CHECKOUT,
      requested_area_code: "212",
      country: "US",
      telnyx_order_id: "order-9",
      updated_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    telnyx.on("GET", /^\/v2\/number_orders\/order-9$/, () => ({
      data: {
        id: "order-9",
        status: "success",
        phone_numbers: [{ phone_number: "+12125550777" }],
      },
    }));
    telnyx.on("GET", /^\/v2\/phone_numbers$/, () => ({
      data: [
        {
          id: "pn-9",
          phone_number: "+12125550777",
          customer_reference: COMPANY_ID,
        },
      ],
      meta: { total_pages: 1 },
    }));

    const summary = await reconcileNumbers(env);
    expect(summary.retried).toBe(1);
    expect(summary.activated).toBe(1);
    expect(summary.orphansFlagged).toBe(0);

    const row = rest.rows("phone_numbers")[0];
    expect(row.status).toBe("active");
    expect(row.number_e164).toBe("+12125550777");
    expect(row.telnyx_phone_number_id).toBe("pn-9");
  });

  it("adopts a customer_reference orphan instead of ordering again", async () => {
    const { env, rest, telnyx } = setup();
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      provisioning_key: CHECKOUT,
      requested_area_code: "212",
      country: "US",
      updated_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    telnyx.on("GET", /^\/v2\/phone_numbers$/, () => ({
      data: [
        {
          id: "pn-7",
          phone_number: "+12125550444",
          customer_reference: COMPANY_ID,
        },
      ],
      meta: { total_pages: 1 },
    }));

    const summary = await reconcileNumbers(env);
    expect(summary.activated).toBe(1);
    const row = rest.rows("phone_numbers")[0];
    expect(row.status).toBe("active");
    expect(row.telnyx_phone_number_id).toBe("pn-7");
    // Adopted — never searched, never ordered.
    expect(telnyx.callsTo("POST", /number_orders/)).toHaveLength(0);
    expect(telnyx.callsTo("GET", /available_phone_numbers/)).toHaveLength(0);
  });

  it("respects the exponential backoff and the 5-attempt budget", async () => {
    const { env, rest, telnyx } = setup();
    // Fresh failure (attempts=3, updated seconds ago) → backoff not elapsed.
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provision_failed",
      provisioning_key: "key-a",
      country: "US",
      provision_attempts: 3,
    });
    // Budget exhausted → never retried.
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provision_failed",
      provisioning_key: "key-b",
      country: "US",
      provision_attempts: 5,
      updated_at: new Date(Date.now() - 86_400_000).toISOString(),
    });
    telnyx.on("GET", /^\/v2\/phone_numbers$/, () => ({
      data: [],
      meta: { total_pages: 1 },
    }));

    const summary = await reconcileNumbers(env);
    expect(summary.retried).toBe(0);
  });

  it("skips canceled companies and flags unknown Telnyx-side numbers", async () => {
    const { env, rest, telnyx } = setup({ subscription_status: "canceled" });
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      provisioning_key: CHECKOUT,
      country: "US",
      updated_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    telnyx.on("GET", /^\/v2\/phone_numbers$/, () => ({
      data: [
        { id: "pn-mystery", phone_number: "+15555550123", customer_reference: null },
      ],
      meta: { total_pages: 1 },
    }));

    const summary = await reconcileNumbers(env);
    expect(summary.retried).toBe(0); // canceled → grace path owns it
    expect(summary.orphansFlagged).toBe(1);
  });

  it("never touches ported/hosted rows waiting on their own sagas", async () => {
    const { env, rest, telnyx } = setup();
    // A port sits at status='provisioning' for the whole multi-week transfer;
    // a hosted (text-enablement) row for the multi-day carrier review. The buy
    // saga running on either would ORDER A NEW NUMBER and overwrite the
    // owner's own number_e164 — the exact keep-your-number betrayal.
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      source: "ported",
      provisioning_key: "port-key",
      country: "US",
      number_e164: "+16135550100",
      updated_at: new Date(Date.now() - 86_400_000).toISOString(),
    });
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      source: "hosted",
      provisioning_key: "hosted-key",
      country: "US",
      number_e164: "+16135550200",
      updated_at: new Date(Date.now() - 86_400_000).toISOString(),
    });
    telnyx.on("GET", /^\/v2\/phone_numbers$/, () => ({
      data: [],
      meta: { total_pages: 1 },
    }));

    const summary = await reconcileNumbers(env);
    expect(summary.retried).toBe(0);
    expect(telnyx.callsTo("POST", /number_orders/)).toHaveLength(0);
    expect(telnyx.callsTo("GET", /available_phone_numbers/)).toHaveLength(0);
    for (const row of rest.rows("phone_numbers")) {
      expect(row.status).toBe("provisioning"); // untouched
      expect(row.number_e164).toMatch(/^\+1613555/); // never overwritten
    }
  });
});

describe("double-order fail-safes (§4.3)", () => {
  it("the loser of a concurrent race orders NOTHING (per-row lease held)", async () => {
    // Simulate the PRIMARY race: thread A already holds the lease on the row.
    // Thread B (this resume) must return the row untouched and place NO order —
    // one paid slot, at most one number_order.
    const { env, rest, telnyx } = setup();
    happyPathTelnyx(telnyx);
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      provisioning_key: CHECKOUT,
      requested_area_code: "212",
      country: "US",
      // A live lease held by the concurrent winner (3 minutes out).
      provisioning_lease_until: new Date(Date.now() + 180_000).toISOString(),
    });
    const row = rest.rows("phone_numbers")[0] as unknown as PhoneNumberRow;

    const result = await resumeProvisioning(env, row);

    expect(result.status).toBe("provisioning"); // untouched
    expect(result.number_e164 ?? null).toBeNull();
    // The whole point: the loser never searched, never ordered.
    expect(telnyx.callsTo("POST", /number_orders/)).toHaveLength(0);
    expect(telnyx.callsTo("GET", /available_phone_numbers/)).toHaveLength(0);
  });

  it("releases the lease on activation so a later resume can proceed", async () => {
    const { env, rest, telnyx } = setup();
    happyPathTelnyx(telnyx);
    const row = await provisionCompanyNumber(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: CHECKOUT,
    });
    expect(row?.status).toBe("active");
    // Lease cleared on the terminal success — nothing waits on it.
    expect(rest.rows("phone_numbers")[0].provisioning_lease_until).toBeNull();
  });

  it("sends a deterministic Idempotency-Key on the order POST, matching the persisted key", async () => {
    const { env, rest, telnyx } = setup();
    happyPathTelnyx(telnyx);
    await provisionCompanyNumber(env, {
      companyId: COMPANY_ID,
      checkoutSessionId: CHECKOUT,
    });
    const order = telnyx.callsTo("POST", /number_orders/)[0];
    const sentKey = order.headers.get("Idempotency-Key");
    expect(sentKey).toBeTruthy();
    // The exact key the row claimed BEFORE the POST — a crash-retry replays it.
    expect(sentKey).toBe(
      rest.rows("phone_numbers")[0].telnyx_order_idempotency_key,
    );
  });

  it("uses a FRESH idempotency key for the taken-fallback order (never deduped against the rejected pick)", async () => {
    const { env, rest, telnyx } = setup();
    telnyx.on("POST", /^\/v2\/messaging_profiles$/, () => ({ data: { id: "profile-1" } }));
    telnyx.on("POST", /^\/v2\/number_orders$/, (call) => {
      const num = (call.body as { phone_numbers: { phone_number: string }[] })
        .phone_numbers[0].phone_number;
      if (num === "+12125550188") return telnyxError(422, "10015"); // chosen taken
      return {
        data: { id: "order-f", status: "success", phone_numbers: [{ phone_number: num }] },
      };
    });
    telnyx.on("GET", /^\/v2\/available_phone_numbers$/, () => ({
      data: [{ phone_number: "+12125550200" }],
    }));
    telnyx.on("GET", /^\/v2\/phone_numbers$/, (call) =>
      call.query.get("filter[phone_number]") === "+12125550200"
        ? { data: [{ id: "pn-f", phone_number: "+12125550200" }] }
        : { data: [] },
    );
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      provisioning_key: "cs_taken",
      country: "US",
      requested_area_code: "212",
      chosen_number_e164: "+12125550188",
    });
    const row = rest.rows("phone_numbers").at(-1) as unknown as PhoneNumberRow;

    await resumeProvisioning(env, row);

    const orders = telnyx.callsTo("POST", /number_orders/);
    expect(orders).toHaveLength(2);
    const rejectedKey = orders[0].headers.get("Idempotency-Key");
    const fallbackKey = orders[1].headers.get("Idempotency-Key");
    expect(rejectedKey).toBeTruthy();
    expect(fallbackKey).toBeTruthy();
    // Distinct keys: the fallback is a genuinely new order, not a replay.
    expect(fallbackKey).not.toBe(rejectedKey);
  });

  it("clears the idempotency key when the order is authoritatively dead (fresh key on reorder)", async () => {
    const { env, rest, telnyx } = setup();
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      provisioning_key: CHECKOUT,
      requested_area_code: "212",
      country: "US",
      telnyx_order_id: "order-dead",
      telnyx_order_idempotency_key: "key-dead",
    });
    telnyx.on("GET", /^\/v2\/number_orders\/order-dead$/, () => ({
      data: { id: "order-dead", status: "failed", phone_numbers: [] },
    }));

    const stored = rest.rows("phone_numbers")[0] as unknown as PhoneNumberRow;
    await resumeProvisioning(env, stored);

    // Both the dead order id AND its key are cleared, so the retry orders fresh
    // instead of replaying (and re-reading) the failed order.
    expect(rest.rows("phone_numbers")[0].telnyx_order_id).toBeNull();
    expect(rest.rows("phone_numbers")[0].telnyx_order_idempotency_key).toBeNull();
  });

  it("reclaims a double-buy orphan owned by a SETTLED company with nothing in flight", async () => {
    const { env, rest, telnyx } = setup();
    // The company already holds its live number (settled) and has no provisioning
    // row — yet Telnyx reports an EXTRA number tagged to it: a pre-lease double-buy.
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      provisioning_key: CHECKOUT,
      country: "US",
      number_e164: "+12125550001",
      telnyx_phone_number_id: "pn-live",
    });
    let deleted: string | null = null;
    telnyx.on("GET", /^\/v2\/phone_numbers$/, () => ({
      data: [
        { id: "pn-live", phone_number: "+12125550001", customer_reference: COMPANY_ID },
        { id: "pn-orphan", phone_number: "+12125550999", customer_reference: COMPANY_ID },
      ],
      meta: { total_pages: 1 },
    }));
    telnyx.on("DELETE", /^\/v2\/phone_numbers\/pn-orphan$/, () => {
      deleted = "pn-orphan";
      return new Response(null, { status: 204 });
    });

    const summary = await reconcileNumbers(env);
    expect(summary.orphansReleased).toBe(1);
    expect(summary.orphansFlagged).toBe(0);
    expect(deleted).toBe("pn-orphan"); // the extra number was reclaimed
  });

  it("NEVER deletes an orphan while the company still has a row provisioning", async () => {
    const { env, rest, telnyx } = setup();
    // The company is BOTH settled (a live number) AND mid-provisioning a second
    // one (Pro). The unknown number may be exactly what the provisioning row is
    // about to adopt — deleting it would be catastrophic, so only flag it. This
    // exercises the in-flight guard specifically (settled alone would reclaim).
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      provisioning_key: "cs_live",
      country: "US",
      number_e164: "+12125550001",
      telnyx_phone_number_id: "pn-live",
    });
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "provisioning",
      provisioning_key: CHECKOUT,
      country: "US",
      updated_at: new Date().toISOString(), // fresh → retry loop skips (backoff)
      provision_attempts: 1,
    });
    telnyx.on("GET", /^\/v2\/phone_numbers$/, () => ({
      data: [
        { id: "pn-live", phone_number: "+12125550001", customer_reference: COMPANY_ID },
        { id: "pn-maybe", phone_number: "+12125550999", customer_reference: COMPANY_ID },
      ],
      meta: { total_pages: 1 },
    }));

    const summary = await reconcileNumbers(env);
    expect(summary.orphansReleased).toBe(0);
    expect(summary.orphansFlagged).toBe(1); // pn-maybe flagged, pn-live known
    expect(telnyx.callsTo("DELETE", /phone_numbers/)).toHaveLength(0);
  });
});

describe("resumeProvisioning — source guard", () => {
  it("refuses to run the buy saga on a non-provisioned row", async () => {
    const { env, telnyx } = setup();
    const hosted = {
      id: "33333333-3333-4333-8333-333333333333",
      company_id: COMPANY_ID,
      status: "provisioning",
      source: "hosted",
      provisioning_key: "hosted-key",
      requested_area_code: null,
      country: "US",
      number_e164: "+16135550200",
      telnyx_phone_number_id: null,
      telnyx_order_id: null,
      provision_attempts: 0,
      last_provision_error: null,
    } as unknown as PhoneNumberRow;

    const row = await resumeProvisioning(env, hosted);
    expect(row).toEqual(hosted); // returned untouched
    expect(telnyx.calls).toHaveLength(0); // no Telnyx traffic at all
  });
});

describe("suspend / release", () => {
  it("suspends active numbers app-side (no Telnyx call)", async () => {
    const { env, rest, telnyx } = setup();
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      provisioning_key: CHECKOUT,
      country: "US",
      number_e164: "+12125550123",
      telnyx_phone_number_id: "pn-1",
    });

    const suspended = await suspendCompanyNumbers(env, COMPANY_ID);
    expect(suspended).toHaveLength(1);
    expect(rest.rows("phone_numbers")[0].status).toBe("suspended");
    expect(rest.rows("phone_numbers")[0].suspended_at).toBeTruthy();
    expect(telnyx.calls).toHaveLength(0);
  });

  it("releases every non-released number, tolerating Telnyx 404", async () => {
    const { env, rest, telnyx } = setup();
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      provisioning_key: "k1",
      country: "US",
      number_e164: "+12125550001",
      telnyx_phone_number_id: "pn-1",
    });
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "suspended",
      provisioning_key: "k2",
      country: "US",
      number_e164: "+12125550002",
      telnyx_phone_number_id: "pn-2",
    });
    telnyx.on("DELETE", /^\/v2\/phone_numbers\/pn-1$/, () => new Response(null, { status: 204 }));
    telnyx.on("DELETE", /^\/v2\/phone_numbers\/pn-2$/, () => telnyxError(404, "10005"));

    const released = await releaseCompanyNumbers(env, COMPANY_ID);
    expect(released).toHaveLength(2);
    for (const row of rest.rows("phone_numbers")) {
      expect(row.status).toBe("released");
      expect(row.released_at).toBeTruthy();
    }
  });

  it("keeps a row un-released when the Telnyx release genuinely fails", async () => {
    const { env, rest, telnyx } = setup();
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      provisioning_key: "k1",
      country: "US",
      number_e164: "+12125550001",
      telnyx_phone_number_id: "pn-1",
    });
    telnyx.on("DELETE", /^\/v2\/phone_numbers\/pn-1$/, () => telnyxError(500, "10000"));

    await expect(releaseCompanyNumbers(env, COMPANY_ID)).rejects.toThrow(
      /release failed/,
    );
    expect(rest.rows("phone_numbers")[0].status).toBe("active");
  });
});
