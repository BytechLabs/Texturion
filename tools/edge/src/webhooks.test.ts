import { runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { STRANGER_DETACH_THRESHOLD } from "./uplink";
import {
  CONNECTIONS,
  OWNED_A,
  OWNED_B,
  PRODUCTION_CONNECTION,
  PRODUCTION_PROFILE,
  PROFILE_TENANT,
  ROBOT_WEBHOOK_SECRET,
  STRANGER,
  call,
  callEvent,
  connectRig,
  counters,
  edgeEnv,
  fakeGuard,
  messageEvent,
  ORIGIN,
  resetEdge,
  telnyxDelivery,
  uplinkStub,
  type FakeGuard,
} from "./test/support";
import type { Env } from "./env";

let guard: FakeGuard;
let env: Env;

beforeEach(async () => {
  await resetEdge();
  guard = fakeGuard();
  env = await edgeEnv(guard);
});

const guardPaths = () => guard.calls.map((c) => `${c.method} ${c.path}`);

describe("signature", () => {
  it("refuses a bad or stale signature with 400 and relays nothing", async () => {
    const stale = await telnyxDelivery("/t/v", callEvent("call.initiated", {}), {
      timestamp: String(Math.floor(Date.now() / 1000) - 600),
    });
    expect((await call(stale, env)).status).toBe(400);

    const good = await telnyxDelivery("/t/v", callEvent("call.initiated", {}));
    const tampered = new Request(good, { body: (await good.text()).replace("incoming", "outgoing") });
    expect((await call(tampered, env)).status).toBe(400);

    expect(guard.calls).toEqual([]);
    expect((await counters())["telnyx.bad_signature"]).toBe(2);
  });
});

describe("ownership", () => {
  it("acks, drops and counts a production call event and a production text", async () => {
    const prodCall = await telnyxDelivery("/t/v", callEvent("call.initiated", { connection_id: PRODUCTION_CONNECTION }));
    const prodText = await telnyxDelivery("/t/m", messageEvent("message.received", { messaging_profile_id: PRODUCTION_PROFILE }));
    expect((await call(prodCall, env)).status).toBe(200);
    expect((await call(prodText, env)).status).toBe(200);
    expect(guardPaths()).toEqual(["GET /partition"]);
    const c = await counters();
    expect(c["telnyx.dropped.not_owned"]).toBe(2);
    expect((await uplinkStub().snapshot()).queueDepth).toBe(0);
  });

  it("answers 503 when the partition cannot be read, so Telnyx retries", async () => {
    guard.partition = null;
    const request = await telnyxDelivery("/t/m", messageEvent("message.received", {}));
    expect((await call(request, env)).status).toBe(503);
    expect((await uplinkStub().snapshot()).queueDepth).toBe(0);
  });

  it("asks the guard for the partition as the edge, and caches it", async () => {
    await call(await telnyxDelivery("/t/m", messageEvent("message.sent", {})), env);
    await call(await telnyxDelivery("/t/m", messageEvent("message.sent", {})), env);
    const partitionCalls = guard.calls.filter((c) => c.path === "/partition");
    expect(partitionCalls).toHaveLength(1);
    expect(partitionCalls[0].headers["x-rig-caller"]).toBe("edge");
  });
});

describe("strangers", () => {
  it("rejects a stranger's call through the guard and never relays it", async () => {
    const rig = await connectRig(env);
    const request = await telnyxDelivery(
      "/t/v",
      callEvent("call.initiated", { from: STRANGER, to: OWNED_B, call_control_id: "ccid-stranger" }),
    );
    expect((await call(request, env)).status).toBe(200);

    const reject = guard.calls.find((c) => c.path === "/reject");
    expect(JSON.parse(reject?.body ?? "null")).toEqual({
      call_control_id: "ccid-stranger",
      connection_id: CONNECTIONS.voice,
      via: "voice",
    });
    expect(guard.calls.some((c) => c.path === "/legs")).toBe(false);
    await expect(rig.next(() => true, 200)).rejects.toThrow();
    expect((await counters())["stranger.call"]).toBe(1);
    rig.close();
  });

  it("drops a stranger's text, keeping only a count and a hash", async () => {
    const rig = await connectRig(env);
    const request = await telnyxDelivery(
      "/t/m",
      messageEvent("message.received", { from: { phone_number: STRANGER }, text: "stranger words" }),
    );
    expect((await call(request, env)).status).toBe(200);
    await expect(rig.next(() => true, 200)).rejects.toThrow();
    expect((await counters())["stranger.text"]).toBe(1);

    const stored = await runInDurableObject(uplinkStub(), (_instance, state) => {
      const senders = state.storage.sql.exec<{ hash: string }>("SELECT hash FROM stranger_senders").toArray();
      const dump = JSON.stringify([
        ...state.storage.sql.exec("SELECT * FROM stranger_senders"),
        ...state.storage.sql.exec("SELECT * FROM strangers"),
        ...state.storage.sql.exec("SELECT * FROM queue"),
      ]);
      return { senders, dump };
    });
    expect(stored.senders).toHaveLength(1);
    expect(stored.senders[0].hash).toMatch(/^[0-9a-f]{32}$/);
    expect(stored.dump).not.toContain(STRANGER);
    expect(stored.dump).not.toContain("stranger words");
    rig.close();
  });

  it("asks the guard to detach our number once strangers pass the threshold", async () => {
    for (let i = 0; i < STRANGER_DETACH_THRESHOLD + 1; i++) {
      const request = await telnyxDelivery(
        "/t/m",
        messageEvent("message.received", { from: { phone_number: STRANGER }, to: [{ phone_number: OWNED_A }] }),
      );
      expect((await call(request, env)).status).toBe(200);
    }
    const detaches = guard.calls.filter((c) => c.path === "/detach");
    expect(detaches).toHaveLength(1);
    expect(JSON.parse(detaches[0].body)).toMatchObject({ e164: OWNED_A, strangers: STRANGER_DETACH_THRESHOLD });
  });
});

describe("call events", () => {
  it("relays over the uplink and returns the rig's own status", async () => {
    const rig = await connectRig(env);
    const event = callEvent("call.initiated", { call_control_id: "ccid-owned" });
    const pending = call(await telnyxDelivery("/t/v", event), env);

    const frame = await rig.next((f) => f.t === "webhook");
    expect(frame).toMatchObject({ t: "webhook", kind: "call", path: "/t/v", attempt: 1 });
    if (frame.t !== "webhook") throw new Error("unreachable");
    expect(JSON.parse(frame.body)).toEqual(event);
    expect(Object.keys(frame.headers).sort()).toEqual(["content-type", "telnyx-signature-ed25519", "telnyx-timestamp"]);
    rig.send({ t: "webhook-result", id: frame.id, status: 204 });

    expect((await pending).status).toBe(204);
    const legs = guard.calls.filter((c) => c.path === "/legs");
    expect(legs.map((c) => JSON.parse(c.body))).toEqual([
      { call_control_id: "ccid-owned", connection_id: CONNECTIONS.voice, via: "voice" },
    ]);
    rig.close();
  });

  it("delivers a duplicate once: the retry of a relayed event is acked without the rig", async () => {
    const rig = await connectRig(env);
    const event = callEvent("call.answered", {}, "evt-dup-call");
    const first = call(await telnyxDelivery("/t/v", event), env);
    const frame = await rig.next((f) => f.t === "webhook");
    rig.send({ t: "webhook-result", id: frame.t === "webhook" ? frame.id : "", status: 200 });
    expect((await first).status).toBe(200);

    expect((await call(await telnyxDelivery("/t/v2", event), env)).status).toBe(200);
    await expect(rig.next((f) => f.t === "webhook", 200)).rejects.toThrow();
    expect((await counters())["call.duplicate"]).toBe(1);
    rig.close();
  });

  it("does not remember an event the rig failed, so Telnyx's retry is relayed again", async () => {
    const rig = await connectRig(env);
    const event = callEvent("call.answered", {}, "evt-retry-call");
    const first = call(await telnyxDelivery("/t/v", event), env);
    const frame = await rig.next((f) => f.t === "webhook");
    rig.send({ t: "webhook-result", id: frame.t === "webhook" ? frame.id : "", status: 500 });
    expect((await first).status).toBe(500);

    const second = call(await telnyxDelivery("/t/v", event), env);
    const again = await rig.next((f) => f.t === "webhook");
    rig.send({ t: "webhook-result", id: again.t === "webhook" ? again.id : "", status: 200 });
    expect((await second).status).toBe(200);
    rig.close();
  });

  it("answers 503 at once when the rig is offline", async () => {
    const response = await call(await telnyxDelivery("/t/v", callEvent("call.initiated", {})), env);
    expect(response.status).toBe(503);
    expect((await counters())["call.rig_offline"]).toBe(1);
  });

  it("answers inside Telnyx's 10 seconds however long the guard took, and remembers a late answer", async () => {
    // Both guard calls inside their own timeouts, and together most of the budget.
    guard.latency = { "/partition": 1_400, "/legs": 2_900 };
    const rig = await connectRig(env);
    const event = callEvent("call.initiated", { call_control_id: "ccid-slow" }, "evt-slow-call");
    const started = Date.now();
    const response = await call(await telnyxDelivery("/t/v", event), env);
    const elapsed = Date.now() - started;
    expect(response.status).toBe(503);
    expect(elapsed).toBeLessThan(10_000);
    expect((await counters())["call.no_answer"]).toBe(1);

    // The rig answers after the edge gave up: the event was handled, so
    // Telnyx's retry is acked without relaying it a second time.
    const frame = await rig.next((f) => f.t === "webhook");
    rig.send({ t: "webhook-result", id: frame.t === "webhook" ? frame.id : "", status: 200 });
    await rig.next(() => false, 100).catch(() => undefined);
    expect((await counters())["call.late_answer"]).toBe(1);
    guard.latency = {};
    expect((await call(await telnyxDelivery("/t/v2", event), env)).status).toBe(200);
    await expect(rig.next((f) => f.t === "webhook", 200)).rejects.toThrow();
    expect((await counters())["call.duplicate"]).toBe(1);
    rig.close();
  });

  it("answers 503 to a retry of an event the rig is still handling, and relays it once", async () => {
    const rig = await connectRig(env);
    const event = callEvent("call.answered", {}, "evt-in-flight");
    const first = call(await telnyxDelivery("/t/v", event), env);
    const frame = await rig.next((f) => f.t === "webhook");
    expect((await call(await telnyxDelivery("/t/v2", event), env)).status).toBe(503);
    expect((await counters())["call.in_flight"]).toBe(1);
    rig.send({ t: "webhook-result", id: frame.t === "webhook" ? frame.id : "", status: 200 });
    expect((await first).status).toBe(200);
    await expect(rig.next((f) => f.t === "webhook", 200)).rejects.toThrow();
    rig.close();
  });

  it("relays the sentinel's ring for G02 without registering its leg", async () => {
    const rig = await connectRig(env);
    const event = callEvent("call.initiated", {
      connection_id: CONNECTIONS.sentinel,
      call_control_id: "ccid-sentinel",
      from: "sip:gencred@sip.telnyx.com",
    });
    const pending = call(await telnyxDelivery("/t/w", event), env);
    const frame = await rig.next((f) => f.t === "webhook");
    rig.send({ t: "webhook-result", id: frame.t === "webhook" ? frame.id : "", status: 200 });
    expect((await pending).status).toBe(200);
    expect(guard.calls.some((c) => c.path === "/legs")).toBe(false);
    rig.close();
  });
});

describe("text events", () => {
  it("acks once queued, delivers to the rig and dedupes a redelivery", async () => {
    const event = messageEvent("message.received", {}, "evt-dup-text");
    expect((await call(await telnyxDelivery("/t/m", event), env)).status).toBe(200);
    expect((await call(await telnyxDelivery("/t/m", event), env)).status).toBe(200);
    expect((await uplinkStub().snapshot()).queueDepth).toBe(1);
    expect((await counters())["queue.duplicate"]).toBe(1);

    const rig = await connectRig(env);
    const frame = await rig.next((f) => f.t === "webhook");
    expect(frame).toMatchObject({ kind: "message", path: "/t/m", attempt: 1 });
    rig.send({ t: "ack", id: frame.t === "webhook" ? frame.id : "" });
    await rig.next(() => false, 100).catch(() => undefined);
    expect((await uplinkStub().snapshot()).queueDepth).toBe(0);
    rig.close();
  });
});

describe("robot webhook sink", () => {
  it("queues a customer webhook for the robot, minus the secret segment", async () => {
    const request = new Request(`${ORIGIN}/w/${ROBOT_WEBHOOK_SECRET}/qa-w?x=1`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "loonext-signature": "t=1,v1=ab",
        "loonext-delivery": "dlv-1",
        "loonext-event": "message.sent",
        authorization: "Bearer not-forwarded",
      },
      body: JSON.stringify({ type: "message.sent" }),
    });
    expect((await call(request, env)).status).toBe(200);
    const rig = await connectRig(env);
    const frame = await rig.next((f) => f.t === "webhook");
    expect(frame).toMatchObject({ kind: "robot-webhook", path: "/w/qa-w?x=1" });
    if (frame.t !== "webhook") throw new Error("unreachable");
    expect(frame.headers).toEqual({
      "content-type": "application/json",
      "loonext-signature": "t=1,v1=ab",
      "loonext-delivery": "dlv-1",
      "loonext-event": "message.sent",
    });
    expect(JSON.stringify(frame)).not.toContain(ROBOT_WEBHOOK_SECRET);
    rig.close();
  });

  it("is an empty 404 without the secret", async () => {
    const request = new Request(`${ORIGIN}/w/wrong-secret/qa-w`, { method: "POST", body: "{}" });
    const response = await call(request, env);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
});

describe("texts from owned numbers across profiles", () => {
  it("queues on the tenant profile", async () => {
    const event = messageEvent("message.received", {
      messaging_profile_id: PROFILE_TENANT,
      from: { phone_number: OWNED_B },
      to: [{ phone_number: OWNED_A }],
    });
    expect((await call(await telnyxDelivery("/t/m", event), env)).status).toBe(200);
    expect((await uplinkStub().snapshot()).queueDepth).toBe(1);
  });
});
