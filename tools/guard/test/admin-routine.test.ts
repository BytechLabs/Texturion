import { readFileSync } from "node:fs";

import { EDGE_PATHS, HEADER } from '@loonext/rig-protocol';
import { describe, expect, it } from "vitest";

import { edgePost, HEALTH_ROUTINE, ROUTINES, runRoutine } from '../scripts/admin-routine';
import type { Post } from '../scripts/admin-routine';
import { EDGE, harness, N, ready, seedAccount } from './support';
import type { Harness } from './support';

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
  });
}

function throughEdge(h: Harness): Post {
  return edgePost(EDGE, "admin-token", edgeFetcher(h));
}


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
    h.telnyx.available = EIGHT;
    expect((await runRoutine("setup", throughEdge(h))).ok).toBe(true);
    const outcome = await runRoutine("order-standing", throughEdge(h));
    expect(outcome.ok).toBe(true);
    expect(outcome.lines.filter((line) => line.startsWith("ordered "))).toHaveLength(8);
    expect(outcome.lines.at(-1)).toBe("every standing role is held");
    expect(h.telnyx.requests("POST", "/v2/number_orders")).toHaveLength(8);
    assertPublicSafe(outcome.lines);
  });

  it("stop, red, when ordering is off, and name the rule", async () => {
    const h = await ready();
    h.production.capabilities = [];
    const outcome = await runRoutine("order-standing", throughEdge(h));
    expect(outcome.ok).toBe(false);
    expect(outcome.lines.at(-1)).toContain("provisioning.ordering_off");
  });

  it("stop, red, after an order Telnyx did not confirm, then warn that its role's number is not listed", async () => {
    const h = harness();
    h.telnyx.available = EIGHT;
    expect((await runRoutine("setup", throughEdge(h))).ok).toBe(true);
    h.telnyx.failNext = { method: "POST", path: "/v2/number_orders", status: 500 };
    const stopped = await runRoutine("order-standing", throughEdge(h));
    expect(stopped.ok).toBe(false);
    expect(stopped.lines.at(-1)).toMatch(/^::error title=Order unconfirmed::Telnyx answered 500 to ROBOT-1's order/);

    const done = await runRoutine("order-standing", throughEdge(h));
    expect(done.ok).toBe(true);
    expect(done.lines).toContain("::warning title=Standing numbers not listed::Held but not yet in the partition's group listing: ROBOT-1");
    expect(h.telnyx.requests("POST", "/v2/number_orders")).toHaveLength(8);
    assertPublicSafe([...stopped.lines, ...done.lines]);
  });

  it("resume ordering: name who and why to the guard, and print only states", async () => {
    const h = await ready();
    await h.store.put("orders:stopped", { at: h.clock.now, reason: "number_unreadable" });
    const outcome = await runRoutine("resume-ordering", throughEdge(h), { by: "operator-1", reason: "Read-back now lists the number" });
    expect(outcome).toEqual({ ok: true, lines: ["cleared stop number_unreadable for operator-1; the read-back answered none"] });
    await expect(h.store.get("orders:stopped")).resolves.toBeUndefined();
    await expect(h.store.get("orders:resumes")).resolves.toEqual([
      { at: h.clock.now, by: "operator-1", why: "Read-back now lists the number", cleared: "number_unreadable" },
    ]);
    assertPublicSafe(outcome.lines);
  });

  it("resume ordering: refuse before calling the guard when nobody says why", async () => {
    const h = await ready();
    await h.store.put("orders:stopped", { at: h.clock.now, reason: "number_unreadable" });
    for (const resume of [{}, { by: "operator-1" }, { reason: "Read-back now lists the number" }, { by: " ", reason: " " }]) {
      const outcome = await runRoutine("resume-ordering", throughEdge(h), resume);
      expect(outcome.ok).toBe(false);
      expect(outcome.lines[0]).toMatch(/^::error title=Resume refused::/);
    }
    await expect(h.store.get("orders:stopped")).resolves.toMatchObject({ reason: "number_unreadable" });
  });

  it("resume ordering: fail, naming the rule, when the stop is not one a person may lift", async () => {
    const h = await ready();
    await h.store.put("orders:stopped", { at: h.clock.now, reason: "group_not_kept" });
    const outcome = await runRoutine("resume-ordering", throughEdge(h), { by: "operator-1", reason: "Read-back now lists the number" });
    expect(outcome.ok).toBe(false);
    expect(outcome.lines.at(-1)).toContain("provisioning.resume_refused");
  });

  it("resume ordering: fail the run when the read-back stops ordering again", async () => {
    const h = await ready();
    h.telnyx.orderStatus = "pending";
    await h.store.put("orders:stopped", { at: h.clock.now, reason: "number_unreadable" });
    await h.store.put("orders:first", { state: "pending", order_id: null, phone_number: "+14165550150", at: h.clock.now });
    const outcome = await runRoutine("resume-ordering", throughEdge(h), { by: "operator-1", reason: "Read-back now lists the number" });
    expect(outcome.ok).toBe(false);
    expect(outcome.lines[0]).toBe("cleared stop number_unreadable for operator-1; the read-back answered failed");
    expect(outcome.lines[1]).toMatch(/^::error title=Ordering stopped again::/);
  });

  it("reattach the standing numbers by role", async () => {
    const h = await ready();
    await h.store.put("partition:standing", { "DEV-W1": { role: "DEV-W1", phone_number: N.devW1 } });
    const outcome = await runRoutine("reattach", throughEdge(h));
    expect(outcome).toEqual({ ok: true, lines: ["reattached: DEV-W1"] });
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
