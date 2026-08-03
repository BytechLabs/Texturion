/**
 * #233 — the firing job, at the moments where it decides NOT to send.
 *
 * The sending half is the easy half, and the SQL suite already pins it
 * (exactly-once, cancel-beats-fire, the lease). What lives here is the
 * judgement this file makes that nothing else can: given a gate failure at fire
 * time, is this message still going or not?
 *
 * That distinction is the whole of #233's acceptance criteria and the whole of
 * the binding rule in docs/DECISIONS.md. Get it wrong in one direction and a
 * customer who sent STOP gets a text; get it wrong in the other and a
 * workspace's follow-ups vanish because a card expired for an afternoon.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
// The "cross-track-doubles" project resolves this to a vi.fn double that
// answers all-clear by default (src/test/telnyx-doubles/registration.ts), which
// is the lever for the gate states below. Reading the real companies row would
// not work here: index.ts's imports are aliased in this project.
import { getSendGates } from "../telnyx/registration";
import { runScheduledSendJob } from "./scheduled-send";

const env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";
const SCHEDULED_ID = "dddddddd-0000-4000-8000-00000000000d";
const OWNER = "10000000-aaaa-4000-8000-000000000001";

const NOW = new Date("2026-08-03T13:00:00Z");

afterEach(() => {
  vi.unstubAllGlobals();
});

function scheduledRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SCHEDULED_ID,
    company_id: COMPANY_ID,
    conversation_id: CONVERSATION_ID,
    body: "Still thinking about that quote?",
    send_at: "2026-08-03T12:00:00Z",
    inbound_watermark: "2026-08-01T09:00:00Z",
    ...overrides,
  };
}

interface HarnessOptions {
  due?: Record<string, unknown>[];
  expired?: Record<string, unknown>[];
  /** Newest inbound in the thread, at fire time. */
  newestInbound?: string | null;
  numberStatus?: string;
  /** Gate state, through the cross-track double. */
  gates?: { subscriptionActive?: boolean; usApproved?: boolean; caAllowed?: boolean };
  optOuts?: Record<string, unknown>[];
  /** Make the fire RPC blow up, to test that one bad row does not stop the rest. */
  fireThrows?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const sb = supabaseStub(env);
  const holds: Record<string, unknown>[] = [];
  const fails: Record<string, unknown>[] = [];
  const fires: Record<string, unknown>[] = [];

  sb.on("POST", "/rest/v1/rpc/api_expire_scheduled_messages", () =>
    options.expired ?? [],
  );
  sb.on("POST", "/rest/v1/rpc/api_claim_due_scheduled_messages", () =>
    options.due ?? [scheduledRow()],
  );
  sb.on("POST", "/rest/v1/rpc/api_hold_scheduled_message", (call) => {
    holds.push(call.body as Record<string, unknown>);
    return { outcome: "held" };
  });
  sb.on("POST", "/rest/v1/rpc/api_fail_scheduled_message", (call) => {
    fails.push(call.body as Record<string, unknown>);
    return { outcome: "failed" };
  });
  sb.on("POST", "/rest/v1/rpc/api_fire_scheduled_message", (call) => {
    fires.push(call.body as Record<string, unknown>);
    // An option rather than a re-registration: this harness is first-match-
    // wins, so a later `sb.on` for the same path never runs.
    if (options.fireThrows) throw new Error("boom");
    return {
      outcome: "fired",
      message: {
        id: "eeeeeeee-0000-4000-8000-00000000000e",
        company_id: COMPANY_ID,
        conversation_id: CONVERSATION_ID,
        direction: "outbound",
        status: "queued",
        body: "Still thinking about that quote?",
        segments: 1,
      },
    };
  });

  // The destination lookup, then the newest-inbound probe. First match wins in
  // this harness, so the more specific `select` is registered first.
  sb.on("GET", "/rest/v1/conversations", (call) => {
    if (String(call.url.searchParams.get("select") ?? "").includes("contacts")) {
      return [
        {
          contacts: { phone_e164: "+16135551000" },
          phone_numbers: {
            number_e164: "+16135550000",
            status: options.numberStatus ?? "active",
          },
        },
      ];
    }
    return [{ phone_number_id: null }];
  });
  sb.on("GET", "/rest/v1/messages", () =>
    options.newestInbound ? [{ created_at: options.newestInbound }] : [],
  );

  // The gates, through the cross-track double rather than a companies row:
  // this project aliases `telnyx/registration`, so stubbing the REST read the
  // real `getSendGates` would make is stubbing a function that never runs.
  vi.mocked(getSendGates).mockResolvedValue({
    subscriptionActive: true,
    usApproved: true,
    caAllowed: true,
    ...options.gates,
  });
  sb.on("GET", "/rest/v1/opt_outs", () => options.optOuts ?? []);
  // The dispatch tail: the row flipped off 'queued' once the carrier has it.
  sb.on("PATCH", "/rest/v1/messages", () => [
    { id: "eeeeeeee-0000-4000-8000-00000000000e", status: "sent" },
  ]);
  sb.on("GET", "/rest/v1/company_members", () => [
    { user_id: OWNER, role: "owner" },
  ]);
  sb.on("POST", "/rest/v1/rpc/member_number_levels", () => []);
  sb.on("GET", "/rest/v1/notification_prefs", () => []);
  sb.on("GET", "/rest/v1/push_subscriptions", () => []);
  sb.on("GET", "/rest/v1/device_push_tokens", () => []);
  sb.on("GET", "/rest/v1/feature_flag_overrides", () => []);
  sb.on("GET", "/rest/v1/feature_flags", () => []);

  return { sb, holds, fails, fires };
}

describe("#233 a STOP between scheduling and firing", () => {
  it("kills the message rather than holding it, and says only they can undo it", async () => {
    // The acceptance criterion, and the one place being generous would be
    // illegal rather than merely wrong. Binding: an opt-out is carrier truth
    // and can only be lifted by the customer — so this must FAIL, not hold,
    // because a hold means "we will send this when we can".
    const { sb, holds, fails } = harness({
      optOuts: [{ id: "opt-1" }],
    });
    stubFetch(sb.route);

    const summary = await runScheduledSendJob(env, NOW);

    expect(summary.sent).toBe(0);
    expect(summary.failed).toBe(1);
    expect(holds).toHaveLength(0);
    expect(fails).toHaveLength(1);
    expect(String(fails[0].p_reason)).toMatch(/only they can/i);
  });
});

describe("#233 the customer answered in the meantime", () => {
  it("holds rather than talking over them", async () => {
    // "Still thinking about that quote?" arriving after they already said yes
    // reads as a robot. A HOLD, not a cancel: the owner may well still want to
    // send it, and deciding that for them is how a message disappears.
    const { sb, holds, fires } = harness({
      newestInbound: "2026-08-03T11:00:00Z", // after the watermark
    });
    stubFetch(sb.route);

    const summary = await runScheduledSendJob(env, NOW);

    expect(summary.held).toBe(1);
    expect(summary.sent).toBe(0);
    expect(fires).toHaveLength(0);
    expect(String(holds[0].p_reason)).toMatch(/replied/i);
  });

  it("sends when the newest inbound is the one it was written against", async () => {
    // The other half, so the check cannot pass by holding everything.
    const { sb, holds, fires } = harness({
      newestInbound: "2026-08-01T09:00:00Z", // equal to the watermark
    });
    stubFetch(sb.route, async (url, request) =>
      request.method === "POST" && url.href === "https://api.telnyx.com/v2/messages"
        ? Response.json({ data: { id: "telnyx-scheduled-1" } })
        : undefined,
    );

    const summary = await runScheduledSendJob(env, NOW);

    expect(holds).toHaveLength(0);
    expect(fires).toHaveLength(1);
    expect(summary.sent).toBe(1);
  });

  it("treats any inbound as new when the thread had none at scheduling time", async () => {
    const { sb, holds } = harness({
      due: [scheduledRow({ inbound_watermark: null })],
      newestInbound: "2026-08-03T11:00:00Z",
    });
    stubFetch(sb.route);

    await runScheduledSendJob(env, NOW);
    expect(String(holds[0]?.p_reason ?? "")).toMatch(/replied/i);
  });
});

describe("#233 a block that will clear versus one that will not", () => {
  it("holds a lapsed subscription, because it resumes on reinstatement", async () => {
    // Binding rule 1: held, not dropped. A workspace whose card failed on
    // Friday must not lose Monday's follow-ups.
    const { sb, holds, fails } = harness({
      gates: { subscriptionActive: false },
    });
    stubFetch(sb.route);

    const summary = await runScheduledSendJob(env, NOW);

    expect(summary.held).toBe(1);
    expect(fails).toHaveLength(0);
    expect(String(holds[0].p_reason)).toMatch(/subscription/i);
  });

  it("fails a number it can no longer send from", async () => {
    // A released number will not become sendable by waiting, and the gates do
    // not catch this — they check the workspace, not which of its numbers the
    // thread is on.
    const { sb, fails, fires } = harness({ numberStatus: "released" });
    stubFetch(sb.route);

    const summary = await runScheduledSendJob(env, NOW);

    expect(summary.failed).toBe(1);
    expect(fires).toHaveLength(0);
    expect(String(fails[0].p_reason)).toMatch(/cannot text/i);
  });
});

describe("#233 expiry is disclosed, not silent", () => {
  it("runs before the claim, so a stale message expires instead of sending late", async () => {
    // Rule 3. If expiry ran after, a message whose window closed while it was
    // held would be attempted once more — arriving late, which is the thing
    // the rule forbids.
    const { sb } = harness({
      expired: [scheduledRow({ id: "ffffffff-0000-4000-8000-00000000000f" })],
      due: [],
    });
    stubFetch(sb.route);

    const summary = await runScheduledSendJob(env, NOW);
    expect(summary.expired).toBe(1);
    expect(summary.sent).toBe(0);
  });
});

describe("#233 one workspace cannot stop the others", () => {
  it("keeps going after a failure and reports it at the end", async () => {
    // #387: collected rather than thrown per row, so a single broken send does
    // not leave every other workspace's message unsent for that minute — but
    // still thrown, so a broken run reaches Sentry.
    const { sb } = harness({
      fireThrows: true,
      due: [
        scheduledRow({ id: "11111111-0000-4000-8000-000000000011" }),
        scheduledRow({ id: "22222222-0000-4000-8000-000000000022" }),
      ],
    });
    stubFetch(sb.route);

    await expect(runScheduledSendJob(env, NOW)).rejects.toThrow(
      /2 of 2 failed/,
    );
  });
});
