import { EDGE_PATHS, HEADER } from "@loonext/rig-protocol";
import { describe, expect, it } from "vitest";

import { edgePost, measurementPosts, runRoutine, type Post } from "../scripts/admin-routine";
import { ADMISSION_KEYS } from "../src/state/admission";
import { readTier } from "../src/state/ledger";
import { EDGE, harness, N, ready, seedAccount, type Harness } from "./support";

/** guard.yml's path to the guard: the edge's /g prefix, the admin class. */
function throughEdge(h: Harness): Post {
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
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
  return edgePost(EDGE, "admin-token", fetcher);
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
    const health = (await (await h.call("/health", { caller: "admin" })).json()) as {
      paid_dials: { blockers: string[]; room: number; window_start_hour_utc: number };
    };
    expect(health.paid_dials).toMatchObject({ blockers: [], room: 3, window_start_hour_utc: 5 });
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
