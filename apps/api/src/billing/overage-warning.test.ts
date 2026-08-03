/**
 * #85/#92 dynamic overage-warning cron: for each active company, decideOverage()
 * decides whether it is projected to cost more than it pays; if so, email the
 * owner once per period via the usage_alerts ledger (metric 'cost_projection').
 * Real product code with only global fetch stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  runOverageDigestJob,
  runOverageWarningJob,
} from "./overage-warning";
import {
  endpoint,
  makeHarness,
  countResponse,
  type Harness,
  type StubEndpoint,
} from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";

// #447: an explicit ops address, so the assertions prove the founder's copy is
// ROUTED rather than merely sent (unset falls back to support@loonext.com).
const env = { ...completeEnv(), OPS_ALERT_EMAIL: "ops@example.com" };
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
});

describe("runOverageWarningJob (#85/#92 dynamic overage warning)", () => {
  it("warns the owner once when the tenant is trending over what they pay", async () => {
    // 5000 inbound @ x2 = 7000c cost + 1110c fixed = 8110c vs ~2771c net -> over.
    const state: State = { inbound: 5000, ledger: new Set() };
    const { harness, done } = run(state);
    await done;

    // #447: two emails now — the customer's heads-up and the founder's copy.
    const emails = sentEmails(harness);
    expect(emails).toHaveLength(2);

    const customer = emails.find((e) => !e.subject.startsWith("[ops]"));
    expect(customer?.subject).toContain("Acme Plumbing");
    expect(customer?.to).toEqual(["owner@example.com"]);
    // The customer's copy must never carry OUR cost or margin — those are
    // internal figures, and the whole point of the split is that the tenant
    // sees usage while the founder sees economics.
    expect(customer?.text).not.toContain("$");
    expect(customer?.text.toLowerCase()).not.toContain("margin");

    // #447: the signal that says "this tenant is unprofitable" reaches the
    // person who cannot absorb it. It carries the money, because ops is the
    // only audience the margin means anything to.
    const ops = emails.find((e) => e.subject.startsWith("[ops]"));
    expect(ops).toBeDefined();
    expect(ops?.to).toEqual(["ops@example.com"]);
    expect(ops?.subject).toContain("Acme Plumbing");
    expect(ops?.text).toContain("Projected margin:");

    // Both ride ONE ledger row, so the founder can never be told more often
    // than the customer was, nor without them.
    expect(state.ledger).toEqual(new Set(["cost_projection:100"]));
  });

  it("stays silent for a tenant comfortably inside their revenue", async () => {
    const state: State = { inbound: 50, ledger: new Set() };
    const { harness, done } = run(state);
    await done;
    expect(sentEmails(harness)).toHaveLength(0);
    expect(harness.callsTo("POST", /usage_alerts/)).toHaveLength(0);
  });

  it("does not re-warn when the period's ledger row already exists", async () => {
    const state: State = {
      inbound: 5000,
      ledger: new Set(["cost_projection:100"]),
    };
    const { harness, done } = run(state);
    await done;
    expect(sentEmails(harness)).toHaveLength(0);
  });
});

describe("runOverageDigestJob (#447 — the pattern, not the instance)", () => {
  const OTHER_ID = "8c9e6679-7425-40de-944b-e07fc1f90ae8";

  function digestHarness(
    crossings: { company_id: string }[],
    activeCount: number,
  ): Harness {
    return makeHarness([
      // The ledger IS the history (#447 ask 3): rows written for idempotency,
      // stamped with sent_at, read back here to answer "how often".
      endpoint("GET", /\/rest\/v1\/usage_alerts/, () => crossings),
      endpoint("HEAD", /\/rest\/v1\/companies/, () =>
        countResponse(activeCount),
      ),
      endpoint("POST", /api\.resend\.com\/emails/, () => ({ id: "email_1" })),
    ]);
  }

  it("tells the founder how many tenants crossed, out of how many", async () => {
    const harness = digestHarness(
      [{ company_id: COMPANY_ID }, { company_id: OTHER_ID }],
      7,
    );
    stubFetch(harness.route);
    await runOverageDigestJob(env, NOW);

    const emails = sentEmails(harness);
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toEqual(["ops@example.com"]);
    expect(emails[0].subject).toContain("2 tenants");
    // The denominator is the pricing signal: 2 of 7 is a different fact from
    // 2 of 700, and only the ratio answers #446.
    expect(emails[0].text).toContain("2 of 7");
  });

  it("counts a tenant once even if it crossed in two periods", async () => {
    // One tenant crossing twice inside the window is one tenant, not a trend.
    const harness = digestHarness(
      [{ company_id: COMPANY_ID }, { company_id: COMPANY_ID }],
      7,
    );
    stubFetch(harness.route);
    await runOverageDigestJob(env, NOW);
    expect(sentEmails(harness)[0].subject).toContain("1 tenant ");
  });

  it("stays silent in a week where nobody crossed", async () => {
    // The module's own posture: no email is the answer "nobody hit the
    // ceiling". A weekly zero would train the founder to ignore it.
    const harness = digestHarness([], 7);
    stubFetch(harness.route);
    await runOverageDigestJob(env, NOW);
    expect(sentEmails(harness)).toHaveLength(0);
  });

  it("never names a tenant — counts only", async () => {
    // The per-tenant conversation stays between the product and the customer;
    // this email exists to make a PATTERN visible without putting anyone's
    // name in front of the founder.
    const harness = digestHarness([{ company_id: COMPANY_ID }], 7);
    stubFetch(harness.route);
    await runOverageDigestJob(env, NOW);
    const body = sentEmails(harness)[0];
    expect(body.text).not.toContain(COMPANY_ID);
    expect(body.text).not.toContain("Acme");
  });
});
