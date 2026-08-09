import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  usTextingApprovedWhilePausedCopy,
  usTextingLiveCopy,
} from "./emails";
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
  // #423: the poller re-reads APPROVED registrations now, so a healthy
  // approved row seeded by a test that is about something else gets a GET it
  // did not previously receive. These fallbacks answer it the way a healthy
  // registration actually answers — still verified, still active — and any
  // test that wants a different answer registers `on()` and wins.
  telnyx.fallback("GET", /^\/v2\/10dlc\/brand\/[^/]+$/, () => ({
    identityStatus: "VERIFIED",
  }));
  telnyx.fallback("GET", /^\/v2\/10dlc\/campaign\/[^/]+$/, () => ({
    campaignStatus: "MNO_ACCEPTED",
    status: "ACTIVE",
  }));
  // Step 0c content migration rides the same poll. A suite that is about
  // campaign STATUS should not have to double the content PUT to say so.
  telnyx.fallback("PUT", /^\/v2\/10dlc\/campaign\/[^/]+$/, () => ({}));
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

  it("#581/15: the transition writes only if the row is still where it was read", async () => {
    /**
     * The MECHANISM, asserted on the wire: the update carries the status it judged.
     *
     * Without it the gate is a check-then-act with a Telnyx round trip inside the
     * window. Verifying a sole proprietor's OTP is what makes Telnyx flip the brand,
     * so our own post-verify refresh and the signed webhook describe the same flip —
     * both read `pending`, both pass, and both used to buy a campaign.
     */
    const { env, rest, telnyx, emails } = setup();
    seedRows(rest, { status: "pending", telnyx_id: "brand-1" }, {});
    telnyx.on("POST", /^\/v2\/10dlc\/campaignBuilder$/, () => ({
      data: { campaignId: "camp-1" },
    }));

    const patches: URL[] = [];
    // Records and falls through: returning undefined leaves the fake REST to answer.
    const spy: FetchRoute = (url, request) => {
      if (
        request.method === "PATCH" &&
        url.pathname.endsWith("/messaging_registrations")
      ) {
        patches.push(url);
      }
      return undefined;
    };
    stubFetch(spy, rest.route(), telnyx.route(), resendRoute(emails));

    await handle10dlcEvent(env, brandEvent({ identityStatus: "VERIFIED" }));

    expect(brandRowOf(rest).status).toBe("approved");
    const transition = patches[0];
    expect(transition, "no transition write was made at all").toBeDefined();
    expect(
      transition.searchParams.get("status"),
      "the transition write is unconditional — two triggers reacting to one carrier " +
        "event both pass the gate and both buy a campaign",
    ).toBe("eq.pending");
  });

  it("#581/15: losing that race buys nothing and says nothing", async () => {
    /**
     * The BEHAVIOUR. A second trigger reaches the write and finds the status already
     * moved, so it does nothing at all — no campaign purchase, no "your US texting is
     * live", no second count in the one activation metric D12 rests on.
     *
     * The purchase is the part that lasts. The row keeps only the last campaign id, so
     * a second one exists at the carrier with nothing here pointing at it, and its
     * recurring monthly fee bills forever with nothing tracking it — deactivation can
     * only ever reach the one we recorded.
     */
    const { env, rest, telnyx, emails } = setup();
    seedRows(rest, { status: "pending", telnyx_id: "brand-1" }, {});
    telnyx.on("POST", /^\/v2\/10dlc\/campaignBuilder$/, () => ({
      data: { campaignId: "camp-1" },
    }));

    // Zero rows back: exactly what the database returns to the loser of the swap.
    let lost = false;
    const raceLoser: FetchRoute = (url, request) => {
      if (
        !lost &&
        request.method === "PATCH" &&
        url.pathname.endsWith("/messaging_registrations")
      ) {
        lost = true;
        return Response.json([]);
      }
      return undefined;
    };
    stubFetch(raceLoser, rest.route(), telnyx.route(), resendRoute(emails));

    await handle10dlcEvent(env, brandEvent({ identityStatus: "VERIFIED" }));

    expect(lost, "the transition never attempted a write").toBe(true);
    expect(
      telnyx.callsTo("POST", /campaignBuilder/),
      "bought a campaign on a transition somebody else had already applied",
    ).toHaveLength(0);
    expect(emails).toHaveLength(0);
  });

  it("#581/15: the paid campaign POST carries a deterministic key", async () => {
    // The second line of defence on the one call here that spends money — two sibling
    // Telnyx paths already send one and this sent none. Keyed on the counts as READ,
    // so two racers reacting to the same approval compose the SAME key and Telnyx
    // answers both with the first result, while a legitimate resubmission after a
    // rejection has consumed a unit by then and correctly buys a new campaign.
    const { env, rest, telnyx } = setup();
    const { campaignRow } = seedRows(
      rest,
      { status: "pending", telnyx_id: "brand-1" },
      {},
    );
    telnyx.on("POST", /^\/v2\/10dlc\/campaignBuilder$/, () => ({
      data: { campaignId: "camp-1" },
    }));

    await handle10dlcEvent(env, brandEvent({ identityStatus: "VERIFIED" }));

    const key = telnyx
      .callsTo("POST", /campaignBuilder/)[0]
      .headers.get("Idempotency-Key");
    expect(key, "a paid POST with no idempotency key").toBeTruthy();
    // Derived from the row and its budget counts, so it is stable for one attempt and
    // different for the next one — a bare row id would make a rejected campaign's
    // resubmission a no-op at Telnyx, which is the opposite failure.
    expect(key).toContain(String(campaignRow.id));
    expect(key).toBe(`10dlc-campaign:${campaignRow.id}:review:0:0`);
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

  /**
   * #525 — approval landing on a PAUSED workspace.
   *
   * `POST /v1/registration/enable-us` is deliberately open during a pause: the
   * 3-7 business day carrier wait is free in a quiet winter, and the $29 is
   * charged once per workspace ever. Nothing in this codebase stalls the
   * registration itself — the brand POST, the campaign POST, this approval
   * transition and the number assignment all read no subscription state — so
   * approval reliably lands on a workspace `runPreSendGates` is refusing.
   *
   * Which made the R3 side effects lie at the worst possible moment: an email
   * saying "You can now text US numbers" and a push saying "You can text
   * customers now", sent to somebody who then opens the app and is refused.
   *
   * Asserted against the SHIPPED copy functions, never a phrase retyped here —
   * a guard quoting a string nobody renders cannot fail. Proven by breaking:
   * with the branch removed (`usTextingLiveCopy` unconditionally) the paused
   * case failed on the subject, and with it inverted the unpaused case failed
   * the same way.
   */
  it("#525-1: approval while PAUSED does not tell them they can text", async () => {
    const { env, rest, telnyx, emails } = setup({
      paused_at: "2026-08-01T09:00:00+00:00",
    });
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

    const paused = usTextingApprovedWhilePausedCopy("Acme Plumbing", env);
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toBe(paused.subject);
    // `toContain` because sendOperationalEmail appends the service-message
    // footer; the whole shipped body is still required to be in there.
    expect(emails[0].text).toContain(paused.text);
    // The lie, named. Whatever the words become, the paused email must not be
    // the one that invites somebody to go and text.
    expect(emails[0].subject).not.toBe(
      usTextingLiveCopy("Acme Plumbing", env).subject,
    );

    // AND NOTHING ELSE CHANGES, which is the decision: allow it, disclose it.
    // The campaign is approved and the number is assigned, so a resume in
    // spring sends immediately rather than starting a second carrier wait —
    // the entire reason registering during a pause is worth $29.
    expect(campaignRowOf(rest).status).toBe("approved");
    expect(telnyx.callsTo("POST", /phoneNumberCampaign/)[0].body).toEqual({
      phoneNumber: "+12125550123",
      campaignId: "camp-1",
    });
  });

  it("#525-3: the push is told about the pause too, at the call site", async () => {
    // The email branch and the push branch are two arguments to two different
    // functions, and only one of them was pinned. `pushRegistrationApproved`
    // has its own tests for both copies, so replacing the argument at the CALL
    // SITE with a literal `false` left the entire api suite green - the phone
    // in somebody's pocket would say "You can text customers now" about a plan
    // that cannot send, and the push is the channel they read first.
    //
    // A source lint rather than a behavioural assertion, deliberately: proving
    // it through the push pipeline needs members, prefs and subscriptions
    // seeded for one boolean, and the property here is not "what the push says"
    // (that is covered where the copy lives) but "the call site passes what it
    // computed". A literal is the whole failure mode, so a literal is what this
    // forbids - any literal, not the one that happened to be tried.
    const source = readFileSync(
      join(__dirname, "registration.ts"),
      "utf8",
    );
    const call = /pushRegistrationApproved\(([^)]*)\)/.exec(source);
    expect(call, "the approval push is gone or renamed").not.toBeNull();
    const last = call![1].split(",").at(-1)!.trim();
    expect(
      ["true", "false"],
      `the push is handed the literal \`${last}\`, so it can no longer disagree ` +
        "with the email beside it about whether this workspace is paused",
    ).not.toContain(last);
  });

  it("#525-2: the SAME approval unpaused still says texting is live", async () => {
    // PROVE THE GUARD BY BREAKING IT: one field differs from #525-1, so a green
    // #525-1 cannot be a fixture that would have produced the paused copy for
    // any workspace at all.
    const { env, rest, emails } = setup({ paused_at: null });
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      { status: "pending", telnyx_id: "camp-1" },
    );
    await handle10dlcEvent(
      env,
      campaignEvent({ type: "MNO_REVIEW", status: "ACCEPTED" }),
    );
    expect(emails[0].subject).toBe(
      usTextingLiveCopy("Acme Plumbing", env).subject,
    );
  });

  it("#525-3: an ABSENT pause column is not an accidental pause", async () => {
    // Same posture and same direction as getSendGates SG-3, which reads the
    // very same select (COMPANY_COLUMNS, asserted by SG-4). A wrong "paused"
    // here tells a paying crew to go and resume a plan that is already running,
    // in the one email they have been waiting a week for.
    const { env, rest, emails } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      { status: "pending", telnyx_id: "camp-1" },
    );
    await handle10dlcEvent(
      env,
      campaignEvent({ type: "MNO_REVIEW", status: "ACCEPTED" }),
    );
    expect(emails[0].subject).toBe(
      usTextingLiveCopy("Acme Plumbing", env).subject,
    );
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

describe("#423 — the carrier takes an approved campaign away", () => {
  it("suspends an approved campaign the carrier reports as failed", async () => {
    // `approved` used to be terminal, so this signal was discarded by
    // ALLOWED_TRANSITIONS before anything could act on it — the revocation was
    // undetectable BY CONSTRUCTION rather than by oversight.
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      { status: "approved", telnyx_id: "camp-1", data: CAMPAIGN_DATA },
    );
    telnyx.on("GET", /^\/v2\/10dlc\/campaign\/camp-1$/, () => ({
      campaignStatus: "MNO_REJECTED",
      failureReasons: "Content violates carrier policy",
    }));

    await pollRegistrations(env);

    expect(campaignRowOf(rest).status).toBe("suspended");
    // The carrier's words survive, on the field that already carries "why we
    // may not send" — a second column would just mean one of them goes unread.
    expect(campaignRowOf(rest).rejection_reason).toContain(
      "Content violates carrier policy",
    );
  });

  it("closes the send gate the moment it is suspended", async () => {
    // The whole point. usApproved is what runPreSendGates consults, so a
    // campaign that still read `approved` let every US send through to a
    // carrier that was dropping them.
    const { env, rest } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      { status: "approved", telnyx_id: "camp-1", data: CAMPAIGN_DATA },
    );
    await expect(getSendGates(env, COMPANY_ID)).resolves.toMatchObject({
      usApproved: true,
    });

    campaignRowOf(rest).status = "suspended";

    await expect(getSendGates(env, COMPANY_ID)).resolves.toMatchObject({
      usApproved: false,
    });
  });

  it("tells the owner AND ops, and does not tell them to resubmit", async () => {
    // The rejection copy says "update your details and resubmit". That is the
    // right instruction for a review that said no and the wrong one here:
    // nothing about their details changed, they were live, and editing a
    // wizard they already completed correctly wastes the hour that matters.
    const { env, rest, telnyx, emails } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      { status: "approved", telnyx_id: "camp-1", data: CAMPAIGN_DATA },
    );
    telnyx.on("GET", /^\/v2\/10dlc\/campaign\/camp-1$/, () => ({
      campaignStatus: "MNO_SUSPENDED",
      failureReasons: "Excessive opt-out rate",
    }));

    await pollRegistrations(env);

    const owner = emails.find((mail) => mail.to.includes("owner@acme.example"));
    expect(owner?.subject).toContain("US texting is paused");
    expect(owner?.text).not.toContain("resubmit");
    // It leads with the consequence, which is the part they can act on.
    expect(owner?.text).toContain("stopped going out");

    const ops = emails.find((mail) => mail.subject.startsWith("[ops]"));
    expect(ops?.text).toContain(COMPANY_ID);
    expect(ops?.text).toContain("Excessive opt-out rate");
  });

  it("treats an EXPIRED lifecycle as suspension even when the status still says accepted", async () => {
    // A campaign can carry `campaignStatus: MNO_ACCEPTED` (historically true)
    // alongside `status: EXPIRED`. The old branch order returned `approved`
    // for exactly that payload, so an expired campaign read as healthy.
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      { status: "approved", telnyx_id: "camp-1", data: CAMPAIGN_DATA },
    );
    telnyx.on("GET", /^\/v2\/10dlc\/campaign\/camp-1$/, () => ({
      campaignStatus: "MNO_ACCEPTED",
      status: "EXPIRED",
    }));

    await pollRegistrations(env);

    expect(campaignRowOf(rest).status).toBe("suspended");
  });

  it("does NOT suspend on a payload it simply does not recognise", async () => {
    // The trade that is tempting and wrong. An unrecognised payload is far
    // more likely to be OUR parsing gap than a carrier decision — a partial
    // record, a renamed field, an envelope we did not unwrap — and acting on
    // it would stop a paying customer's texting because we failed to
    // understand a response. Suspension is inferred only from signals the
    // carrier actually sends; silence infers nothing.
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      { status: "approved", telnyx_id: "camp-1", data: CAMPAIGN_DATA },
    );
    telnyx.on("GET", /^\/v2\/10dlc\/campaign\/camp-1$/, () => ({
      somethingWeHaveNeverSeen: true,
    }));

    await pollRegistrations(env);

    expect(campaignRowOf(rest).status).toBe("approved");
  });

  it("reinstates without re-sending the welcome or re-counting activation", async () => {
    // Carrier suspensions are routinely lifted. "Your US texting is live" is
    // the wrong sentence for somebody who was live last week, and the
    // north-star capture counts workspaces that reached carrier approval — so
    // counting one twice would corrupt the activation metric D12 rests on.
    const { env, rest, telnyx, emails } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      {
        status: "suspended",
        telnyx_id: "camp-1",
        data: CAMPAIGN_DATA,
        rejection_reason: "Excessive opt-out rate",
      },
    );
    telnyx.on("GET", /^\/v2\/10dlc\/campaign\/camp-1$/, () => ({
      campaignStatus: "MNO_ACCEPTED",
      status: "ACTIVE",
    }));
    telnyx.on("POST", /^\/v2\/10dlc\/phoneNumberCampaign$/, () => ({}));

    await pollRegistrations(env);

    expect(campaignRowOf(rest).status).toBe("approved");
    // A stale carrier complaint must not outlive the suspension it described.
    expect(campaignRowOf(rest).rejection_reason).toBeNull();

    const subjects = emails.map((mail) => mail.subject);
    expect(subjects).toContain("US texting is back on");
    expect(subjects.filter((s) => s.includes("is live"))).toHaveLength(0);
  });

  it("leaves a campaign we deactivated ourselves alone", async () => {
    // `deactivated_at` is OUR billing action (D2), not a carrier decision.
    // Polling it would spend a Telnyx call per churned workspace per day and
    // could flip a row we deliberately parked into `suspended`, which would
    // then read as something the carrier did.
    const { env, rest, telnyx } = setup();
    seedRows(
      rest,
      { status: "approved", telnyx_id: "brand-1" },
      {
        status: "approved",
        telnyx_id: "camp-1",
        data: CAMPAIGN_DATA,
        deactivated_at: "2026-06-01T00:00:00.000Z",
      },
    );

    await pollRegistrations(env);

    expect(telnyx.callsTo("GET", /campaign\/camp-1/)).toHaveLength(0);
    expect(campaignRowOf(rest).status).toBe("approved");
  });
});

/**
 * #303 — the enforcement state as the REAL gate loader reads it.
 *
 * This assertion lives here rather than beside the rest of the #303 suite
 * because that suite runs under the `cross-track-doubles` project, where this
 * module is aliased to a test double. The double coalesces the absent case
 * itself, so the real function's default was never exercised — proven by
 * breaking it: changing the coalesce to "suspended" passed the whole #303
 * suite.
 *
 * Which is the failure worth catching. If an absent column read as suspended,
 * a migration that had not yet reached one environment would silence every
 * workspace in it at once, and the only symptom would be that nobody could
 * text.
 */
describe("#303 getSendGates reads the enforcement ladder", () => {
  const COMPANY = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

  function world(company: Record<string, unknown>): FetchRoute {
    return (url) => {
      if (url.pathname.includes("/companies")) {
        return Response.json([
          {
            id: COMPANY,
            name: "Reed Roofing",
            country: "US",
            us_texting_enabled: true,
            subscription_status: "active",
            ...company,
          },
        ]);
      }
      if (url.pathname.includes("/messaging_registrations")) {
        return Response.json([
          { kind: "campaign", status: "approved", deactivated_at: null },
        ]);
      }
      // Loud rather than a hang: an unstubbed table used to time out at five
      // seconds with nothing saying which one.
      return Response.json(
        { message: `unstubbed ${url.pathname}` },
        { status: 500 },
      );
    };
  }

  it("passes the stored step through", async () => {
    stubFetch(world({ aup_enforcement: "suspended" }));
    const gates = await getSendGates(completeEnv(), COMPANY);
    expect(gates.aupEnforcement).toBe("suspended");
  });

  it("an ABSENT column is not an accidental suspension", async () => {
    // The break that the #303 suite could not see. "We do not know" has to
    // read as "not under enforcement" — the other way round, a migration that
    // has not landed yet silences the entire product.
    stubFetch(world({}));
    const gates = await getSendGates(completeEnv(), COMPANY);
    expect(gates.aupEnforcement).toBe("none");

    stubFetch(world({ aup_enforcement: null }));
    const nulled = await getSendGates(completeEnv(), COMPANY);
    expect(nulled.aupEnforcement).toBe("none");
  });

  it("asks the database for the column at all", async () => {
    // A gate that never selects the column reads undefined forever and
    // coalesces to "none" — enforcement that silently does nothing, with
    // every test above still green.
    let seen = "";
    stubFetch((url, request) => {
      if (url.pathname.includes("/companies")) seen = url.search;
      return world({ aup_enforcement: "suspended" })(url, request);
    });
    await getSendGates(completeEnv(), COMPANY);
    expect(seen).toContain("aup_enforcement");
  });
});

/**
 * #277 — the pause, as the REAL gate loader derives it.
 *
 * This is the load-bearing half of the whole send-side pause: `getSendGates` is
 * the ONE place the fact is read, and every outbound path inherits it from
 * there. `messaging/pause-gate.test.ts` cannot assert it — that suite runs
 * under the `cross-track-doubles` project, where this module is aliased to a
 * test double, so it sets `paused` on the double and exercises what
 * runPreSendGates does with the answer. Proven by breaking it: hardcoding
 * `paused: false` in the derivation below left that entire suite green.
 *
 * Same reason the #303 block above lives here, and the same three failure
 * modes: the term is removed, the fixture refuses for some other reason, or
 * the SELECT stops asking for the column and every workspace reads "not
 * paused" forever.
 */
describe("#277 getSendGates derives the pause from the company row", () => {
  const COMPANY = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  const PAUSED_AT = "2026-08-01T09:00:00+00:00";

  function world(company: Record<string, unknown>): FetchRoute {
    return (url) => {
      if (url.pathname.includes("/companies")) {
        return Response.json([
          {
            id: COMPANY,
            name: "Reed Roofing",
            country: "US",
            us_texting_enabled: true,
            subscription_status: "active",
            ...company,
          },
        ]);
      }
      if (url.pathname.includes("/messaging_registrations")) {
        return Response.json([
          { kind: "campaign", status: "approved", deactivated_at: null },
        ]);
      }
      // Loud rather than a hang: an unstubbed table times out at five seconds
      // with nothing saying which one.
      return Response.json(
        { message: `unstubbed ${url.pathname}` },
        { status: 500 },
      );
    };
  }

  it("SG-1: a stamped paused_at closes the gate", async () => {
    stubFetch(world({ paused_at: PAUSED_AT }));
    const gates = await getSendGates(completeEnv(), COMPANY);
    expect(gates.paused).toBe(true);
  });

  it("SG-2: the SAME row unpaused leaves it open — and the pause moves nothing else", async () => {
    // PROVE THE GUARD BY BREAKING IT: one field differs from SG-1, so a green
    // SG-1 cannot be the fixture refusing for another reason.
    stubFetch(world({ paused_at: null }));
    const gates = await getSendGates(completeEnv(), COMPANY);
    expect(gates.paused).toBe(false);

    // The mechanism, restated as an assertion. A pause is a licensed-PRICE
    // swap: the subscription stays genuinely active and the 10DLC campaign
    // stays live (deactivating it would cost the customer a week of US texting
    // on their return). If a paused workspace ever started reading as
    // inactive or unapproved here, the pause would be silently doing the
    // damage the mechanism was chosen to avoid.
    stubFetch(world({ paused_at: PAUSED_AT }));
    const paused = await getSendGates(completeEnv(), COMPANY);
    expect(paused.subscriptionActive).toBe(true);
    expect(paused.usApproved).toBe(true);
  });

  it("SG-3: an ABSENT column is not an accidental pause", async () => {
    // The other direction is the worse one. "We do not know" has to read as
    // "not paused" — a wrong "paused" refuses a paying crew's texts, and the
    // only symptom is that their customers stop hearing back.
    stubFetch(world({}));
    await expect(getSendGates(completeEnv(), COMPANY)).resolves.toMatchObject({
      paused: false,
    });
  });

  it("SG-4: asks the database for the column at all", async () => {
    // A gate that never selects the column reads undefined forever and
    // coalesces to "not paused" — a pause that charges the customer a holding
    // fee and holds nothing, with every test above still green.
    let seen = "";
    stubFetch((url, request) => {
      if (url.pathname.includes("/companies")) seen = url.search;
      return world({ paused_at: PAUSED_AT })(url, request);
    });
    await getSendGates(completeEnv(), COMPANY);
    expect(seen).toContain("paused_at");
  });
});
