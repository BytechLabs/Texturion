/**
 * #251 — a ceiling has to fail truthfully, not hang and not lie.
 *
 * `docs/CAPACITY.md` §2 records four unknowns as unmeasurable locally, and it is
 * right: DO saturation, the pooler ceiling, realtime fan-out and webhook bursts
 * are all properties of a deployed system under concurrency. It then says one
 * more thing, which is the part local code CAN answer:
 *
 * > The honest-degradation requirement is also unverified. #251 asks that every
 * > ceiling produce a truthful failure rather than a hang. That cannot be
 * > claimed for a ceiling nobody has reached.
 *
 * Reaching the ceiling needs a load driver. Reaching the FAILURE the ceiling
 * produces does not: a saturated pooler refuses the connection, and a refused
 * connection is a PostgREST error we can hand the app directly. What happens
 * next is entirely ours, and it is what a customer experiences on the worst day
 * this product has.
 *
 * ---------------------------------------------------------------------------
 * THIS DRIVES THE REAL APP, AND THAT IS THE WHOLE POINT.
 *
 * `buildTestApp` in the routes harness installs its OWN `onError`, a simplified
 * double that returns the envelope and nothing else. Every route suite in this
 * repo runs against that double, so no existing test could see the two things
 * the real handler in `index.ts` does — the CORS re-echo and the `request_id`.
 * A guard written against the harness would have passed while asserting nothing
 * about production. So this imports `app` from `./index`, the way `mount.test.ts`
 * does.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CORS HEADER IS ASSERTED AT ALL.
 *
 * An error response that ships without `Access-Control-Allow-Origin` is read by
 * the browser as a "CORS error", so the real 5xx never reaches the client and a
 * database outage presents as a configuration bug. That is not hypothetical
 * here: a transient `/me` failure was read as CORS for a while before it turned
 * out to be a cold-isolate 1101. A failure the customer cannot see the reason
 * for is a DISHONEST failure even when the status code is right.
 *
 * WHAT THIS DOES NOT TELL YOU, stated because I checked. `index.ts`'s `onError`
 * re-echoes the origin, with a comment explaining that a thrown error unwinds
 * past the CORS middleware before its post-`next()` header pass. I deleted that
 * re-echo and this suite still passed, because Hono's `cors()` sets the header
 * BEFORE `next()`, so it is already on the response when the error unwinds.
 *
 * So this asserts the OUTCOME (the response is readable cross-origin) and
 * cannot attribute it to either mechanism. Do not read a passing run as
 * evidence that the re-echo is dead code and delete it: this runs in the test
 * runtime, not in Workers behind `Sentry.withSentry`, and the re-echo is cheap
 * belt-and-braces for a failure that has actually happened here. Deleting it
 * needs evidence from the deployed runtime, which this file does not provide.
 */
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../context";
import { app } from "../index";
import { buildTestApp } from "../test/routes-harness";
import {
  authorizeRoute,
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type TestAuth,
} from "../test/support";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";

let auth: TestAuth;

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The shape a saturated pooler returns: the connection is refused, PostgREST
 * surfaces it with the driver's own words, and the route's `unwrap` turns that
 * into a thrown Error. The message is deliberately one that would be
 * embarrassing to leak.
 */
const REFUSAL =
  "remaining connection slots are reserved for non-replication superuser connections";

function poolerRefuses() {
  stubFetch(
    jwksRoute(auth),
    authorizeRoute(env, { id: MEMBER_ID, role: "owner" }),
    // Everything else Supabase-bound refuses, which is what exhaustion looks
    // like: not one bad query, but the next connection failing to open.
    async (url) => {
      if (!url.href.startsWith(env.SUPABASE_URL)) return undefined;
      return new Response(
        JSON.stringify({ message: REFUSAL, code: "53300" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    },
  );
}

async function callUnderRefusal(headers: Record<string, string> = {}) {
  poolerRefuses();
  return app.request(
    "/v1/conversations",
    {
      headers: {
        Authorization: `Bearer ${await auth.token()}`,
        "X-Company-Id": COMPANY_ID,
        ...headers,
      },
    },
    env,
  );
}

describe("#251 the database refusing is an honest failure", () => {
  it("answers rather than hanging", async () => {
    // The first requirement, and the one a hang violates silently. A request
    // that cannot be served must still terminate: a hung request gives the
    // client no state to act on and holds a connection while the pool is
    // already exhausted, which is the shape of an outage that gets worse the
    // longer it lasts.
    const res = await callUnderRefusal();
    expect(res.status).toBeGreaterThanOrEqual(500);
  });

  it("does not leak the driver's message to the customer", async () => {
    // The refusal names our infrastructure and tells a customer nothing they
    // can act on.
    const res = await callUnderRefusal();
    const text = await res.text();
    expect(text).not.toContain("connection slots");
    expect(text).not.toContain("superuser");
    expect(text).not.toContain("53300");
  });

  it("returns the SPEC envelope with a request id to trace it by", async () => {
    // The ray turns "it broke" into one log line and one Sentry event. Without
    // it the founder is grepping by timestamp during the incident.
    const res = await callUnderRefusal({ "cf-ray": "abc123-YYZ" });
    const body = (await res.json()) as {
      error: { code: string; message: string; request_id?: string };
    };
    expect(body.error.code).toBeTruthy();
    expect(body.error.message).toBe("Something went wrong.");
    expect(body.error.request_id).toBe("abc123-YYZ");
  });

  it("stays READABLE cross-origin, so an outage is not misread as a CORS bug", async () => {
    // The outcome that matters: whichever layer supplies the header, an error
    // the client cannot read is an outage that looks like a configuration bug.
    // That mistake has already been made once here, against a cold-isolate
    // 1101. See the header note for why a pass does not tell you WHICH layer.
    const res = await callUnderRefusal({ origin: env.APP_ORIGIN });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(env.APP_ORIGIN);
    // Contains rather than equals: the CORS middleware and the error handler
    // each add it, so this arrives as "Origin, Origin". A repeated token in a
    // Vary list is a no-op to every cache that reads it, and tightening the
    // assertion would mean editing the header logic the rest of this file
    // exists to protect, for a cosmetic gain.
    expect(res.headers.get("Vary")).toContain("Origin");
  });

  it("the test harness now answers the same way the real app does", async () => {
    // The reason this file had to import the real `app`: `buildTestApp` used to
    // install a simplified `onError` of its own, so every route suite in the
    // repo asserted against an error response production does not send. Both
    // now call `internalErrorResponse`, and this is what stops them drifting
    // apart again — a future route test about failure can trust its harness.
    const harnessApp = buildTestApp(
      new Hono<AppEnv>().get("/boom", () => {
        throw new Error(REFUSAL);
      }),
    );
    stubFetch(jwksRoute(auth));
    const res = await harnessApp.request(
      "/v1/boom",
      {
        headers: {
          Authorization: `Bearer ${await auth.token()}`,
          "X-Company-Id": COMPANY_ID,
          origin: env.APP_ORIGIN,
          "cf-ray": "harness-ray",
        },
      },
      env,
    );
    const body = (await res.json()) as {
      error: { message: string; request_id?: string };
    };
    expect(body.error.message).toBe("Something went wrong.");
    expect(body.error.request_id).toBe("harness-ray");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(env.APP_ORIGIN);
  });

  it("echoes only an allowed origin, not whatever asked", async () => {
    // The re-echo is a fix for a masked failure, not a relaxation: it must not
    // become a way to read our error envelope from anywhere.
    const res = await callUnderRefusal({ origin: "https://evil.example" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
