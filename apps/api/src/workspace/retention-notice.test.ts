/**
 * #284 — the warning that precedes any deletion.
 *
 * Two properties carry this. It must reach the CUSTOMER, because the only
 * person who can act on it is the one who might want to export first — and it
 * must go exactly once per window, because a duplicate warning about data
 * destruction reads as a system that has lost track of what it is deleting.
 */
import { describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import { runRetentionNoticeJob } from "./retention-notice";

const env = { OPS_ALERT_EMAIL: "ops@test.local" } as unknown as Env;

const due = (over: Record<string, unknown> = {}) => ({
  company_id: "c1",
  company_name: "Ace Plumbing",
  window_days: 2555,
  message_count: 1200,
  oldest_at: "2019-03-04T00:00:00Z",
  ...over,
});

/** A db whose RPCs answer in order, and whose member lookup returns an email. */
function stub(rows: unknown[], claimed = true) {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === "api_retention_due") return { data: rows, error: null };
    if (fn === "api_record_retention_notice") return { data: claimed, error: null };
    return { data: null, error: null };
  });
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    in: () => builder,
    limit: async () => ({ data: [{ user_id: "u1" }], error: null }),
  });
  return { db: { rpc, from: () => builder } as never, rpc };
}

describe("runRetentionNoticeJob", () => {
  it("sends nothing when nothing is approaching its window", async () => {
    const sent = vi.fn();
    vi.stubGlobal("fetch", sent);
    const { db } = stub([]);

    await expect(runRetentionNoticeJob(env, new Date(0), db)).resolves.toBe(0);
    expect(sent).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("claims BEFORE sending, so a second run cannot warn twice", async () => {
    // A duplicate warning about data destruction is worse than none: it reads
    // as a system that has lost track of what it is deleting.
    const { db, rpc } = stub([due()], false);
    const sent = vi.fn();
    vi.stubGlobal("fetch", sent);

    await expect(runRetentionNoticeJob(env, new Date(0), db)).resolves.toBe(0);

    const calls = rpc.mock.calls.map((c) => c[0]);
    expect(calls).toContain("api_record_retention_notice");
    // The claim lost, so nothing was sent.
    expect(sent).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("throws when the scan fails, so the cron reports broken", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    const db = { rpc, from: () => ({}) } as never;
    await expect(runRetentionNoticeJob(env, new Date(0), db)).rejects.toThrow(/due scan failed/);
  });
});
