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
      webhook_url: "https://api.jobtext.app/webhooks/telnyx",
      webhook_failover_url: "https://api.jobtext.app/webhooks/telnyx",
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

    expect(emails).toHaveLength(1);
    expect(emails[0].to).toContain("owner@acme.example");
    expect(emails[0].subject).toContain("still setting up");
    expect(emails[0].text).toContain("You don't need to do anything");

    // A later failure does NOT email again.
    const stored = rest.rows("phone_numbers")[0] as unknown as PhoneNumberRow;
    await resumeProvisioning(env, stored);
    expect(emails).toHaveLength(1);
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
