/**
 * Usage-alert job suite (SPEC §2, §9, §11): the 80/100% percent arms
 * (segments, voice, egress) computed against real usage sums, plus the #121
 * storage_abuse arm (absolute GB tiers over TOTAL stored bytes — customer +
 * ops email, storage never blocks). One email set per
 * (company, period, metric, threshold) via the usage_alerts ledger. Real
 * product code with only global fetch stubbed.
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
  /**
   * api_storage_usage bytes — the #121 storage_abuse arm SUMS both figures
   * against the absolute tiers (default 0 → no storage alert).
   */
  mmsBytes?: number;
  attachmentBytes?: number;
  /** api_period_forward_seconds (D36 — default 0 → no voice alerts). */
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
      /\/rest\/v1\/rpc\/api_period_forward_seconds/,
      () => state.voiceSeconds ?? 0,
    ),
    endpoint(
      "POST",
      /\/rest\/v1\/rpc\/api_period_egress_bytes/,
      () => state.egressBytes ?? 0,
    ),
    // #121: NO company_modules endpoint — the per-budget storage arms (and
    // their extra_storage-aware budget resolution) are gone; a read of
    // company_modules would fail loudly as unstubbed.
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

/** Bytes per GB (the #121 abuse tiers and the egress pool are stated in GB). */
const GB = 1024 * 1024 * 1024;

function run(state: UsageState): { harness: Harness; done: Promise<void> } {
  const harness = makeHarness(usageEndpoints(state));
  stubFetch(harness.route);
  return { harness, done: runUsageAlertsJob(env) };
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

  it("total stored bytes below the 25 GB abuse tier: no alert, and no budget resolution remains (#121)", async () => {
    // 20 GB attachments + 4 GB MMS = 24 GB total — under the first tier.
    // (Under the RETIRED per-budget arms this would already have alerted;
    // #121 replaced them with absolute tiers over the SUM.)
    const state: UsageState = {
      used: 0,
      ledger: new Set(),
      attachmentBytes: 20 * GB,
      mmsBytes: 4 * GB,
    };
    const { harness, done } = run(state);
    await done;
    expect(sentEmails(harness)).toHaveLength(0);
    expect(harness.callsTo("POST", /usage_alerts/)).toHaveLength(0);
  });

  it("crossing 25 GB (summed attachments + MMS) sends the friendly customer note AND the ops copy once (#121)", async () => {
    // 15 GB files + 10 GB pictures = exactly 25 GB — at the tier counts as
    // crossed (>=), and it is the SUM that matters, not either pool alone.
    const state: UsageState = {
      used: 0,
      ledger: new Set(),
      attachmentBytes: 15 * GB,
      mmsBytes: 10 * GB,
    };
    const { harness, done } = run(state);
    await done;
    const emails = sentEmails(harness);
    expect(emails).toHaveLength(2);
    // Customer copy: friendly and explicitly non-blocking, to owner/admins.
    expect(emails[0].subject).toBe("A note about Acme Plumbing's storage");
    expect(emails[0].to).toEqual(["owner@example.com"]);
    expect(emails[0].text).toContain("free and nothing is paused");
    // Ops copy rides the SAME ledger claim, to OPS_ALERT_EMAIL (unset in the
    // test env → the support@loonext.com default).
    expect(emails[1].subject).toBe(
      "[ops] storage abuse tier 25 GB: Acme Plumbing",
    );
    expect(emails[1].to).toEqual(["support@loonext.com"]);
    // ONE ledger row: metric storage_abuse, threshold = the GB tier.
    expect(state.ledger).toEqual(new Set(["storage_abuse:25"]));

    // Second run in the same period: the ledger row suppresses BOTH emails.
    const again = run(state);
    await again.done;
    expect(sentEmails(again.harness)).toHaveLength(0);
  });

  it("a runaway tenant crossing multiple tiers in one run records one row per tier (#121)", async () => {
    // 70 + 50 = 120 GB total: crosses 25, 50, and 100 — not 200/400.
    const state: UsageState = {
      used: 0,
      ledger: new Set(),
      attachmentBytes: 70 * GB,
      mmsBytes: 50 * GB,
    };
    const { harness, done } = run(state);
    await done;
    const emails = sentEmails(harness);
    // Three crossings × (customer + ops), escalating tiers in order.
    expect(emails).toHaveLength(6);
    expect(
      emails
        .map((email) => email.subject)
        .filter((subject) => subject.startsWith("[ops] storage abuse tier")),
    ).toEqual([
      "[ops] storage abuse tier 25 GB: Acme Plumbing",
      "[ops] storage abuse tier 50 GB: Acme Plumbing",
      "[ops] storage abuse tier 100 GB: Acme Plumbing",
    ]);
    expect(state.ledger).toEqual(
      new Set(["storage_abuse:25", "storage_abuse:50", "storage_abuse:100"]),
    );

    // Converged: the next run in the same period is a pure no-op.
    const again = run(state);
    await again.done;
    expect(sentEmails(again.harness)).toHaveLength(0);
  });

  it("voice minutes at 100% (starter: 2,500 min) sends both forwarded-minute alerts (D36)", async () => {
    const state: UsageState = {
      used: 0,
      ledger: new Set(),
      voiceSeconds: 2500 * 60,
    };
    const { harness, done } = run(state);
    await done;
    const emails = sentEmails(harness);
    const subjects = emails.map((email) => email.subject);
    expect(subjects).toHaveLength(2);
    expect(subjects[0]).toContain("80% of its included calling minutes");
    expect(subjects[1]).toContain("all 2500 included calling minutes");
    // D36: the copy promises billed overage up to the cap — never a silent
    // pause at the allowance, and never a surprise bill.
    expect(emails[1].text).toContain("billed at 1¢ each");
    expect(emails[1].text).toContain("up to your spending cap");
    expect(state.ledger).toEqual(
      new Set(["voice_minutes:80", "voice_minutes:100"]),
    );
  });

  it("voice thresholds follow the plan allowance (pro: 4,800 of 6,000 = 80%)", async () => {
    const state: UsageState = {
      used: 0,
      ledger: new Set(),
      plan: "pro",
      voiceSeconds: 4800 * 60,
    };
    const { harness, done } = run(state);
    await done;
    const emails = sentEmails(harness);
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toContain("80% of its included calling minutes");
    expect(state.ledger).toEqual(new Set(["voice_minutes:80"]));
  });

  it("voice minutes below 80% sends nothing", async () => {
    const state: UsageState = {
      used: 0,
      ledger: new Set(),
      voiceSeconds: 1000 * 60, // 1,000 of 2,500 min (starter allowance)
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

  it("egress at 100% (the fixed 200 GB pool) sends both download alerts (#16/#121)", async () => {
    // #121: the allowance is a FIXED 200 GB per period for every plan — no
    // longer 4× the (retired) storage budgets.
    const state: UsageState = {
      used: 0,
      ledger: new Set(),
      egressBytes: 200 * GB,
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

  it("egress at exactly 80% (160 of 200 GB) sends only the 80% download alert", async () => {
    const state: UsageState = {
      used: 0,
      ledger: new Set(),
      egressBytes: 160 * GB,
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
      egressBytes: 159 * GB, // just under 80% of the fixed 200 GB pool
    };
    const { harness, done } = run(state);
    await done;
    expect(sentEmails(harness)).toHaveLength(0);
  });

  it("segment and storage metrics never collide at the same threshold", async () => {
    // Over on segments (100%) AND stored past the 100 GB tier: the ledger
    // carries BOTH a segments:100 and a storage_abuse:100 row — the metric
    // axis keeps the identical threshold number 100 apart (#121: the abuse
    // tier is a GB figure, but it shares the same threshold column).
    const state: UsageState = {
      used: 500,
      ledger: new Set(),
      attachmentBytes: 100 * GB,
    };
    const { harness, done } = run(state);
    await done;
    // 2 segment alerts + 3 crossed tiers × (customer + ops) = 8.
    expect(sentEmails(harness)).toHaveLength(8);
    expect(state.ledger).toEqual(
      new Set([
        "segments:80",
        "segments:100",
        "storage_abuse:25",
        "storage_abuse:50",
        "storage_abuse:100",
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
      endpoint("POST", /\/rest\/v1\/rpc\/api_period_forward_seconds/, () => 0),
      endpoint("POST", /\/rest\/v1\/rpc\/api_period_egress_bytes/, () => 0),
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
