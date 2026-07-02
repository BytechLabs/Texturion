import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deactivateCampaign,
  getSendGates,
  handle10dlcEvent,
  nudgeSoleProprietorOtp,
  pollRegistrations,
  submitRegistration,
  type RegistrationRow,
} from "./registration";
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

const REGISTRATION_DEFAULTS = {
  status: "draft",
  sole_proprietor: false,
  telnyx_id: null,
  data: {},
  rejection_reason: null,
  submission_count: 0,
  submitted_at: null,
  approved_at: null,
  rejected_at: null,
  deactivated_at: null,
  otp_nudged_at: null,
};

const BRAND_DATA = {
  displayName: "Acme Plumbing",
  companyName: "Acme Plumbing LLC",
  ein: "12-3456789",
  email: "owner@acme.example",
  phone: "+12125550100",
  vertical: "PROFESSIONAL",
  street: "1 Main St",
  city: "New York",
  state: "NY",
  postalCode: "10001",
  country: "US",
  website: "https://acme.example",
};

const SOLE_PROP_DATA = {
  displayName: "Pat's Plumbing",
  firstName: "Pat",
  lastName: "Doe",
  ein: "1234",
  mobilePhone: "+12125550111",
  email: "pat@acme.example",
  phone: "+12125550100",
  vertical: "PROFESSIONAL",
  street: "1 Main St",
  city: "New York",
  state: "NY",
  postalCode: "10001",
  country: "US",
};

const CAMPAIGN_DATA = {
  messageFlow:
    "Customers text our business number first, or ask us in person / by phone to text them. We never send marketing blasts.",
  sample1:
    "Hi, this is Acme Plumbing — we can come Tuesday at 3pm, does that work for you?",
  sample2:
    "Your appointment is confirmed for tomorrow at 9am. Reply STOP to opt out.",
};

function setup(companyOverrides: Record<string, unknown> = {}) {
  const env = completeEnv();
  const rest = new FakeRest(env);
  rest.table("companies");
  rest.table("messaging_registrations", REGISTRATION_DEFAULTS);
  rest.table("phone_numbers", {
    status: "active",
    number_e164: null,
    telnyx_phone_number_id: null,
  });
  rest.table("company_members");
  rest.user(OWNER_ID, "owner@acme.example");
  rest.insert("companies", {
    id: COMPANY_ID,
    name: "Acme Plumbing",
    country: "US",
    us_texting_enabled: true,
    subscription_status: "active",
    requested_area_code: "212",
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

function seedRows(
  rest: FakeRest,
  brand: Record<string, unknown>,
  campaign: Record<string, unknown>,
) {
  const brandRow = rest.insert("messaging_registrations", {
    company_id: COMPANY_ID,
    kind: "brand",
    data: BRAND_DATA,
    ...brand,
  });
  const campaignRow = rest.insert("messaging_registrations", {
    company_id: COMPANY_ID,
    kind: "campaign",
    data: CAMPAIGN_DATA,
    ...campaign,
  });
  return { brandRow, campaignRow };
}

function brandRowOf(rest: FakeRest): RegistrationRow {
  return rest
    .rows("messaging_registrations")
    .find((row) => row.kind === "brand") as unknown as RegistrationRow;
}

function campaignRowOf(rest: FakeRest): RegistrationRow {
  return rest
    .rows("messaging_registrations")
    .find((row) => row.kind === "campaign") as unknown as RegistrationRow;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("submitRegistration — R1 (§4.4)", () => {
  it("submits a standard brand with the §4.4 field mapping", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(rest, {}, {});
    telnyx.on("POST", /^\/v2\/10dlc\/brand$/, () => ({
      data: { brandId: "brand-1" },
    }));

    const result = await submitRegistration(env, COMPANY_ID);
    expect(result.action).toBe("brand_submitted");

    const call = telnyx.callsTo("POST", /^\/v2\/10dlc\/brand$/)[0];
    expect(call.body).toMatchObject({
      entityType: "PRIVATE_PROFIT",
      companyName: "Acme Plumbing LLC",
      displayName: "Acme Plumbing",
      ein: "12-3456789",
      street: "1 Main St",
      city: "New York",
      state: "NY",
      postalCode: "10001",
      country: "US",
      email: "owner@acme.example",
      phone: "+12125550100",
      website: "https://acme.example",
      vertical: "PROFESSIONAL",
      webhookURL: "https://api.jobtext.app/webhooks/telnyx",
      webhookFailoverURL: "https://api.jobtext.app/webhooks/telnyx",
    });

    const brand = brandRowOf(rest);
    expect(brand.status).toBe("submitted");
    expect(brand.telnyx_id).toBe("brand-1");
    expect(brand.submission_count).toBe(1);
    expect(brand.submitted_at).toBeTruthy();
    // Standard path: no OTP.
    expect(telnyx.callsTo("POST", /smsOtp/)).toHaveLength(0);
  });

  it("submits a sole-prop brand and immediately triggers the OTP (§4.2)", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(rest, { data: SOLE_PROP_DATA, sole_proprietor: true }, {});
    telnyx.on("POST", /^\/v2\/10dlc\/brand$/, () => ({ brandId: "brand-sp" }));
    telnyx.on("POST", /^\/v2\/10dlc\/brand\/brand-sp\/smsOtp$/, () => ({}));

    const result = await submitRegistration(env, COMPANY_ID);
    expect(result.action).toBe("brand_submitted");

    const call = telnyx.callsTo("POST", /^\/v2\/10dlc\/brand$/)[0];
    expect(call.body).toMatchObject({
      entityType: "SOLE_PROPRIETOR",
      firstName: "Pat",
      lastName: "Doe",
      ein: "1234",
      mobilePhone: "+12125550111",
    });
    expect((call.body as Record<string, unknown>).companyName).toBeUndefined();

    expect(telnyx.callsTo("POST", /brand-sp\/smsOtp$/)).toHaveLength(1);
    const brand = brandRowOf(rest);
    expect(brand.status).toBe("submitted");
    expect(brand.sole_proprietor).toBe(true);
  });

  it("resubmits a rejected brand via PUT against the same brandId", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      { status: "rejected", telnyx_id: "brand-1", rejection_reason: "bad EIN", submission_count: 1 },
      {},
    );
    telnyx.on("PUT", /^\/v2\/10dlc\/brand\/brand-1$/, () => ({ brandId: "brand-1" }));

    const result = await submitRegistration(env, COMPANY_ID);
    expect(result.action).toBe("brand_submitted");
    expect(telnyx.callsTo("POST", /^\/v2\/10dlc\/brand$/)).toHaveLength(0);
    expect(telnyx.callsTo("PUT", /^\/v2\/10dlc\/brand\/brand-1$/)).toHaveLength(1);

    const brand = brandRowOf(rest);
    expect(brand.status).toBe("submitted");
    expect(brand.submission_count).toBe(2);
    expect(brand.rejection_reason).toBeNull();
  });

  it("noops with a reason when the wizard data is incomplete", async () => {
    const { env, rest } = setup();
    seedRows(rest, { data: { displayName: "only this" } }, {});
    const result = await submitRegistration(env, COMPANY_ID);
    expect(result.action).toBe("noop");
    if (result.action === "noop") {
      expect(result.reason).toContain("Brand draft data is incomplete");
    }
  });

  it("noops for CA companies with us_texting_enabled=false (§4.2)", async () => {
    const { env, rest } = setup({ country: "CA", us_texting_enabled: false });
    seedRows(rest, {}, {});
    const result = await submitRegistration(env, COMPANY_ID);
    expect(result.action).toBe("noop");
  });

  it("noops while the brand is under review (idempotent checkout replays)", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(rest, { status: "pending", telnyx_id: "brand-1", submission_count: 1 }, {});
    const result = await submitRegistration(env, COMPANY_ID);
    expect(result.action).toBe("noop");
    expect(telnyx.calls).toHaveLength(0);
  });
});

describe("handle10dlcEvent — §4.4 webhook mapping", () => {
  function brandEvent(payload: Record<string, unknown>) {
    return {
      data: {
        event_type: "10dlc.brand.update",
        id: "evt-1",
        payload: { brandId: "brand-1", ...payload },
      },
    };
  }
  function campaignEvent(payload: Record<string, unknown>) {
    return {
      data: {
        event_type: "10dlc.campaign.update",
        id: "evt-2",
        payload: { campaignId: "camp-1", ...payload },
      },
    };
  }

  it("submitted → pending on the first in-review brand event", async () => {
    const { env, rest } = setup();
    seedRows(rest, { status: "submitted", telnyx_id: "brand-1" }, {});
    await handle10dlcEvent(
      env,
      brandEvent({ type: "REGISTRATION", identityStatus: "PENDING" }),
    );
    expect(brandRowOf(rest).status).toBe("pending");
  });

  it("brand VERIFIED → approved, and R2 submits the campaign", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(rest, { status: "pending", telnyx_id: "brand-1" }, {});
    telnyx.on("POST", /^\/v2\/10dlc\/campaignBuilder$/, () => ({
      data: { campaignId: "camp-1" },
    }));

    await handle10dlcEvent(env, brandEvent({ identityStatus: "VERIFIED" }));

    expect(brandRowOf(rest).status).toBe("approved");
    expect(brandRowOf(rest).approved_at).toBeTruthy();

    const builder = telnyx.callsTo("POST", /campaignBuilder/)[0];
    expect(builder.body).toMatchObject({
      brandId: "brand-1",
      usecase: "LOW_VOLUME",
      autoRenewal: true,
      messageFlow: CAMPAIGN_DATA.messageFlow,
      sample1: CAMPAIGN_DATA.sample1,
      sample2: CAMPAIGN_DATA.sample2,
      optinKeywords: "START",
      optoutKeywords: "STOP",
      helpKeywords: "HELP",
      helpMessage:
        "Acme Plumbing: reply STOP to opt out. Contact us at +12125550100.",
      embeddedLink: false,
      numberPool: false,
      ageGated: false,
    });

    const campaign = campaignRowOf(rest);
    expect(campaign.status).toBe("submitted");
    expect(campaign.telnyx_id).toBe("camp-1");
    expect(campaign.submission_count).toBe(1);
  });

  it("sole-prop brand approval submits a SOLE_PROPRIETOR campaign", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      {
        status: "submitted",
        telnyx_id: "brand-1",
        sole_proprietor: true,
        data: SOLE_PROP_DATA,
      },
      {},
    );
    telnyx.on("POST", /^\/v2\/10dlc\/campaignBuilder$/, () => ({
      data: { campaignId: "camp-1" },
    }));
    await handle10dlcEvent(env, brandEvent({ identityStatus: "VERIFIED" }));
    const builder = telnyx.callsTo("POST", /campaignBuilder/)[0];
    expect((builder.body as Record<string, unknown>).usecase).toBe(
      "SOLE_PROPRIETOR",
    );
  });

  it("brand failure → rejected with reasons + rejection email (R4)", async () => {
    const { env, rest, emails } = setup();
    seedRows(rest, { status: "pending", telnyx_id: "brand-1" }, {});
    await handle10dlcEvent(
      env,
      brandEvent({
        type: "REGISTRATION",
        status: "FAILED",
        reasons: [{ fields: ["ein"], description: "EIN does not match records" }],
      }),
    );
    const brand = brandRowOf(rest);
    expect(brand.status).toBe("rejected");
    expect(brand.rejection_reason).toContain("EIN does not match records");
    expect(brand.rejected_at).toBeTruthy();
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toContain("needs a fix");
    expect(emails[0].text).toContain("EIN does not match records");
  });

  it("campaign TELNYX_REVIEW → pending", async () => {
    const { env, rest } = setup();
    seedRows(rest, {}, { status: "submitted", telnyx_id: "camp-1" });
    await handle10dlcEvent(env, campaignEvent({ type: "TELNYX_REVIEW" }));
    expect(campaignRowOf(rest).status).toBe("pending");
  });

  it("campaign MNO_REVIEW ACCEPTED → approved: assigns numbers + emails (R3)", async () => {
    const { env, rest, telnyx, emails } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      { status: "pending", telnyx_id: "camp-1" },
    );
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      provisioning_key: "cs_1",
      country: "US",
      number_e164: "+12125550123",
    });
    telnyx.on("POST", /^\/v2\/10dlc\/phoneNumberCampaign$/, () => ({}));

    await handle10dlcEvent(
      env,
      campaignEvent({ type: "MNO_REVIEW", status: "ACCEPTED" }),
    );

    const campaign = campaignRowOf(rest);
    expect(campaign.status).toBe("approved");
    expect(campaign.approved_at).toBeTruthy();

    const assignment = telnyx.callsTo("POST", /phoneNumberCampaign/)[0];
    expect(assignment.body).toEqual({
      phoneNumber: "+12125550123",
      campaignId: "camp-1",
    });
    expect(
      (campaign.data as { numberAssignments: Record<string, string> })
        .numberAssignments["+12125550123"],
    ).toBe("pending");

    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toContain("US texting is live");
    expect(emails[0].to).toContain("owner@acme.example");
  });

  it("a duplicate approval event neither re-assigns nor re-emails", async () => {
    const { env, rest, telnyx, emails } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      { status: "pending", telnyx_id: "camp-1" },
    );
    telnyx.on("POST", /^\/v2\/10dlc\/phoneNumberCampaign$/, () => ({}));
    const event = campaignEvent({ type: "MNO_REVIEW", status: "ACCEPTED" });
    await handle10dlcEvent(env, event);
    await handle10dlcEvent(env, event);
    expect(emails).toHaveLength(1);
    expect(campaignRowOf(rest).status).toBe("approved");
  });

  it("campaign REJECTED → rejected + email with the reason", async () => {
    const { env, rest, emails } = setup();
    seedRows(rest, {}, { status: "pending", telnyx_id: "camp-1" });
    await handle10dlcEvent(
      env,
      campaignEvent({
        type: "MNO_REVIEW",
        status: "REJECTED",
        reasons: ["Message flow does not describe opt-in"],
      }),
    );
    const campaign = campaignRowOf(rest);
    expect(campaign.status).toBe("rejected");
    expect(campaign.rejection_reason).toContain("does not describe opt-in");
    expect(emails).toHaveLength(1);
  });

  it("10dlc.phone_number.update ADDED / FAILED updates the assignment ledger", async () => {
    const { env, rest } = setup();
    seedRows(
      rest,
      {},
      {
        status: "approved",
        telnyx_id: "camp-1",
        data: {
          ...CAMPAIGN_DATA,
          numberAssignments: { "+12125550123": "pending" },
        },
      },
    );
    await handle10dlcEvent(env, {
      data: {
        event_type: "10dlc.phone_number.update",
        payload: {
          campaignId: "camp-1",
          phoneNumber: "+12125550123",
          status: "ADDED",
        },
      },
    });
    let ledger = (campaignRowOf(rest).data as {
      numberAssignments: Record<string, string>;
    }).numberAssignments;
    expect(ledger["+12125550123"]).toBe("added");

    await handle10dlcEvent(env, {
      data: {
        event_type: "10dlc.phone_number.update",
        payload: {
          campaignId: "camp-1",
          phoneNumber: "+12125550123",
          status: "FAILED",
          reasons: ["carrier rejected"],
        },
      },
    });
    ledger = (campaignRowOf(rest).data as {
      numberAssignments: Record<string, string>;
    }).numberAssignments;
    expect(ledger["+12125550123"]).toBe("failed");
  });

  it("ignores unknown event types and unknown brand/campaign ids", async () => {
    const { env, rest } = setup();
    seedRows(rest, { status: "submitted", telnyx_id: "brand-1" }, {});
    await handle10dlcEvent(env, {
      data: { event_type: "message.received", payload: {} },
    });
    await handle10dlcEvent(env, {
      data: {
        event_type: "10dlc.brand.update",
        payload: { brandId: "brand-unknown", identityStatus: "VERIFIED" },
      },
    });
    await handle10dlcEvent(env, { nonsense: true });
    expect(brandRowOf(rest).status).toBe("submitted");
  });

  it("accepts the bare data object as well as the full envelope", async () => {
    const { env, rest } = setup();
    seedRows(rest, { status: "submitted", telnyx_id: "brand-1" }, {});
    await handle10dlcEvent(env, {
      event_type: "10dlc.brand.update",
      payload: { brandId: "brand-1", type: "REGISTRATION" },
    });
    expect(brandRowOf(rest).status).toBe("pending");
  });
});

describe("pollRegistrations — §11 daily fallback", () => {
  it("applies a missed brand approval and recovers R2", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(rest, { status: "submitted", telnyx_id: "brand-1" }, {});
    telnyx.on("GET", /^\/v2\/10dlc\/brand\/brand-1$/, () => ({
      data: { brandId: "brand-1", identityStatus: "VERIFIED" },
    }));
    telnyx.on("POST", /^\/v2\/10dlc\/campaignBuilder$/, () => ({
      data: { campaignId: "camp-1" },
    }));

    const summary = await pollRegistrations(env);
    expect(summary.polled).toBe(1);
    expect(summary.transitioned).toBe(1);
    expect(brandRowOf(rest).status).toBe("approved");
    expect(campaignRowOf(rest).status).toBe("submitted");
  });

  it("applies a missed campaign approval from campaignStatus", async () => {
    const { env, rest, telnyx, emails } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      { status: "pending", telnyx_id: "camp-1" },
    );
    telnyx.on("GET", /^\/v2\/10dlc\/campaign\/camp-1$/, () => ({
      data: { campaignId: "camp-1", campaignStatus: "MNO_ACCEPTED" },
    }));

    await pollRegistrations(env);
    expect(campaignRowOf(rest).status).toBe("approved");
    expect(emails).toHaveLength(1);
  });

  it("applies a missed campaign rejection with failureReasons", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      { status: "submitted", telnyx_id: "camp-1" },
    );
    telnyx.on("GET", /^\/v2\/10dlc\/campaign\/camp-1$/, () => ({
      data: {
        campaignId: "camp-1",
        campaignStatus: "TELNYX_FAILED",
        failureReasons: "sample messages too short",
      },
    }));

    await pollRegistrations(env);
    const campaign = campaignRowOf(rest);
    expect(campaign.status).toBe("rejected");
    expect(campaign.rejection_reason).toContain("too short");
  });

  it("leaves under-review rows alone (no phantom transitions)", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(rest, { status: "pending", telnyx_id: "brand-1" }, {});
    telnyx.on("GET", /^\/v2\/10dlc\/brand\/brand-1$/, () => ({
      data: { brandId: "brand-1", identityStatus: "PENDING" },
    }));
    const summary = await pollRegistrations(env);
    expect(summary.transitioned).toBe(0);
    expect(brandRowOf(rest).status).toBe("pending");
  });

  it("retries failed number assignments on approved campaigns", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      {
        status: "approved",
        telnyx_id: "camp-1",
        data: {
          ...CAMPAIGN_DATA,
          numberAssignments: { "+12125550123": "failed" },
        },
      },
    );
    rest.insert("phone_numbers", {
      company_id: COMPANY_ID,
      status: "active",
      provisioning_key: "cs_1",
      country: "US",
      number_e164: "+12125550123",
    });
    telnyx.on("POST", /^\/v2\/10dlc\/phoneNumberCampaign$/, () => ({}));

    const summary = await pollRegistrations(env);
    expect(summary.assignmentsRetried).toBe(1);
    const ledger = (campaignRowOf(rest).data as {
      numberAssignments: Record<string, string>;
    }).numberAssignments;
    expect(ledger["+12125550123"]).toBe("pending");
    expect(telnyx.callsTo("POST", /phoneNumberCampaign/)).toHaveLength(1);
  });
});

describe("post-grace reactivation (§4.4, §9)", () => {
  it("resubmits against the existing brand, clears deactivated_at, bumps submission_count", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      {
        status: "approved",
        telnyx_id: "camp-old",
        submission_count: 1,
        approved_at: "2026-01-01T00:00:00.000Z",
        deactivated_at: "2026-06-01T00:00:00.000Z",
        data: {
          ...CAMPAIGN_DATA,
          numberAssignments: { "+12125550123": "added" },
        },
      },
    );
    telnyx.on("POST", /^\/v2\/10dlc\/campaignBuilder$/, () => ({
      data: { campaignId: "camp-new" },
    }));

    const result = await submitRegistration(env, COMPANY_ID);
    expect(result.action).toBe("campaign_reactivated");

    const builder = telnyx.callsTo("POST", /campaignBuilder/)[0];
    expect((builder.body as Record<string, unknown>).brandId).toBe("brand-1");

    const campaign = campaignRowOf(rest);
    expect(campaign.status).toBe("submitted");
    expect(campaign.telnyx_id).toBe("camp-new");
    expect(campaign.submission_count).toBe(2);
    expect(campaign.deactivated_at).toBeNull();
    expect(campaign.approved_at).toBeNull();
    expect(
      (campaign.data as { numberAssignments: Record<string, string> })
        .numberAssignments,
    ).toEqual({});
    // Brand row untouched (SPEC: brand row untouched).
    expect(brandRowOf(rest).status).toBe("approved");
  });
});

describe("deactivateCampaign (§11 grace expiry)", () => {
  it("DELETEs the campaign and stamps deactivated_at exactly once", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      { status: "approved", telnyx_id: "camp-1" },
    );
    telnyx.on(
      "DELETE",
      /^\/v2\/10dlc\/campaign\/camp-1$/,
      () => new Response(null, { status: 204 }),
    );

    const first = await deactivateCampaign(env, COMPANY_ID);
    expect(first?.deactivated_at).toBeTruthy();

    const second = await deactivateCampaign(env, COMPANY_ID);
    expect(second?.deactivated_at).toBeTruthy();
    expect(telnyx.callsTo("DELETE", /campaign/)).toHaveLength(1);
  });

  it("tolerates a Telnyx 404 (already gone) and still stamps", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      {},
      { status: "approved", telnyx_id: "camp-1" },
    );
    telnyx.on("DELETE", /^\/v2\/10dlc\/campaign\/camp-1$/, () =>
      telnyxError(404, "10005"),
    );
    const result = await deactivateCampaign(env, COMPANY_ID);
    expect(result?.deactivated_at).toBeTruthy();
  });

  it("returns null when there is no submitted campaign", async () => {
    const { env, rest } = setup();
    seedRows(rest, {}, {}); // both drafts, no telnyx ids
    expect(await deactivateCampaign(env, COMPANY_ID)).toBeNull();
  });
});

describe("getSendGates truth table (contract)", () => {
  const CASES: {
    name: string;
    company: Record<string, unknown>;
    campaign: Record<string, unknown> | null;
    expected: { subscriptionActive: boolean; usApproved: boolean };
  }[] = [
    {
      name: "US active + campaign approved",
      company: { country: "US", subscription_status: "active" },
      campaign: { status: "approved", telnyx_id: "camp-1" },
      expected: { subscriptionActive: true, usApproved: true },
    },
    {
      name: "US active + campaign pending",
      company: { country: "US", subscription_status: "active" },
      campaign: { status: "pending", telnyx_id: "camp-1" },
      expected: { subscriptionActive: true, usApproved: false },
    },
    {
      name: "US active + campaign rejected",
      company: { country: "US", subscription_status: "active" },
      campaign: { status: "rejected", telnyx_id: "camp-1" },
      expected: { subscriptionActive: true, usApproved: false },
    },
    {
      name: "US past_due + campaign approved",
      company: { country: "US", subscription_status: "past_due" },
      campaign: { status: "approved", telnyx_id: "camp-1" },
      expected: { subscriptionActive: false, usApproved: true },
    },
    {
      name: "US canceled + campaign approved but deactivated",
      company: { country: "US", subscription_status: "canceled" },
      campaign: {
        status: "approved",
        telnyx_id: "camp-1",
        deactivated_at: "2026-06-01T00:00:00.000Z",
      },
      expected: { subscriptionActive: false, usApproved: false },
    },
    {
      name: "US active + no campaign row",
      company: { country: "US", subscription_status: "active" },
      campaign: null,
      expected: { subscriptionActive: true, usApproved: false },
    },
    {
      name: "CA active, us_texting_enabled=false (even with a stale approved row)",
      company: {
        country: "CA",
        us_texting_enabled: false,
        subscription_status: "active",
      },
      campaign: { status: "approved", telnyx_id: "camp-1" },
      expected: { subscriptionActive: true, usApproved: false },
    },
    {
      name: "CA active, us_texting_enabled=true + approved",
      company: {
        country: "CA",
        us_texting_enabled: true,
        subscription_status: "active",
      },
      campaign: { status: "approved", telnyx_id: "camp-1" },
      expected: { subscriptionActive: true, usApproved: true },
    },
    {
      name: "CA incomplete, no campaign",
      company: {
        country: "CA",
        us_texting_enabled: false,
        subscription_status: "incomplete",
      },
      campaign: null,
      expected: { subscriptionActive: false, usApproved: false },
    },
  ];

  for (const testCase of CASES) {
    it(testCase.name, async () => {
      const { env, rest } = setup(testCase.company);
      if (testCase.campaign) {
        rest.insert("messaging_registrations", {
          company_id: COMPANY_ID,
          kind: "campaign",
          data: CAMPAIGN_DATA,
          ...testCase.campaign,
        });
      }
      const gates = await getSendGates(env, COMPANY_ID);
      expect(gates.subscriptionActive).toBe(testCase.expected.subscriptionActive);
      expect(gates.usApproved).toBe(testCase.expected.usApproved);
      // §4.2: CA-bound sends carry no registration gate — always true.
      expect(gates.caAllowed).toBe(true);
    });
  }
});

describe("nudgeSoleProprietorOtp (§4.2, §11)", () => {
  it("sends exactly one nudge per submission, 12h after submission", async () => {
    const { env, rest, emails } = setup();
    seedRows(
      rest,
      {
        status: "submitted",
        telnyx_id: "brand-sp",
        sole_proprietor: true,
        data: SOLE_PROP_DATA,
        submitted_at: new Date(Date.now() - 13 * 3600_000).toISOString(),
      },
      {},
    );

    expect(await nudgeSoleProprietorOtp(env)).toBe(1);
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toContain("One step left");
    expect(brandRowOf(rest).otp_nudged_at).toBeTruthy();

    // Idempotent: the stamp blocks a second nudge.
    expect(await nudgeSoleProprietorOtp(env)).toBe(0);
    expect(emails).toHaveLength(1);
  });

  it("does not nudge before 12h or after verification", async () => {
    const { env, rest, emails } = setup();
    seedRows(
      rest,
      {
        status: "submitted",
        telnyx_id: "brand-sp",
        sole_proprietor: true,
        submitted_at: new Date(Date.now() - 3600_000).toISOString(),
      },
      {},
    );
    expect(await nudgeSoleProprietorOtp(env)).toBe(0);
    expect(emails).toHaveLength(0);
  });
});
