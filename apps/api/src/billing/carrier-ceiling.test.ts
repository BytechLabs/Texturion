/**
 * #457 — the daily carrier ceiling warning.
 *
 * The predicate itself is tested in the shared package (D59). What is worth
 * pinning here is the wiring around it, because every one of these was a real
 * way to ship an alert that looked right and warned nobody:
 *
 *  - the UTC day, not the local one (the carrier resets on UTC midnight)
 *  - one email per crew per day, though the job runs hourly
 *  - the sole-proprietor ceiling is HALF the low-volume one
 *  - one bad address does not stop the rest of the fleet being warned
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { runCarrierCeilingJob } from "./carrier-ceiling";
import type { Env } from "../env";

const sent: Array<{ to: string[]; subject: string; text: string }> = [];

vi.mock("../email/resend", () => ({
  sendEmail: vi.fn(async (_env: unknown, msg: { to: string[]; subject: string; text: string }) => {
    sent.push(msg);
  }),
}));
vi.mock("../email/html", () => ({ renderEmailHtml: (t: string) => t }));
vi.mock("./recipients", () => ({
  billingRecipients: vi.fn(async (_e: unknown, companyId: string) =>
    companyId === "no-inbox" ? [] : ["owner@example.com"],
  ),
}));

interface Row {
  company_id: string;
  use_case: string;
  sent_today: number;
}

/** A db double that records what the job asked for and what it claimed. */
function fakeDb(rows: Row[], opts: { alreadyClaimed?: Set<string> } = {}) {
  const claimed = opts.alreadyClaimed ?? new Set<string>();
  const calls: { since?: string; claims: Array<Record<string, unknown>> } = { claims: [] };
  const db = {
    rpc: vi.fn(async (name: string, args: { p_since: string }) => {
      expect(name).toBe("api_daily_outbound");
      calls.since = args.p_since;
      return { data: rows, error: null };
    }),
    from: (table: string) => {
      expect(table).toBe("usage_alerts");
      return {
        upsert: (row: Record<string, unknown>) => {
          calls.claims.push(row);
          const won = !claimed.has(String(row.company_id));
          claimed.add(String(row.company_id));
          return {
            select: async () => ({ data: won ? [{ company_id: row.company_id }] : [], error: null }),
          };
        },
      };
    },
  };
  return { db: db as never, calls };
}

const env = {} as Env;

describe("carrier ceiling warning (#457)", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it("counts against the UTC day, because that is when the carrier resets", async () => {
    // Late evening in California is already the next UTC day. Asking for the
    // local day would measure the wrong budget entirely.
    const probe = fakeDb([]);
    await runCarrierCeilingJob(env, new Date("2026-07-29T06:30:00Z"), probe.db);
    expect(probe.calls.since).toBe("2026-07-29T00:00:00.000Z");
  });

  it("warns at 80% of the low-volume ceiling and names the real number", async () => {
    // 2,000/day on LOW_VOLUME → the warning arm opens at 1,600.
    const probe = fakeDb([{ company_id: "c1", use_case: "LOW_VOLUME", sent_today: 1_600 }]);
    const warned = await runCarrierCeilingJob(env, new Date("2026-07-29T15:00:00Z"), probe.db);

    expect(warned).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["owner@example.com"]);
    expect(sent[0].text).toContain("2000");
    // The whole point of the email: this is not a limit we can lift.
    expect(sent[0].text).toContain("not a Loonext limit");
  });

  it("does not warn below the fraction", async () => {
    const probe = fakeDb([{ company_id: "c1", use_case: "LOW_VOLUME", sent_today: 1_599 }]);
    expect(await runCarrierCeilingJob(env, new Date("2026-07-29T15:00:00Z"), probe.db)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("holds a sole proprietor to half the ceiling", async () => {
    // 1,000/day, so 800 warns — the same volume that is comfortably fine for a
    // LOW_VOLUME campaign. Reading the use case wrongly warns the wrong crews.
    const probe = fakeDb([{ company_id: "c1", use_case: "SOLE_PROPRIETOR", sent_today: 800 }]);
    expect(await runCarrierCeilingJob(env, new Date("2026-07-29T15:00:00Z"), probe.db)).toBe(1);
    expect(sent[0].text).toContain("1000");

    sent.length = 0;
    const low = fakeDb([{ company_id: "c2", use_case: "LOW_VOLUME", sent_today: 800 }]);
    expect(await runCarrierCeilingJob(env, new Date("2026-07-29T15:00:00Z"), low.db)).toBe(0);
  });

  it("warns once a day even though the job runs hourly", async () => {
    const rows = [{ company_id: "c1", use_case: "LOW_VOLUME", sent_today: 1_800 }];
    const claimed = new Set<string>();
    const first = fakeDb(rows, { alreadyClaimed: claimed });
    const second = fakeDb(rows, { alreadyClaimed: claimed });

    expect(await runCarrierCeilingJob(env, new Date("2026-07-29T15:00:00Z"), first.db)).toBe(1);
    expect(await runCarrierCeilingJob(env, new Date("2026-07-29T16:00:00Z"), second.db)).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("claims the UTC day, so tomorrow's batch is warned about again", async () => {
    const probe = fakeDb([{ company_id: "c1", use_case: "LOW_VOLUME", sent_today: 1_900 }]);
    await runCarrierCeilingJob(env, new Date("2026-07-29T15:00:00Z"), probe.db);
    expect(probe.calls.claims[0]).toMatchObject({
      period_start: "2026-07-29T00:00:00.000Z",
      metric: "carrier_daily",
    });
  });

  it("keeps warning the fleet when one workspace's send fails", async () => {
    const probe = fakeDb([
      { company_id: "no-inbox", use_case: "LOW_VOLUME", sent_today: 1_900 },
      { company_id: "c2", use_case: "LOW_VOLUME", sent_today: 1_900 },
    ]);
    expect(await runCarrierCeilingJob(env, new Date("2026-07-29T15:00:00Z"), probe.db)).toBe(1);
    expect(sent).toHaveLength(1);
  });
});
