/**
 * Ring beacons from the browser (D142). The stage spelling in beacons.ts is
 * checked by apps/api/src/routes/ring-beacons.test.ts; this covers what a
 * beacon carries and that it can fail every way without the ring noticing.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  publicEnv: { NEXT_PUBLIC_API_URL: "https://api.example.test" },
}));
vi.mock("@/lib/supabase/browser", () => ({
  getAccessToken: async () => "token-1",
}));

import { createRingBeaconSender, webOs, type WebDeviceState } from "./beacons";

const DEVICE: WebDeviceState = {
  os: "web-windows",
  permissions: { notifications: "granted", microphone: "prompt" },
};

function harness(options: { token?: string | null; fetch?: typeof fetch } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch =
    options.fetch ??
    (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response('{"recorded":true}', { status: 202 });
    });
  const send = createRingBeaconSender({
    baseUrl: "https://api.example.test/",
    getAccessToken: async () => (options.token === undefined ? "token-1" : options.token),
    appVersion: "0.18.2",
    fetch: fakeFetch as typeof fetch,
    deviceState: async () => DEVICE,
    now: () => new Date("2026-10-30T12:00:00.000Z"),
  });
  return { send, calls };
}

describe("createRingBeaconSender", () => {
  it("posts the stage with the app's own headers and nothing from the call", async () => {
    const { send, calls } = harness();

    await send("company-1", "ringing_shown", "v3:sess-1");

    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(url).toBe("https://api.example.test/v1/ring-beacons");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Authorization: "Bearer token-1",
      "X-Client": "web",
      "X-Company-Id": "company-1",
      "X-App-Version": "0.18.2",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      call_session_id: "v3:sess-1",
      stage: "ringing_shown",
      occurred_at: "2026-10-30T12:00:00.000Z",
      os: "web-windows",
      permissions: { notifications: "granted", microphone: "prompt" },
    });
  });

  it.each([
    ["no workspace", null, "v3:sess-1"],
    ["no session", "company-1", null],
    ["an empty session", "company-1", ""],
  ])("sends nothing with %s", async (_label, company, session) => {
    const { send, calls } = harness();
    await send(company, "answered", session);
    expect(calls).toHaveLength(0);
  });

  it("sends nothing when signed out", async () => {
    const { send, calls } = harness({ token: null });
    await send("company-1", "answered", "v3:sess-1");
    expect(calls).toHaveLength(0);
  });

  it("resolves, never rejects, when the network fails", async () => {
    const { send } = harness({
      fetch: (async () => {
        throw new TypeError("Failed to fetch");
      }) as typeof fetch,
    });
    await expect(send("company-1", "declined", "v3:sess-1")).resolves.toBeUndefined();
  });

  it("resolves when the server refuses the beacon", async () => {
    const { send } = harness({
      fetch: (async () => new Response("{}", { status: 404 })) as typeof fetch,
    });
    await expect(send("company-1", "declined", "v3:sess-1")).resolves.toBeUndefined();
  });
});

describe("webOs", () => {
  it("names the coarse platform and never the user agent", () => {
    expect(webOs({ userAgentData: { platform: "Windows" } })).toBe("web-windows");
    expect(webOs({ userAgentData: { platform: "Chrome OS" } })).toBe("web-chrome-os");
    expect(webOs({})).toBe("web");
    expect(webOs(undefined)).toBe("web");
  });

  it("stays inside the server's character set and length", () => {
    const os = webOs({ userAgentData: { platform: "x".repeat(80) + "/é" } });
    expect(os).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(os.length).toBeLessThanOrEqual(40);
  });
});
