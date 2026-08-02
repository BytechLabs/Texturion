/**
 * #303 — the decision that separates a spammer from a busy roofer.
 *
 * The SQL suite proves the signals are computed correctly and read no message
 * content. What is left for here is the judgement: which combinations of those
 * numbers are worth putting in front of a person, and — much more important —
 * which are not.
 *
 * The issue's devil's advocate is the spec for this file: "a genuinely busy
 * crew after a storm looks statistically like a spammer, and suspending them
 * would be a catastrophic false positive." Every test below is a way that
 * mistake could be made.
 */
import { describe, expect, it, vi } from "vitest";

import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { aupConcerns, runAupWatchJob, type AupSignals } from "./aup-watch";

vi.mock("@sentry/cloudflare", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const env = completeEnv();

function signals(over: Partial<AupSignals> = {}): AupSignals {
  return {
    company_id: "cccccccc-0000-4000-8000-00000000000c",
    company_name: "Test Co",
    sent_24h: 0,
    baseline_daily: 0,
    fresh_ratio: 0,
    opt_outs_24h: 0,
    ...over,
  };
}

describe("what gets reported", () => {
  it("reports volume far above a workspace's own day AND mostly to strangers", () => {
    // The shape of a marketing blast, and the only shape that is.
    expect(
      aupConcerns(signals({ sent_24h: 900, baseline_daily: 40, fresh_ratio: 0.95 })),
    ).toHaveLength(1);
  });

  it("says nothing about a busy crew texting people who already called them", () => {
    // THE ONE THAT MATTERS. A roofer after a storm sends twenty times a normal
    // day — to their own customers. Reporting this is how the alert gets muted,
    // and acting on it would cost somebody their business on their best week.
    expect(
      aupConcerns(signals({ sent_24h: 900, baseline_daily: 40, fresh_ratio: 0.05 })),
    ).toEqual([]);
  });

  it("says nothing about a new workspace reaching only strangers", () => {
    // Every contact is new when you have no contacts. A ratio near 1.0 is the
    // correct reading of a workspace's first fortnight, not a breach — which is
    // why the stranger arm never fires alone.
    expect(
      aupConcerns(signals({ sent_24h: 120, baseline_daily: 0, fresh_ratio: 1 })),
    ).toEqual([]);
  });

  it("ignores a large multiple of a tiny baseline", () => {
    // A workspace whose usual day is two texts hits 5x by sending ten. That is
    // a Tuesday with one extra job on it, and a percentage of a small number is
    // exactly the arithmetic that produces confident nonsense.
    expect(
      aupConcerns(signals({ sent_24h: 10, baseline_daily: 2, fresh_ratio: 1 })),
    ).toEqual([]);
  });

  it("reports opt-outs on their own, because they are not our inference", () => {
    // Every other signal here is us reading a shape. This one is the
    // recipients pressing STOP, so it stands without the conjunction.
    const concerns = aupConcerns(signals({ sent_24h: 50, opt_outs_24h: 25 }));
    expect(concerns).toHaveLength(1);
    expect(concerns[0]).toContain("opt-outs");
  });
});

describe("the job", () => {
  function world(rows: AupSignals[]) {
    const sb = supabaseStub(env);
    const emails: Record<string, string>[] = [];
    sb.on("POST", "/rest/v1/rpc/api_aup_signals", () => rows);
    const resend: FetchRoute = async (url, request) => {
      if (url.href !== "https://api.resend.com/emails") return undefined;
      emails.push((await request.clone().json()) as Record<string, string>);
      return Response.json({ id: "email_1" });
    };
    return { sb, emails, routes: [sb.route, resend] };
  }

  it("mails ops once for the whole run, not once per workspace", async () => {
    // The reader is one founder, and the pattern across workspaces is itself
    // information: three at once is a different problem from one.
    const w = world([
      signals({ company_id: "a", sent_24h: 900, baseline_daily: 40, fresh_ratio: 0.95 }),
      signals({ company_id: "b", sent_24h: 800, baseline_daily: 30, fresh_ratio: 0.9 }),
    ]);
    stubFetch(...w.routes);

    const flagged = await runAupWatchJob(env, new Date(), undefined);

    expect(flagged).toBe(2);
    expect(w.emails).toHaveLength(1);
  });

  it("says plainly that nothing was done to them", async () => {
    // The alert has to carry its own posture. A founder reading "3 workspaces
    // breaching the AUP" at 7am, with no statement that this is a look-at-it,
    // is one click from suspending a customer on the evidence of a ratio.
    const w = world([
      signals({ sent_24h: 900, baseline_daily: 40, fresh_ratio: 0.95 }),
    ]);
    stubFetch(...w.routes);

    await runAupWatchJob(env, new Date(), undefined);

    expect(w.emails[0].text).toContain("NOTHING HAS BEEN DONE TO THEM");
    expect(w.emails[0].text).toContain("never message content");
  });

  it("stays silent on an ordinary day", async () => {
    // The common case, and the one that decides whether the mailbox is read at
    // all: a quiet run must send nothing rather than an all-clear.
    const w = world([
      signals({ sent_24h: 400, baseline_daily: 380, fresh_ratio: 0.1 }),
    ]);
    stubFetch(...w.routes);

    const flagged = await runAupWatchJob(env, new Date(), undefined);

    expect(flagged).toBe(0);
    expect(w.emails).toHaveLength(0);
  });
});
