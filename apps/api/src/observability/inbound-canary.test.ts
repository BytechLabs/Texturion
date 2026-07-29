/**
 * #308 — the synthetic canary.
 *
 * The round-trip arithmetic is SQL and lives in
 * supabase/tests/webhook_liveness.test.sql. What this suite owns is the
 * judgement calls the Worker makes, and all four are about NOT doing something:
 *
 *   - it is OFF until configured, and its liveness expectation is withheld
 *     while it is off, so it cannot alert about a feature nobody enabled;
 *   - it REFUSES a destination this platform does not own, which is what makes
 *     it defensible as the one send path that skips the §5 gates;
 *   - it STOPS SENDING once the path is known broken, because re-buying an
 *     alert at 1.7c a go is money for nothing;
 *   - a failed SEND is never allowed to age into an INBOUND alert.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { canaryConfig, runInboundCanaryJob } from "./inbound-canary";
import { runLivenessCheckJob } from "./liveness-check";

const base = completeEnv();
const env = {
  ...base,
  CANARY_FROM_E164: "+15125550100",
  CANARY_TO_E164: "+15125550199",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function world(options: {
  owned?: boolean;
  unanswered?: number;
  confirmed?: string | null;
  telnyxStatus?: number;
} = {}) {
  const sb = supabaseStub(env);
  const beats: string[] = [];
  sb.on("GET", "/rest/v1/phone_numbers", () =>
    (options.owned ?? true) ? [{ id: "num-1" }] : [],
  );
  sb.on("POST", "/rest/v1/rpc/inbound_canary_unanswered", () =>
    options.unanswered ?? 0,
  );
  sb.on("POST", "/rest/v1/rpc/confirm_inbound_canary", () => ({
    confirmed: options.confirmed ?? null,
    pending: false,
  }));
  sb.on("POST", "/rest/v1/rpc/record_heartbeat", (call) => {
    beats.push((call.body as { p_key: string }).p_key);
    return { recovered: false };
  });
  sb.on("POST", "/rest/v1/inbound_canary_runs", () => []);
  sb.on("PATCH", "/rest/v1/inbound_canary_runs", () => []);

  const sends: Record<string, unknown>[] = [];
  const telnyx: FetchRoute = async (url, request) => {
    if (!url.href.includes("/v2/messages")) return undefined;
    sends.push((await request.clone().json()) as Record<string, unknown>);
    return options.telnyxStatus !== undefined
      ? new Response("no", { status: options.telnyxStatus })
      : Response.json({ data: { id: "msg-1" } });
  };
  return { sb, beats, sends, routes: [sb.route, telnyx] };
}

describe("the canary is off until configured", () => {
  it("reads a missing number pair as switched off", () => {
    expect(canaryConfig(base)).toBeNull();
    // Half a pair is not half a canary — it is a text to nowhere.
    expect(canaryConfig({ ...base, CANARY_FROM_E164: "+15125550100" })).toBeNull();
    expect(canaryConfig(env)).toEqual({
      from: "+15125550100",
      to: "+15125550199",
    });
  });

  it("sends nothing and touches nothing when unconfigured", async () => {
    const w = world();
    stubFetch(...w.routes);

    await expect(runInboundCanaryJob(base, new Date())).resolves.toEqual({
      status: "unconfigured",
    });
    expect(w.sends).toEqual([]);
  });

  it("withholds the canary EXPECTATION while it is off", async () => {
    // Declaring it unconditionally would alert every six hours, forever, about
    // a feature nobody switched on — and a channel that cries about phantoms
    // is one the founder stops opening, taking every other key with it.
    const sb = supabaseStub(base);
    let sent: { key: string }[] = [];
    sb.on("GET", "/rest/v1/messages", () => []);
    sb.on("POST", "/rest/v1/rpc/api_webhook_inbound_probe", () => ({
      rejections: {},
    }));
    sb.on("POST", "/rest/v1/rpc/record_heartbeat", () => ({ recovered: false }));
    sb.on("POST", "/rest/v1/rpc/api_liveness_check", (call) => {
      sent = (call.body as { p_expectations: { key: string }[] }).p_expectations;
      return { overdue: [], seeded: [] };
    });
    stubFetch(sb.route);

    await runLivenessCheckJob(base, new Date());

    const keys = sent.map((e) => e.key);
    expect(keys).not.toContain("channel:inbound-canary");
    // Everything else still declared — this filters one key, not the table.
    expect(keys).toContain("channel:sms-outbound");
    expect(keys).toContain("channel:webhook-signature");
  });

  it("declares the expectation once the pair is configured", async () => {
    const sb = supabaseStub(env);
    let sent: { key: string }[] = [];
    sb.on("GET", "/rest/v1/messages", () => []);
    sb.on("POST", "/rest/v1/rpc/api_webhook_inbound_probe", () => ({
      rejections: {},
    }));
    sb.on("POST", "/rest/v1/rpc/record_heartbeat", () => ({ recovered: false }));
    sb.on("POST", "/rest/v1/rpc/api_liveness_check", (call) => {
      sent = (call.body as { p_expectations: { key: string }[] }).p_expectations;
      return { overdue: [], seeded: [] };
    });
    stubFetch(sb.route);

    await runLivenessCheckJob(env, new Date());

    expect(sent.map((e) => e.key)).toContain("channel:inbound-canary");
  });
});

describe("the canary cannot text a person", () => {
  it("refuses a destination this platform does not own", async () => {
    // This is the one send path that does not run the §5 gates, and that is
    // only defensible because it cannot reach a customer. A typo in a secret
    // would otherwise have an ops job texting a stranger, hourly, forever,
    // with no consent and no conversation anybody can see.
    const w = world({ owned: false });
    stubFetch(...w.routes);

    const result = await runInboundCanaryJob(env, new Date());

    expect(result).toEqual({ status: "not-our-number", to: "+15125550199" });
    expect(w.sends).toEqual([]);
  });
});

describe("the canary stops paying once the answer is known", () => {
  it("sends nothing once too many round trips have gone unanswered", async () => {
    // The alert is already raised. Every further send is 1.7c to re-learn a
    // fact we have — cap-and-drop, with the drop landing on the spend and
    // never on the signal.
    const w = world({ unanswered: 6 });
    stubFetch(...w.routes);

    const result = await runInboundCanaryJob(env, new Date());

    expect(result).toEqual({ status: "capped", unanswered: 6 });
    expect(w.sends).toEqual([]);
  });

  it("still sends while under the ceiling", async () => {
    const w = world({ unanswered: 5 });
    stubFetch(...w.routes);

    const result = await runInboundCanaryJob(env, new Date());

    expect(result.status).toBe("sent");
    expect(w.sends).toHaveLength(1);
    const body = w.sends[0] as { from: string; to: string; text: string };
    expect(body.from).toBe("+15125550100");
    expect(body.to).toBe("+15125550199");
    // The token IS the body: matching on the destination number alone would
    // let last hour's delivery confirm this hour's send.
    expect(body.text).toContain("LOONEXT-CANARY-");
  });

  it("confirms EVEN WHEN capped, so a broken send cannot hide a working inbox", async () => {
    // Confirmation is what records the heartbeat. If the send half suppressed
    // it, a send outage would silently manufacture an inbound outage and we
    // would alert on the wrong subsystem.
    const w = world({ unanswered: 6, confirmed: "LOONEXT-CANARY-abc" });
    stubFetch(...w.routes);

    await runInboundCanaryJob(env, new Date());

    expect(w.beats).toContain("channel:inbound-canary");
  });
});

describe("a failed send is not an inbound outage", () => {
  it("records the send error on the run rather than leaving it pending", async () => {
    // A canary that never left is no evidence about the inbound path. Left
    // pending it would age into channel:inbound-canary and report the wrong
    // outage; channel:sms-outbound already owns this one.
    const w = world({ telnyxStatus: 500 });
    stubFetch(...w.routes);

    const result = await runInboundCanaryJob(env, new Date());

    expect(result.status).toBe("send-failed");
    const patches = w.sb.find("PATCH", "/rest/v1/inbound_canary_runs");
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toMatchObject({ send_error: "Telnyx HTTP 500" });
  });

  it("beats nothing on a send failure with no confirmation", async () => {
    const w = world({ telnyxStatus: 500 });
    stubFetch(...w.routes);

    await runInboundCanaryJob(env, new Date());

    expect(w.beats).not.toContain("channel:inbound-canary");
  });
});

describe("confirmation", () => {
  it("beats only when a round trip actually came back", async () => {
    const confirmedWorld = world({ confirmed: "LOONEXT-CANARY-xyz" });
    stubFetch(...confirmedWorld.routes);
    await runInboundCanaryJob(env, new Date());
    expect(confirmedWorld.beats).toContain("channel:inbound-canary");

    vi.unstubAllGlobals();

    const silentWorld = world({ confirmed: null });
    stubFetch(...silentWorld.routes);
    await runInboundCanaryJob(env, new Date());
    expect(silentWorld.beats).not.toContain("channel:inbound-canary");
  });
});
