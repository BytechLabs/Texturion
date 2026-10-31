import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { QUEUED_DELIVERY_MAX_AGE_MS } from "@loonext/rig-protocol";
import { beforeEach, describe, expect, it } from "vitest";

import type { Env } from "./env";
import { decodeMedia, parseRigFrame, retryDelay } from "./uplink";
import {
  ORIGIN,
  TOKENS,
  call,
  connectRig,
  counters,
  edgeEnv,
  fakeGuard,
  messageEvent,
  resetEdge,
  telnyxDelivery,
  uplinkStub,
} from "./test/support";

let env: Env;

beforeEach(async () => {
  await resetEdge();
  env = await edgeEnv(fakeGuard());
});

/** Makes every queued entry due now, as if its backoff had passed. */
async function makeDue(): Promise<void> {
  await runInDurableObject(uplinkStub(), (_instance, state) => {
    state.storage.sql.exec("UPDATE queue SET next_at = 0");
  });
}

describe("the uplink", () => {
  it("accepts only the rig control token, and only as a WebSocket", async () => {
    const upgrade = { upgrade: "websocket" };
    const as = (token: string) => ({ ...upgrade, authorization: `Bearer ${token}` });
    expect((await call(new Request(`${ORIGIN}/ctl/uplink`, { headers: upgrade }), env)).status).toBe(401);
    expect((await call(new Request(`${ORIGIN}/ctl/uplink`, { headers: as(TOKENS.triage) }), env)).status).toBe(401);
    expect((await call(new Request(`${ORIGIN}/ctl/uplink`, { headers: as(TOKENS["rig-api"]) }), env)).status).toBe(401);
    const plain = new Request(`${ORIGIN}/ctl/uplink`, { headers: { authorization: `Bearer ${TOKENS.rig}` } });
    expect((await call(plain, env)).status).toBe(426);
  });

  it("keeps one rig: a new connection replaces the old", async () => {
    const first = await connectRig(env);
    const second = await connectRig(env);
    await call(await telnyxDelivery("/t/m", messageEvent("message.sent", {})), env);
    const frame = await second.next((f) => f.t === "webhook");
    expect(frame.t).toBe("webhook");
    await expect(first.next((f) => f.t === "webhook", 200)).rejects.toThrow();
    second.close();
  });

  it("records heartbeats and arms the dead-man on the first", async () => {
    expect((await uplinkStub().deadman()).armedAt).toBeNull();
    const rig = await connectRig(env);
    rig.send({ t: "heartbeat", component: "rig", at: "2026-10-30T00:00:00.000Z" });
    rig.send({ t: "heartbeat", component: "suite", at: "2026-10-30T00:00:00.000Z" });
    rig.ws.send(JSON.stringify({ t: "heartbeat", component: "nonsense", at: "x" }));
    rig.ws.send("not json");
    await rig.next(() => false, 150).catch(() => undefined);
    const view = await uplinkStub().deadman();
    expect(view.armedAt).not.toBeNull();
    expect(view.heartbeats.rig).not.toBeNull();
    expect(view.heartbeats.suite).not.toBeNull();
    expect(view.heartbeats.triage).toBeNull();
    expect((await counters())["uplink.bad_frame"]).toBe(2);
    rig.close();
  });
});

describe("the queue", () => {
  it("retries an unacked delivery with a rising attempt count, and stops when acked", async () => {
    const rig = await connectRig(env);
    await call(await telnyxDelivery("/t/m", messageEvent("message.received", {})), env);
    const first = await rig.next((f) => f.t === "webhook");
    expect(first).toMatchObject({ attempt: 1 });

    // No ack. Nothing more is sent until the backoff passes.
    await expect(rig.next((f) => f.t === "webhook", 150)).rejects.toThrow();
    await makeDue();
    expect(await runDurableObjectAlarm(uplinkStub())).toBe(true);
    const second = await rig.next((f) => f.t === "webhook");
    expect(second).toMatchObject({ attempt: 2 });
    expect(second.t === "webhook" && first.t === "webhook" && second.id === first.id).toBe(true);

    rig.send({ t: "ack", id: second.t === "webhook" ? second.id : "" });
    await rig.next(() => false, 100).catch(() => undefined);
    expect((await uplinkStub().snapshot()).queueDepth).toBe(0);
    expect((await counters())["queue.delivered"]).toBe(1);
    await makeDue();
    await runDurableObjectAlarm(uplinkStub());
    await expect(rig.next((f) => f.t === "webhook", 150)).rejects.toThrow();
    rig.close();
  });

  it("holds deliveries while the rig is offline and flushes them when it connects", async () => {
    for (let i = 0; i < 3; i++) {
      await call(await telnyxDelivery("/t/m", messageEvent("message.sent", {})), env);
    }
    expect((await uplinkStub().snapshot()).queueDepth).toBe(3);
    const rig = await connectRig(env);
    for (let i = 0; i < 3; i++) await rig.next((f) => f.t === "webhook");
    rig.close();
  });

  it("treats a 2xx webhook-result for a queued entry as its ack", async () => {
    const rig = await connectRig(env);
    await call(await telnyxDelivery("/t/m", messageEvent("message.sent", {})), env);
    const frame = await rig.next((f) => f.t === "webhook");
    rig.send({ t: "webhook-result", id: frame.t === "webhook" ? frame.id : "", status: 200 });
    await rig.next(() => false, 100).catch(() => undefined);
    expect((await uplinkStub().snapshot()).queueDepth).toBe(0);
    rig.close();
  });

  it("drops and counts an entry older than the delivery window", async () => {
    await call(await telnyxDelivery("/t/m", messageEvent("message.sent", {})), env);
    await runInDurableObject(uplinkStub(), (_instance, state) => {
      state.storage.sql.exec("UPDATE queue SET first_at = ?", Date.now() - QUEUED_DELIVERY_MAX_AGE_MS - 1);
    });
    await runDurableObjectAlarm(uplinkStub());
    expect((await uplinkStub().snapshot()).queueDepth).toBe(0);
    expect((await counters())["queue.expired"]).toBe(1);
  });

  it("backs off from 30 seconds to at most 15 minutes", () => {
    expect([1, 2, 3, 6, 20].map(retryDelay)).toEqual([30_000, 60_000, 120_000, 900_000, 900_000]);
  });
});

describe("rpc", () => {
  it("forwards a triage rpc and returns the rig's result", async () => {
    const rig = await connectRig(env);
    const request = new Request(`${ORIGIN}/ctl/rpc`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKENS.triage}`, "content-type": "application/json" },
      body: JSON.stringify({ method: "verdicts.unresolved", params: { limit: 5 } }),
    });
    const pending = call(request, env);
    const frame = await rig.next((f) => f.t === "rpc");
    expect(frame).toMatchObject({ method: "verdicts.unresolved", params: { limit: 5 } });
    rig.send({ t: "rpc-result", id: frame.t === "rpc" ? frame.id : "", ok: true, result: { failures: [] } });
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: { failures: [] } });
    rig.close();
  });

  it("refuses the rig token and answers 503 while the rig is offline", async () => {
    const as = (token: string) =>
      new Request(`${ORIGIN}/ctl/rpc`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ method: "rig.status" }),
      });
    expect((await call(as(TOKENS.rig), env)).status).toBe(401);
    expect((await call(as(TOKENS.triage), env)).status).toBe(503);
  });
});

describe("frames", () => {
  it("parses only well-formed rig frames", () => {
    expect(parseRigFrame(JSON.stringify({ t: "ack", id: "a" }))).toEqual({ t: "ack", id: "a" });
    expect(parseRigFrame(JSON.stringify({ t: "ack" }))).toBeNull();
    expect(parseRigFrame(JSON.stringify({ t: "webhook-result", id: "a" }))).toBeNull();
    expect(parseRigFrame(JSON.stringify({ t: "rpc-result", id: "a", ok: false }))).toBeNull();
    expect(parseRigFrame(JSON.stringify({ t: "heartbeat", component: "triage", at: "now" }))).not.toBeNull();
    expect(parseRigFrame(new ArrayBuffer(4))).toBeNull();
  });

  it("decodes media only up to the limit", () => {
    expect(decodeMedia(btoa("abc"))).toEqual(new TextEncoder().encode("abc"));
    expect(decodeMedia(undefined)).toEqual(new Uint8Array(0));
    expect(decodeMedia(42)).toBeNull();
    expect(decodeMedia("!!!")).toBeNull();
  });
});
