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

/**
 * #303 — the carrier's own verdict.
 *
 * CB-1 is the point of the signal. Velocity and fan-out are inferences about a
 * SHAPE, and the conjunction exists because either alone is something ordinary
 * businesses do. A carrier rejecting messages as spam is not a shape — a
 * network has already decided — and the filtering that comes with it applies
 * to the sending pool, so it is spending every other customer's
 * deliverability while it accumulates.
 */
describe("#303 carrier spam-rejections", () => {
  /** A workspace doing nothing else wrong. */
  const calm = {
    company_id: "c1",
    company_name: "Reed Roofing",
    sent_24h: 40,
    baseline_daily: 35,
    fresh_ratio: 0.1,
    opt_outs_24h: 0,
  };

  it("CB-1: stands alone — no velocity, no fan-out, still reported", () => {
    const concerns = aupConcerns({ ...calm, spam_blocks_24h: 9 });
    expect(concerns).toHaveLength(1);
    expect(concerns[0]).toMatch(/rejected by carriers as spam/i);
  });

  it("CB-2: says whose verdict it is, and who pays for it", () => {
    // The email is read by somebody deciding whether to phone a customer. That
    // this is a network's decision rather than ours is the fact that makes the
    // call easy, and that it costs every other workspace is why it is urgent.
    const [concern] = aupConcerns({ ...calm, spam_blocks_24h: 9 });
    expect(concern).toMatch(/not our\s+reading|a network's/i);
    expect(concern).toMatch(/every workspace sharing our numbers/i);
  });

  it("CB-3: a handful is not an alarm", () => {
    // A bad number list or one badly-worded template produces a few. Reporting
    // on those trains whoever reads these to skim, and a skimmed alert is the
    // same as none.
    expect(aupConcerns({ ...calm, spam_blocks_24h: 4 })).toEqual([]);
  });

  it("CB-4: an absent count is not an alarm", () => {
    // A Worker deployed ahead of the migration reads undefined. That must be
    // "nothing to report", not a division by zero or an alert for everybody.
    expect(aupConcerns(calm)).toEqual([]);
    expect(aupConcerns({ ...calm, spam_blocks_24h: undefined })).toEqual([]);
  });

  it("CB-5: it is reported ALONGSIDE the other concerns, not instead of them", () => {
    // A workspace blasting strangers AND being blocked has two problems, and
    // the email that mentions one is the email that gets the wrong response.
    const concerns = aupConcerns({
      company_id: "c1",
      company_name: "Blast Co",
      sent_24h: 5000,
      baseline_daily: 100,
      fresh_ratio: 0.95,
      opt_outs_24h: 40,
      spam_blocks_24h: 60,
    });
    expect(concerns).toHaveLength(3);
    expect(concerns.join(" ")).toMatch(/marketing blast/);
    expect(concerns.join(" ")).toMatch(/opt-outs/);
    expect(concerns.join(" ")).toMatch(/rejected by carriers/);
  });
});

/**
 * #303 — complaint RATIOS, the last signal the issue names.
 *
 * CR-1 is why they exist. The count thresholds answer the wrong question for
 * half our customers: ten opt-outs against ten thousand sends is a good week,
 * ten against forty is a workspace texting people who never asked. A count
 * catches the second only by accident, and a bought list on a small workspace
 * is exactly the shape it misses.
 */
describe("#303 complaint ratios", () => {
  const base = {
    company_id: "c1",
    company_name: "Reed Roofing",
    baseline_daily: 200,
    fresh_ratio: 0.1,
    opt_outs_24h: 0,
    spam_blocks_24h: 0,
  };

  it("CR-1: a small workspace with a terrible rate is caught", () => {
    // Four opt-outs is under the count alarm of ten and would have passed
    // silently. Four from sixty is 7%, which does not happen to somebody
    // texting people who asked to hear from them.
    const concerns = aupConcerns({ ...base, sent_24h: 60, opt_outs_24h: 4 });
    expect(concerns).toHaveLength(1);
    expect(concerns[0]).toMatch(/7% of this workspace's 60 sends/);
    expect(concerns[0]).toMatch(/did not expect them/);
  });

  it("CR-2: a large workspace is not punished for being busy", () => {
    // Nine opt-outs against four thousand sends is 0.2%. A count-only model
    // says nothing here either, but the point is that adding ratios must not
    // start shouting at the healthiest customers.
    expect(aupConcerns({ ...base, sent_24h: 4000, opt_outs_24h: 9 })).toEqual([]);
  });

  it("CR-3: the volume floor stops a quiet workspace tripping on its first STOP", () => {
    // One opt-out from three sends is 33%. Without the floor every workspace
    // in the product trips the week somebody unsubscribes, and the alerts
    // become noise before the feature has caught anything.
    expect(aupConcerns({ ...base, sent_24h: 3, opt_outs_24h: 1 })).toEqual([]);
    // 9 from 49 is 18% and still below the floor. Deliberately 9 and not 40:
    // forty opt-outs trips the COUNT alarm whatever the volume, so the first
    // version of this line was testing that instead of the floor, and failed.
    // The count staying live below the floor is the right behaviour — a
    // workspace collecting forty STOPs is worth a look at any size.
    expect(aupConcerns({ ...base, sent_24h: 49, opt_outs_24h: 9 })).toEqual([]);
    expect(
      aupConcerns({ ...base, sent_24h: 49, opt_outs_24h: 40 }),
    ).toHaveLength(1);
  });

  it("CR-4: the same fact is not reported twice in different arithmetic", () => {
    // Sixty opt-outs from a thousand sends trips the COUNT alarm. Reporting
    // the ratio alongside it says nothing new, and an email that repeats
    // itself is one that gets skimmed.
    const concerns = aupConcerns({ ...base, sent_24h: 1000, opt_outs_24h: 60 });
    expect(concerns).toHaveLength(1);
    expect(concerns[0]).toMatch(/recipients' own verdict/);
  });

  it("CR-5: a carrier-rejection rate is caught below the count alarm too", () => {
    // Three rejections is under the alarm of five. Three from a hundred is
    // 3%, and a network rejecting three in every hundred is already filtering
    // the pool every other customer sends from.
    const concerns = aupConcerns({ ...base, sent_24h: 100, spam_blocks_24h: 3 });
    expect(concerns).toHaveLength(1);
    expect(concerns[0]).toMatch(/rejected by a carrier/);
    expect(concerns[0]).toMatch(/does not happen to a workspace/);
  });

  it("CR-6: a healthy workspace stays quiet", () => {
    // The assertion that stops every test above from passing against a
    // function that reports everybody.
    expect(
      aupConcerns({ ...base, sent_24h: 800, opt_outs_24h: 2, spam_blocks_24h: 1 }),
    ).toEqual([]);
  });
});
