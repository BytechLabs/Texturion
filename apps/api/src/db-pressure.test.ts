import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb, isDatabaseOverload } from "./db";
import {
  databaseOverloaded,
  databasePressure,
  markDatabaseOverloaded,
} from "./db-pressure";
import type { Env } from "./env";

/**
 * #251 -- once the database has refused a request, that request stops asking.
 *
 * The rig's overload run found requests answered after 80 to 110 seconds. A
 * request makes several database calls in a row, each with a 10 s deadline, and
 * after the first timed out the rest each waited their own ten seconds in the
 * queue that had just failed it. The fix is per request: the first timeout or
 * refusal marks the request, and its later database calls fail at once.
 *
 * These drive the real `getDb` transport and the real middleware with a fetch
 * double, because the property is about how they interact, and a unit test of
 * either alone would pass while the pair did not.
 */

const ORIGIN = "https://app.example.test";
const timeoutError = () => new DOMException("The operation timed out.", "TimeoutError");

function freshEnv(): Env {
  return {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test",
  } as unknown as Env;
}

type Respond = (call: number) => Response | Promise<Response>;

/** Stub the transport; returns how many database calls actually left. */
function stubDatabase(respond: Respond): { calls: () => number } {
  let calls = 0;
  vi.stubGlobal("fetch", async () => {
    calls += 1;
    return respond(calls);
  });
  return { calls: () => calls };
}

const ok = () =>
  new Response("[]", { status: 200, headers: { "content-type": "application/json" } });

/**
 * A route that makes `reads` database calls one after another and keeps going
 * past a failed one, the way a best-effort lookup does, then fails if any
 * failed. The real routes throw on the first error; carrying on is what shows
 * how many calls were still attempted.
 */
function appWithReads(reads: number, env: Env) {
  const app = new Hono();
  app.use("*", databasePressure(() => [ORIGIN]));
  app.get("/reads", async (c) => {
    const db = getDb(env);
    let failed = false;
    for (let index = 0; index < reads; index += 1) {
      const { error } = await db.from("t").select("id").limit(1);
      failed ||= error !== null;
    }
    if (failed) throw new Error("a read failed");
    return c.json({ ok: true });
  });
  // POST calls: postgrest-js never retries these, so each one is exactly one
  // trip to the fetch double and the count means what it says.
  app.get("/rpc-reads", async (c) => {
    const db = getDb(env);
    let lastFailed = false;
    for (let index = 0; index < reads; index += 1) {
      const { error } = await db.rpc("api_something");
      lastFailed = error !== null;
    }
    if (lastFailed) throw new Error("the last call failed");
    return c.json({ ok: true });
  });
  app.get("/own-bug", async () => {
    const db = getDb(env);
    await db.rpc("api_something");
    await db.rpc("api_something");
    throw new Error("a bug of the route's own");
  });
  app.get("/returns-500", async (c) => {
    markDatabaseOverloaded();
    return c.json({ error: { code: "internal_error", message: "x" } }, 500);
  });
  app.get("/fine", async (c) => {
    markDatabaseOverloaded();
    return c.json({ ok: true });
  });
  return app;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("#251 a request that saw the database refuse stops asking it", () => {
  it("fails the rest of the request at once after a timeout", async () => {
    const env = freshEnv();
    const database = stubDatabase(() => {
      throw timeoutError();
    });
    const app = appWithReads(4, env);

    const res = await app.request("/reads", { headers: { origin: ORIGIN } });

    // One call left the Worker. Without the fix there are four, which is four
    // ten-second waits behind the same saturated queue.
    expect(database.calls()).toBe(1);
    expect(res.status).toBe(503);
  });

  it("answers 503 with a Retry-After and the SPEC envelope, not a 500", async () => {
    const env = freshEnv();
    stubDatabase(() => {
      throw timeoutError();
    });
    const res = await appWithReads(2, env).request("/reads", {
      headers: { origin: ORIGIN, "cf-ray": "ray-abc-YYZ" },
    });

    expect(res.status).toBe(503);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    const body = (await res.json()) as {
      error: { code: string; message: string; request_id?: string };
    };
    expect(body.error.code).toBe("service_unavailable");
    expect(body.error.request_id).toBe("ray-abc-YYZ");
    // The sentence is ours. It never carries the driver's words.
    expect(body.error.message).not.toMatch(/timeout|abort|connection|postgres/i);
  });

  it("stays readable cross-origin for an allowed origin only", async () => {
    const env = freshEnv();
    stubDatabase(() => {
      throw timeoutError();
    });
    const app = appWithReads(1, env);

    const allowed = await app.request("/reads", { headers: { origin: ORIGIN } });
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);

    const stranger = await app.request("/reads", {
      headers: { origin: "https://evil.example" },
    });
    expect(stranger.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("treats a gateway that ran out of connections as the database refusing", async () => {
    // Found on the rig at 800 concurrent callers: Kong logged "512
    // worker_connections are not enough" and answered this bare 500, which the
    // Worker reported as "Something went wrong." for 32 requests.
    const env = freshEnv();
    const database = stubDatabase(
      () =>
        new Response(JSON.stringify({ message: "An unexpected error occurred" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );
    const res = await appWithReads(3, env).request("/reads");
    expect(database.calls()).toBe(1);
    expect(res.status).toBe(503);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("treats PostgREST 503 and 504, and a gateway 502, as the database refusing", async () => {
    for (const status of [502, 503, 504]) {
      const env = freshEnv();
      const database = stubDatabase(
        () => new Response(JSON.stringify({ code: "PGRST003" }), { status }),
      );
      const res = await appWithReads(3, env).request("/reads");
      expect(database.calls(), `HTTP ${status}`).toBe(1);
      expect(res.status).toBe(503);
    }
  });

  it("treats Postgres running out of connections (53300) as overload", async () => {
    const env = freshEnv();
    const database = stubDatabase(
      () =>
        new Response(
          JSON.stringify({
            code: "53300",
            message:
              "remaining connection slots are reserved for non-replication superuser connections",
          }),
          { status: 500, headers: { "content-type": "application/json" } },
        ),
    );
    const res = await appWithReads(3, env).request("/reads");
    expect(database.calls()).toBe(1);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("superuser");
  });

  it("leaves an ordinary failed query alone", async () => {
    // A query the database ran and rejected is not the database being out of
    // room. Marking it would turn one bad row into a request-wide failure.
    const env = freshEnv();
    const database = stubDatabase(
      () =>
        new Response(JSON.stringify({ code: "23505", message: "duplicate key" }), {
          status: 409,
        }),
    );
    const res = await appWithReads(3, env).request("/reads");
    expect(database.calls()).toBe(3);
    expect(res.status).toBe(500);
  });

  it("does not touch a request that coped and succeeded", async () => {
    const env = freshEnv();
    stubDatabase(ok);
    const res = await appWithReads(1, env).request("/fine");
    expect(res.status).toBe(200);
  });

  it("reports a route's own 500 as 503 once the database refused", async () => {
    const env = freshEnv();
    stubDatabase(ok);
    const res = await appWithReads(1, env).request("/returns-500", {
      headers: { origin: ORIGIN },
    });
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).not.toBeNull();
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });

  it("keeps one request's timeout from failing another", async () => {
    // The scope is per request. A shared flag would let one slow caller turn
    // every other caller's healthy request into a 503.
    const env = freshEnv();
    const database = stubDatabase((call) => {
      if (call === 1) throw timeoutError();
      return ok();
    });
    const app = appWithReads(1, env);

    const first = await app.request("/reads");
    const second = await app.request("/reads");

    expect(first.status).toBe(503);
    expect(second.status).toBe(200);
    expect(database.calls()).toBe(2);
  });

  it("does nothing outside a request, so crons and alarms are untouched", async () => {
    const env = freshEnv();
    const database = stubDatabase(() => ok());
    const db = getDb(env);

    await db.from("t").select("id");
    expect(databaseOverloaded()).toBe(false);
    expect(markDatabaseOverloaded()).toBe(false);
    expect(databaseOverloaded()).toBe(false);
    await db.from("t").select("id");

    // Both calls left: nothing was remembered, because there is no request.
    expect(database.calls()).toBe(2);
  });

  it("hands a cron the database's own 503, not a thrown refusal", async () => {
    // Outside a request nobody is waiting on a customer's behalf, and the
    // callers there read the status (push attempts logs "HTTP 503"), so the
    // answer is theirs to interpret.
    const env = freshEnv();
    stubDatabase(
      () => new Response(JSON.stringify({ code: "PGRST003" }), { status: 503 }),
    );
    const { error, status } = await getDb(env).from("t").insert({ id: 1 });
    expect(status).toBe(503);
    expect(error?.code).toBe("PGRST003");
  });

  it("does not count the caller giving up as the database refusing", async () => {
    // Supabase passes the caller's own signal for .abortSignal(). A client that
    // cancelled has told us nothing about the database.
    const env = freshEnv();
    const database = stubDatabase(() => {
      throw new DOMException("cancelled", "AbortError");
    });
    const res = await appWithReads(3, env).request("/reads");
    expect(database.calls()).toBe(3);
    expect(res.status).toBe(500);
  });
});

describe("#251 a database that cannot be reached is reported as that", () => {
  const reset = () => new TypeError("fetch failed");

  it("answers 503 when the call died in transit and the request ended in a 5xx", async () => {
    const env = freshEnv();
    stubDatabase(() => {
      throw reset();
    });
    const res = await appWithReads(1, env).request("/rpc-reads", {
      headers: { origin: ORIGIN },
    });
    expect(res.status).toBe(503);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("does not stop asking, because a dropped connection is not a refusal", async () => {
    // postgrest-js retries these on purpose. Failing the rest of the request on
    // the first reset would turn a blip into an outage.
    const env = freshEnv();
    const database = stubDatabase(() => {
      throw reset();
    });
    await appWithReads(3, env).request("/rpc-reads");
    expect(database.calls()).toBe(3);
  });

  it("forgets it once the database answers, so a later bug stays a bug", async () => {
    const env = freshEnv();
    let calls = 0;
    stubDatabase(() => {
      calls += 1;
      if (calls === 1) throw reset();
      return ok();
    });
    // One request: the first call is reset, the second is answered, and then
    // the route fails for a reason of its own. The database answered, so this
    // is a bug and must stay a 500 rather than be called overload.
    const res = await appWithReads(1, env).request("/own-bug");
    expect(calls).toBe(2);
    expect(res.status).toBe(500);
  });
});

describe("isDatabaseOverload", () => {
  it("reads only the bodies it needs to", async () => {
    expect(await isDatabaseOverload(new Response("", { status: 200 }))).toBe(false);
    expect(await isDatabaseOverload(new Response("", { status: 404 }))).toBe(false);
    expect(await isDatabaseOverload(new Response("not json", { status: 500 }))).toBe(false);
    expect(
      await isDatabaseOverload(new Response('{"code":"XX000"}', { status: 500 })),
    ).toBe(false);
    expect(
      await isDatabaseOverload(new Response('{"code":"53300"}', { status: 500 })),
    ).toBe(true);
  });

  it("calls the gateway's bare 500 overload, and a query's own 500 a failure", async () => {
    const bare = '{"message":"An unexpected error occurred"}';
    expect(await isDatabaseOverload(new Response(bare, { status: 500 }))).toBe(true);
    // The same sentence beside a SQLSTATE came from a query, not the gateway.
    expect(
      await isDatabaseOverload(
        new Response('{"code":"XX000","message":"An unexpected error occurred"}', {
          status: 500,
        }),
      ),
    ).toBe(false);
    expect(
      await isDatabaseOverload(new Response('{"message":"duplicate key"}', { status: 500 })),
    ).toBe(false);
  });

  it("leaves the body readable for the caller", async () => {
    const response = new Response('{"code":"53300","message":"m"}', { status: 500 });
    await isDatabaseOverload(response);
    expect(await response.json()).toEqual({ code: "53300", message: "m" });
  });
});
