/**
 * 80%/100% usage-alert job suite (SPEC §2, §9, §11): thresholds computed
 * against the plan's INCLUDED quota from real usage_events sums (the same
 * api_period_segments RPC the usage route uses), one email per
 * (company, period, threshold) via the usage_alerts ledger. Real product code
 * with only global fetch stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runUsageAlertsJob } from "./usage-alerts";
import {
  endpoint,
  makeHarness,
  type Harness,
  type StubEndpoint,
} from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";

const env = completeEnv();
const COMPANY_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const PERIOD_START = "2026-06-15T00:00:00.000Z";

interface UsageState {
  /** Sum api_period_segments reports for the company. */
  used: number;
  /** Ledger keys already present, `${metric}:${threshold}` (e.g. "segments:80"). */
  ledger: Set<string>;
  plan?: "starter" | "pro";
  /** api_storage_usage bytes (default 0 → no storage alerts). */
  mmsBytes?: number;
  attachmentBytes?: number;
  /** api_period_voice_seconds (default 0 → no voice alerts). */
  voiceSeconds?: number;
  /** api_period_egress_bytes (default 0 → no egress alerts). */
  egressBytes?: number;
}

function usageEndpoints(state: UsageState): StubEndpoint[] {
  return [
    endpoint("GET", /\/rest\/v1\/companies/, () => [
      {
        id: COMPANY_ID,
        name: "Acme Plumbing",
        plan: state.plan ?? "starter",
        current_period_start: PERIOD_START,
      },
    ]),
    endpoint("POST", /\/rest\/v1\/rpc\/api_period_segments/, () => state.used),
    endpoint("POST", /\/rest\/v1\/rpc\/api_storage_usage/, () => ({
      attachments_bytes: state.attachmentBytes ?? 0,
      mms_bytes: state.mmsBytes ?? 0,
    })),
    endpoint(
      "POST",
      /\/rest\/v1\/rpc\/api_period_voice_seconds/,
      () => state.voiceSeconds ?? 0,
    ),
    endpoint(
      "POST",
      /\/rest\/v1\/rpc\/api_period_egress_bytes/,
      () => state.egressBytes ?? 0,
    ),
    // #12: effectiveStorageBudgets reads company_modules; [] = extra_storage
    // off → base budgets, so the storage thresholds are unchanged.
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

/** Starter storage budgets in bytes (mirrors billing/plans.ts). */
const GB = 1024 * 1024 * 1024;

function run(state: UsageState): { harness: Harness; done: Promise<void> } {
  const harness = makeHarness(usageEndpoints(state));
  stubFetch(harness.route);
  return { harness, done: runUsageAlertsJob(env) };
}

function sentEmails(harness: Harness): { subject: string; to: string[] }[] {
  return harness
    .callsTo("POST", /api\.resend\.com/)
    .map((call) => call.json() as { subject: string; to: string[] });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runUsageAlertsJob (SPEC §9 usage-alert check)", () => {
  it("below 80% of the included quota: no ledger writes, no email", async () => {
    const state: UsageState = { used: 399, ledger: new Set() }; // 500 included
    const { harness, done } = run(state);
    await done;
    expect(harness.callsTo("POST", /usage_alerts/)).toHaveLength(0);
    expect(sentEmails(harness)).toHaveLength(0);
  });

  it("crossing 80% (starter: 400 of 500) sends exactly the 80% alert", async () => {
    const state: UsageState = { used: 400, ledger: new Set() };
    const { harness, done } = run(state);
    await done;
    const emails = sentEmails(harness);
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toContain("80%");
    expect(emails[0].to).toEqual(["owner@example.com"]);
    expect(state.ledger).toEqual(new Set(["segments:80"]));
  });

  it("re-running with the 80% ledger row present sends nothing (PK idempotency)", async () => {
    const state: UsageState = { used: 450, ledger: new Set(["segments:80"]) };
    const { harness, done } = run(state);
    await done;
    expect(sentEmails(harness)).toHaveLength(0);
  });

  it("at 100% both thresholds are recorded and emailed once each", async () => {
    const state: UsageState = { used: 500, ledger: new Set() };
    const { harness, done } = run(state);
    await done;
    const subjects = sentEmails(harness).map((email) => email.subject);
    expect(subjects).toHaveLength(2);
    expect(subjects[0]).toContain("80%");
    expect(subjects[1]).toContain("all 500 included messages");
    expect(state.ledger).toEqual(new Set(["segments:80", "segments:100"]));

    // Converged: the next run is a pure no-op.
    const again = run(state);
    await again.done;
    expect(sentEmails(again.harness)).toHaveLength(0);
  });

  it("thresholds follow the plan quota (pro: 2000 of 2500 = 80%)", async () => {
    const state: UsageState = { used: 2000, ledger: new Set(), plan: "pro" };
    const { harness, done } = run(state);
    await done;
    expect(sentEmails(harness)).toHaveLength(1);
    expect(state.ledger).toEqual(new Set(["segments:80"]));
  });

  it("MMS storage at 100% (starter: 5 GB) sends both picture-storage alerts", async () => {
    const state: UsageState = { used: 0, ledger: new Set(), mmsBytes: 5 * GB };
    const { harness, done } = run(state);
    await done;
    const subjects = sentEmails(harness).map((email) => email.subject);
    expect(subjects).toHaveLength(2);
    expect(subjects[0]).toContain("nearing its picture-message storage limit");
    expect(subjects[1]).toContain("reached its picture-message storage limit");
    expect(state.ledger).toEqual(
      new Set(["mms_storage:80", "mms_storage:100"]),
    );

    // Converged: re-running with the ledger populated is a pure no-op.
    const again = run(state);
    await again.done;
    expect(sentEmails(again.harness)).toHaveLength(0);
  });

  it("attachment storage at exactly 80% (starter: 4 of 5 GB) sends only the 80% file alert", async () => {
    const state: UsageState = {
      used: 0,
      ledger: new Set(),
      attachmentBytes: 4 * GB,
    };
    const { harness, done } = run(state);
    await done;
    const emails = sentEmails(harness);
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toContain("nearing its file storage limit");
    expect(state.ledger).toEqual(new Set(["attachment_storage:80"]));
  });

  it("voice minutes at 100% (300 min = 18000 s) sends both call-forwarding alerts", async () => {
    const state: UsageState = {
      used: 0,
      ledger: new Set(),
      voiceSeconds: 300 * 60,
    };
    const { harness, done } = run(state);
    await done;
    const subjects = sentEmails(harness).map((email) => email.subject);
    expect(subjects).toHaveLength(2);
    expect(subjects[0]).toContain("nearing its call-forwarding minutes");
    expect(subjects[1]).toContain("used all its included call-forwarding");
    expect(state.ledger).toEqual(
      new Set(["voice_minutes:80", "voice_minutes:100"]),
    );
  });

  it("voice minutes below 80% sends nothing", async () => {
    const state: UsageState = {
      used: 0,
      ledger: new Set(),
      voiceSeconds: 100 * 60, // 100 of 300 min
    };
    const { harness, done } = run(state);
    await done;
    expect(sentEmails(harness)).toHaveLength(0);
  });

  it("#103: never reads or alerts on a picture-message count (the cap is gone)", async () => {
    // Pictures meter as segments now — a heavy-MMS period surfaces through the
    // `segments` arm, never a phantom "picture-message limit" warning about a
    // cap that no longer exists. The endpoint list carries NO stub for the
    // dropped api_period_outbound_mms RPC, so a read of it would fail loudly.
    const state: UsageState = { used: 0, ledger: new Set() };
    const { harness, done } = run(state);
    await done;
    expect(sentEmails(harness)).toHaveLength(0);
    expect(
      harness.callsTo("POST", /api_period_outbound_mms/),
    ).toHaveLength(0);
  });

  it("egress at 100% (starter: 40 GB allowance) sends both download alerts (#16)", async () => {
    // Starter allowance = 4 × (5 GB attachments + 5 GB MMS) = 40 GB.
    const state: UsageState = {
      used: 0,
      ledger: new Set(),
      egressBytes: 40 * GB,
    };
    const { harness, done } = run(state);
    await done;
    const subjects = sentEmails(harness).map((email) => email.subject);
    expect(subjects).toHaveLength(2);
    expect(subjects[0]).toContain("nearing its file-download limit");
    expect(subjects[1]).toContain("used all its included file downloads");
    expect(state.ledger).toEqual(new Set(["egress:80", "egress:100"]));

    // Converged: the next run is a pure no-op.
    const again = run(state);
    await again.done;
    expect(sentEmails(again.harness)).toHaveLength(0);
  });

  it("egress at exactly 80% (starter: 32 of 40 GB) sends only the 80% download alert", async () => {
    const state: UsageState = {
      used: 0,
      ledger: new Set(),
      egressBytes: 32 * GB,
    };
    const { harness, done } = run(state);
    await done;
    const emails = sentEmails(harness);
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toContain("nearing its file-download limit");
    expect(state.ledger).toEqual(new Set(["egress:80"]));
  });

  it("egress below 80% sends nothing", async () => {
    const state: UsageState = {
      used: 0,
      ledger: new Set(),
      egressBytes: 31 * GB,
    };
    const { harness, done } = run(state);
    await done;
    expect(sentEmails(harness)).toHaveLength(0);
  });

  it("segment and storage metrics never collide at the same threshold", async () => {
    // Over on segments (100%) AND over on MMS storage (100%): four distinct
    // alerts, one per (metric, threshold) — the metric axis keeps the two 80s
    // and two 100s apart in the ledger.
    const state: UsageState = { used: 500, ledger: new Set(), mmsBytes: 5 * GB };
    const { harness, done } = run(state);
    await done;
    expect(sentEmails(harness)).toHaveLength(4);
    expect(state.ledger).toEqual(
      new Set([
        "segments:80",
        "segments:100",
        "mms_storage:80",
        "mms_storage:100",
      ]),
    );
  });

  it("one broken tenant does not starve the rest; the run still fails loudly", async () => {
    const OTHER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
    const ledger = new Set<number>();
    const harness = makeHarness([
      endpoint("GET", /\/rest\/v1\/companies/, () => [
        {
          id: COMPANY_ID,
          name: "Broken Co",
          plan: "starter",
          current_period_start: PERIOD_START,
        },
        {
          id: OTHER_ID,
          name: "Fine Co",
          plan: "starter",
          current_period_start: PERIOD_START,
        },
      ]),
      endpoint("POST", /\/rest\/v1\/rpc\/api_period_segments/, (call) => {
        const body = call.json() as { p_company_id: string };
        if (body.p_company_id === COMPANY_ID) {
          return new Response(JSON.stringify({ message: "boom" }), {
            status: 500,
          });
        }
        return 500; // Fine Co is at 100%
      }),
      endpoint("POST", /\/rest\/v1\/rpc\/api_storage_usage/, () => ({
        attachments_bytes: 0,
        mms_bytes: 0,
      })),
      endpoint("POST", /\/rest\/v1\/rpc\/api_period_voice_seconds/, () => 0),
      endpoint("POST", /\/rest\/v1\/rpc\/api_period_egress_bytes/, () => 0),
      endpoint("GET", /\/rest\/v1\/company_modules/, () => []),
      endpoint("POST", /\/rest\/v1\/usage_alerts/, (call) => {
        const row = call.json() as { threshold: number };
        ledger.add(row.threshold);
        return [{ company_id: OTHER_ID }];
      }),
      endpoint("GET", /\/rest\/v1\/company_members/, () => [
        { user_id: "11111111-1111-4111-8111-111111111111" },
      ]),
      endpoint("GET", /\/auth\/v1\/admin\/users\//, () => ({
        id: "11111111-1111-4111-8111-111111111111",
        email: "owner@example.com",
      })),
      endpoint("POST", /api\.resend\.com\/emails/, () => ({ id: "email_1" })),
    ]);
    stubFetch(harness.route);

    await expect(runUsageAlertsJob(env)).rejects.toThrow(
      /failed for 1 company/,
    );
    // Fine Co still got both alerts despite Broken Co's failure.
    expect(ledger).toEqual(new Set([80, 100]));
    expect(sentEmails(harness)).toHaveLength(2);
  });
});
