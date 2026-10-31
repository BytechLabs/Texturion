/**
 * D142: what a CallSessionDO alarm can send on the rig.
 *
 * An alarm wakes the object with no request, so the Worker's own start-up
 * refusals never run for it. These drive the real class: a call is brought to
 * ringing on a fake runtime, then a fresh object is revived on the same
 * storage with real bindings and no runtime installed, so it builds the real
 * one, and the ring-window alarm fires. Only the network edge is stubbed, so
 * "nothing left" is a fact about fetch.
 */
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bindings } from "../env";
import { sourceText, stripComments } from "../test/source-tree";
import type { TelnyxEvent } from "../messaging/types";
import { RIG_SUPABASE_URL, RIG_TELNYX_API_BASE, rigEnv } from "../test/rig-env";
import { stubFetch } from "../test/support";
import { CallSessionDO } from "./session-do";
import { ctx, makeRuntime, makeStorage, SESSION } from "./session-do-fake";

vi.mock("@sentry/cloudflare", async () =>
  (await import("../test/sentry-mock")).sentryModuleMock(),
);

const GUARD = new URL(RIG_TELNYX_API_BASE);
const RIG_DATABASE = new URL(RIG_SUPABASE_URL);

function initiated(): TelnyxEvent {
  return {
    data: {
      id: "evt-initiated",
      event_type: "call.initiated",
      payload: {
        call_control_id: "cust-ccid",
        call_session_id: SESSION,
        direction: "incoming",
        to: "+19995000",
        from: "+15551000",
      } as never,
    },
  };
}

/** A call left ringing in storage, as a live object would leave it. */
async function ringingCall() {
  const store = makeStorage();
  const { runtime, calls } = makeRuntime({ initiated: ctx() });
  const live = new CallSessionDO({ storage: store.storage } as never, {} as never);
  live.installRuntime(runtime);
  await live.onTelnyxEvent(initiated());
  await live.whenIdle();
  expect(calls.dials, "the fake runtime rang the member").toHaveLength(1);
  expect(store.getAlarmAt(), "the ring window is armed").not.toBeNull();
  return store;
}

/** The same storage in a new isolate, holding only bindings. */
function revive(store: ReturnType<typeof makeStorage>, bindings: Bindings): CallSessionDO {
  return new CallSessionDO({ storage: store.storage } as never, bindings as never);
}

function withoutKey(bindings: Bindings, key: string): Bindings {
  const copy = { ...bindings };
  delete copy[key];
  return copy;
}

/** Every request that reached the network edge. */
function recordEverything(): string[] {
  const requests: string[] = [];
  stubFetch((url, request) => {
    requests.push(`${request.method} ${url.href}`);
    if (url.host === GUARD.host) return Response.json({ data: { result: "ok" } });
    if (url.host === RIG_DATABASE.host) {
      return request.method === "GET" ? Response.json([]) : Response.json(null);
    }
    return new Response("not reachable from the rig", { status: 599 });
  });
  return requests;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Past the 45-second ring window, so the alarm sends the caller to voicemail. */
function ringWindowElapses(): void {
  vi.setSystemTime(new Date(Date.now() + 46_000));
}

describe("the object's only road to Telnyx", () => {
  const read = (name: string) =>
    stripComments(sourceText(join(import.meta.dirname, name)));

  it("is the runtime, which sends through the seamed client", () => {
    const shell = read("session-do.ts");
    const runtime = read("runtime.ts");
    // The shell reaches the network only through `this.rt`, built from
    // validated bindings, and the runtime only through the client.
    expect(shell).not.toMatch(/\bfetch\s*\(/);
    expect(shell).not.toMatch(/from\s+["']\.\.\/telnyx\/client["']/);
    expect(runtime).not.toMatch(/\bfetch\s*\(/);
    expect(runtime).toMatch(/import\s*\{[^}]*\btelnyxRequest\b[^}]*\}\s*from\s*["']\.\.\/telnyx\/client["']/);
    const sends = runtime.match(/\btelnyxRequest\s*\(/g) ?? [];
    expect(sends.length, "the runtime's Telnyx requests were found").toBeGreaterThan(0);
    expect(shell).toMatch(/createSessionRuntime\(\s*getEnv\(/);
  });
});

describe("a CallSessionDO alarm on the rig", () => {
  it("sends its Telnyx commands to the guard, and reaches nothing else", async () => {
    const store = await ringingCall();
    const requests = recordEverything();
    ringWindowElapses();

    await revive(store, rigEnv()).alarm().catch(() => undefined);

    const telnyx = requests.filter((line) => line.includes(GUARD.host));
    expect(telnyx, "the alarm answered the caller into voicemail").toContain(
      `POST ${RIG_TELNYX_API_BASE}/v2/calls/cust-ccid/actions/answer`,
    );
    const elsewhere = requests.filter(
      (line) => !line.includes(`//${GUARD.host}/`) && !line.includes(`//${RIG_DATABASE.host}/`),
    );
    expect(elsewhere).toEqual([]);
  });

  it.each([
    ["TELNYX_API_BASE unset", (bindings: Bindings) => withoutKey(bindings, "TELNYX_API_BASE")],
    [
      "TELNYX_API_BASE at Telnyx itself",
      (bindings: Bindings) => ({ ...bindings, TELNYX_API_BASE: "https://api.telnyx.com" }),
    ],
  ])("refuses to act with %s, and nothing leaves", async (_name, unseam) => {
    const store = await ringingCall();
    const requests = recordEverything();
    ringWindowElapses();

    await expect(revive(store, unseam(rigEnv())).alarm()).rejects.toThrowError(
      /TELNYX_API_BASE must point at the guard/,
    );
    expect(requests).toEqual([]);
  });

  it("refuses to act with a raw Telnyx key in place of the guard token", async () => {
    const store = await ringingCall();
    const requests = recordEverything();
    ringWindowElapses();

    await expect(
      revive(store, rigEnv({ TELNYX_API_KEY: "KEY0123456789ABCDEFGHIJ" })).alarm(),
    ).rejects.toThrowError(/TELNYX_API_KEY is a raw Telnyx key/);
    expect(requests).toEqual([]);
  });
});
