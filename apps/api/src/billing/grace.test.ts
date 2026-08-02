/**
 * Grace & release job suite (SPEC §9, §11): day-1/15/27 warnings gated by the
 * grace_notices ledger, day-30 release + campaign deactivation + the released
 * email gated by the same ledger (synthetic threshold_day 30 — #54), all with
 * the clock injected as a parameter (never Date.now() buried in logic). Real
 * product code with only global fetch stubbed; the telnyx contract functions
 * resolve to typed doubles via the vitest alias.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runGraceJob } from "./grace";
import {
  countResponse,
  endpoint,
  makeHarness,
  type Harness,
  type StubEndpoint,
} from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";
import { releaseCompanyNumbers } from "../test/telnyx-doubles/provisioning";
import { deactivateCampaign } from "../test/telnyx-doubles/registration";

const env = completeEnv();
const COMPANY_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const CANCELED_AT = "2026-06-01T00:00:00.000Z";

function daysAfterCancel(days: number): Date {
  return new Date(Date.parse(CANCELED_AT) + days * 24 * 60 * 60 * 1000);
}

interface GraceState {
  /** Ledger keys `${threshold_day}` already present for the company. */
  ledger: Set<number>;
  nonReleasedNumbers: number;
  campaignActive: boolean;
  /** #54: whether the company ever provisioned any number (default true). */
  everHadNumbers?: boolean;
}

function graceEndpoints(state: GraceState): StubEndpoint[] {
  return [
    endpoint("GET", /\/rest\/v1\/companies/, () => [
      { id: COMPANY_ID, name: "Acme Plumbing", canceled_at: CANCELED_AT },
    ]),
    endpoint("POST", /\/rest\/v1\/grace_notices/, (call) => {
      const row = call.json() as { threshold_day: number };
      if (state.ledger.has(row.threshold_day)) return [];
      state.ledger.add(row.threshold_day);
      return [{ company_id: COMPANY_ID }];
    }),
    endpoint("HEAD", /\/rest\/v1\/phone_numbers/, () =>
      countResponse(state.nonReleasedNumbers),
    ),
    // #54: the ever-had-a-number check behind the released email.
    endpoint("GET", /\/rest\/v1\/phone_numbers/, () =>
      state.everHadNumbers === false ? [] : [{ id: "num-1" }],
    ),
    endpoint("GET", /\/rest\/v1\/messaging_registrations/, () =>
      state.campaignActive ? [{ id: "reg_campaign_row" }] : [],
    ),
    endpoint("GET", /\/rest\/v1\/company_members/, () => [
      { user_id: "11111111-1111-4111-8111-111111111111" },
    ]),
    endpoint("GET", /\/auth\/v1\/admin\/users\//, () => ({
      id: "11111111-1111-4111-8111-111111111111",
      email: "owner@example.com",
    })),
    endpoint("POST", /api\.resend\.com\/emails/, () => ({ id: "email_1" })),
    // #252: the warning now also goes to the phone, because losing a business
    // number is too consequential to depend on one channel. Answering "nobody
    // subscribed" makes it a silent no-op here — these tests are about the
    // ledger claim and the email copy, and the push has its own assertions.
    endpoint("GET", /\/rest\/v1\/push_subscriptions/, () => []),
  ];
}

function run(state: GraceState, now: Date): { harness: Harness; done: Promise<void> } {
  const harness = makeHarness(graceEndpoints(state));
  stubFetch(harness.route);
  return { harness, done: runGraceJob(env, now) };
}

/**
 * `text` is included because #413 moved the escalation into the BODY. The old copy
 * escalated only the subject, so the subject was all a test needed to look at.
 */
function sentEmails(
  harness: Harness,
): { subject: string; to: string[]; text: string }[] {
  return harness
    .callsTo("POST", /api\.resend\.com/)
    .map((call) => call.json() as { subject: string; to: string[]; text: string });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runGraceJob — day 1/15/27/30 transitions, ledger-gated", () => {
  it("selects only canceled, not-deleted companies with a cancellation clock", async () => {
    const state: GraceState = { ledger: new Set(), nonReleasedNumbers: 1, campaignActive: true };
    const { harness, done } = run(state, daysAfterCancel(0.5));
    await done;
    const query = harness.callsTo("GET", /companies/)[0].url.searchParams;
    expect(query.get("subscription_status")).toBe("eq.canceled");
    expect(query.get("canceled_at")).toBe("not.is.null");
    expect(query.get("deleted_at")).toBe("is.null");
  });

  it("day 0: inside 24h nothing fires", async () => {
    const state: GraceState = { ledger: new Set(), nonReleasedNumbers: 1, campaignActive: true };
    const { harness, done } = run(state, daysAfterCancel(0.5));
    await done;
    expect(harness.callsTo("POST", /grace_notices/)).toHaveLength(0);
    expect(sentEmails(harness)).toHaveLength(0);
    expect(releaseCompanyNumbers).not.toHaveBeenCalled();
  });

  it("day 1: inserts the ledger row FIRST, then sends the day-1 warning", async () => {
    const state: GraceState = { ledger: new Set(), nonReleasedNumbers: 1, campaignActive: true };
    const { harness, done } = run(state, daysAfterCancel(1.2));
    await done;

    const inserts = harness.callsTo("POST", /grace_notices/);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].json()).toEqual({
      company_id: COMPANY_ID,
      canceled_at: CANCELED_AT,
      threshold_day: 1,
    });
    const emails = sentEmails(harness);
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toContain("canceled");
    expect(emails[0].to).toEqual(["owner@example.com"]);
    // Ledger insert strictly precedes the email on the wire.
    const insertIndex = harness.calls.indexOf(inserts[0]);
    const emailIndex = harness.calls.findIndex((call) =>
      /api\.resend\.com/.test(call.url.href),
    );
    expect(insertIndex).toBeLessThan(emailIndex);
    expect(releaseCompanyNumbers).not.toHaveBeenCalled();
    expect(deactivateCampaign).not.toHaveBeenCalled();
  });

  it("day 16 with day-1 already sent: only the day-15 warning goes out", async () => {
    const state: GraceState = { ledger: new Set([1]), nonReleasedNumbers: 1, campaignActive: true };
    const { harness, done } = run(state, daysAfterCancel(16));
    await done;

    // Both thresholds were attempted through the ledger…
    const attempted = harness
      .callsTo("POST", /grace_notices/)
      .map((call) => (call.json() as { threshold_day: number }).threshold_day);
    expect(attempted).toEqual([1, 15]);
    // …but only the unsent one produced an email.
    const emails = sentEmails(harness);
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toContain("15 days left");
  });

  it("day 27: the final warning names 3 days", async () => {
    const state: GraceState = { ledger: new Set([1, 15]), nonReleasedNumbers: 1, campaignActive: true };
    const { harness, done } = run(state, daysAfterCancel(27.1));
    await done;
    const emails = sentEmails(harness);
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toContain("3 days");
    expect(releaseCompanyNumbers).not.toHaveBeenCalled();
  });

  /**
   * #413 — the escalation has to be in the BODY, not only the subject.
   *
   * The old copy sent one identical body on all three days and escalated only the
   * subject line, and that body said the number is "permanently released and
   * cannot be recovered". True about us, and it reads as "it is gone" — while the
   * fact is that the number goes back to carrier inventory and gets reassigned to
   * another business. Only one of those two prompts a customer to act.
   */
  describe("#413 what release actually means", () => {
    it("day 1 stays reassuring and does NOT talk about reassignment", async () => {
      // Day 1's job is "nothing is lost yet, here is how to come back". There is
      // nothing to act on for four weeks, so the alarming half would only frighten.
      const state: GraceState = { ledger: new Set(), nonReleasedNumbers: 1, campaignActive: true };
      const { harness, done } = run(state, daysAfterCancel(1.1));
      await done;
      const [email] = sentEmails(harness);
      expect(email.text).not.toMatch(/another business/i);
      expect(email.text).not.toMatch(/port it out/i);
      expect(email.text).toMatch(/resubscribe/i);
    });

    it("day 15 says the number is reassigned, not deleted", async () => {
      const state: GraceState = { ledger: new Set([1]), nonReleasedNumbers: 1, campaignActive: true };
      const { harness, done } = run(state, daysAfterCancel(15.1));
      await done;
      const [email] = sentEmails(harness);
      expect(email.text).toMatch(/back to the phone company/i);
      expect(email.text).toMatch(/given to another business/i);
      // The consequence the customer can actually picture, which is the point.
      expect(email.text).toMatch(/reach whoever has it next/i);
      // The way out is day 27's job — at day 15 it is not urgent yet.
      expect(email.text).not.toMatch(/port it out/i);
    });

    it("day 27 names the way out and a concrete date", async () => {
      const state: GraceState = { ledger: new Set([1, 15]), nonReleasedNumbers: 1, campaignActive: true };
      const { harness, done } = run(state, daysAfterCancel(27.1));
      await done;
      const [email] = sentEmails(harness);
      expect(email.text).toMatch(/port it out/i);
      // "Before the deadline" is not actionable. A date is.
      expect(email.text).toMatch(/before \w+ \d{1,2}, \d{4}/);
      expect(email.text).toMatch(/telling your own customers/i);
      // Still says what release means — the final notice is not the place to drop it.
      expect(email.text).toMatch(/another business/i);
    });

    it("never claims the number cannot be recovered, on any day", async () => {
      // The exact sentence #413 was filed about. It is true about US and false
      // about the world, and a reader acts on the second reading.
      for (const [day, ledger] of [
        [1.1, new Set<number>()],
        [15.1, new Set([1])],
        [27.1, new Set([1, 15])],
      ] as const) {
        const state: GraceState = {
          ledger: new Set(ledger),
          nonReleasedNumbers: 1,
          campaignActive: true,
        };
        const { harness, done } = run(state, daysAfterCancel(day));
        await done;
        for (const email of sentEmails(harness)) {
          expect(email.text, `day ${day}`).not.toMatch(/cannot be recovered/i);
        }
      }
    });
  });

  it("re-running the same day sends nothing twice (ledger-gated)", async () => {
    const state: GraceState = { ledger: new Set(), nonReleasedNumbers: 1, campaignActive: true };
    const firstRun = run(state, daysAfterCancel(1.2));
    await firstRun.done;
    expect(sentEmails(firstRun.harness)).toHaveLength(1);

    const secondRun = run(state, daysAfterCancel(1.4));
    await secondRun.done;
    expect(sentEmails(secondRun.harness)).toHaveLength(0);
  });

  it("day 30: releases numbers, deactivates the campaign, sends the ledgered final email", async () => {
    const state: GraceState = {
      ledger: new Set([1, 15, 27]),
      nonReleasedNumbers: 2,
      campaignActive: true,
    };
    const { harness, done } = run(state, daysAfterCancel(30));
    await done;

    expect(releaseCompanyNumbers).toHaveBeenCalledExactlyOnceWith(env, COMPANY_ID);
    expect(deactivateCampaign).toHaveBeenCalledExactlyOnceWith(env, COMPANY_ID);
    const emails = sentEmails(harness);
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toContain("has been released");

    // #54: the released email is ledgered insert-first as threshold_day 30,
    // and the insert strictly precedes the email on the wire.
    const claim = harness
      .callsTo("POST", /grace_notices/)
      .find((call) => (call.json() as { threshold_day: number }).threshold_day === 30);
    expect(claim).toBeDefined();
    expect(claim!.json()).toEqual({
      company_id: COMPANY_ID,
      canceled_at: CANCELED_AT,
      threshold_day: 30,
    });
    const claimIndex = harness.calls.indexOf(claim!);
    const emailIndex = harness.calls.findIndex((call) =>
      /api\.resend\.com/.test(call.url.href),
    );
    expect(claimIndex).toBeLessThan(emailIndex);
  });

  it("day 31 after release with the day-30 notice ledgered: full no-op", async () => {
    const state: GraceState = {
      ledger: new Set([1, 15, 27, 30]),
      nonReleasedNumbers: 0, // released rows only
      campaignActive: false, // deactivated_at stamped
    };
    const { harness, done } = run(state, daysAfterCancel(31));
    await done;
    expect(releaseCompanyNumbers).not.toHaveBeenCalled();
    expect(deactivateCampaign).not.toHaveBeenCalled();
    expect(sentEmails(harness)).toHaveLength(0);
  });

  it("day 31, released but the email was lost (#54): the ledger sends it without re-releasing", async () => {
    // A prior run released the numbers + deactivated the campaign, then
    // crashed before (or during) the email — no threshold_day 30 ledger row.
    const state: GraceState = {
      ledger: new Set([1, 15, 27]),
      nonReleasedNumbers: 0,
      campaignActive: false,
    };
    const { harness, done } = run(state, daysAfterCancel(31));
    await done;

    expect(releaseCompanyNumbers).not.toHaveBeenCalled();
    expect(deactivateCampaign).not.toHaveBeenCalled();
    const emails = sentEmails(harness);
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toContain("has been released");

    // …and the run after THAT is silent (overlap can never double-send).
    const secondRun = run(state, daysAfterCancel(31.5));
    await secondRun.done;
    expect(sentEmails(secondRun.harness)).toHaveLength(0);
  });

  it("a canceled tenant that never had a number gets no 'released' email (#54)", async () => {
    const state: GraceState = {
      ledger: new Set([1, 15, 27]),
      nonReleasedNumbers: 0,
      campaignActive: false,
      everHadNumbers: false,
    };
    const { harness, done } = run(state, daysAfterCancel(30));
    await done;

    // The day-30 notice is still claimed (one-shot), but nothing was ever
    // released, so the email would be false — it is skipped.
    expect(state.ledger.has(30)).toBe(true);
    expect(sentEmails(harness)).toHaveLength(0);
    expect(releaseCompanyNumbers).not.toHaveBeenCalled();
  });

  it("day 30 with a CA-only tenant (no campaign): releases numbers, skips deactivation", async () => {
    const state: GraceState = {
      ledger: new Set([1, 15, 27]),
      nonReleasedNumbers: 1,
      campaignActive: false,
    };
    const { done } = run(state, daysAfterCancel(32));
    await done;
    expect(releaseCompanyNumbers).toHaveBeenCalledExactlyOnceWith(env, COMPANY_ID);
    expect(deactivateCampaign).not.toHaveBeenCalled();
  });

  it("keeps retrying a company whose release failed past the notice window", async () => {
    // A release failure is re-thrown so the daily cron retries, but the scan
    // used to be bounded by age: four attempts, then the company was never
    // selected again. Its Telnyx number was never deleted and its campaign
    // never deactivated, so the rent and the monthly campaign fee billed a
    // churned tenant forever. Nothing else reclaims them - the number
    // reconcile skips canceled companies outright.
    const OLD_COMPANY = "8c9e6679-7425-40de-944b-e07fc1f90ae7";
    const harness = makeHarness([
      // Far outside the notice window, so the age-bounded scan returns nothing.
      endpoint("GET", /\/rest\/v1\/companies/, () => []),
      endpoint("GET", /\/rest\/v1\/phone_numbers/, (call) =>
        call.url.searchParams.has("companies.subscription_status")
          ? [
              {
                company_id: OLD_COMPANY,
                companies: {
                  id: OLD_COMPANY,
                  name: "Churned Plumbing",
                  canceled_at: CANCELED_AT,
                },
              },
            ]
          : [{ id: "num-1" }],
      ),
      endpoint("HEAD", /\/rest\/v1\/phone_numbers/, () => countResponse(1)),
      endpoint("GET", /\/rest\/v1\/messaging_registrations/, () => []),
      endpoint("POST", /\/rest\/v1\/grace_notices/, () => [{ company_id: OLD_COMPANY }]),
      endpoint("GET", /\/rest\/v1\/company_members/, () => [
        { user_id: "11111111-1111-4111-8111-111111111111" },
      ]),
      // #252: the release warning also pushes; nobody is subscribed here.
      endpoint("GET", /\/rest\/v1\/push_subscriptions/, () => []),
      endpoint("GET", /\/auth\/v1\/admin\/users\//, () => ({
        id: "11111111-1111-4111-8111-111111111111",
        email: "owner@example.com",
      })),
      endpoint("POST", /api\.resend\.com\/emails/, () => ({ id: "email_1" })),
    ]);
    stubFetch(harness.route);

    // 90 days after cancellation: long past the window the old scan allowed.
    await runGraceJob(env, daysAfterCancel(90));

    // The number release was attempted for the straggler.
    expect(releaseCompanyNumbers).toHaveBeenCalledWith(
      expect.anything(),
      OLD_COMPANY,
    );
  });

  it("a failing tenant surfaces as an error after the loop (cron retries daily)", async () => {
    const harness = makeHarness([
      endpoint("GET", /\/rest\/v1\/companies/, () => [
        { id: COMPANY_ID, name: "Acme Plumbing", canceled_at: CANCELED_AT },
      ]),
      endpoint(
        "POST",
        /\/rest\/v1\/grace_notices/,
        () => new Response(JSON.stringify({ message: "db down" }), { status: 500 }),
      ),
      // The unfinished-release sweep runs on every pass.
      endpoint("GET", /\/rest\/v1\/phone_numbers/, () => []),
      endpoint("GET", /\/rest\/v1\/messaging_registrations/, () => []),
    ]);
    stubFetch(harness.route);
    await expect(runGraceJob(env, daysAfterCancel(2))).rejects.toThrow(
      /grace job failed for 1 company/,
    );
  });
});

describe("#252 — the release warning does not depend on email alone", () => {
  /**
   * Losing a business number is the most expensive thing that can happen to a
   * workspace here, and the only warning was an email — to an address that may
   * bounce, may be filtered, and whose deliverability this issue exists
   * because we could not vouch for.
   *
   * Asserted at the AUDIENCE lookup rather than at the wire. Getting a real
   * send through would mean generating ECDH keys per test to satisfy the
   * payload encryption, which would pin `webpush.ts`'s crypto — already
   * covered by its own suite — instead of the thing that is new here: that the
   * warning reaches the phone at all, aimed at the right people.
   */
  it("wakes the phone as well as the inbox, for the owners and admins", async () => {
    const state: GraceState = {
      ledger: new Set<number>(),
      nonReleasedNumbers: 1,
      campaignActive: false,
    };
    const harness = makeHarness(graceEndpoints(state));
    stubFetch(harness.route);

    await runGraceJob(env, daysAfterCancel(1.2));

    const emails = harness.callsTo("POST", /api\.resend\.com\/emails/);
    const pushes = harness.callsTo("GET", /\/rest\/v1\/push_subscriptions/);
    // Both channels, for one warning.
    expect(emails.length).toBeGreaterThan(0);
    expect(pushes.length).toBeGreaterThan(0);
    // Aimed at the billing audience, not at the whole crew: a release warning
    // is for whoever can actually stop it.
    expect(pushes[0].url.searchParams.get("user_id")).toContain(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("still sends the email when the push audience read fails", async () => {
    // The ledger row is claimed before either channel runs, so a push failure
    // must not make the caller think nothing went out. Throwing would also
    // re-run the notice tomorrow, where the claim would refuse it — so one bad
    // read would silence the warning entirely rather than degrade it.
    const state: GraceState = {
      ledger: new Set<number>(),
      nonReleasedNumbers: 1,
      campaignActive: false,
    };
    const harness = makeHarness([
      // FIRST: the harness is first-match-wins, so this overrides the healthy
      // answer graceEndpoints registers below.
      endpoint("GET", /\/rest\/v1\/push_subscriptions/, () =>
        new Response("boom", { status: 500 }),
      ),
      ...graceEndpoints(state),
    ]);
    stubFetch(harness.route);

    await runGraceJob(env, daysAfterCancel(1.2));

    expect(harness.callsTo("POST", /api\.resend\.com\/emails/).length,
    ).toBeGreaterThan(0);
  });
});
