/**
 * #85/#92 dynamic overage-warning cron: for each active company, decideOverage()
 * decides whether it is projected to cost more than it pays; if so, email the
 * owner once per period via the usage_alerts ledger (metric 'cost_projection').
 * Real product code with only global fetch stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runOverageWarningJob } from "./overage-warning";
import { eventsCaptured, resetCaptures } from "../test/capture-mock";
import {
  endpoint,
  makeHarness,
  countResponse,
  type Harness,
  type StubEndpoint,
} from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";

vi.mock("../observability/capture", async () =>
  (await import("../test/capture-mock")).captureModuleMock(),
);

const env = completeEnv();
const COMPANY_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const PERIOD_START = "2026-06-01T00:00:00.000Z";
const PERIOD_END = "2026-07-01T00:00:00.000Z";
const NOW = new Date("2026-06-16T00:00:00.000Z"); // 15 days in, multiplier 2

interface State {
  /** api_period_inbound_segments — the loss driver we vary. */
  inbound: number;
  /** Ledger keys already present, `${metric}:${threshold}`. */
  ledger: Set<string>;
  numbers?: number;
  /** #277: companies.paused_at / paused_price_cents, as the row carries them. */
  pausedAt?: string | null;
  pausedPriceCents?: number | null;
}

function endpoints(state: State): StubEndpoint[] {
  return [
    endpoint("GET", /\/rest\/v1\/companies/, () => [
      {
        id: COMPANY_ID,
        name: "Acme Plumbing",
        plan: "starter",
        current_period_start: PERIOD_START,
        current_period_end: PERIOD_END,
        us_texting_enabled: true,
        overage_cap_multiplier: 3,
        paid_extra_numbers: 0,
        paused_at: state.pausedAt ?? null,
        paused_price_cents: state.pausedPriceCents ?? null,
      },
    ]),
    // #400/D107: null = no prepaid year. A year zeroes the licensed line,
    // so the projection asks before counting the list price as revenue.
    endpoint("POST", /\/rpc\/open_prepayment/, () => null),
    // #304: the three period sums are now ONE window read.
    endpoint("POST", /\/rpc\/api_usage_window/, () => [
      {
        outbound_segments: 0,
        inbound_segments: state.inbound,
        forward_seconds: 0,
        reported_segments: 0,
        unreported_segments: 0,
      },
    ]),
    endpoint("POST", /\/rpc\/api_period_segments/, () => 0),
    endpoint("POST", /\/rpc\/api_period_inbound_segments/, () => state.inbound),
    endpoint("POST", /\/rpc\/api_period_forward_seconds/, () => 0),
    endpoint("POST", /\/rpc\/api_period_forwarded_calls/, () => 0),
    endpoint("POST", /\/rpc\/api_period_egress_bytes/, () => 0),
    endpoint("POST", /\/rpc\/api_period_provider_cost/, () => 0),
    endpoint("POST", /\/rpc\/api_storage_usage/, () => ({
      attachments_bytes: 0,
      mms_bytes: 0,
    })),
    endpoint("HEAD", /\/rest\/v1\/phone_numbers/, () =>
      countResponse(state.numbers ?? 1),
    ),
    endpoint("GET", /\/rest\/v1\/company_modules/, () => []),
    endpoint("POST", /\/rest\/v1\/usage_alerts/, (call) => {
      const row = call.json() as { metric: string; threshold: number };
      const key = `${row.metric}:${row.threshold}`;
      if (state.ledger.has(key)) return [];
      state.ledger.add(key);
      return [{ company_id: COMPANY_ID }];
    }),
    endpoint("GET", /\/rest\/v1\/company_members/, () => [
      { user_id: "11111111-1111-4111-8111-111111111111" },
    ]),
    endpoint("GET", /\/auth\/v1\/admin\/users\//, () => ({
      id: "11111111-1111-4111-8111-111111111111",
      email: "owner@example.com",
    })),
    endpoint("POST", /api\.resend\.com\/emails/, () => ({ id: "email_1" })),
  ];
}

function run(state: State): { harness: Harness; done: Promise<void> } {
  const harness = makeHarness(endpoints(state));
  stubFetch(harness.route);
  return { harness, done: runOverageWarningJob(env, NOW) };
}

function sentEmails(
  harness: Harness,
): { subject: string; to: string[]; text: string }[] {
  return harness
    .callsTo("POST", /api\.resend\.com/)
    .map((call) => call.json() as { subject: string; to: string[]; text: string });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCaptures();
});

describe("runOverageWarningJob (#85/#92 dynamic overage warning)", () => {
  it("warns the owner once when the tenant is trending over what they pay", async () => {
    // 5000 inbound @ x2 = 7000c cost + 1110c fixed = 8110c vs ~2771c net -> over.
    const state: State = { inbound: 5000, ledger: new Set() };
    const { harness, done } = run(state);
    await done;

    const emails = sentEmails(harness);
    expect(emails).toHaveLength(1);

    const [customer] = emails;
    expect(customer?.subject).toContain("Acme Plumbing");
    expect(customer?.to).toEqual(["owner@example.com"]);
    // The customer's copy must never carry OUR cost or margin — those are
    // internal figures, and the whole point of the split is that the tenant
    // sees usage while we see economics.
    expect(customer?.text).not.toContain("$");
    expect(customer?.text.toLowerCase()).not.toContain("margin");

    // #447: the signal that says "this tenant is unprofitable" carries the
    // money, in an event under the workspace, never in the customer's copy.
    const [projected] = eventsCaptured("overage_projected");
    expect(projected.distinctId).toBe(COMPANY_ID);
    expect(projected.properties).toMatchObject({ metric: "cost_projection", threshold: 100 });
    expect(projected.properties.margin_cents).toBeLessThan(0);
    expect(typeof projected.properties.projected_cost_cents).toBe("number");
    expect(typeof projected.properties.revenue_cents).toBe("number");
    expect(eventsCaptured("usage_threshold_crossed")).toEqual([]);

    // Both ride ONE ledger row, so the event can never fire more often than
    // the customer was told.
    expect(state.ledger).toEqual(new Set(["cost_projection:100"]));
  });

  it("stays silent for a tenant comfortably inside their revenue", async () => {
    const state: State = { inbound: 50, ledger: new Set() };
    const { harness, done } = run(state);
    await done;
    expect(sentEmails(harness)).toHaveLength(0);
    expect(harness.callsTo("POST", /usage_alerts/)).toHaveLength(0);
    expect(eventsCaptured()).toEqual([]);
  });

  it("does not re-warn when the period's ledger row already exists", async () => {
    const state: State = {
      inbound: 5000,
      ledger: new Set(["cost_projection:100"]),
    };
    const { harness, done } = run(state);
    await done;
    expect(sentEmails(harness)).toHaveLength(0);
    expect(eventsCaptured()).toEqual([]);
  });

  /**
   * #277 — the paused cohort, in the one alert that exists to catch a tenant
   * costing more than it pays.
   *
   * A pause leaves `subscription_status` 'active' and `plan` populated, so every
   * paused workspace sails into this scan. Its revenue fell to a holding fee of
   * a few dollars; its cost — a held number, a live 10DLC campaign, uncapped
   * inbound — did not move. That is the definition of the row this job is read
   * for, and valuing it at $29 is what makes it invisible.
   *
   * PW-1/PW-2 drive the two halves that fail separately: the fee we can read,
   * and the fee we cannot. PW-3 asserts the SELECT, because neither behavioural
   * assertion can see a projection that stops asking for the column — the stub
   * hands back whole rows regardless of what was requested, so the fixture keeps
   * supplying a value production can no longer read and both tests stay green
   * while every paused tenant is quietly restored to its plan's list price.
   */
  it("PW-1: warns on a PAUSED tenant that a plan price would have hidden", async () => {
    // The SAME 50 inbound segments the test above proves is silent on a plan:
    // ~1210c of extrapolated cost (a held number and a live campaign dominate)
    // against $29 net is comfortable, and against a $5 holding fee is not. The
    // usage is identical in both runs — only the revenue moved, which is the
    // whole claim.
    const quiet: State = { inbound: 50, ledger: new Set() };
    const { harness: unpausedHarness, done: unpausedDone } = run(quiet);
    await unpausedDone;
    expect(sentEmails(unpausedHarness)).toHaveLength(0);

    const paused: State = {
      inbound: 50,
      ledger: new Set(),
      pausedAt: "2026-06-01T00:00:00.000Z",
      pausedPriceCents: 500,
    };
    const { harness, done } = run(paused);
    await done;
    expect(sentEmails(harness)).toHaveLength(1);
  });

  it("PW-2: warns on a paused tenant whose fee we cannot read, never crediting the plan", async () => {
    // paused_price_cents is null for a tiered pause price, for a workspace
    // paused before pausePriceSnapshot began refusing those, and in the window
    // between syncSubscription's two writes. Branching on the FEE reads every
    // one of them as "not paused" and hands back $29.
    const state: State = {
      inbound: 50,
      ledger: new Set(),
      pausedAt: "2026-06-01T00:00:00.000Z",
      pausedPriceCents: null,
    };
    const { harness, done } = run(state);
    await done;
    expect(sentEmails(harness)).toHaveLength(1);
  });

  it("PW-3: asks the database for paused_at, not only for the fee", async () => {
    const { harness, done } = run({ inbound: 50, ledger: new Set() });
    await done;
    const select =
      harness.callsTo("GET", /\/rest\/v1\/companies/)[0]?.url.searchParams.get(
        "select",
      ) ?? "";
    expect(select).toContain("paused_at");
    expect(select).toContain("paused_price_cents");
  });
});
