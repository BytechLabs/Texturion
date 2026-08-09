/**
 * #387 — the Worker's half of the liveness primitive.
 *
 * The ledger's arithmetic (seeding, grace, re-alert throttling, recovery) is
 * SQL and is covered by supabase/tests/liveness.test.sql. What this suite owns
 * is what the Worker decides:
 *
 *   - that the declaration is COMPLETE in both directions. TypeScript already
 *     refuses a cron schedule with no expectation; nothing but a test can
 *     catch the reverse — an expectation for a trigger that no longer exists,
 *     which would alert forever about a job that was deliberately deleted;
 *   - that every expectation is actually alertable (a cadence of zero, or a
 *     `what` that does not say what broke, is a declaration in name only);
 *   - that a heartbeat write can never take down the thing it is measuring;
 *   - that the outbound-SMS probe reads success rather than mere existence.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { CRON_JOBS, runScheduledJobs } from "../index";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { runLivenessCheckJob } from "./liveness-check";
import {
  LIVENESS_EXPECTATIONS,
  recordHeartbeat,
  recordHeartbeatBestEffort,
} from "./liveness";

const env = completeEnv();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the declaration is complete in both directions", () => {
  it("declares an expectation for every cron schedule", () => {
    // The compiler already enforces this — CRON_JOBS is keyed by CronSchedule,
    // which is derived from these keys — so this test exists to say so out
    // loud and to fail loudly if that typing is ever loosened back to
    // Record<string, ...>.
    for (const schedule of Object.keys(CRON_JOBS)) {
      expect(
        LIVENESS_EXPECTATIONS,
        `cron "${schedule}" has no liveness expectation`,
      ).toHaveProperty(`cron:${schedule}`);
    }
  });

  it("declares no expectation for a cron that no longer exists", () => {
    // The direction the compiler CANNOT catch. A deleted trigger whose
    // expectation was left behind alerts every six hours, forever, about a job
    // that was removed on purpose — and a channel that cries about phantoms is
    // one the founder stops opening.
    const schedules = new Set(Object.keys(CRON_JOBS));
    for (const key of Object.keys(LIVENESS_EXPECTATIONS)) {
      if (!key.startsWith("cron:")) continue;
      expect(
        schedules.has(key.slice("cron:".length)),
        `${key} is declared but no such cron is registered`,
      ).toBe(true);
    }
  });

  it("gives every expectation a real cadence and a sentence worth reading", () => {
    for (const [key, spec] of Object.entries(LIVENESS_EXPECTATIONS)) {
      expect(spec.everyMinutes, `${key} cadence`).toBeGreaterThan(0);
      // Grace may be zero in principle; negative would make a key permanently
      // overdue the instant it is declared.
      expect(spec.graceMinutes, `${key} grace`).toBeGreaterThanOrEqual(0);
      // The alert names the thing that did not happen. "cron:0 14 * * *" in an
      // inbox at 3am tells the founder nothing they can act on.
      expect(spec.what.length, `${key} description`).toBeGreaterThan(20);
    }
  });

  /**
   * #510 — the requiredness of `doThis` is a type, but its USEFULNESS cannot be.
   *
   * TypeScript is satisfied by `doThis: "investigate"`, which is the founder's
   * complaint verbatim ("what do I do?? there is nothing actionable?") wearing
   * a field name. So the compiler enforces that an answer exists and this
   * enforces that it is an answer: something the reader can DO without already
   * knowing this codebase — a log line to search, a console path to open, a
   * table to read, an environment variable to compare.
   *
   * Deliberately a shape check, not a wording check. A test that pinned
   * phrasing would be a ceiling on how these are written rather than a floor
   * under how useful they are, and the next person would route around it.
   */
  it("answers 'what do I do?' with something concrete, for every key", () => {
    // A backticked identifier, a `→` console path, a URL, or a SCREAMING_CASE
    // env var. Any one of them is a thing the reader can act on; prose with
    // none of them is a restatement of the problem.
    const CONCRETE = /`[^`]+`|→|https?:\/\/|[A-Z][A-Z0-9_]{4,}/;
    // The two the doc comment calls out by name: they fit all ~76 keys here,
    // which is exactly what makes them worthless.
    const RESTATEMENTS = /check the logs|investigate the (issue|problem)/i;

    for (const [key, spec] of Object.entries(LIVENESS_EXPECTATIONS)) {
      const doThis: string = spec.doThis;
      expect(doThis, `${key} names no concrete first move`).toMatch(CONCRETE);
      expect(doThis, `${key} restates the problem`).not.toMatch(RESTATEMENTS);
      // Long enough to name a move and its consequence. The shortest honest
      // answer here ("nothing to do, it clears when X") still clears this.
      expect(doThis.length, `${key} remedy length`).toBeGreaterThan(80);
    }
  });
});

describe("recording a heartbeat", () => {
  it("reports a recovery so the founder learns the outage ended", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/record_heartbeat", () => ({
      key: "cron:* * * * *",
      recovered: true,
    }));
    stubFetch(sb.route);

    await expect(recordHeartbeat(env, "cron:* * * * *")).resolves.toBe(true);
  });

  it("never lets a bookkeeping write take down the thing it measures", async () => {
    // recordHeartbeatBestEffort is what `scheduled()` calls. If the liveness
    // write could throw there, a database hiccup would mark an otherwise
    // healthy cron run as failed — the measurement breaking the measured.
    // The failed write is itself an absence, which the checker catches one
    // cadence later. That is the mechanism working, not a hole in it.
    stubFetch(async () => new Response("nope", { status: 500 }));

    await expect(
      recordHeartbeatBestEffort(env, "cron:* * * * *"),
    ).resolves.toBeUndefined();
  });
});

/** The instant every check in this file runs at. */
const CHECK_NOW = new Date("2026-07-28T12:00:00Z");

/** A world where the RPCs answer, and every outbound call is captured. */
function checkWorld(options: {
  overdue?: Record<string, unknown>[];
  smsRows?: Record<string, unknown>[];
  /**
   * #510 — what the WEEK-long baseline read returns, as distinct from the hour.
   *
   * The probe now asks two questions: "has anything sent in the last hour?"
   * and, only if not, "has this platform ever sent anything?". They hit the
   * same table with different `created_at` floors, so the stub tells them
   * apart by that floor rather than by call order.
   */
  smsBaselineRows?: Record<string, unknown>[];
  /** #308 — what `api_webhook_inbound_probe` reports. Default: all quiet. */
  inbound?: Record<string, unknown>;
  /** #308 — fail the probe RPC itself with this HTTP status. */
  inboundStatus?: number;
}) {
  const sb = supabaseStub(env);
  const beats: string[] = [];
  sb.on("GET", "/rest/v1/messages", (call) => {
    // The hourly probe floors at now-60m; the baseline at now-7d. Anything
    // older than a day back is the baseline read.
    const gte = call.url.searchParams.get("created_at") ?? "";
    const floor = gte.replace(/^gte\./, "");
    // Anchored to the CHECK's clock, not the wall clock: every test here
    // passes a fixed `now`, and comparing against Date.now() classified both
    // reads as the baseline.
    const isBaseline =
      floor !== "" &&
      CHECK_NOW.getTime() - new Date(floor).getTime() > 24 * 60 * 60_000;
    return isBaseline
      ? (options.smsBaselineRows ?? [])
      : (options.smsRows ?? []);
  });
  // Registered here rather than overridden by the caller: stub handlers run in
  // REGISTRATION order and the first non-undefined wins, so a later `on()` for
  // the same path would never be reached.
  sb.on("POST", "/rest/v1/rpc/api_webhook_inbound_probe", () =>
    options.inboundStatus !== undefined
      ? new Response("boom", { status: options.inboundStatus })
      : {
          inbound_message: 0,
          message_status: 0,
          call_event: 0,
          telnyx_accepted: 0,
          rejections: {},
          ...(options.inbound ?? {}),
        },
  );
  sb.on("POST", "/rest/v1/rpc/record_heartbeat", (call) => {
    beats.push((call.body as { p_key: string }).p_key);
    return { recovered: false };
  });
  sb.on("POST", "/rest/v1/rpc/api_liveness_check", () => ({
    overdue: options.overdue ?? [],
    seeded: [],
  }));

  const emails: Record<string, unknown>[] = [];
  const resend: FetchRoute = async (url, request) => {
    if (url.href !== "https://api.resend.com/emails") return undefined;
    emails.push((await request.clone().json()) as Record<string, unknown>);
    return Response.json({ id: "email_1" });
  };
  return { sb, beats, emails, routes: [sb.route, resend] };
}

describe("the checker", () => {
  it("says nothing when nothing is overdue", async () => {
    const world = checkWorld({});
    stubFetch(...world.routes);

    const result = await runLivenessCheckJob(env, CHECK_NOW);

    expect(result.overdue).toBe(0);
    expect(world.emails).toHaveLength(0);
  });

  it("emails the founder what did not happen, and how long ago", async () => {
    const world = checkWorld({
      overdue: [
        {
          key: "cron:0 15 * * *",
          what: "The daily subscription reconcile has not run.",
          last_seen_at: "2026-07-27T15:00:00Z",
          due_by: "2026-07-28T03:00:00Z",
          first_alert: true,
        },
      ],
    });
    stubFetch(...world.routes);

    await runLivenessCheckJob(env, CHECK_NOW);

    expect(world.emails).toHaveLength(1);
    const email = world.emails[0] as { subject: string; text: string };
    expect(email.subject).toContain("did not happen");
    expect(email.text).toContain("cron:0 15 * * *");
    expect(email.text).toContain("The daily subscription reconcile has not run.");
    // 21 hours stale — the number is the difference between "check this" and
    // "this has been broken since yesterday".
    expect(email.text).toContain("1260 min ago");
  });

  /**
   * #510 — "I keep getting emails like this but what do I do??"
   *
   * The remedy must arrive with the alert, on its own labelled line, in both
   * bodies. Appending it to `what` would technically put the words in the
   * email and would not fix anything: the complaint was that the message ended
   * on the diagnosis, so the reader had to supply the next step themselves at
   * whatever hour it landed.
   */
  it("tells the founder what to DO, not only what broke", async () => {
    const world = checkWorld({
      overdue: [
        {
          key: "cron:0 15 * * *",
          what: "The daily subscription reconcile has not run.",
          last_seen_at: "2026-07-27T15:00:00Z",
          due_by: "2026-07-28T03:00:00Z",
          first_alert: true,
        },
      ],
    });
    stubFetch(...world.routes);

    await runLivenessCheckJob(env, CHECK_NOW);

    const email = world.emails[0] as { text: string; html: string };
    expect(email.text).toContain("DO THIS:");
    expect(email.text).toContain(
      LIVENESS_EXPECTATIONS["cron:0 15 * * *"].doThis,
    );
    // And in the HTML, which is the body the founder actually reads — with its
    // own label, so it cannot be mistaken for a fourth line of the diagnosis.
    expect(email.html).toContain("Do this");
    expect(email.html).toContain("Cron Triggers");
  });

  /**
   * The identifiers a remedy names are the parts that have to be copied
   * exactly, so they are backticked — which the plain-text body renders as-is
   * and the HTML body must render as monospace rather than as literal
   * backticks, i.e. markdown that visibly failed.
   */
  it("sets the identifiers it names in monospace, and cannot be forged", async () => {
    const world = checkWorld({
      overdue: [
        {
          key: "job:report-usage",
          what: "Usage is not reaching Stripe.",
          last_seen_at: "2026-07-27T15:00:00Z",
          due_by: "2026-07-28T03:00:00Z",
          first_alert: true,
        },
      ],
    });
    stubFetch(...world.routes);

    await runLivenessCheckJob(env, CHECK_NOW);

    const email = world.emails[0] as { html: string };
    // `stripe_reported_at` is backticked in that key's remedy.
    expect(email.html).toContain("<code");
    expect(email.html).toContain("stripe_reported_at</code>");
    // Escaping runs FIRST, so nothing in the alert's own text can close a tag
    // or open one of its own. The RPC's `what` is the untrusted-ish half here
    // (it round-trips through SQL), and it is escaped by the same path.
    expect(email.html).not.toContain("<script");
  });

  /**
   * The remedy is looked up from the DECLARATION by key, not echoed back by
   * the RPC, so a key the checker never declared has no answer to give. That
   * is unreachable in practice — it only asks about what it sent — and the
   * failure mode if it ever happens must be a readable alert, not a crash that
   * takes down the whole email and silences every other overdue key with it.
   */
  it("blames the alert, not the reader, for a key it never declared", async () => {
    const world = checkWorld({
      overdue: [
        {
          key: "cron:0 4 * * *",
          what: "A schedule that is no longer declared has not run.",
          last_seen_at: "2026-07-27T15:00:00Z",
          due_by: "2026-07-28T03:00:00Z",
          first_alert: true,
        },
      ],
    });
    stubFetch(...world.routes);

    await expect(runLivenessCheckJob(env, CHECK_NOW)).resolves.toBeDefined();

    const email = world.emails[0] as { text: string };
    expect(email.text).toContain("LIVENESS_EXPECTATIONS");
  });
});

describe("the outbound-SMS probe", () => {
  it("beats when a text actually reached the carrier", async () => {
    const world = checkWorld({ smsRows: [{ id: "m1" }] });
    stubFetch(...world.routes);

    await runLivenessCheckJob(env, CHECK_NOW);

    expect(world.beats).toContain("channel:sms-outbound");
  });

  /**
   * #510 — THE ONE THE FOUNDER REPORTED.
   *
   * "I keep getting emails like this but what do I do?? there is nothing
   * actionable?" — about an alert whose own text read "Either nobody is
   * texting, or sending is broken and every workspace is silent."
   *
   * A platform with a handful of workspaces is silent most evenings, so this
   * fired every six hours forever and taught its only reader to delete it.
   */
  it("says nothing when the platform has never been busy", async () => {
    const world = checkWorld({ smsRows: [], smsBaselineRows: [] });
    stubFetch(...world.routes);

    await runLivenessCheckJob(env, CHECK_NOW);

    // Heartbeat, so the expectation stays satisfied: nothing has STOPPED that
    // ever started. Not a snooze — one real text makes the hourly window
    // meaningful again by itself.
    expect(world.beats).toContain("channel:sms-outbound");
  });

  /**
   * ...and the negative control, which is the whole point. Without this, the
   * fix above would read identically to switching the alert off.
   */
  it("still goes quiet when a BUSY platform stops sending", async () => {
    const world = checkWorld({ smsRows: [], smsBaselineRows: [{ id: "old" }] });
    stubFetch(...world.routes);

    await runLivenessCheckJob(env, CHECK_NOW);

    // No heartbeat means the key ages toward its own alert. The probe never
    // asserts an outage itself — it only declines to say the channel is alive.
    expect(world.beats).not.toContain("channel:sms-outbound");
  });

  it("asks for delivered messages, not merely queued ones", async () => {
    // A row we queued and never handed to the carrier is not evidence that
    // sending works — it is the evidence that it does not.
    const world = checkWorld({ smsRows: [{ id: "m1" }] });
    stubFetch(...world.routes);

    await runLivenessCheckJob(env, CHECK_NOW);

    const probe = world.sb.calls.find((call) => call.path === "/rest/v1/messages");
    expect(probe?.url.href).toContain("sent");
    expect(probe?.url.href).toContain("delivered");
    expect(probe?.url.href).not.toContain("queued");
  });
});


describe("per-job heartbeats (#333)", () => {
  /** Captures which keys were beaten during a run. */
  function beatWorld() {
    const sb = supabaseStub(env);
    const beats: string[] = [];
    sb.on("POST", "/rest/v1/rpc/record_heartbeat", (call) => {
      beats.push((call.body as { p_key: string }).p_key);
      return { recovered: false };
    });
    return { sb, beats };
  }

  const at = CHECK_NOW;

  it("beats for a job that succeeded", async () => {
    const world = beatWorld();
    stubFetch(world.sb.route);

    await runScheduledJobs(
      env,
      "*/5 * * * *",
      [{ key: "job:sweep-webhooks", run: async () => undefined }],
      at,
    );

    expect(world.beats).toEqual(["job:sweep-webhooks"]);
  });

  it("withholds the beat from a job that threw", async () => {
    // The whole point of #333's "consecutive failures, distinct from absence":
    // a job broken every single run must go overdue exactly like one that
    // never ran. If it beat here, it would look healthy forever while doing
    // nothing, and the schedule heartbeat could not tell the difference —
    // the trigger fired either way.
    const world = beatWorld();
    stubFetch(world.sb.route);

    await expect(
      runScheduledJobs(
        env,
        "*/5 * * * *",
        [{ key: "job:sweep-webhooks", run: async () => { throw new Error("boom"); } }],
        at,
      ),
    ).rejects.toThrow(/1 of 1 job/);

    expect(world.beats).toEqual([]);
  });

  it("lets a healthy sibling beat when the one before it failed", async () => {
    // Jobs on a shared trigger fail independently. A broken job must not
    // silence the ones after it, or one bad job makes six others look dead
    // and the alert stops pointing at the actual fault.
    const world = beatWorld();
    stubFetch(world.sb.route);

    await expect(
      runScheduledJobs(
        env,
        "*/5 * * * *",
        [
          { key: "job:sweep-webhooks", run: async () => { throw new Error("boom"); } },
          { key: "job:fail-stuck-sends", run: async () => undefined },
        ],
        at,
      ),
    ).rejects.toThrow(/1 of 2 job/);

    expect(world.beats).toEqual(["job:fail-stuck-sends"]);
  });
});

describe("the inbound-webhook probe (#308)", () => {
  const AT = CHECK_NOW;

  it("beats each event class independently", async () => {
    // The whole reason there are three keys: "message webhooks fine, call
    // webhooks dead" is a real shape, and one combined key would report the
    // path as healthy while every inbound call rang nowhere.
    const world = checkWorld({
      inbound: { inbound_message: 4, message_status: 9, call_event: 0 },
    });
    stubFetch(...world.routes);

    await runLivenessCheckJob(env, AT);

    expect(world.beats).toContain("channel:telnyx-inbound-message");
    expect(world.beats).toContain("channel:telnyx-message-status");
    expect(world.beats).not.toContain("channel:telnyx-call-events");
  });

  it("beats nothing when the whole inbound path is silent", async () => {
    // No heartbeat means each key ages toward its own alert. The probe never
    // asserts an outage itself — absence is the signal.
    const world = checkWorld({});
    stubFetch(...world.routes);

    await runLivenessCheckJob(env, AT);

    expect(world.beats).not.toContain("channel:telnyx-inbound-message");
    expect(world.beats).not.toContain("channel:telnyx-message-status");
    expect(world.beats).not.toContain("channel:telnyx-call-events");
  });

  it("treats rejections ALONGSIDE acceptances as noise, not an outage", async () => {
    // A retry, a stale delivery, a probe. If this alerted, it would alert
    // constantly and be muted — and then the real signal below goes with it.
    const world = checkWorld({
      inbound: { telnyx_accepted: 12, rejections: { telnyx: 3 } },
    });
    stubFetch(...world.routes);

    await runLivenessCheckJob(env, AT);

    expect(world.beats).toContain("channel:webhook-signature");
  });

  it("withholds the beat when we reject signed deliveries and accept none", async () => {
    // The rotated-secret shape, and the only thing that looks like it: the
    // provider believes it is delivering, nothing here throws, and every
    // delivery is discarded.
    const world = checkWorld({
      inbound: { telnyx_accepted: 0, rejections: { telnyx: 7 } },
    });
    stubFetch(...world.routes);

    await runLivenessCheckJob(env, AT);

    expect(world.beats).not.toContain("channel:webhook-signature");
  });

  it("#581/16: withholds the beat when STRIPE is discarding everything", async () => {
    /**
     * THE CASE THE ALARM COULD NOT SEE. Rejections were summed across every provider
     * and divided by TELNYX's acceptances — and inbound texts arrive all day, so that
     * denominator is essentially never zero.
     *
     * Rotate or mis-copy the Stripe secret and every delivery 400s in silence. A
     * rejected delivery never becomes a `webhook_events` row, so the five-minute
     * sweeper has nothing to replay, and `charge.dispute.created/updated/closed` has
     * no other entry point in this product: a customer disputes a charge and their
     * workspace keeps full service, with nothing anywhere saying so.
     */
    const world = checkWorld({
      inbound: {
        telnyx_accepted: 400,
        accepted: { telnyx: 400 },
        rejections: { stripe: 9 },
      },
    });
    stubFetch(...world.routes);

    await runLivenessCheckJob(env, AT);

    expect(world.beats).not.toContain("channel:webhook-signature");
  });

  it("#581/16: and for RESEND, whose rotation stops every bounce being recorded", async () => {
    // No bounce recorded means no address suppressed, which means we keep mailing
    // addresses that have already hard bounced — and that is how a sending domain's
    // reputation goes. Busy Telnyx traffic used to hold the alarm quiet through it.
    const world = checkWorld({
      inbound: {
        telnyx_accepted: 400,
        accepted: { telnyx: 400 },
        rejections: { resend: 4 },
      },
    });
    stubFetch(...world.routes);

    await runLivenessCheckJob(env, AT);

    expect(world.beats).not.toContain("channel:webhook-signature");
  });

  it("#581/16: a provider rejecting AND accepting is still just noise", async () => {
    // Per provider, the two numbers finally describe the same thing — so Stripe
    // retries alongside Stripe acceptances read as noise, exactly as Telnyx's do,
    // and a busy Telnyx does not vouch for anybody else.
    const world = checkWorld({
      inbound: {
        telnyx_accepted: 400,
        accepted: { telnyx: 400, stripe: 20 },
        rejections: { stripe: 2 },
      },
    });
    stubFetch(...world.routes);

    await runLivenessCheckJob(env, AT);

    expect(world.beats).toContain("channel:webhook-signature");
  });

  it("#581/16: falls back to the old field against a database mid-deploy", async () => {
    // The Worker ships separately from the migrations, so this reader meets a probe
    // with no per-provider map for a while. Reading the missing map as zero would
    // alarm on every provider at once the moment it shipped — a false alarm on day
    // one is how an operator learns to ignore this mailbox.
    const world = checkWorld({
      inbound: { telnyx_accepted: 12, rejections: { stripe: 3 } },
    });
    stubFetch(...world.routes);

    await runLivenessCheckJob(env, AT);

    expect(world.beats).toContain("channel:webhook-signature");
  });

  it("stays healthy on a platform with no traffic at all", async () => {
    // Zero rejections and zero acceptances is idle, not broken. Getting this
    // backwards would page every night on a young product, which is exactly
    // how this mailbox stops being read.
    const world = checkWorld({ inbound: { telnyx_accepted: 0, rejections: {} } });
    stubFetch(...world.routes);

    await runLivenessCheckJob(env, AT);

    expect(world.beats).toContain("channel:webhook-signature");
  });

  it("records nothing and claims nothing when the probe itself fails", async () => {
    // A broken probe is not proof of a broken channel. Leaving the ledger
    // untouched lets the absence speak one cadence later.
    const world = checkWorld({ inboundStatus: 500 });
    stubFetch(...world.routes);

    await expect(runLivenessCheckJob(env, AT)).resolves.toBeDefined();
    expect(world.beats).not.toContain("channel:webhook-signature");
  });
});
