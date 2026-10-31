import { EDGE_PATHS, HEADER, type GuardHealth } from "@loonext/rig-protocol";
import { describe, expect, it } from "vitest";

import { edgeHealth, edgePost, measurementPosts, measureProduction, runRoutine, type Post } from "../scripts/admin-routine";
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
import { readTier } from "../src/state/ledger";
import { EDGE, harness, N, ready, seedAccount, type Harness } from "./support";

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
    await h.store.put(ADMISSION_KEYS.reserve, { legs: 2, measured_at: h.clock.now });
    h.telnyx.available = [
      "+14165550170",
      "+14165550171",
      "+14165550172",
      "+14165550173",
      "+14165550174",
      "+14165550175",
      "+14165550176",
      "+14165550177",
    ];
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

  it("stop, red, when ordering is off, and name the rule", async () => {
    const h = await ready({ env: { TELNYX_CONCURRENT_LIMIT: "unknown" } });
    const outcome = await runRoutine("order-standing", throughEdge(h), {}, noWait);
    expect(outcome.ok).toBe(false);
    expect(outcome.lines.at(-1)).toContain("provisioning.ordering_off");
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
      room: 3,
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
});

/** Production's calls by UTC hour: `busy` in every hour but the quiet ones. */
function hourly(quiet: readonly number[], busy = 9): number[] {
  return Array.from({ length: 24 }, (_, hour) => (quiet.includes(hour) ? 0 : busy));
}

const AGENT_DIAG_URL = "postgresql://agent_diag.abcdefghijklmnopqrst:pw@pooler.example.invalid:5432/postgres";

describe("the daily measurements, read from production as agent_diag", () => {
  it("read ops_diag's views and nothing else", () => {
    // Qualified names only; the one-letter ones are the statement's own aliases.
    const relations = new Set([...PRODUCTION_SQL.matchAll(/\b([a-z_]{2,}\.[a-z_]+)\b/gi)].map((match) => match[1]));
    expect([...relations].sort()).toEqual(["ops_diag.hourly_call_counts", "ops_diag.ring_audience_sizes"]);
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
    const read: ProductionRead = { numbers: 1, largest_audience: 3, hourly_calls: hourly([6, 7, 8, 9, 10, 11]) };
    expect(planFiling(read, true).inputs).toEqual({ reserveLegs: "4", windowStartHour: "6" });
    expect(planFiling(read, false).inputs).toEqual({ reserveLegs: "4" });
    const none = planFiling({ ...read, numbers: 0 }, false);
    expect(none.inputs).toEqual({});
    expect(none.lines[0]).toMatch(/^::warning title=Reserve not filed::/);
    const quiet = planFiling({ ...read, hourly_calls: new Array(24).fill(0) }, true);
    expect(quiet.inputs).toEqual({ reserveLegs: "4" });
  });

  it("take only the statement's own document from psql", () => {
    const document = JSON.stringify({ numbers: 1, largest_audience: 2, hourly_calls: hourly([]) });
    expect(parseRead(`${document}\n`)).toMatchObject({ numbers: 1, largest_audience: 2 });
    expect(parseRead("")).toBeNull();
    expect(parseRead(JSON.stringify({ numbers: 1, largest_audience: -1, hourly_calls: hourly([]) }))).toBeNull();
    expect(parseRead(JSON.stringify({ numbers: 1, largest_audience: 2, hourly_calls: [1, 2] }))).toBeNull();
  });

  it("run the agent_diag self-check in the same session, and refuse any other login before psql", () => {
    const sessions: { sql: string; env: Record<string, string> }[] = [];
    const psql: PsqlRunner = (sql, env) => {
      sessions.push({ sql, env });
      return { status: 0, stdout: JSON.stringify({ numbers: 1, largest_audience: 2, hourly_calls: hourly([]) }) };
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
    const read = () => ({ ok: true, read: { numbers: 2, largest_audience: 2, hourly_calls: hourly([7, 8, 9, 10, 11, 12]) } }) as const;
    const health = edgeHealth(EDGE, "admin-token", edgeFetcher(h));

    const first = await measureProduction(throughEdge(h), health, read, new Date(h.clock.now));
    expect(first.ok).toBe(true);
    expect(first.lines).toEqual([
      "reserve read over 2 active number(s)",
      expect.stringMatching(/^::notice title=Ratios not filed::/),
      'filed reserve: {"legs":3}',
      'filed window: {"start_hour":7}',
    ]);
    assertPublicSafe(first.lines);
    const shown = (await health()).body as GuardHealth;
    expect(shown.paid_dials).toMatchObject({ window_start_hour_utc: 7, window_measured_at: new Date(h.clock.now).toISOString() });

    h.advance(24 * 60 * 60 * 1000);
    const next = await measureProduction(throughEdge(h), health, read, new Date(h.clock.now));
    expect(next.lines).toContain("window: measured within the month, not due");
    expect(next.lines).toContain('filed reserve: {"legs":3}');
    expect(next.lines.some((line) => line.startsWith("filed window"))).toBe(false);
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
