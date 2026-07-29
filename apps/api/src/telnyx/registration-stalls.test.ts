/**
 * #310 — the registration that stopped moving.
 *
 * The property worth pinning is the threshold's *direction*. Alerting too
 * early fires on the ordinary case and teaches whoever reads the mailbox to
 * ignore it, which costs more than the stall — it is the same reasoning the
 * liveness graces are tuned against. So: nothing inside the range we quote,
 * something past it.
 */
import { describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import { runRegistrationStallJob } from "./registration-stalls";

const env = { OPS_ALERT_EMAIL: "ops@test.local" } as unknown as Env;
const NOW = new Date("2026-07-29T12:00:00Z");

/** A db stub that records the filters the scan applied. */
function stub(rows: unknown[]) {
  const filters: Record<string, unknown> = {};
  const builder: Record<string, unknown> = {};
  const chain = (key: string) => (...args: unknown[]) => {
    filters[key] = args;
    return builder;
  };
  Object.assign(builder, {
    select: chain("select"),
    in: chain("in"),
    lt: chain("lt"),
    order: chain("order"),
    limit: vi.fn(async () => ({ data: rows, error: null })),
  });
  return { db: { from: () => builder } as never, filters };
}

const stalled = (days: number, over: Record<string, unknown> = {}) => ({
  id: "r1",
  company_id: "c1",
  kind: "campaign",
  status: "pending",
  submitted_at: new Date(NOW.getTime() - days * 86_400_000).toISOString(),
  companies: { name: "Ace Plumbing" },
  ...over,
});

describe("runRegistrationStallJob", () => {
  it("looks only at the two waiting states", async () => {
    const { db, filters } = stub([]);
    vi.stubGlobal("fetch", vi.fn());
    await runRegistrationStallJob(env, NOW, db);

    // An approved or rejected registration has stopped waiting; alerting on
    // either would be alerting about a finished thing.
    expect(filters.in).toEqual(["status", ["submitted", "pending"]]);
    vi.unstubAllGlobals();
  });

  it("cuts off past the range we quote, not inside it", async () => {
    const { db, filters } = stub([]);
    vi.stubGlobal("fetch", vi.fn());
    await runRegistrationStallJob(env, NOW, db);

    const cutoff = Date.parse((filters.lt as string[])[1]);
    const days = (NOW.getTime() - cutoff) / 86_400_000;
    // We tell customers "usually 3-7 business days, sometimes longer". A
    // threshold inside that range fires on the ordinary case.
    expect(days).toBeGreaterThan(7);
    vi.unstubAllGlobals();
  });

  it("sends nothing when everything is moving", async () => {
    const sent = vi.fn();
    vi.stubGlobal("fetch", sent);
    const { db } = stub([]);

    await expect(runRegistrationStallJob(env, NOW, db)).resolves.toEqual([]);
    expect(sent).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("names the workspace and how long it has waited", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return Response.json({ id: "e1" });
    });
    const { db } = stub([stalled(14)]);

    await runRegistrationStallJob(env, NOW, db);

    const body = bodies.join("");
    // A company id is not something anyone can act on at 8am.
    expect(body).toContain("Ace Plumbing");
    expect(body).toContain("14 days");
    vi.unstubAllGlobals();
  });

  it("calls out a 'submitted' row as the more serious case", async () => {
    // It can mean the submission never landed at the carrier at all, which the
    // poller cannot distinguish from a slow review.
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return Response.json({ id: "e1" });
    });
    const { db } = stub([stalled(12, { status: "submitted" })]);

    await runRegistrationStallJob(env, NOW, db);

    expect(bodies.join("")).toContain("never landed at the carrier");
    vi.unstubAllGlobals();
  });

  it("throws when the scan itself fails, so the cron reports broken", async () => {
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      in: () => builder,
      lt: () => builder,
      order: () => builder,
      limit: async () => ({ data: null, error: { message: "boom" } }),
    });
    const db = { from: () => builder } as never;

    await expect(runRegistrationStallJob(env, NOW, db)).rejects.toThrow(/stall scan failed/);
  });
});
