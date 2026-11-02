import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ALERT_EVENTS,
  alertFunction,
  applyAlerts,
  exceptionRows,
  main,
  parity,
  posthogFingerprint,
  posthogSettings,
  sentryOpsKeys,
} from "../src/posthog-errors.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const SETTINGS = { key: "phx_test", projectId: "7", host: "https://us.posthog.com" };

test("a Sentry fingerprint becomes PostHog's by joining its parts with a colon", () => {
  assert.equal(posthogFingerprint(["ops", "telnyx-wiring"]), "ops:telnyx-wiring");
  assert.equal(posthogFingerprint(["{{ default }}"]), undefined);
  assert.equal(posthogFingerprint([]), undefined);
});

test("settings need the personal key and default to the US app host", () => {
  assert.equal(posthogSettings({}), null);
  assert.deepEqual(posthogSettings({ POSTHOG_PERSONAL_API_KEY: "k" }), { key: "k", projectId: undefined, host: "https://us.posthog.com" });
});

test("exceptionRows asks HogQL for $exception events and maps the rows", async () => {
  const asked = [];
  const rows = await exceptionRows(SETTINGS, {
    hours: 48,
    environments: ["production"],
    fetch: async (url, init) => {
      asked.push([url, JSON.parse(init.body).query.query, init.headers.authorization]);
      return json({ results: [["ops:a", "production", 2, "2026-11-01 09:00:00"], [null, "production", 1, "2026-11-01 08:00:00"]] });
    },
  });
  assert.equal(asked[0][0], "https://us.posthog.com/api/environments/7/query/");
  assert.equal(asked[0][2], "Bearer phx_test");
  assert.match(asked[0][1], /event = '\$exception'/);
  assert.match(asked[0][1], /interval 48 hour/);
  assert.match(asked[0][1], /properties\.environment in \('production'\)/);
  assert.deepEqual(rows, [
    { fingerprint: "ops:a", environment: "production", count: 2, last_seen: "2026-11-01 09:00:00" },
    { fingerprint: null, environment: "production", count: 1, last_seen: "2026-11-01 08:00:00" },
  ]);
});

test("the project is the key's first when none is configured", async () => {
  const urls = [];
  await exceptionRows({ ...SETTINGS, projectId: undefined }, {
    fetch: async (url) => {
      urls.push(url);
      return url.endsWith("/api/projects/") ? json({ results: [{ id: 99 }] }) : json({ results: [] });
    },
  });
  assert.equal(urls[1], "https://us.posthog.com/api/environments/99/query/");
});

test("parity names every Sentry ops key PostHog did not receive, and refuses an empty comparison", () => {
  assert.deepEqual(parity(["a", "b"], ["ops:a", "ops:b", null]), { ok: true, checked: 2, missing: [] });
  assert.deepEqual(parity(["a", "b"], ["ops:a"]), { ok: false, checked: 2, missing: ["b"] });
  const empty = parity([], ["ops:a"]);
  assert.equal(empty.ok, false);
  assert.match(empty.reason, /nothing to compare/);
});

test("sentryOpsKeys reads the ops_key tag values for the environment", async () => {
  let asked;
  const keys = await sentryOpsKeys({
    token: "t",
    org: "acme",
    days: 7,
    environment: "production",
    fetch: async (url, init) => {
      asked = [url, init.headers.authorization];
      return json([{ value: "b" }, { value: "a" }]);
    },
  });
  assert.deepEqual(keys, ["a", "b"]);
  assert.match(asked[0], /organizations\/acme\/tags\/ops_key\/values\/\?statsPeriod=7d&environment=production/);
  assert.equal(asked[1], "Bearer t");
});

test("each alert is an internal_destination filtered on the issue event, posting to the webhook", () => {
  for (const alert of ALERT_EVENTS) {
    const fn = alertFunction(alert, "https://hooks.example.test/x");
    assert.equal(fn.type, "internal_destination");
    assert.equal(fn.filters.events[0].id, alert.event);
    assert.equal(fn.inputs.url.value, "https://hooks.example.test/x");
  }
  assert.deepEqual(ALERT_EVENTS.map((alert) => alert.event), ["$error_tracking_issue_created", "$error_tracking_issue_reopened"]);
});

test("applyAlerts creates what is missing, updates what exists, and wants https", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push([init.method ?? "GET", url.replace("https://us.posthog.com", "")]);
    if (!init.method) return json({ results: [{ id: "f1", name: ALERT_EVENTS[0].name }] });
    return json({});
  };
  const outcomes = await applyAlerts(SETTINGS, "https://hooks.example.test/x", fetchImpl);
  assert.deepEqual(outcomes, [
    { name: ALERT_EVENTS[0].name, action: "updated" },
    { name: ALERT_EVENTS[1].name, action: "created" },
  ]);
  assert.deepEqual(calls.slice(1), [
    ["PATCH", "/api/environments/7/hog_functions/f1/"],
    ["POST", "/api/environments/7/hog_functions/"],
  ]);
  await assert.rejects(applyAlerts(SETTINGS, "http://hooks.example.test/x", fetchImpl), /must be an https URL/);
});

test("the parity command exits 0 on parity, 1 on a missing key, 2 when it cannot run", async () => {
  const env = { POSTHOG_PERSONAL_API_KEY: "k", POSTHOG_PROJECT_ID: "7", SENTRY_AUTH_TOKEN: "t", SENTRY_ORG: "acme" };
  const answer = (posthogRows) => async (url) => (url.includes("sentry.io") ? json([{ value: "a" }]) : json({ results: posthogRows }));
  const out = [];
  assert.equal(await main(["parity"], env, answer([["ops:a", "production", 1, "x"]]), (line) => out.push(line)), 0);
  assert.equal(await main(["parity"], env, answer([]), (line) => out.push(line)), 1);
  assert.equal(await main(["parity"], { POSTHOG_PERSONAL_API_KEY: "k" }, answer([]), (line) => out.push(line)), 2);
  assert.equal(await main(["parity"], {}, answer([]), (line) => out.push(line)), 2);
});
