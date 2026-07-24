import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deactivateCampaign,
  getSendGates,
  handle10dlcEvent,
  MAX_CAMPAIGN_REACTIVATIONS,
  MAX_CAMPAIGN_SUBMISSIONS,
  nudgeSoleProprietorOtp,
  pollRegistrations,
  retryCampaignAssignments,
  submitRegistration,
  updateCampaignContent,
  type RegistrationRow,
} from "./registration";
import {
  FakeRest,
  resendRoute,
  TelnyxMock,
  telnyxError,
  type SentEmailCapture,
} from "./test-support";
import { POSTHOG_CAPTURE_URL } from "../analytics/posthog";
import { getDb } from "../db";
import type { Env } from "../env";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";

const REGISTRATION_DEFAULTS = {
  status: "draft",
  sole_proprietor: false,
  telnyx_id: null,
  data: {},
  rejection_reason: null,
  submission_count: 0,
  reactivation_count: 0,
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

/**
 * Faithful simulator of the 20260707170000 `bump_registration_counter` RPC
 * (#40): a guarded increment that stops AT the cap without incrementing.
 */
function registerBumpRpc(rest: FakeRest) {
  rest.rpc("bump_registration_counter", (args) => {
    const counter = args.p_counter as string;
    const cap = args.p_cap as number;
    const row = rest
      .rows("messaging_registrations")
      .find(
        (candidate) =>
          candidate.id === args.p_row_id &&
          candidate.company_id === args.p_company_id,
      );
    if (!row) return { allowed: false };
    const current = (row[counter] as number) ?? 0;
    if (current >= cap) return { allowed: false };
    row[counter] = current + 1;
    return { allowed: true, count: current + 1 };
  });
}

/**
 * Faithful simulator of the 20260724010000 `merge_number_assignment` RPC: a
 * per-key merge of one number's status (+ optional failure-notified stamp) into
 * the row's data ledgers, mirroring the single jsonb UPDATE.
 */
function registerMergeNumberAssignmentRpc(rest: FakeRest) {
  rest.rpc("merge_number_assignment", (args) => {
    const row = rest
      .rows("messaging_registrations")
      .find(
        (candidate) =>
          candidate.id === args.p_row_id &&
          candidate.company_id === args.p_company_id,
      );
    if (!row) return null;
    const data = (row.data ?? {}) as Record<string, unknown>;
    const assignments = {
      ...((data.numberAssignments as Record<string, unknown>) ?? {}),
      [args.p_phone as string]: args.p_status,
    };
    const notified = {
      ...((data.assignmentFailureNotified as Record<string, unknown>) ?? {}),
    };
    if (args.p_clear_notified) {
      delete notified[args.p_phone as string];
    } else if (args.p_notified_at != null) {
      notified[args.p_phone as string] = args.p_notified_at;
    }
    row.data = {
      ...data,
      numberAssignments: assignments,
      assignmentFailureNotified: notified,
    };
    return null;
  });
}

function setup(companyOverrides: Record<string, unknown> = {}) {
  const env = completeEnv();
  const rest = new FakeRest(env);
  rest.table("companies");
  rest.table("messaging_registrations", REGISTRATION_DEFAULTS);
  registerBumpRpc(rest);
  registerMergeNumberAssignmentRpc(rest);
  rest.table("phone_numbers", {
    status: "active",
    number_e164: null,
    telnyx_phone_number_id: null,
  });
  // Read by the assignment-FAILED branch (§9: is the stuck number a port?).
  rest.table("port_requests", { status: "ported" });
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
    // #51: the create path first checks for an adoptable orphan brand.
    telnyx.on("GET", /^\/v2\/10dlc\/brand$/, () => ({ records: [] }));
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
      webhookURL: "https://api.loonext.com/webhooks/telnyx",
      webhookFailoverURL: "https://api.loonext.com/webhooks/telnyx",
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
    telnyx.on("GET", /^\/v2\/10dlc\/brand$/, () => ({ records: [] }));
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
      // Step 0c: the review ask is DECLARED content — brand name in the body,
      // review deep-link domain visible, embedded links on.
      sample3:
        "Thanks for choosing Acme Plumbing! A quick Google review means a lot: " +
        "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4",
      optinKeywords: "START",
      optoutKeywords: "STOP",
      helpKeywords: "HELP",
      helpMessage:
        "Acme Plumbing: reply STOP to opt out. Contact us at +12125550100.",
      embeddedLink: true,
      numberPool: false,
      ageGated: false,
    });
    expect(
      (builder.body as { description: string }).description,
    ).toContain("post-service review requests");

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
    const { env, rest, emails } = setup();
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
    // Not a ported number (no port_requests row) → the §9 port guidance email
    // does not apply; the failure still lands in Sentry + the ledger.
    expect(emails).toHaveLength(0);
  });

  // PORTING.md §8.2/§9: the assignment-FAILED guidance must actually reach the
  // customer — one email at the transition into FAILED, never per retry.
  describe("assignment FAILED for a ported number — one-shot §9 email", () => {
    const FAILED_EVENT = {
      data: {
        event_type: "10dlc.phone_number.update",
        payload: {
          campaignId: "camp-1",
          phoneNumber: "+12125550123",
          status: "FAILED",
          reasons: ["number is registered to another campaign"],
        },
      },
    };
    const ADDED_EVENT = {
      data: {
        event_type: "10dlc.phone_number.update",
        payload: {
          campaignId: "camp-1",
          phoneNumber: "+12125550123",
          status: "ADDED",
        },
      },
    };

    function seedPortedNumber(rest: FakeRest) {
      seedRows(
        rest,
        { status: "approved", telnyx_id: "brand-1" },
        {
          status: "approved",
          telnyx_id: "camp-1",
          data: {
            ...CAMPAIGN_DATA,
            numberAssignments: { "+12125550123": "pending" },
          },
        },
      );
      rest.insert("port_requests", {
        company_id: COMPANY_ID,
        phone_e164: "+12125550123",
        status: "ported",
      });
      rest.insert("phone_numbers", {
        company_id: COMPANY_ID,
        status: "active",
        provisioning_key: "cs_1",
        country: "US",
        number_e164: "+12125550123",
      });
    }

    it("emails the §9 guidance exactly once across redelivery AND the retry cycle", async () => {
      const { env, rest, telnyx, emails } = setup();
      seedPortedNumber(rest);
      telnyx.on("POST", /^\/v2\/10dlc\/phoneNumberCampaign$/, () => ({}));

      await handle10dlcEvent(env, FAILED_EVENT);
      expect(emails).toHaveLength(1);
      expect(emails[0].subject).toBe(
        "Action needed to finish activating texting",
      );
      expect(emails[0].text).toContain(
        "ask your previous texting provider to remove +12125550123 from their carrier campaign",
      );
      expect(emails[0].text).toContain("retry automatically");
      expect(emails[0].to).toContain("owner@acme.example");

      // Duplicate webhook delivery → no second email.
      await handle10dlcEvent(env, FAILED_EVENT);
      expect(emails).toHaveLength(1);

      // Full §4.4 retry cycle: the cron clears `failed`, re-assigns (ledger →
      // pending), the carrier FAILs it again. The persistent stamp — not the
      // cycling ledger — gates the email.
      await retryCampaignAssignments(env);
      expect(
        (campaignRowOf(rest).data as {
          numberAssignments: Record<string, string>;
        }).numberAssignments["+12125550123"],
      ).toBe("pending");
      await handle10dlcEvent(env, FAILED_EVENT);
      expect(emails).toHaveLength(1);
      expect(
        (campaignRowOf(rest).data as {
          numberAssignments: Record<string, string>;
        }).numberAssignments["+12125550123"],
      ).toBe("failed");
    });

    it("a later success (ADDED) clears the stamp — a NEW failure incident notifies again", async () => {
      const { env, rest, emails } = setup();
      seedPortedNumber(rest);

      await handle10dlcEvent(env, FAILED_EVENT);
      expect(emails).toHaveLength(1);
      await handle10dlcEvent(env, ADDED_EVENT);
      await handle10dlcEvent(env, FAILED_EVENT);
      expect(emails).toHaveLength(2);
    });
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
    telnyx.on("PUT", /^\/v2\/10dlc\/campaign\/camp-1$/, () => ({}));

    const summary = await pollRegistrations(env);
    expect(campaignRowOf(rest).status).toBe("approved");
    expect(emails).toHaveLength(1);
    // Step 0c: the freshly-approved campaign has no remote sample3 yet, so
    // the same poll run migrates its content.
    expect(summary.contentUpdated).toBe(1);
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
    // Remote content already migrated (sample3 present) → Step 0c no-op.
    telnyx.on("GET", /^\/v2\/10dlc\/campaign\/camp-1$/, () => ({
      data: { campaignId: "camp-1", sample3: "already-declared review sample" },
    }));

    const summary = await pollRegistrations(env);
    expect(summary.assignmentsRetried).toBe(1);
    expect(summary.contentUpdated).toBe(0);
    const ledger = (campaignRowOf(rest).data as {
      numberAssignments: Record<string, string>;
    }).numberAssignments;
    expect(ledger["+12125550123"]).toBe("pending");
    expect(telnyx.callsTo("POST", /phoneNumberCampaign/)).toHaveLength(1);
  });
});

describe("updateCampaignContent — Step 0c content migration", () => {
  const EXPECTED_SAMPLE3 =
    "Thanks for choosing Acme Plumbing! A quick Google review means a lot: " +
    "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4";

  it("PUTs ONLY the update-schema sample fields when the remote campaign has no sample3", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      { status: "approved", telnyx_id: "camp-1" },
    );
    telnyx.on("GET", /^\/v2\/10dlc\/campaign\/camp-1$/, () => ({
      data: {
        campaignId: "camp-1",
        embeddedLink: false,
        sample1: CAMPAIGN_DATA.sample1,
        sample2: CAMPAIGN_DATA.sample2,
      },
    }));
    telnyx.on("PUT", /^\/v2\/10dlc\/campaign\/camp-1$/, () => ({}));

    const sent = await updateCampaignContent(env, getDb(env), campaignRowOf(rest));
    expect(sent).toBe(true);

    // Telnyx's UpdateCampaignRequest accepts only resellerId / sample1..5 /
    // messageFlow / helpMessage / autoRenewal / webhook URLs — and only the
    // samples are actually editable after registration — so the PUT body is
    // exactly the sample block: no create-only description/embeddedLink, no
    // identity fields.
    const put = telnyx.callsTo("PUT", /^\/v2\/10dlc\/campaign\/camp-1$/)[0];
    expect(put.body).toEqual({
      sample1: CAMPAIGN_DATA.sample1,
      sample2: CAMPAIGN_DATA.sample2,
      sample3: EXPECTED_SAMPLE3,
    });
    const body = put.body as Record<string, unknown>;
    expect(body.description).toBeUndefined();
    expect(body.messageFlow).toBeUndefined();
    expect(body.embeddedLink).toBeUndefined();
    expect(body.brandId).toBeUndefined();
    expect(body.usecase).toBeUndefined();
  });

  it("truncates legacy >255-char samples to the update schema's cap", async () => {
    // The CREATE path (and the wizard) allow samples up to 1024 chars, but
    // UpdateCampaignRequest caps every sampleN at 255 — an unclamped PUT
    // would 422 forever for this campaign.
    const longSample1 = `Hi, this is Acme Plumbing. ${"We can come Tuesday at 3pm. ".repeat(12)}`;
    expect(longSample1.length).toBeGreaterThan(255);
    expect(longSample1.length).toBeLessThanOrEqual(1024);

    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      {
        status: "approved",
        telnyx_id: "camp-1",
        data: { ...CAMPAIGN_DATA, sample1: longSample1 },
      },
    );
    telnyx.on("GET", /^\/v2\/10dlc\/campaign\/camp-1$/, () => ({
      data: { campaignId: "camp-1" },
    }));
    telnyx.on("PUT", /^\/v2\/10dlc\/campaign\/camp-1$/, () => ({}));

    const sent = await updateCampaignContent(env, getDb(env), campaignRowOf(rest));
    expect(sent).toBe(true);

    const body = telnyx.callsTo("PUT", /^\/v2\/10dlc\/campaign\/camp-1$/)[0]
      .body as Record<string, string>;
    expect(body.sample1).toBe(longSample1.trim().slice(0, 255));
    expect(body.sample1.length).toBe(255);
    expect(body.sample2).toBe(CAMPAIGN_DATA.sample2);
    expect(body.sample3.length).toBeLessThanOrEqual(255);
  });

  it("swallows a Telnyx 422 on the PUT (reports, returns false) instead of throwing", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      { status: "approved", telnyx_id: "camp-1" },
    );
    telnyx.on("GET", /^\/v2\/10dlc\/campaign\/camp-1$/, () => ({
      data: { campaignId: "camp-1" },
    }));
    telnyx.on("PUT", /^\/v2\/10dlc\/campaign\/camp-1$/, () =>
      telnyxError(422, "10015", "sample rejected"),
    );

    const sent = await updateCampaignContent(env, getDb(env), campaignRowOf(rest));
    expect(sent).toBe(false);
    expect(telnyx.callsTo("PUT", /^\/v2\/10dlc\/campaign\/camp-1$/)).toHaveLength(1);
  });

  it("still propagates non-422 PUT failures (the poll must retry outages)", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      { status: "approved", telnyx_id: "camp-1" },
    );
    telnyx.on("GET", /^\/v2\/10dlc\/campaign\/camp-1$/, () => ({
      data: { campaignId: "camp-1" },
    }));
    telnyx.on("PUT", /^\/v2\/10dlc\/campaign\/camp-1$/, () =>
      telnyxError(500, "internal", "boom"),
    );

    await expect(
      updateCampaignContent(env, getDb(env), campaignRowOf(rest)),
    ).rejects.toThrow("Telnyx 500");
  });

  it("one campaign whose content PUT 422s cannot poison pollRegistrations", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      { status: "approved", telnyx_id: "camp-1" },
    );
    telnyx.on("GET", /^\/v2\/10dlc\/campaign\/camp-1$/, () => ({
      data: { campaignId: "camp-1" },
    }));
    telnyx.on("PUT", /^\/v2\/10dlc\/campaign\/camp-1$/, () =>
      telnyxError(422, "10015", "sample rejected"),
    );

    const summary = await pollRegistrations(env); // must NOT throw AggregateError
    expect(summary.contentUpdated).toBe(0);
  });

  it("no-ops when the remote campaign already declares a sample3", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      { status: "approved", telnyx_id: "camp-1" },
    );
    telnyx.on("GET", /^\/v2\/10dlc\/campaign\/camp-1$/, () => ({
      data: { campaignId: "camp-1", sample3: EXPECTED_SAMPLE3 },
    }));

    const sent = await updateCampaignContent(env, getDb(env), campaignRowOf(rest));
    expect(sent).toBe(false);
    expect(telnyx.callsTo("PUT", /campaign/)).toHaveLength(0);
  });

  it("does not PUT when the stored campaign draft is incomplete", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      { status: "approved", telnyx_id: "camp-1", data: {} },
    );
    telnyx.on("GET", /^\/v2\/10dlc\/campaign\/camp-1$/, () => ({
      data: { campaignId: "camp-1" },
    }));

    const sent = await updateCampaignContent(env, getDb(env), campaignRowOf(rest));
    expect(sent).toBe(false);
    expect(telnyx.callsTo("PUT", /campaign/)).toHaveLength(0);
  });

  it("pollRegistrations migrates a stale campaign once, then converges", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      { status: "approved", telnyx_id: "camp-1" },
    );
    // Stateful remote: no sample3 until the migration PUT lands it.
    let remoteSample3: string | undefined;
    telnyx.on("GET", /^\/v2\/10dlc\/campaign\/camp-1$/, () => ({
      data: {
        campaignId: "camp-1",
        ...(remoteSample3 ? { sample3: remoteSample3 } : {}),
      },
    }));
    telnyx.on("PUT", /^\/v2\/10dlc\/campaign\/camp-1$/, (call) => {
      remoteSample3 = (call.body as { sample3?: string }).sample3;
      return {};
    });

    const first = await pollRegistrations(env);
    expect(first.contentUpdated).toBe(1);

    const second = await pollRegistrations(env);
    expect(second.contentUpdated).toBe(0);
    expect(telnyx.callsTo("PUT", /^\/v2\/10dlc\/campaign\/camp-1$/)).toHaveLength(1);
  });

  it("skips deactivated campaigns in the poll migration", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      {
        status: "approved",
        telnyx_id: "camp-1",
        deactivated_at: "2026-06-01T00:00:00.000Z",
      },
    );
    const summary = await pollRegistrations(env);
    expect(summary.contentUpdated).toBe(0);
    expect(telnyx.callsTo("GET", /campaign/)).toHaveLength(0);
  });
});

describe("post-grace reactivation (§4.4, §9)", () => {
  it("resubmits against the existing brand, clears deactivated_at, bumps reactivation_count", async () => {
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
    // #40: a reactivation consumes its OWN budget — the review-cycle
    // submission_count is untouched.
    expect(campaign.submission_count).toBe(1);
    expect(campaign.reactivation_count).toBe(1);
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

describe("#40 lifetime campaign-submission budget (cap-and-drop)", () => {
  it("consuming the second-to-last review unit sends the alert-before-the-cap email", async () => {
    const { env, rest, telnyx, emails } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      {
        status: "rejected",
        telnyx_id: "camp-old",
        submission_count: MAX_CAMPAIGN_SUBMISSIONS - 2,
        rejection_reason: "flow unclear",
      },
    );
    telnyx.on("POST", /^\/v2\/10dlc\/campaignBuilder$/, () => ({
      data: { campaignId: "camp-new" },
    }));

    const result = await submitRegistration(env, COMPANY_ID);
    expect(result.action).toBe("campaign_submitted");
    expect(campaignRowOf(rest).submission_count).toBe(
      MAX_CAMPAIGN_SUBMISSIONS - 1,
    );
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toBe(
      "Heads up: one carrier-review submission left",
    );
    expect(emails[0].to).toContain("owner@acme.example");
  });

  it("blocks at the cap BEFORE any Telnyx call, one-shot email, 'contact support' reason", async () => {
    const { env, rest, telnyx, emails } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      {
        status: "rejected",
        telnyx_id: "camp-old",
        submission_count: MAX_CAMPAIGN_SUBMISSIONS,
        rejection_reason: "flow unclear",
      },
    );

    const result = await submitRegistration(env, COMPANY_ID);
    expect(result.action).toBe("noop");
    if (result.action === "noop") {
      expect(result.reason).toContain("contact support");
    }
    // No silent spend: the paid campaignBuilder POST never happened.
    expect(telnyx.callsTo("POST", /campaignBuilder/)).toHaveLength(0);
    expect(campaignRowOf(rest).submission_count).toBe(MAX_CAMPAIGN_SUBMISSIONS);

    // Terminal-state owner notification — exactly once across retries.
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toBe("Your US texting registration needs our help");
    expect(
      (campaignRowOf(rest).data as { submissionCapNotifiedAt?: string })
        .submissionCapNotifiedAt,
    ).toBeTruthy();

    const again = await submitRegistration(env, COMPANY_ID);
    expect(again.action).toBe("noop");
    expect(emails).toHaveLength(1);
    expect(telnyx.callsTo("POST", /campaignBuilder/)).toHaveLength(0);
  });

  it("reactivation consumes its OWN budget — an exhausted review budget does not block it", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      {
        status: "approved",
        telnyx_id: "camp-old",
        submission_count: MAX_CAMPAIGN_SUBMISSIONS,
        deactivated_at: "2026-06-01T00:00:00.000Z",
      },
    );
    telnyx.on("POST", /^\/v2\/10dlc\/campaignBuilder$/, () => ({
      data: { campaignId: "camp-new" },
    }));

    const result = await submitRegistration(env, COMPANY_ID);
    expect(result.action).toBe("campaign_reactivated");
    const campaign = campaignRowOf(rest);
    expect(campaign.reactivation_count).toBe(1);
    expect(campaign.submission_count).toBe(MAX_CAMPAIGN_SUBMISSIONS);
  });

  it("blocks a reactivation at ITS cap with the same terminal state", async () => {
    const { env, rest, telnyx, emails } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      {
        status: "approved",
        telnyx_id: "camp-old",
        reactivation_count: MAX_CAMPAIGN_REACTIVATIONS,
        deactivated_at: "2026-06-01T00:00:00.000Z",
      },
    );

    const result = await submitRegistration(env, COMPANY_ID);
    expect(result.action).toBe("noop");
    if (result.action === "noop") {
      expect(result.reason).toContain("contact support");
    }
    expect(telnyx.callsTo("POST", /campaignBuilder/)).toHaveLength(0);
    expect(emails).toHaveLength(1);
    expect(
      (campaignRowOf(rest).data as { reactivationCapNotifiedAt?: string })
        .reactivationCapNotifiedAt,
    ).toBeTruthy();
  });

  it("consumes the budget BEFORE the Telnyx call (fail closed on a failed POST)", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(rest, { status: "approved", telnyx_id: "brand-1" }, {});
    telnyx.on("POST", /^\/v2\/10dlc\/campaignBuilder$/, () =>
      telnyxError(500, "internal", "boom"),
    );

    await expect(submitRegistration(env, COMPANY_ID)).rejects.toThrow(
      "Telnyx 500",
    );
    // The unit is spent even though the POST failed — a crash/retry loop can
    // never buy more than the cap's worth of campaigns.
    expect(campaignRowOf(rest).submission_count).toBe(1);
    expect(campaignRowOf(rest).status).toBe("draft");
  });
});

describe("#51 brand-create write-ahead marker + orphan adoption", () => {
  it("stamps the write-ahead marker BEFORE the paid POST (survives a crash)", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(rest, {}, {});
    telnyx.on("GET", /^\/v2\/10dlc\/brand$/, () => ({ records: [] }));
    telnyx.on("POST", /^\/v2\/10dlc\/brand$/, () =>
      telnyxError(500, "internal", "boom"),
    );

    await expect(submitRegistration(env, COMPANY_ID)).rejects.toThrow(
      "Telnyx 500",
    );
    const brand = brandRowOf(rest);
    expect(brand.telnyx_id).toBeNull();
    expect(brand.status).toBe("draft");
    expect(
      (brand.data as { brandSubmitAttemptedAt?: string }).brandSubmitAttemptedAt,
    ).toBeTruthy();

    // The marker never breaks the strict wizard schema: the retry still
    // parses the draft and reaches Telnyx again (a failed parse would have
    // returned a 'Brand draft data is incomplete' noop instead of throwing).
    await expect(submitRegistration(env, COMPANY_ID)).rejects.toThrow(
      "Telnyx 500",
    );
    expect(telnyx.callsTo("POST", /^\/v2\/10dlc\/brand$/)).toHaveLength(2);
  });

  it("adopts the orphan TCR brand on retry instead of buying a duplicate", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      {
        data: {
          ...BRAND_DATA,
          brandSubmitAttemptedAt: "2026-07-07T00:00:00.000Z",
        },
      },
      {},
    );
    telnyx.on("GET", /^\/v2\/10dlc\/brand$/, () => ({
      records: [
        // A foreign brand that happens to share the display name — skipped.
        { brandId: "brand-other", displayName: "Acme Plumbing", ein: "99-9999999" },
        { brandId: "brand-orphan", displayName: "Acme Plumbing", ein: "12-3456789" },
      ],
    }));

    const result = await submitRegistration(env, COMPANY_ID);
    expect(result.action).toBe("brand_submitted");
    // Adopted, never re-bought.
    expect(telnyx.callsTo("POST", /^\/v2\/10dlc\/brand$/)).toHaveLength(0);
    const list = telnyx.callsTo("GET", /^\/v2\/10dlc\/brand$/)[0];
    expect(list.query.get("displayName")).toBe("Acme Plumbing");

    const brand = brandRowOf(rest);
    expect(brand.telnyx_id).toBe("brand-orphan");
    expect(brand.status).toBe("submitted");
    expect(brand.submission_count).toBe(1);
  });

  it("creates fresh when no unclaimed orphan matches displayName + EIN", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      {
        data: {
          ...BRAND_DATA,
          brandSubmitAttemptedAt: "2026-07-07T00:00:00.000Z",
        },
      },
      {},
    );
    telnyx.on("GET", /^\/v2\/10dlc\/brand$/, () => ({
      records: [{ brandId: "brand-other", displayName: "Other Biz", ein: "12-3456789" }],
    }));
    telnyx.on("POST", /^\/v2\/10dlc\/brand$/, () => ({
      data: { brandId: "brand-fresh" },
    }));

    const result = await submitRegistration(env, COMPANY_ID);
    expect(result.action).toBe("brand_submitted");
    expect(telnyx.callsTo("POST", /^\/v2\/10dlc\/brand$/)).toHaveLength(1);
    expect(brandRowOf(rest).telnyx_id).toBe("brand-fresh");
  });

  it("never steals a brand another local row already claims", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(rest, {}, {});
    // A different company's row already tracks brand-orphan.
    rest.insert("messaging_registrations", {
      company_id: "99999999-9999-4999-8999-999999999999",
      kind: "brand",
      status: "approved",
      telnyx_id: "brand-orphan",
      data: {},
    });
    telnyx.on("GET", /^\/v2\/10dlc\/brand$/, () => ({
      records: [
        { brandId: "brand-orphan", displayName: "Acme Plumbing", ein: "12-3456789" },
      ],
    }));
    telnyx.on("POST", /^\/v2\/10dlc\/brand$/, () => ({
      data: { brandId: "brand-fresh" },
    }));

    const result = await submitRegistration(env, COMPANY_ID);
    expect(result.action).toBe("brand_submitted");
    expect(brandRowOf(rest).telnyx_id).toBe("brand-fresh");
  });

  it("fails closed when the orphan listing fails — no blind create POST", async () => {
    const { env, rest, telnyx } = setup();
    seedRows(rest, {}, {});
    telnyx.on("GET", /^\/v2\/10dlc\/brand$/, () =>
      telnyxError(500, "internal", "boom"),
    );

    await expect(submitRegistration(env, COMPANY_ID)).rejects.toThrow(
      "Telnyx 500",
    );
    expect(telnyx.callsTo("POST", /^\/v2\/10dlc\/brand$/)).toHaveLength(0);
    expect(brandRowOf(rest).telnyx_id).toBeNull();
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

describe("PostHog north-star events (§12 step 18)", () => {
  interface PosthogCapture {
    api_key: string;
    event: string;
    distinct_id: string;
    properties: Record<string, unknown>;
  }

  /**
   * Same world as setup(), plus POSTHOG_API_KEY and a capture recorder —
   * self-contained so the analytics assertions never leak into the other
   * suites (whose env has no key, making every capture a silent no-op).
   */
  function setupWithAnalytics(apiKey: string | null = "phc_test_key") {
    const env: Env = {
      ...completeEnv(),
      ...(apiKey ? { POSTHOG_API_KEY: apiKey } : {}),
    };
    const rest = new FakeRest(env);
    rest.table("companies");
    rest.table("messaging_registrations", REGISTRATION_DEFAULTS);
    registerBumpRpc(rest);
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
    });
    rest.insert("company_members", {
      company_id: COMPANY_ID,
      user_id: OWNER_ID,
      role: "owner",
      deactivated_at: null,
    });

    const telnyx = new TelnyxMock();
    const emails: SentEmailCapture[] = [];
    const posthog: PosthogCapture[] = [];
    const posthogRoute: FetchRoute = async (url, request) => {
      if (url.href !== POSTHOG_CAPTURE_URL) return undefined;
      posthog.push((await request.clone().json()) as PosthogCapture);
      return Response.json({ status: 1 });
    };
    stubFetch(rest.route(), telnyx.route(), resendRoute(emails), posthogRoute);
    return { env, rest, telnyx, emails, posthog };
  }

  it("submitRegistration fires registration_submitted with the action", async () => {
    const { env, rest, telnyx, posthog } = setupWithAnalytics();
    seedRows(rest, {}, {});
    telnyx.on("GET", /^\/v2\/10dlc\/brand$/, () => ({ records: [] }));
    telnyx.on("POST", /^\/v2\/10dlc\/brand$/, () => ({
      data: { brandId: "brand-1" },
    }));

    await submitRegistration(env, COMPANY_ID);
    expect(posthog).toHaveLength(1);
    expect(posthog[0]).toEqual({
      api_key: "phc_test_key",
      event: "registration_submitted",
      distinct_id: COMPANY_ID,
      properties: { action: "brand_submitted" },
    });
  });

  it("a noop submission (already under review) fires nothing", async () => {
    const { env, rest, posthog } = setupWithAnalytics();
    seedRows(rest, { status: "pending", telnyx_id: "brand-1" }, {});
    const result = await submitRegistration(env, COMPANY_ID);
    expect(result.action).toBe("noop");
    expect(posthog).toHaveLength(0);
  });

  it("campaign approval fires registration_approved exactly once (duplicate delivery)", async () => {
    const { env, rest, telnyx, posthog } = setupWithAnalytics();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      { status: "pending", telnyx_id: "camp-1" },
    );
    telnyx.on("POST", /^\/v2\/10dlc\/phoneNumberCampaign$/, () => ({}));
    const event = {
      data: {
        event_type: "10dlc.campaign.update",
        id: "evt-approve",
        payload: { campaignId: "camp-1", type: "MNO_REVIEW", status: "ACCEPTED" },
      },
    };

    await handle10dlcEvent(env, event);
    await handle10dlcEvent(env, event); // duplicate → no second transition

    const approvals = posthog.filter((c) => c.event === "registration_approved");
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      distinct_id: COMPANY_ID,
      properties: {},
    });
  });

  it("a brand-only approval does not fire registration_approved", async () => {
    const { env, rest, telnyx, posthog } = setupWithAnalytics();
    seedRows(rest, { status: "pending", telnyx_id: "brand-1" }, {});
    telnyx.on("POST", /^\/v2\/10dlc\/campaignBuilder$/, () => ({
      data: { campaignId: "camp-1" },
    }));

    await handle10dlcEvent(env, {
      data: {
        event_type: "10dlc.brand.update",
        id: "evt-brand",
        payload: { brandId: "brand-1", identityStatus: "VERIFIED" },
      },
    });
    expect(
      posthog.filter((c) => c.event === "registration_approved"),
    ).toHaveLength(0);
  });

  it("stays entirely silent without POSTHOG_API_KEY", async () => {
    const { env, rest, telnyx, posthog } = setupWithAnalytics(null);
    seedRows(rest, {}, {});
    telnyx.on("GET", /^\/v2\/10dlc\/brand$/, () => ({ records: [] }));
    telnyx.on("POST", /^\/v2\/10dlc\/brand$/, () => ({
      data: { brandId: "brand-1" },
    }));

    const result = await submitRegistration(env, COMPANY_ID);
    expect(result.action).toBe("brand_submitted");
    expect(posthog).toHaveLength(0);
  });
});
