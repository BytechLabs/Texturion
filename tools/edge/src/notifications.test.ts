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

beforeEach(async () => {
  await resetEdge();
  guard = fakeGuard();
  balance = { data: { balance: "412.00", currency: "USD" } };
  events = { data: [{ name: "Suspicious Outbound Voice Traffic", enabled: true }, { name: "Low Balance", enabled: true }] };
  guard.respond = (c) => {
    if (c.path === "/telnyx/v2/balance") return Response.json(balance);
    if (c.path.startsWith("/telnyx/v2/notification_events")) return Response.json(events);
    return undefined;
  };
  env = await edgeEnv(guard, { SENTRY_PROD_DSN: "https://prodkey@o1.ingest.sentry.io/202" });
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

describe("account notices", () => {
  it("is an empty 404 without the secret", async () => {
    const wrong = new Request(`${ORIGIN}/t/n/not-the-secret`, { method: "POST", body: "{}" });
    expect((await call(wrong, env)).status).toBe(404);
    expect(guard.calls).toEqual([]);
  });

  it("halts on a corroborated traffic notice, asking as the edge", async () => {
    expect((await call(notice("Suspicious Outbound Voice Traffic", "ntc-1"), env)).status).toBe(200);
    expect(halts()).toEqual([
      expect.objectContaining({ signal: "Suspicious Outbound Voice Traffic", notice_id: "ntc-1", corroborated_by: "notification_event" }),
    ]);
    expect(guard.calls.every((c) => c.headers[HEADER.callerClass] === "edge")).toBe(true);
  });

  it("does not halt on a notice the account does not corroborate", async () => {
    expect((await call(notice("Something We Never Subscribed To"), env)).status).toBe(200);
    expect((await call(notice("Low Balance"), env)).status).toBe(200);
    expect(halts()).toEqual([]);
    expect((await counters())["notice.uncorroborated"]).toBe(2);
  });

  it("halts on a low balance only when the balance really is low", async () => {
    balance = { data: { balance: "42.10" } };
    await call(notice("Low Balance"), env);
    expect(halts()).toEqual([expect.objectContaining({ corroborated_by: "balance" })]);
  });

  it("corroborates when Telnyx itself refuses the account's reads", async () => {
    guard.respond = () => new Response(null, { status: 401 });
    await call(notice("Account Disabled"), env);
    expect(halts()).toEqual([expect.objectContaining({ corroborated_by: "account_refused" })]);
  });

  it("does not take a guard refusal as the account refusing", async () => {
    guard.respond = (c) =>
      c.path === "/halt" ? undefined : new Response(null, { status: 403, headers: { [HEADER.refusedBy]: "guard" } });
    const response = await call(notice("Account Disabled"), env);
    expect(response.status).toBe(503);
    expect(halts()).toEqual([]);
  });

  it("handles one notice once", async () => {
    await call(notice("Suspicious Outbound Voice Traffic", "ntc-same"), env);
    await call(notice("Suspicious Outbound Voice Traffic", "ntc-same"), env);
    expect(halts()).toHaveLength(1);
  });

  it("raises the production alert itself when the guard will not take the halt", async () => {
    const sentry = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    guard.respond = (c) => {
      if (c.path === "/halt") return new Response(null, { status: 500 });
      if (c.path === "/telnyx/v2/balance") return Response.json(balance);
      return Response.json(events);
    };
    expect((await call(notice("Suspicious Outbound Voice Traffic"), env)).status).toBe(200);
    expect(sentry).toHaveBeenCalledTimes(1);
    const body = await new Request(sentry.mock.calls[0][0] as RequestInfo, sentry.mock.calls[0][1]).text();
    expect(JSON.parse(body.split("\n")[2]).fingerprint).toEqual(["ops", "telnyx-account-signal"]);
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
