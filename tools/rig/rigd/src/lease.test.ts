import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EDGE_PATHS, GUARD_ROUTES, HEADER, LEASE_MAX_MS } from "@loonext/rig-protocol";
import { GuardRefusedError } from "@loonext/rig-robot";
import { ManualClock } from "@loonext/rig-robot/test-support";
import { afterEach, describe, expect, it } from "vitest";
import { LeaseBusyError, LeaseClient, LeaseReapedError, LeaseWatchdog, type UndoHandlers } from "./lease.ts";
import { fakeFetch, json } from "./test-support.ts";

const EDGE = "https://rig-edge.example.workers.dev";
const LEASE_URL = `${EDGE}${EDGE_PATHS.guardPrefix}${GUARD_ROUTES.lease}`;
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const refusal = (rule: string, status = 403) => json({ error: "guard_refused", rule }, status, { [HEADER.refusedBy]: rule });

function setup(options: { acquire?: () => Response; release?: () => Response; handlers?: UndoHandlers } = {}) {
  const stateDir = mkdtempSync(join(tmpdir(), "rig-lease-"));
  dirs.push(stateDir);
  const undone: string[] = [];
  const handlers: UndoHandlers = options.handlers ?? {
    "robot.sms": async (params) => {
      undone.push(`sms ${String(params.text)}`);
    },
    "app.restore": async (params) => {
      undone.push(`restore ${String(params.what)}`);
    },
  };
  const { fetch, requests } = fakeFetch({
    [`POST ${LEASE_URL}`]: () =>
      options.acquire?.() ?? json({ lease_id: "lease-abc", scenario: "S02", expires_at: "2026-10-31T05:15:00.000Z" }, 201),
    [`DELETE ${LEASE_URL}/`]: () => options.release?.() ?? new Response(null, { status: 204 }),
  });
  const clock = new ManualClock();
  const client = new LeaseClient({ edgeOrigin: EDGE, token: "robot-token", stateDir, handlers, fetch, clock });
  return { client, requests, undone, clock, stateDir };
}

describe("the run lease", () => {
  it("is acquired at the guard's lease route with the caller token", async () => {
    const { client, requests } = setup();
    const lease = await client.acquire("S02");
    expect(lease.id).toBe("lease-abc");
    expect(requests[0]).toMatchObject({ method: "POST", url: LEASE_URL, body: JSON.stringify({ scenario: "S02" }) });
    expect(requests[0]!.headers.authorization).toBe("Bearer robot-token");
  });

  it("names a busy lease, a guard refusal and a broken rig apart", async () => {
    await expect(setup({ acquire: () => refusal("lease.busy") }).client.acquire("S02")).rejects.toBeInstanceOf(LeaseBusyError);
    await expect(setup({ acquire: () => json({ error: "busy" }, 409) }).client.acquire("S02")).rejects.toBeInstanceOf(LeaseBusyError);
    const refused = setup({ acquire: () => refusal("class.not_allowed") }).client.acquire("S02");
    await expect(refused).rejects.toBeInstanceOf(GuardRefusedError);
    await expect(refused).rejects.toMatchObject({ rule: "class.not_allowed" });
    // No refused-by header: the edge turned the token away, the route is
    // missing or the guard is down. None of those is the guard saying no.
    for (const status of [401, 404, 502, 503]) {
      const failed = setup({ acquire: () => json({ error: "x" }, status) }).client.acquire("S02");
      await expect(failed).rejects.not.toBeInstanceOf(GuardRefusedError);
      await expect(failed).rejects.toThrow(new RegExp(`acquiring returned ${status}`));
    }
  });

  it("runs the undos newest first on release, then releases at the guard and forgets the journal", async () => {
    const { client, requests, undone } = setup();
    const lease = await client.acquire("S24");
    lease.registerUndo({ kind: "app.restore", params: { what: "audience" } });
    lease.registerUndo({ kind: "robot.sms", params: { text: "START" } });
    const result = await lease.release();
    expect(undone).toEqual(["sms START", "restore audience"]);
    expect(result).toEqual({ lease_id: "lease-abc", reaped: false, undone: 2, failed: [] });
    expect(requests.at(-1)).toMatchObject({ method: "DELETE", url: `${LEASE_URL}/lease-abc` });
    expect(readdirSync(client.dir)).toEqual([]);
  });

  it("keeps undoing when one undo fails, and says which failed", async () => {
    const order: string[] = [];
    const { client } = setup({
      handlers: {
        a: async () => {
          order.push("a");
        },
        b: async () => {
          throw new Error("robotd is down");
        },
      },
    });
    const lease = await client.acquire("S24");
    lease.registerUndo({ kind: "a", params: {} });
    lease.registerUndo({ kind: "b", params: {} });
    lease.registerUndo({ kind: "unknown", params: {} });
    const result = await lease.release();
    expect(order).toEqual(["a"]);
    expect(result.failed).toEqual([
      { kind: "unknown", error: "no handler for this undo" },
      { kind: "b", error: "robotd is down" },
    ]);
  });

  it("journals locally for a run that dials nothing, without the guard", async () => {
    const { client, requests, undone } = setup();
    const lease = client.acquireLocal("S25");
    lease.registerUndo({ kind: "robot.sms", params: { text: "START" } });
    await lease.release();
    expect(undone).toEqual(["sms START"]);
    expect(requests).toEqual([]);
  });

  it("lists the leases still held, and none once released", async () => {
    const { client } = setup();
    const lease = client.acquireLocal("G01");
    expect(client.open().map((entry) => entry.scenario)).toEqual(["G01"]);
    await lease.release();
    expect(client.open()).toEqual([]);
  });

  it("runs the undos of the leases this process holds when it is told to stop", async () => {
    const { client, undone, stateDir } = setup();
    const lease = client.acquireLocal("S25");
    lease.registerUndo({ kind: "robot.sms", params: { text: "START" } });
    const other = client.acquireLocal("S02");
    const otherPath = client.path(other.id);
    writeFileSync(otherPath, JSON.stringify({ ...JSON.parse(readFileSync(otherPath, "utf8")), pid: process.pid + 1 }));
    expect((await client.releaseOwn()).map((result) => result.undone)).toEqual([1]);
    expect(undone).toEqual(["sms START"]);
    expect(client.open().map((entry) => entry.scenario)).toEqual(["S02"]);
    expect(readdirSync(join(stateDir, "leases"))).toHaveLength(1);
  });
});

describe("releasing at the guard", () => {
  it("forgets a lease the guard no longer holds, so its undos run once", async () => {
    const { client, undone, clock } = setup({ release: () => refusal("lease.not_found") });
    const lease = await client.acquire("S24");
    lease.registerUndo({ kind: "robot.sms", params: { text: "START" } });
    expect(await lease.release()).toMatchObject({ reaped: false, undone: 1, failed: [] });
    expect(readdirSync(client.dir)).toEqual([]);
    clock.advance(3 * LEASE_MAX_MS);
    expect(await new LeaseWatchdog({ client, clock }).sweep()).toEqual([]);
    expect(undone).toEqual(["sms START"]);
  });

  it("keeps the journal for the watchdog when the guard cannot be told", async () => {
    const { client } = setup({ release: () => json({ error: "guard_error" }, 502) });
    const lease = await client.acquire("S24");
    await expect(lease.release()).rejects.toThrow(/release returned 502/);
    expect(readdirSync(client.dir)).toEqual(["lease-abc.releasing.json"]);
  });
});

describe("the lease watchdog", () => {
  it("leaves a live lease alone and reaps one held past LEASE_MAX_MS", async () => {
    const { client, clock, undone, requests } = setup();
    const lease = await client.acquire("S02");
    lease.registerUndo({ kind: "robot.sms", params: { text: "START" } });
    const reaped: string[] = [];
    const watchdog = new LeaseWatchdog({ client, clock, onReap: (result) => reaped.push(result.lease_id) });

    clock.advance(LEASE_MAX_MS);
    expect(await watchdog.sweep()).toEqual([]);
    clock.advance(1);
    const results = await watchdog.sweep();
    expect(results).toMatchObject([{ lease_id: "lease-abc", reaped: true, undone: 1 }]);
    expect(reaped).toEqual(["lease-abc"]);
    expect(undone).toEqual(["sms START"]);
    expect(requests.at(-1)).toMatchObject({ method: "DELETE", url: `${LEASE_URL}/lease-abc` });

    // The run that hung finds its lease gone and must not change anything more.
    expect(() => lease.registerUndo({ kind: "robot.sms", params: { text: "late" } })).toThrow(LeaseReapedError);
    expect(await lease.release()).toMatchObject({ reaped: true, undone: 0 });
    expect(undone).toEqual(["sms START"]);
  });

  it("finishes a release that a dead process left half done", async () => {
    const { client, clock, undone } = setup();
    const lease = await client.acquire("S02");
    lease.registerUndo({ kind: "robot.sms", params: { text: "START" } });
    // Claimed for release, then the process died.
    const { renameSync } = await import("node:fs");
    renameSync(client.path("lease-abc"), client.path("lease-abc", "releasing"));
    const watchdog = new LeaseWatchdog({ client, clock });
    clock.advance(LEASE_MAX_MS + 1);
    expect(await watchdog.sweep()).toEqual([]);
    // Two lease lifetimes after the journal was last touched.
    const later = new ManualClock(Date.now() + 2 * LEASE_MAX_MS + 1_000);
    const reaper = new LeaseWatchdog({ client, clock: later });
    expect(await reaper.sweep()).toMatchObject([{ lease_id: "lease-abc", undone: 1 }]);
    expect(undone).toEqual(["sms START"]);
    expect(existsSync(client.path("lease-abc", "releasing"))).toBe(false);
  });
});
