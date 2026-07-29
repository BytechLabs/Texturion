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

/** A world where the RPCs answer, and every outbound call is captured. */
function checkWorld(options: {
  overdue?: Record<string, unknown>[];
  smsRows?: Record<string, unknown>[];
  /** #308 — what `api_webhook_inbound_probe` reports. Default: all quiet. */
  inbound?: Record<string, unknown>;
  /** #308 — fail the probe RPC itself with this HTTP status. */
  inboundStatus?: number;
}) {
  const sb = supabaseStub(env);
  const beats: string[] = [];
  sb.on("GET", "/rest/v1/messages", () => options.smsRows ?? []);
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

    const result = await runLivenessCheckJob(env, new Date("2026-07-28T12:00:00Z"));

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

    await runLivenessCheckJob(env, new Date("2026-07-28T12:00:00Z"));

    expect(world.emails).toHaveLength(1);
    const email = world.emails[0] as { subject: string; text: string };
    expect(email.subject).toContain("did not happen");
    expect(email.text).toContain("cron:0 15 * * *");
    expect(email.text).toContain("The daily subscription reconcile has not run.");
    // 21 hours stale — the number is the difference between "check this" and
    // "this has been broken since yesterday".
    expect(email.text).toContain("1260 min ago");
  });
});

describe("the outbound-SMS probe", () => {
  it("beats when a text actually reached the carrier", async () => {
    const world = checkWorld({ smsRows: [{ id: "m1" }] });
    stubFetch(...world.routes);

    await runLivenessCheckJob(env, new Date("2026-07-28T12:00:00Z"));

    expect(world.beats).toContain("channel:sms-outbound");
  });

  it("stays silent when nothing got through", async () => {
    // No heartbeat means the key ages toward its own alert. The probe never
    // asserts an outage itself — it only declines to say the channel is alive.
    const world = checkWorld({ smsRows: [] });
    stubFetch(...world.routes);

    await runLivenessCheckJob(env, new Date("2026-07-28T12:00:00Z"));

    expect(world.beats).not.toContain("channel:sms-outbound");
  });

  it("asks for delivered messages, not merely queued ones", async () => {
    // A row we queued and never handed to the carrier is not evidence that
    // sending works — it is the evidence that it does not.
    const world = checkWorld({ smsRows: [{ id: "m1" }] });
    stubFetch(...world.routes);

    await runLivenessCheckJob(env, new Date("2026-07-28T12:00:00Z"));

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

  const at = new Date("2026-07-28T12:00:00Z");

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
  const AT = new Date("2026-07-28T12:00:00Z");

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
