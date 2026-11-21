import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyApiPlacement } from "../../ops/api-placement.mjs";

const API = "https://api.example.com";

function health(placement, status = 200) {
  return new Response(null, { status, headers: placement ? { "cf-placement": placement } : {} });
}

function db(timing, status = 204) {
  return new Response(null, { status, headers: timing ? { "server-timing": timing } : {} });
}

test("retries health before falling back to the database probe", async (t) => {
  const responses = [health(), health("remote-IAD")];
  const fetch = t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, `${API}/health`);
    return responses.shift();
  });

  assert.deepEqual(await verifyApiPlacement(API, {}), {
    ok: true,
    message: "API answers with cf-placement remote-IAD",
  });
  assert.equal(fetch.mock.callCount(), 2);
});

test("accepts a cold round trip through IAD or a fast round trip without a colo", async (t) => {
  const timings = ['db;dur=94.0;desc="IAD"', "db;dur=27.0"];
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url === `${API}/health`) return health();
    assert.equal(url, `${API}/health/db`);
    return db(timings.shift());
  });

  assert.deepEqual(await verifyApiPlacement(API, {}), {
    ok: true,
    message: "API reached Supabase in 94 ms through IAD",
  });
  assert.deepEqual(await verifyApiPlacement(API, {}), {
    ok: true,
    message: "API reached Supabase in 27 ms",
  });
});

test("fails when the database probe stays at the edge, times an error, or has no valid timing", async (t) => {
  const responses = [db('db;dur=76.0;desc="YVR"'), db('db;dur=27.0;desc="IAD"', 503), db("db;dur=0")];
  const fetch = t.mock.method(globalThis, "fetch", async (url) =>
    url === `${API}/health` ? health("local-YVR") : responses.shift(),
  );

  const result = await verifyApiPlacement(API, {});
  assert.equal(result.ok, false);
  assert.match(result.message, /HTTP 204, db;dur=76\.0;desc="YVR"/);
  assert.match(result.message, /HTTP 503/);
  assert.equal(fetch.mock.callCount(), 6);
});

test("never substitutes a database round trip for liveness", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, `${API}/health`);
    return health("remote-IAD", 500);
  });

  const result = await verifyApiPlacement(API, {});
  assert.equal(result.ok, false);
  assert.match(result.message, /\/health did not answer 200/);
  assert.equal(fetch.mock.callCount(), 3);
});
