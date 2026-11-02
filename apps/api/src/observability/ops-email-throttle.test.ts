/**
 * #652: one ops email per fingerprint per hour.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { completeEnv, stubFetch } from "../test/support";
import { opsAlert, opsEmail } from "./ops-alert";
import {
  claimOpsEmailSlot,
  OPS_EMAIL_WINDOW_SECONDS,
  releaseOpsEmailSlot,
  type ThrottleCache,
} from "./ops-email-throttle";

vi.mock("@sentry/cloudflare", async () =>
  (await import("../test/sentry-mock")).sentryModuleMock(),
);

function fakeCache() {
  const stored = new Map<string, Response>();
  const cache: ThrottleCache = {
    async match(request) {
      return stored.get(request.url)?.clone();
    },
    async put(request, response) {
      stored.set(request.url, response);
    },
    async delete(request) {
      return stored.delete(request.url);
    },
  };
  return { cache, stored };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("claimOpsEmailSlot", () => {
  it("hands out a fingerprint's slot once", async () => {
    const { cache } = fakeCache();

    expect(await claimOpsEmailSlot("ops:a", cache)).toBe(true);
    expect(await claimOpsEmailSlot("ops:a", cache)).toBe(false);
    expect(await claimOpsEmailSlot("ops:b", cache)).toBe(true);
  });

  it("stores the slot for an hour, under a hashed key", async () => {
    const { cache, stored } = fakeCache();
    await claimOpsEmailSlot("ops:with spaces & a very long tail ".repeat(20), cache);

    const [[url, response]] = [...stored];
    expect(url).toMatch(/^https:\/\/ops-email-throttle\.invalid\/[0-9a-f]{64}$/);
    expect(response.headers.get("cache-control")).toBe(
      `public, max-age=${OPS_EMAIL_WINDOW_SECONDS}`,
    );
    expect(OPS_EMAIL_WINDOW_SECONDS).toBe(3600);
  });

  it("hands a released slot out again", async () => {
    const { cache } = fakeCache();
    await claimOpsEmailSlot("ops:a", cache);
    await releaseOpsEmailSlot("ops:a", cache);

    expect(await claimOpsEmailSlot("ops:a", cache)).toBe(true);
  });

  it("sends when there is no cache at all", async () => {
    expect(await claimOpsEmailSlot("ops:a", undefined)).toBe(true);
    expect(await claimOpsEmailSlot("ops:a", undefined)).toBe(true);
  });
});

describe("the direct ops mail goes through the same slot", () => {
  const env = completeEnv();

  function world() {
    const subjects: string[] = [];
    stubFetch((url, request) => {
      if (url.host !== "api.resend.com") return undefined;
      return (async () => {
        subjects.push(((await request.clone().json()) as { subject: string }).subject);
        return Response.json({ id: "email-1" });
      })();
    });
    return subjects;
  }

  it("mails a storm of one key once, and a different key separately", async () => {
    vi.stubGlobal("caches", { default: fakeCache().cache });
    const subjects = world();

    for (let i = 0; i < 25; i += 1) {
      await opsAlert(env, { key: "storm", summary: "storm is on" });
      await opsEmail(env, { key: "storm", subject: "storm, again", text: "x" });
    }
    await opsAlert(env, { key: "other", summary: "other is on" });

    expect(subjects).toEqual(["[ops] storm is on", "[ops] other is on"]);
  });

  it("hands the slot back when the send fails, so the next alert still mails", async () => {
    vi.stubGlobal("caches", { default: fakeCache().cache });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let failing = true;
    const subjects: string[] = [];
    stubFetch((url, request) => {
      if (url.host !== "api.resend.com") return undefined;
      if (failing) return new Response("down", { status: 500 });
      return (async () => {
        subjects.push(((await request.clone().json()) as { subject: string }).subject);
        return Response.json({ id: "email-1" });
      })();
    });

    await opsAlert(env, { key: "flaky", summary: "flaky" });
    failing = false;
    await opsAlert(env, { key: "flaky", summary: "flaky" });

    expect(subjects).toEqual(["[ops] flaky"]);
  });
});
