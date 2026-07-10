/**
 * #85/#92 dynamic overage-warning cron: for each active company, decideOverage()
 * decides whether it is projected to cost more than it pays; if so, email the
 * owner once per period via the usage_alerts ledger (metric 'cost_projection').
 * Real product code with only global fetch stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runOverageWarningJob } from "./overage-warning";
import {
  endpoint,
  makeHarness,
  countResponse,
  type Harness,
  type StubEndpoint,
} from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";

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
      },
    ]),
    endpoint("POST", /\/rpc\/api_period_segments/, () => 0),
    endpoint("POST", /\/rpc\/api_period_inbound_segments/, () => state.inbound),
    endpoint("POST", /\/rpc\/api_period_voice_seconds/, () => 0),
    endpoint("POST", /\/rpc\/api_period_forwarded_calls/, () => 0),
    endpoint("POST", /\/rpc\/api_period_egress_bytes/, () => 0),
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

function sentEmails(harness: Harness): { subject: string; to: string[] }[] {
  return harness
    .callsTo("POST", /api\.resend\.com/)
    .map((call) => call.json() as { subject: string; to: string[] });
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

    const emails = sentEmails(harness);
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toContain("Acme Plumbing");
    expect(emails[0].to).toEqual(["owner@example.com"]);
    // The ledger row is keyed on the dynamic metric, once per period.
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
