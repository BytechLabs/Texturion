/**
 * #581 — the two prunes that existed and ran nowhere.
 *
 * The interesting assertions here are the REGISTRATION ones. A unit test that
 * only proves `prunePublicLinkAccess` issues the right RPC would have passed
 * just as happily on the day this bug was filed, because the function it
 * exercises is not the thing that was missing — the CALLER was. So the shape of
 * this suite mirrors the shape of the defect: prove the RPC is right, then
 * prove something actually reaches it on a schedule.
 *
 * Only the network edge is stubbed, as everywhere else, so these go through the
 * real supabase-js encoding: an argument renamed in the RPC and not here shows
 * up as a wrong request body rather than a passing mock.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import { CRON_JOBS } from "../index";
import type { JobKey } from "../observability/liveness";
import { rpcMatch, stubRoute } from "../test/messaging-support";
import { completeEnv, stubFetch } from "../test/support";
import {
  PROBE_RESULT_RETENTION_DAYS,
  PUBLIC_LINK_ACCESS_RETENTION_DAYS,
  pruneProbeResults,
  prunePublicLinkAccess,
} from "./retention-prunes";

const REPO_ROOT = join(fileURLToPath(new URL("../../../..", import.meta.url)));

/** The daily retention trigger every prune in the product rides (SPEC §11). */
const RETENTION_CRON = "30 15 * * *";

let env: Env;

beforeEach(() => {
  env = completeEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prunePublicLinkAccess", () => {
  it("asks for exactly the window the inventory publishes", async () => {
    const rpc = stubRoute(
      rpcMatch(env, "api_prune_public_link_access"),
      () => 7,
    );
    stubFetch(rpc.route);

    await expect(prunePublicLinkAccess(env)).resolves.toBe(7);

    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0]?.body).toEqual({ p_days: 30 });
  });

  it("throws a named error so the cron runner can say which job failed", async () => {
    const rpc = stubRoute(rpcMatch(env, "api_prune_public_link_access"), () =>
      Response.json(
        { code: "42501", message: "permission denied", details: null, hint: null },
        { status: 403 },
      ),
    );
    stubFetch(rpc.route);

    // runScheduledJobs logs `cron job <key> failed: <stack>` and keeps going, so
    // a bare "permission denied" in Workers Logs would name no table at all.
    await expect(prunePublicLinkAccess(env)).rejects.toThrow(
      /public_link_access prune failed/,
    );
  });
});

describe("pruneProbeResults", () => {
  it("asks for the window /status is read over", async () => {
    const rpc = stubRoute(rpcMatch(env, "prune_probe_results"), () => 12);
    stubFetch(rpc.route);

    await expect(pruneProbeResults(env)).resolves.toBe(12);

    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0]?.body).toEqual({ p_keep_days: 90 });
  });

  it("throws a named error rather than reporting a silent zero", async () => {
    const rpc = stubRoute(rpcMatch(env, "prune_probe_results"), () =>
      Response.json(
        { code: "42883", message: "function does not exist", details: null, hint: null },
        { status: 404 },
      ),
    );
    stubFetch(rpc.route);

    // A prune that swallowed its error would leave the liveness heartbeat
    // beating (#333 records it only on success) — the table would grow while
    // the dashboard said the job was fine, which is this bug a second time.
    await expect(pruneProbeResults(env)).rejects.toThrow(
      /probe_results prune failed/,
    );
  });
});

describe("#581 — both prunes are actually reachable", () => {
  /**
   * The assertion that would have caught the original bug. Both functions were
   * defined, granted to `service_role` and named in a document; what nothing
   * checked was that a schedule ever calls them.
   */
  // `as const` so the keys stay literal rather than widening to `string`: the
  // compiler is the first line of this assertion (#387 makes an undeclared key
  // a type error), and a widened string would hand that job to the runtime.
  it.each([
    ["job:prune-public-link-access", prunePublicLinkAccess],
    ["job:prune-probe-results", pruneProbeResults],
  ] as const)("registers %s on the daily retention trigger", (key, run) => {
    expect(CRON_JOBS[RETENTION_CRON]).toContainEqual({ key, run });
  });

  it("runs both BEFORE the notice→enforce pair at the tail of the trigger", () => {
    // #284 makes the notice a precondition of enforcement in SQL, so those two
    // have to stay last and stay in that order. Pinning the relative position
    // here means a future prune appended to this list cannot quietly land
    // between them.
    const keys = CRON_JOBS[RETENTION_CRON].map((entry) => entry.key);
    const at = (key: JobKey) => {
      // Asserted, not just read. `indexOf` answers -1 for a key that is not
      // registered at all, and -1 is less than every real index — so comparing
      // raw positions would let this whole assertion pass for two jobs nobody
      // had wired up, which is exactly the bug it sits next to.
      const index = keys.indexOf(key);
      expect(index, `${key} is not registered on "${RETENTION_CRON}"`).toBeGreaterThanOrEqual(0);
      return index;
    };
    const enforce = at("job:retention-enforce");
    expect(at("job:prune-public-link-access")).toBeLessThan(enforce);
    expect(at("job:prune-probe-results")).toBeLessThan(enforce);
    expect(at("job:retention-notice")).toBeLessThan(enforce);
  });
});

describe("#581 — the published window and the enforced one are the same number", () => {
  /**
   * The document is the thing a customer was promised. A constant that drifts
   * from it turns this file back into what it replaced: a retention policy that
   * is true in prose and false in the database.
   */
  it("enforces the 30 days docs/PERSONAL-DATA-INVENTORY.md §5 publishes", () => {
    const inventory = readFileSync(
      join(REPO_ROOT, "docs/PERSONAL-DATA-INVENTORY.md"),
      "utf8",
    );
    const row = inventory
      .split("\n")
      .find((line) => line.includes("`public_link_access`"));

    expect(row, "public_link_access has no row in the inventory").toBeDefined();
    expect(
      row,
      `inventory publishes a window this job does not enforce (${PUBLIC_LINK_ACCESS_RETENTION_DAYS}d)`,
    ).toContain(`${PUBLIC_LINK_ACCESS_RETENTION_DAYS} days`);
  });

  it("keeps probe_results out of the personal-data sections", () => {
    // Its prune is a storage bound, not a privacy promise: the table holds a
    // probe name, a boolean, a <=64-char failure CODE and a latency. If it ever
    // gains a column worth naming, it moves to §5 and its window becomes
    // publishable — this is the tripwire for that day.
    const inventory = readFileSync(
      join(REPO_ROOT, "docs/PERSONAL-DATA-INVENTORY.md"),
      "utf8",
    );
    const noPersonalData = inventory.slice(
      inventory.indexOf("## 6. No personal data"),
    );
    expect(noPersonalData).toContain("`probe_results`");
    expect(PROBE_RESULT_RETENTION_DAYS).toBeGreaterThan(0);
  });
});
