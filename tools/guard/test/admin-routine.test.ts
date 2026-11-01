import { readFileSync } from "node:fs";

import { EDGE_PATHS, HEADER, type GuardHealth } from "@loonext/rig-protocol";
import { describe, expect, it } from "vitest";

import { edgeHealth, edgePost, HEALTH_ROUTINE, healthLines, measurementPosts, measureProduction, ROUTINES, runRoutine, type Post } from "../scripts/admin-routine";
import {
  parseRead,
  planFiling,
  PRODUCTION_SQL,
  quietestWindow,
  readProduction,
  windowDue,
  type ProductionRead,
  type PsqlRunner,
} from "../scripts/production-measurements";
import { ADMISSION_KEYS } from "../src/state/admission";
import { LIMIT_KEYS } from "../src/state/concurrency";
import { readTier } from "../src/state/ledger";
import { EDGE, fileMeasurements, fileValidation, harness, N, ready, seedAccount, type Harness } from "./support";

/** guard.yml's path to the guard: the edge's /g prefix, the admin class. */
function edgeFetcher(h: Harness): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    expect(url.origin).toBe(EDGE);
    expect(request.headers.get("authorization")).toBe("Bearer admin-token");
    const headers = new Headers(request.headers);
    headers.delete("authorization");
    headers.set(HEADER.callerClass, "admin");
    return h.guard.handle(
      new Request(`https://guard.internal${url.pathname.slice(EDGE_PATHS.guardPrefix.length)}`, {
        method: request.method,
        headers,
        body: request.method === "GET" ? undefined : await request.text(),
      }),
    );
  }) as typeof fetch;
}

function throughEdge(h: Harness): Post {
  return edgePost(EDGE, "admin-token", edgeFetcher(h));
}

const noWait = async () => {};

const ROLES = ["ROBOT-1", "ROBOT-2", "STRANGER-1", "DEV-W1", "DEV-W2", "DEV-A1", "DEV-C1", "DEV-E1"];
const EIGHT = ["+14165550170", "+14165550171", "+14165550172", "+14165550173", "+14165550174", "+14165550175", "+14165550176", "+14165550177"];

/** Ids, numbers and addresses the fake account holds: none may reach a public log. */
function assertPublicSafe(lines: string[]): void {
  const text = lines.join("\n");
  expect(text).not.toMatch(/\+1\d{10}|\d{7,}/);
  expect(text).not.toMatch(/\b(?:num|conn|prof|cred|bg|ovp|order)-[a-z0-9-]+|key-(?:production|guard|unexpected)|grant-1/);
  expect(text).not.toContain("@");
}

describe("guard.yml's admin routines", () => {
  it("run setup, then the start-up checks, and print only states and names", async () => {
    const h = harness();
    const setup = await runRoutine("setup", throughEdge(h));
    expect(setup.ok).toBe(true);
    expect(setup.lines).toContain("billing_group loonext-nonprod created");
    expect(setup.lines.at(-1)).toBe(JSON.stringify({ state: "ok", reasons: [] }));
    const check = await runRoutine("check", throughEdge(h));
    expect(check).toEqual({ ok: true, lines: [JSON.stringify({ state: "ok", reasons: [] })] });
    assertPublicSafe([...setup.lines, ...check.lines]);
  });

  it("fail the run when the partition is unsafe, and pass with a notice before the Telnyx key exists", async () => {
    const h = harness();
    seedAccount(h.telnyx);
    const voice = h.telnyx.lists.call_control_applications.find((item) => item.id === "conn-voice");
    if (voice) voice.webhook_event_url = "https://api.loonext.com/webhooks/telnyx";
    const unsafe = await runRoutine("check", throughEdge(h));
    expect(unsafe.ok).toBe(false);
    expect(unsafe.lines.join("\n")).toContain("points_at_production:app:nonprod-voice");

    const keyless = await runRoutine("check", throughEdge(harness({ env: { TELNYX_API_KEY: "" } })));
    expect(keyless.ok).toBe(true);
    expect(keyless.lines[0]).toMatch(/^::notice title=Guard has no Telnyx key yet::/);
  });

  it("order every standing role, one per call, and say which without the numbers", async () => {
    const h = harness();
    await fileMeasurements(h);
    await fileValidation(h);
    h.telnyx.available = EIGHT;
    expect((await runRoutine("setup", throughEdge(h))).ok).toBe(true);
    const waits: number[] = [];
    const outcome = await runRoutine("order-standing", throughEdge(h), {}, async (ms) => {
      waits.push(ms);
      h.advance(ms);
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.lines.filter((line) => line.startsWith("ordered "))).toHaveLength(8);
    expect(outcome.lines.at(-1)).toBe("every standing role is held");
    expect(h.telnyx.requests("POST", "/v2/number_orders")).toHaveLength(8);
    expect(waits.every((ms) => ms >= 10_000)).toBe(true);
    assertPublicSafe(outcome.lines);
  });

  it("order all eight roles with no voice connection while paid dials are refused, and say which wait", async () => {
    const h = harness();
    await fileMeasurements(h);
    h.telnyx.available = EIGHT;
    expect((await runRoutine("setup", throughEdge(h))).ok).toBe(true);
    const outcome = await runRoutine("order-standing", throughEdge(h), {}, async (ms) => h.advance(ms));
    expect(outcome.ok).toBe(true);
    expect(outcome.lines.filter((line) => line.startsWith("ordered "))).toEqual(ROLES.map((role) => `ordered ${role}`));
    expect(outcome.lines.at(-1)).toBe(`every standing role is held; no voice connection until paid dials open: ${ROLES.join(", ")}`);
    const orders = h.telnyx.requests("POST", "/v2/number_orders");
    expect(orders).toHaveLength(8);
    for (const sent of orders) {
      expect(sent.body, "a bound number would take inbound calls").not.toHaveProperty("connection_id");
      expect(sent.body).toHaveProperty("messaging_profile_id");
    }
    const held = EIGHT.map((phone) => h.telnyx.numbers.find((item) => item.phone_number === phone)!);
    expect(held.map((item) => item.connection_id)).toEqual(Array(8).fill(null));
    expect(held.every((item) => typeof item.messaging_profile_id === "string")).toBe(true);
    expect(await h.store.get("orders:first")).toMatchObject({ state: "verified", expect: { connection_id: null }, number_id: held[0]!.id });
    assertPublicSafe(outcome.lines);
  });

  it("bind the voice-less standing numbers once paid dials open, but not a detached one", async () => {
    const h = harness();
    await fileMeasurements(h);
    h.telnyx.available = EIGHT;
    expect((await runRoutine("setup", throughEdge(h))).ok).toBe(true);
    expect((await runRoutine("order-standing", throughEdge(h), {}, async (ms) => h.advance(ms))).ok).toBe(true);
    const held = EIGHT.map((phone) => h.telnyx.numbers.find((item) => item.phone_number === phone)!);
    expect(held.map((item) => item.connection_id)).toEqual(Array(8).fill(null));
    await h.store.put(`detached:${held[7]!.id}`, { at: h.clock.now, reason: "stranger_flood" });

    await fileValidation(h);
    h.telnyx.log.length = 0;
    const answer = await h.call("/admin/numbers/order-standing", { caller: "admin", method: "POST" });
    expect(await answer.json()).toMatchObject({ ordered: null, bound: 7, voice_deferred: [ROLES[7]] });
    const bound = h.telnyx.requests("PATCH").filter((entry) => (entry.body as Record<string, unknown>)?.connection_id !== undefined);
    expect(bound.map((entry) => entry.path)).toEqual(held.slice(0, 7).map((item) => `/v2/phone_numbers/${item.id}`));
    expect(held.map((item) => item.connection_id !== null)).toEqual([true, true, true, true, true, true, true, false]);
  });

  it("stop, red, when ordering is off, and name the rule", async () => {
    const h = await ready();
    h.production.capabilities = [];
    const outcome = await runRoutine("order-standing", throughEdge(h), {}, noWait);
    expect(outcome.ok).toBe(false);
    expect(outcome.lines.at(-1)).toContain("provisioning.ordering_off");
  });

  it("stop, red, after an order Telnyx did not confirm, then warn that its role's number is not listed", async () => {
    const h = harness();
    await fileMeasurements(h);
    h.telnyx.available = EIGHT;
    expect((await runRoutine("setup", throughEdge(h))).ok).toBe(true);
    h.telnyx.failNext = { method: "POST", path: "/v2/number_orders", status: 500 };
    const stopped = await runRoutine("order-standing", throughEdge(h), {}, async (ms) => h.advance(ms));
    expect(stopped.ok).toBe(false);
    expect(stopped.lines.at(-1)).toMatch(/^::error title=Order unconfirmed::Telnyx answered 500 to ROBOT-1's order/);

    const done = await runRoutine("order-standing", throughEdge(h), {}, async (ms) => h.advance(ms));
    expect(done.ok).toBe(true);
    expect(done.lines).toContain("::warning title=Standing numbers not listed::Held but not yet in the partition's group listing: ROBOT-1");
    expect(h.telnyx.requests("POST", "/v2/number_orders")).toHaveLength(8);
    assertPublicSafe([...stopped.lines, ...done.lines]);
  });

  it("resume ordering: name who and why to the guard, and print only states", async () => {
    const h = await ready();
    await h.store.put("orders:stopped", { at: h.clock.now, reason: "number_unreadable" });
    const outcome = await runRoutine("resume-ordering", throughEdge(h), {}, noWait, { by: "operator-1", reason: "Read-back now lists the number" });
    expect(outcome).toEqual({ ok: true, lines: ["cleared stop number_unreadable for operator-1; the read-back answered none"] });
    expect(await h.store.get("orders:stopped")).toBeUndefined();
    expect(await h.store.get("orders:resumes")).toEqual([
      { at: h.clock.now, by: "operator-1", why: "Read-back now lists the number", cleared: "number_unreadable" },
    ]);
    assertPublicSafe(outcome.lines);
  });

  it("resume ordering: refuse before calling the guard when nobody says why", async () => {
    const h = await ready();
    await h.store.put("orders:stopped", { at: h.clock.now, reason: "number_unreadable" });
    for (const resume of [{}, { by: "operator-1" }, { reason: "Read-back now lists the number" }, { by: " ", reason: " " }]) {
      const outcome = await runRoutine("resume-ordering", throughEdge(h), {}, noWait, resume);
      expect(outcome.ok).toBe(false);
      expect(outcome.lines[0]).toMatch(/^::error title=Resume refused::/);
    }
    expect(await h.store.get("orders:stopped")).toMatchObject({ reason: "number_unreadable" });
  });

  it("resume ordering: fail, naming the rule, when the stop is not one a person may lift", async () => {
    const h = await ready();
    await h.store.put("orders:stopped", { at: h.clock.now, reason: "group_not_kept" });
    const outcome = await runRoutine("resume-ordering", throughEdge(h), {}, noWait, { by: "operator-1", reason: "Read-back now lists the number" });
    expect(outcome.ok).toBe(false);
    expect(outcome.lines.at(-1)).toContain("provisioning.resume_refused");
  });

  it("resume ordering: fail the run when the read-back stops ordering again", async () => {
    const h = await ready();
    h.telnyx.orderStatus = "pending";
    await h.store.put("orders:stopped", { at: h.clock.now, reason: "number_unreadable" });
    await h.store.put("orders:first", { state: "pending", order_id: null, phone_number: "+14165550150", at: h.clock.now });
    const outcome = await runRoutine("resume-ordering", throughEdge(h), {}, noWait, { by: "operator-1", reason: "Read-back now lists the number" });
    expect(outcome.ok).toBe(false);
    expect(outcome.lines[0]).toBe("cleared stop number_unreadable for operator-1; the read-back answered failed");
    expect(outcome.lines[1]).toMatch(/^::error title=Ordering stopped again::/);
  });

  it("run and accept the key inventory, printing counts, never ids", async () => {
    const h = await ready();
    h.telnyx.apiKeys = [{ id: "key-production" }, { id: "key-guard" }];
    h.telnyx.lists.oauth_grants.push({ id: "grant-1" });
    const run = await runRoutine("key-inventory", throughEdge(h));
    expect(run.ok).toBe(true);
    expect(JSON.parse(run.lines[0])).toEqual({
      sources: { api_keys: 2, oauth_clients: 0, oauth_grants: 1, audit_findings: 0 },
      unexpected: { no_accepted_baseline: 1 },
    });
    const accept = await runRoutine("accept-key-inventory", throughEdge(h));
    expect(JSON.parse(accept.lines[0])).toEqual({ accepted: { api_keys: 2, oauth_clients: 0, oauth_grants: 1 } });

    h.telnyx.apiKeys.push({ id: "key-unexpected" });
    const again = await runRoutine("key-inventory", throughEdge(h));
    expect(JSON.parse(again.lines[0]).unexpected).toEqual({ api_key: 1 });
    expect(again.lines[1]).toMatch(/^::warning /);
    assertPublicSafe([...run.lines, ...accept.lines, ...again.lines]);
  });

  it("file production's measurements, which admission then reads", async () => {
    const h = await ready();
    await h.store.delete(ADMISSION_KEYS.reserve);
    await h.store.delete(ADMISSION_KEYS.ratios);
    const outcome = await runRoutine("measurements", throughEdge(h), {
      reserveLegs: "3",
      calls: "120",
      abandoned: "6",
      short: "4",
      windowStartHour: "5",
    });
    expect(outcome).toEqual({
      ok: true,
      lines: [
        'filed reserve: {"legs":3}',
        'filed ratios: {"calls":120,"abandoned":6,"short":4}',
        'filed window: {"start_hour":5}',
      ],
    });
    const health = (await (await h.call("/health", { caller: "admin" })).json()) as GuardHealth;
    expect(health.paid_dials).toMatchObject({
      blockers: [],
      room: 2,
      window_start_hour_utc: 5,
      window_measured_at: new Date(h.clock.now).toISOString(),
    });
  });

  it("refuse measurements that are partial or not whole numbers, before sending any", () => {
    expect(measurementPosts({})).toEqual([]);
    expect(() => measurementPosts({ calls: "10", abandoned: "1" })).toThrow(/together/);
    expect(() => measurementPosts({ reserveLegs: "2.5" })).toThrow(/whole number/);
    expect(() => measurementPosts({ windowStartHour: "-1" })).toThrow(/whole number/);
    expect(() => measurementPosts({ usageUsd: "4,25" })).toThrow(/dollars/);
    expect(measurementPosts({ reserveLegs: " 4 " })).toEqual([{ route: "/reserve", body: { legs: 4 } }]);
  });

  it("reconcile this month's ledger with the actual usage, which then counts", async () => {
    const h = await ready();
    const [post] = measurementPosts({ usageUsd: "12.5" }, new Date(h.clock.now));
    expect(post).toEqual({ route: "/ledger", body: { month: "2026-11", usage_usd: 12.5 } });
    expect((await throughEdge(h)(post.route, post.body)).status).toBe(200);
    expect((await readTier(h.ctx)).month_to_date_usd).toBe(12.5);
  });

  it("reattach the standing numbers by role", async () => {
    const h = await ready();
    await h.store.put("partition:standing", { "DEV-W1": { role: "DEV-W1", phone_number: N.devW1 } });
    const outcome = await runRoutine("reattach", throughEdge(h));
    expect(outcome).toEqual({ ok: true, lines: ["reattached: DEV-W1"] });
  });

  it("reattach only the messaging profile while paid dials are refused", async () => {
    const h = await ready({ validated: null });
    await h.store.put("partition:standing", { "DEV-W1": { role: "DEV-W1", phone_number: N.devW1 } });
    const response = await h.call("/admin/numbers/reattach", { caller: "admin", method: "POST" });
    expect(await response.json()).toEqual({ reattached: ["DEV-W1"], voice_deferred: ["DEV-W1"] });
    expect(h.telnyx.requests("PATCH").map((entry) => entry.path)).toEqual(["/v2/phone_numbers/num-devw1/messaging"]);
  });
});

/** Production's calls by UTC hour: `busy` in every hour but the quiet ones. */
function hourly(quiet: readonly number[], busy = 9): number[] {
  return Array.from({ length: 24 }, (_, hour) => (quiet.includes(hour) ? 0 : busy));
}

const AGENT_DIAG_URL = "postgresql://agent_diag.abcdefghijklmnopqrst:pw@pooler.example.invalid:5432/postgres";

/** Production's call peaks, as the statement returns them beside the reserve and window. */
const PEAKS = { peak_concurrent_calls: 3, peak_hour_dials: 4, peak_day_dials: 20 } as const;

/** The ratio counts the same statement returns: 40 calls, 5 abandoned, 2 short. */
const RATIOS = { ratio_calls: 40, ratio_abandoned: 5, ratio_short: 2 } as const;
const READ = { ...PEAKS, ...RATIOS } as const;

describe("guard.yml's limit-probe and health routines", () => {
  it("run the validation check and print each write by status, code and field, never Telnyx's words", async () => {
    const h = await ready({ validated: null });
    h.telnyx.profileLimit = { mode: "refuse-above", limit: 4 };
    const outcome = await runRoutine("limit-probe", throughEdge(h));
    expect(outcome.ok).toBe(true);
    expect(JSON.parse(outcome.lines[0])).toMatchObject({ result: "exact", value: 4, refusal_code: "10015" });
    expect(outcome.lines[1]).toBe("wrote 9999: HTTP 422, code 10015, field /concurrent_call_limit");
    expect(outcome.lines.at(-1)).toBe("wrote 1: HTTP 200, code null, field null");
    expect(outcome.lines.join(" ")).not.toContain("global concurrent call limit");
    assertPublicSafe(outcome.lines);
  });

  it("show which answer stopped an inconclusive search", async () => {
    const h = await ready({ validated: null });
    h.telnyx.profileLimit = { mode: "refuse-above", limit: 6 };
    const realHandle = h.telnyx.handle.bind(h.telnyx);
    h.telnyx.handle = async (request) => {
      const body = request.method === "PATCH" ? ((await request.clone().json()) as { concurrent_call_limit?: number }) : {};
      if (body.concurrent_call_limit === 4999) {
        return Response.json({ errors: [{ code: "10099", detail: "private words", source: { pointer: "/concurrent_call_limit" } }] }, { status: 429 });
      }
      return realHandle(request);
    };
    const outcome = await runRoutine("limit-probe", throughEdge(h));
    expect(outcome.lines).toContain("wrote 4999: HTTP 429, code 10099, field /concurrent_call_limit");
    expect(outcome.lines.some((line) => line.startsWith("::warning title=Limit probe inconclusive"))).toBe(true);
    expect(outcome.lines.join(" ")).not.toContain("private words");
  });

  it("print the guard's health as states, counts and rule names", async () => {
    const h = await ready();
    const lines = healthLines((await edgeHealth(EDGE, "admin-token", edgeFetcher(h))()).body);
    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[1])).toHaveProperty("paid_dials.blockers");
    expect(JSON.parse(lines[2])).toHaveProperty("concurrency.limit_in_force");
    assertPublicSafe(lines);
    expect(healthLines(null)).toHaveLength(4);
  });
});

describe("the daily measurements, read from production as agent_diag", () => {
  it("read ops_diag's views and nothing else", () => {
    // Qualified names only; the one-letter ones are the statement's own aliases.
    const relations = new Set([...PRODUCTION_SQL.matchAll(/\b([a-z_]{2,}\.[a-z_]+)\b/gi)].map((match) => match[1]));
    expect([...relations].sort()).toEqual([
      "ops_diag.call_legs",
      "ops_diag.call_sessions",
      "ops_diag.hourly_call_counts",
      "ops_diag.ring_audience_sizes",
    ]);
    expect(PRODUCTION_SQL).not.toMatch(/\b(insert|update|delete|create|alter|grant|set)\b/i);
  });

  it("place the window on the quietest six hours, keeping 04:00 when nothing tells them apart", () => {
    expect(quietestWindow(new Array(24).fill(0))).toBe(4);
    expect(quietestWindow(hourly([6, 7, 8, 9, 10, 11]))).toBe(6);
    expect(quietestWindow(hourly([22, 23, 0, 1, 2, 3]))).toBe(22);
    expect(quietestWindow(hourly([5, 6, 7, 8, 9, 10, 11]))).toBe(5);
  });

  it("measure the window again only once the guard's is four weeks old", () => {
    const now = new Date("2026-11-30T05:00:00.000Z");
    expect(windowDue(null, now)).toBe(true);
    expect(windowDue("not a date", now)).toBe(true);
    expect(windowDue("2026-11-03T05:00:01.000Z", now)).toBe(false);
    expect(windowDue("2026-11-02T05:00:00.000Z", now)).toBe(true);
  });

  it("reserve production's largest ring audience plus one, and never reserve for no number", () => {
    const read: ProductionRead = { numbers: 1, largest_audience: 3, hourly_calls: hourly([6, 7, 8, 9, 10, 11]), ...READ };
    expect(planFiling(read, true).inputs).toEqual({ reserveLegs: "4", windowStartHour: "6" });
    expect(planFiling(read, false).inputs).toEqual({ reserveLegs: "4" });
    const none = planFiling({ ...read, numbers: 0 }, false);
    expect(none.inputs).toEqual({});
    expect(none.lines[0]).toMatch(/^::warning title=Reserve not filed::/);
    const quiet = planFiling({ ...read, hourly_calls: new Array(24).fill(0) }, true);
    expect(quiet.inputs).toEqual({ reserveLegs: "4" });
  });

  it("take only the statement's own document from psql", () => {
    const document = JSON.stringify({ numbers: 1, largest_audience: 2, hourly_calls: hourly([]), ...READ });
    expect(parseRead(`${document}\n`)).toMatchObject({ numbers: 1, largest_audience: 2, ...READ });
    expect(parseRead("")).toBeNull();
    expect(parseRead(JSON.stringify({ numbers: 1, largest_audience: -1, hourly_calls: hourly([]), ...READ }))).toBeNull();
    expect(parseRead(JSON.stringify({ numbers: 1, largest_audience: 2, hourly_calls: [1, 2], ...READ }))).toBeNull();
    // Without the peaks or the ratios, or with counts that cannot be true, nothing is filed.
    expect(parseRead(JSON.stringify({ numbers: 1, largest_audience: 2, hourly_calls: hourly([]) }))).toBeNull();
    expect(parseRead(JSON.stringify({ numbers: 1, largest_audience: 2, hourly_calls: hourly([]), ...PEAKS }))).toBeNull();
    for (const bad of [
      { peak_concurrent_calls: 1.5 },
      { peak_hour_dials: -1 },
      { peak_day_dials: "9" },
      { peak_hour_dials: 21 },
      { ratio_calls: -1 },
      { ratio_short: 1.5 },
      { ratio_abandoned: 41 },
      { ratio_short: 41 },
    ]) {
      expect(parseRead(JSON.stringify({ numbers: 1, largest_audience: 2, hourly_calls: hourly([]), ...READ, ...bad })), JSON.stringify(bad)).toBeNull();
    }
  });

  it("count overlapping answered calls with a sweep, and every outbound leg over a rolling hour and day", () => {
    expect(PRODUCTION_SQL).toContain("'peak_concurrent_calls'");
    expect(PRODUCTION_SQL).toMatch(/c\.answered_at as at, 1 as delta/);
    expect(PRODUCTION_SQL).toMatch(/select c\.ended_at, -1/);
    expect(PRODUCTION_SQL).toMatch(/c\.answered_at is not null and c\.ended_at is not null/);
    // An end sorts before a start at the same instant: touching calls do not overlap.
    expect(PRODUCTION_SQL).toContain("order by e.at, e.delta");
    expect(PRODUCTION_SQL).toMatch(/from ops_diag\.call_legs l/);
    expect(PRODUCTION_SQL).toMatch(/c\.direction = 'outbound'/);
    expect(PRODUCTION_SQL).toContain("count(*) over (order by o.at range between interval '1 hour' preceding and current row)");
    expect(PRODUCTION_SQL).toContain("count(*) over (order by o.at range between interval '1 day' preceding and current row)");
    expect(PRODUCTION_SQL).not.toContain("date_trunc");
  });

  it("count the ratios over 28 days from outbound calls and ring legs, as the costlier reading", () => {
    expect(PRODUCTION_SQL).toContain("'ratio_calls'");
    expect(PRODUCTION_SQL).toContain("'ratio_abandoned'");
    expect(PRODUCTION_SQL).toContain("'ratio_short'");
    expect(PRODUCTION_SQL).toMatch(/from ops_diag\.call_legs l\s+where l\.kind = 'ring' and l\.created_at >= now\(\) - interval '28 days'/);
    expect(PRODUCTION_SQL).toMatch(/from ops_diag\.call_sessions c\s+where c\.direction = 'outbound' and c\.started_at >= now\(\) - interval '28 days'/);
    // A ring leg that did not answer is abandoned even when another leg of its call did; the answering member's own leg is not.
    expect(PRODUCTION_SQL).toContain("and l.state <> 'answered'");
    expect(PRODUCTION_SQL).toContain("a.answered_by_ref = l.member_ref");
    // Calls still up are not abandoned yet.
    expect(PRODUCTION_SQL).toContain("u.ended_at is null");
    expect(PRODUCTION_SQL).toContain("c.answered_at is null and c.ended_at is not null");
    expect(PRODUCTION_SQL).toContain("c.ended_at - c.answered_at <= interval '6 seconds'");
  });

  it("file the ratios with the peaks, from the read alone, and say when the sample is low", () => {
    const base: ProductionRead = { numbers: 1, largest_audience: 1, hourly_calls: hourly([]), ...READ };
    const now = new Date("2026-11-02T05:00:00.000Z");
    const ratios = (read: ProductionRead) => planFiling(read, false, now).measured.find((post) => post.route === "/ratios");
    expect(ratios(base)).toEqual({ route: "/ratios", body: { calls: 40, abandoned: 5, short: 2, measured_at: now.toISOString() } });
    expect(planFiling(base, false, now).lines).toContain("ratios over 40 call(s) in 28 days");
    const few = { ...base, ratio_calls: 29 };
    expect(ratios(few)?.body).toMatchObject({ calls: 29 });
    expect(planFiling(few, false, now).lines).toContain("ratios over 29 call(s) in 28 days: below 30, filed as a low sample");
    expect(planFiling({ ...base, ratio_calls: 30 }, false, now).lines).toContain("ratios over 30 call(s) in 28 days");
    // No calls at all is still a filing: otherwise admission would refuse as unknown for ever.
    expect(ratios({ ...base, ratio_calls: 0, ratio_abandoned: 0, ratio_short: 0 })?.body).toMatchObject({ calls: 0, abandoned: 0, short: 0 });
  });

  it("file the call peaks from the read alone: no typed input reaches them", async () => {
    const read: ProductionRead = { numbers: 1, largest_audience: 1, hourly_calls: hourly([]), ...READ };
    const now = new Date("2026-11-02T05:00:00.000Z");
    expect(planFiling(read, false, now).measured).toEqual([
      { route: "/concurrency-history", body: { peak_calls: 3, measured_at: now.toISOString() } },
      { route: "/account-rate", body: { peak_hour_dials: 4, peak_day_dials: 20, measured_at: now.toISOString() } },
      { route: "/ratios", body: { calls: 40, abandoned: 5, short: 2, measured_at: now.toISOString() } },
    ]);
    const typed = measurementPosts({ reserveLegs: "2", calls: "1", abandoned: "0", short: "0", windowStartHour: "4", usageUsd: "1" });
    expect(typed.map((post) => post.route)).toEqual(["/reserve", "/ratios", "/window", "/ledger"]);
  });

  it("run the agent_diag self-check in the same session, and refuse any other login before psql", () => {
    const sessions: { sql: string; env: Record<string, string> }[] = [];
    const psql: PsqlRunner = (sql, env) => {
      sessions.push({ sql, env });
      return { status: 0, stdout: JSON.stringify({ numbers: 1, largest_audience: 2, hourly_calls: hourly([]), ...READ }) };
    };
    expect(readProduction(AGENT_DIAG_URL, psql)).toMatchObject({ ok: true, read: { largest_audience: 2 } });
    expect(sessions[0].sql.indexOf("current_user <> 'agent_diag'")).toBeLessThan(sessions[0].sql.indexOf(PRODUCTION_SQL));
    expect(sessions[0].sql).toContain("REFUSED: this agent_diag login is no longer safe");
    expect(sessions[0].env).toMatchObject({ PGUSER: "agent_diag.abcdefghijklmnopqrst", PGSSLMODE: "require" });

    const other = readProduction("postgresql://postgres.abcdefghijklmnopqrst:pw@pooler.example.invalid:5432/postgres", psql);
    expect(other).toMatchObject({ ok: false });
    expect(sessions).toHaveLength(1);
  });

  it("say why production was not read without repeating psql, whose errors name the login and host", () => {
    const failing: PsqlRunner = () => ({
      status: 2,
      stderr: 'psql: error: connection to server at "pooler.example.invalid" failed: FATAL: password authentication failed for user "agent_diag.abcdefghijklmnopqrst"',
    });
    const refused: PsqlRunner = () => ({ status: 3, stderr: "ERROR:  REFUSED: this agent_diag login is no longer safe: it can reach public.calls" });
    const lines = [
      ...(readProduction(AGENT_DIAG_URL, failing) as { lines: string[] }).lines,
      ...(readProduction(AGENT_DIAG_URL, refused) as { lines: string[] }).lines,
    ];
    expect(lines).toEqual([
      "::error title=Production not read::psql exited 2",
      "::error title=Production not read::the agent_diag self-check refused this login; see scripts/ops/call-trace.mjs --self-check",
    ]);
    expect(lines.join("\n")).not.toMatch(/abcdefghijklmnopqrst|pooler|public\.calls/);
  });

  it("file nothing, and stay green, while the guard environment has no agent_diag login", async () => {
    const h = await ready();
    await h.store.delete(ADMISSION_KEYS.reserve);
    const outcome = await measureProduction(throughEdge(h), edgeHealth(EDGE, "admin-token", edgeFetcher(h)), () => readProduction(""));
    expect(outcome.ok).toBe(true);
    expect(outcome.lines).toEqual([expect.stringMatching(/^::notice title=Production not read::.*AGENT_DIAG_DATABASE_URL/)]);
    expect(await h.store.get(ADMISSION_KEYS.reserve)).toBeUndefined();
  });

  it("file the reserve daily and the window monthly, which /health then shows", async () => {
    const h = await ready();
    await h.store.delete(ADMISSION_KEYS.reserve);
    await h.store.delete(LIMIT_KEYS.history);
    await h.store.delete(ADMISSION_KEYS.accountRate);
    await h.store.delete(ADMISSION_KEYS.ratios);
    const read = () => ({ ok: true, read: { numbers: 2, largest_audience: 2, hourly_calls: hourly([7, 8, 9, 10, 11, 12]), ...READ } }) as const;
    const health = edgeHealth(EDGE, "admin-token", edgeFetcher(h));

    const first = await measureProduction(throughEdge(h), health, read, new Date(h.clock.now));
    expect(first.ok).toBe(true);
    const at = new Date(h.clock.now).toISOString();
    expect(first.lines).toEqual([
      "reserve read over 2 active number(s)",
      "ratios over 40 call(s) in 28 days",
      `filed concurrency-history: {"peak_calls":3,"measured_at":"${at}"}`,
      `filed account-rate: {"peak_hour_dials":4,"peak_day_dials":20,"measured_at":"${at}"}`,
      `filed ratios: {"calls":40,"abandoned":5,"short":2,"measured_at":"${at}"}`,
      'filed reserve: {"legs":3}',
      'filed window: {"start_hour":7}',
    ]);
    expect(await h.store.get(LIMIT_KEYS.history)).toEqual({ peak_calls: 3, measured_at: h.clock.now });
    expect(await h.store.get(ADMISSION_KEYS.ratios)).toEqual({ calls: 40, abandoned: 5, short: 2, low_sample: false, measured_at: h.clock.now });
    expect(await h.store.get(ADMISSION_KEYS.accountRate)).toEqual({ peak_hour_dials: 4, peak_day_dials: 20, measured_at: h.clock.now });
    expect(((await health()).body as GuardHealth).account_rate).toMatchObject({ production_peak_hour: 4, production_peak_day: 20 });
    assertPublicSafe(first.lines);
    const shown = (await health()).body as GuardHealth;
    expect(shown.paid_dials).toMatchObject({ window_start_hour_utc: 7, window_measured_at: new Date(h.clock.now).toISOString() });

    h.advance(24 * 60 * 60 * 1000);
    const next = await measureProduction(throughEdge(h), health, read, new Date(h.clock.now));
    expect(next.lines).toContain("window: measured within the month, not due");
    expect(next.lines).toContain('filed reserve: {"legs":3}');
    expect(next.lines.some((line) => line.startsWith("filed window"))).toBe(false);
    expect(next.lines).toContain(`filed ratios: {"calls":40,"abandoned":5,"short":2,"measured_at":"${new Date(h.clock.now).toISOString()}"}`);
  });

  it("file a low sample that admission does not refuse on, and refuse again once the filing is stale", async () => {
    const h = await ready();
    await h.store.delete(ADMISSION_KEYS.ratios);
    const health = edgeHealth(EDGE, "admin-token", edgeFetcher(h));
    const blockers = async () => ((await health()).body as GuardHealth).paid_dials?.blockers;
    expect(await blockers()).toContain("admission.ratios_unknown");
    // Every call abandoned and short: 12 calls say nothing about a share.
    const read = () =>
      ({ ok: true, read: { numbers: 1, largest_audience: 1, hourly_calls: hourly([]), ...PEAKS, ratio_calls: 12, ratio_abandoned: 12, ratio_short: 12 } }) as const;
    const outcome = await measureProduction(throughEdge(h), health, read, new Date(h.clock.now));
    expect(outcome.ok).toBe(true);
    expect(outcome.lines).toContain("ratios over 12 call(s) in 28 days: below 30, filed as a low sample");
    expect(await h.store.get(ADMISSION_KEYS.ratios)).toEqual({ calls: 12, abandoned: 12, short: 12, low_sample: true, measured_at: h.clock.now });
    expect(await blockers()).toEqual([]);
    h.advance(37 * 60 * 60 * 1000);
    expect(await blockers()).toContain("admission.ratios_unknown");
  });

  it("let a dispatch with values override the read, and keep the three counts together", async () => {
    const h = await ready();
    await h.store.delete(ADMISSION_KEYS.ratios);
    const outcome = await runRoutine("measurements", throughEdge(h), { calls: "29", abandoned: "29", short: "0" });
    expect(outcome).toEqual({ ok: true, lines: ['filed ratios: {"calls":29,"abandoned":29,"short":0}'] });
    expect(await h.store.get(ADMISSION_KEYS.ratios)).toMatchObject({ calls: 29, abandoned: 29, short: 0, low_sample: true });
    await runRoutine("measurements", throughEdge(h), { calls: "30", abandoned: "5", short: "0" });
    expect(await h.store.get(ADMISSION_KEYS.ratios)).toMatchObject({ calls: 30, low_sample: false });
  });

  it("fail the run when production could not be read, so a reserve going stale is never quiet", async () => {
    const h = await ready();
    const outcome = await measureProduction(throughEdge(h), edgeHealth(EDGE, "admin-token", edgeFetcher(h)), () => ({
      ok: false,
      lines: ["::error title=Production not read::psql exited 2"],
    }));
    expect(outcome).toEqual({ ok: false, lines: ["::error title=Production not read::psql exited 2"] });
  });
});

describe("guard.yml", () => {
  const workflow = readFileSync(new URL("../../../.github/workflows/guard.yml", import.meta.url), "utf8");

  it("offers every admin routine the script runs", () => {
    const options = /options:\r?\n((?:\s+- [a-z-]+\r?\n)+)/.exec(workflow)?.[1] ?? "";
    expect(options.split(/\r?\n/).map((line) => line.trim().replace(/^- /, "")).filter(Boolean)).toEqual([...ROUTINES, HEALTH_ROUTINE]);
  });

  it("hands resume-ordering the login that started the attempt and the reason given", () => {
    expect(workflow).toMatch(/\n {6}resume_reason:\r?\n/);
    expect(workflow).toContain("RESUME_BY: ${{ github.triggering_actor }}");
    expect(workflow).toContain("RESUME_REASON: ${{ inputs.resume_reason }}");
  });
});
