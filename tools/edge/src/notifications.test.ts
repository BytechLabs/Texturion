import { HEADER } from "@loonext/rig-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "./env";
import { balanceOf, parseNotice, sameEvent } from "./notifications";
import {
  NOTIFICATIONS_SECRET,
  ORIGIN,
  call,
  counters,
  edgeEnv,
  fakeGuard,
  resetEdge,
  telnyxDelivery,
  type FakeGuard,
} from "./test/support";

let guard: FakeGuard;
let env: Env;
let balance: unknown;
let events: unknown;
/** Every request the edge sent past the guard, Sentry included. None reaches the network. */
let outbound: { url: string; event: Record<string, unknown> | null }[];

beforeEach(async () => {
  await resetEdge();
  outbound = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const lines = (await request.text()).split("\n");
    outbound.push({ url: request.url, event: lines[2] ? (JSON.parse(lines[2]) as Record<string, unknown>) : null });
    return new Response("{}", { status: 200 });
  });
  guard = fakeGuard();
  balance = { data: { balance: "412.00", currency: "USD" } };
  events = { data: [{ name: "Suspicious Outbound Voice Traffic", enabled: true }, { name: "Low Balance", enabled: true }] };
  guard.respond = (c) => {
    if (c.path === "/telnyx/v2/balance") return Response.json(balance);
    if (c.path.startsWith("/telnyx/v2/notification_events")) return Response.json(events);
    return undefined;
  };
  env = await edgeEnv(guard, {
    SENTRY_PROD_DSN: "https://prodkey@o1.ingest.sentry.io/202",
    SENTRY_SYNTHETIC_DSN: "https://synthetickey@o1.ingest.sentry.io/101",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function notice(name: string, id = `ntc-${Math.random()}`): Request {
  return new Request(`${ORIGIN}/t/n/${NOTIFICATIONS_SECRET}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: { id, event_type: name, payload: {} } }),
  });
}

const halts = () => guard.calls.filter((c) => c.path === "/halt").map((c) => JSON.parse(c.body));

/** A notice signed by the account's key now. */
function signedNotice(name: string, id = `ntc-${Math.random()}`): Promise<Request> {
  return telnyxDelivery(`/t/n/${NOTIFICATIONS_SECRET}`, { data: { id, event_type: name, payload: {} } });
}

const toProduction = () => outbound.filter((o) => o.url.includes("/api/202/"));
const toSynthetic = () => outbound.filter((o) => o.url.includes("/api/101/"));

describe("account notices", () => {
  it("is an empty 404 without the secret", async () => {
    const wrong = new Request(`${ORIGIN}/t/n/not-the-secret`, { method: "POST", body: "{}" });
    expect((await call(wrong, env)).status).toBe(404);
    expect(guard.calls).toEqual([]);
  });

  it("halts on a signed traffic notice of a type the account has enabled, asking as the edge", async () => {
    expect((await call(await signedNotice("Suspicious Outbound Voice Traffic", "ntc-1"), env)).status).toBe(200);
    expect(halts()).toEqual([
      expect.objectContaining({ signal: "Suspicious Outbound Voice Traffic", notice_id: "ntc-1", corroborated_by: "signature" }),
    ]);
    expect(guard.calls.every((c) => c.headers[HEADER.callerClass] === "edge")).toBe(true);
    expect(outbound).toEqual([]);
  });

  it("never halts on an unsigned traffic notice: the event-type list proves no occurrence", async () => {
    expect((await call(notice("Suspicious Outbound Voice Traffic"), env)).status).toBe(200);
    expect(halts()).toEqual([]);
    expect(toProduction()).toEqual([]);
    expect(toSynthetic().map((o) => o.event?.fingerprint)).toEqual([["synthetic-infra", "telnyx-notice"]]);
    // The existing project's DSN: environment is what keeps these apart from production's own events.
    expect(toSynthetic().map((o) => o.event?.environment)).toEqual(["synthetic"]);
  });

  it("does not halt on a notice the account does not corroborate", async () => {
    expect((await call(notice("Something We Never Subscribed To"), env)).status).toBe(200);
    expect((await call(notice("Low Balance"), env)).status).toBe(200);
    expect((await call(await signedNotice("Something We Never Subscribed To"), env)).status).toBe(200);
    expect(halts()).toEqual([]);
    expect((await counters())["notice.uncorroborated"]).toBe(3);
    expect(toProduction()).toEqual([]);
  });

  it("halts on a low balance only when the balance really is low", async () => {
    balance = { data: { balance: "42.10" } };
    await call(notice("Low Balance"), env);
    expect(halts()).toEqual([expect.objectContaining({ corroborated_by: "balance" })]);
  });

  it("corroborates when Telnyx itself refuses the account's reads", async () => {
    guard.respond = (c) => (c.path.startsWith("/telnyx/") ? new Response(null, { status: 401 }) : undefined);
    expect((await call(notice("Account Disabled"), env)).status).toBe(200);
    expect(halts()).toEqual([expect.objectContaining({ corroborated_by: "account_refused" })]);
    expect(outbound).toEqual([]);
  });

  it("does not take a guard refusal as the account refusing", async () => {
    guard.respond = (c) =>
      c.path === "/halt" ? undefined : new Response(null, { status: 403, headers: { [HEADER.refusedBy]: "guard" } });
    const response = await call(await signedNotice("Account Disabled"), env);
    expect(response.status).toBe(503);
    expect(halts()).toEqual([]);
  });

  it("handles one notice once", async () => {
    await call(await signedNotice("Suspicious Outbound Voice Traffic", "ntc-same"), env);
    await call(await signedNotice("Suspicious Outbound Voice Traffic", "ntc-same"), env);
    expect(halts()).toHaveLength(1);
  });

  const haltRefused = (c: { path: string }) => {
    if (c.path === "/halt") return new Response(null, { status: 500 });
    if (c.path === "/telnyx/v2/balance") return Response.json(balance);
    return Response.json(events);
  };

  it("raises the production alert itself when the guard will not take the halt", async () => {
    guard.respond = haltRefused;
    expect((await call(await signedNotice("Suspicious Outbound Voice Traffic"), env)).status).toBe(200);
    expect(toProduction()).toHaveLength(1);
    expect(toProduction()[0].event).toMatchObject({ fingerprint: ["ops", "telnyx-account-signal"] });
    expect(toProduction()[0].event?.release).toBeUndefined();
  });

  it("answers 503 so Telnyx retries when neither the halt nor the alert can land", async () => {
    guard.respond = haltRefused;
    const noDsn = { ...env, SENTRY_PROD_DSN: undefined };
    expect((await call(await signedNotice("Suspicious Outbound Voice Traffic"), noDsn)).status).toBe(503);
    expect(outbound).toEqual([]);
  });

  it("halts on a late notice whose signature verifies, marked late, once per notice id", async () => {
    const old = String(Math.floor(Date.now() / 1000) - 3_600);
    const late = () =>
      telnyxDelivery(`/t/n/${NOTIFICATIONS_SECRET}`, { data: { id: "ntc-late", event_type: "Suspicious Outbound Voice Traffic", payload: {} } }, { timestamp: old });
    expect((await call(await late(), env)).status).toBe(200);
    expect((await call(await late(), env)).status).toBe(200);
    expect(halts()).toEqual([
      expect.objectContaining({ signal: "Suspicious Outbound Voice Traffic", notice_id: "ntc-late", corroborated_by: "signature", late: true }),
    ]);
    expect((await counters())["notice.late_signature"]).toBe(2);
  });

  it("still refuses a late notice whose signature does not verify", async () => {
    const old = String(Math.floor(Date.now() / 1000) - 3_600);
    const signed = await telnyxDelivery(`/t/n/${NOTIFICATIONS_SECRET}`, { data: { id: "n", event_type: "Low Balance" } }, { timestamp: old });
    const tampered = new Request(signed, { body: JSON.stringify({ data: { id: "n", event_type: "Account Disabled" } }) });
    expect((await call(tampered, env)).status).toBe(400);
    expect(halts()).toEqual([]);
  });

  it("marks nothing late on a fresh signature", async () => {
    await call(await signedNotice("Suspicious Outbound Voice Traffic", "ntc-fresh"), env);
    expect(halts()[0]).not.toHaveProperty("late");
  });

  it("verifies a notice that arrives signed", async () => {
    const signed = await telnyxDelivery(`/t/n/${NOTIFICATIONS_SECRET}`, { data: { id: "n", event_type: "Low Balance" } });
    const tampered = new Request(signed, { body: JSON.stringify({ data: { id: "n", event_type: "Account Disabled" } }) });
    expect((await call(tampered, env)).status).toBe(400);
    expect((await call(signed, env)).status).toBe(200);
  });
});

describe("notice parsing", () => {
  it("reads the name and id from the envelope, and keys an id-less notice by its hash", async () => {
    expect(await parseNotice(JSON.stringify({ data: { id: "a", event_type: "Low Balance" } }))).toEqual({
      key: "a",
      id: "a",
      name: "Low Balance",
    });
    const anonymous = await parseNotice(JSON.stringify({ event_type: "Account Disabled" }));
    expect(anonymous?.key).toMatch(/^[0-9a-f]{64}$/);
    expect(await parseNotice("[]")).toBeNull();
  });

  it("matches event names loosely but not trivially", () => {
    expect(sameEvent("Low Balance", "account.low_balance")).toBe(true);
    expect(sameEvent("Suspicious Outbound Voice Traffic", "suspicious_outbound_voice_traffic")).toBe(true);
    expect(sameEvent("Low Balance", "Account Disabled")).toBe(false);
    expect(sameEvent("Calls", "Emergency Number Dialed")).toBe(false);
  });

  it("reads a balance however the guard shapes it", () => {
    expect(balanceOf({ data: { balance: "12.50" } })).toBe(12.5);
    expect(balanceOf({ balance: 3 })).toBe(3);
    expect(balanceOf(7)).toBe(7);
    expect(balanceOf({})).toBeNull();
  });
});
