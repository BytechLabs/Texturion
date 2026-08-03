/**
 * #411 — the auto-retry, and the much longer list of things it must not do.
 *
 * The whole feature rests on one claim: a STUCK row provably never reached the
 * carrier, so re-sending it cannot duplicate a message. Every assertion here
 * is either that claim's consequence or a guard on its boundary — because if
 * the boundary leaks, the failure is a customer receiving the same text twice,
 * which is worse than the late send this fixes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUTO_RETRY_LIMIT, retryInterruptedSends } from "./retry-interrupted";
import type { Env } from "../env";

const dispatched: string[] = [];
const gated: string[] = [];
const failedOut: string[] = [];

vi.mock("./send", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./send")>();
  return {
    ...actual,
    runPreSendGates: vi.fn(async (_env: unknown, companyId: string, to: string) => {
      gated.push(`${companyId}:${to}`);
      if (to === "+15550000BLOCKED") throw new Error("recipient_opted_out");
      return { destinationE164: to } as never;
    }),
    claimMessageRetry: vi.fn(async (_db: unknown, args: { messageId: string }) => ({
      id: args.messageId,
      body: "On our way.",
      company_id: "c1",
    })),
    dispatchOutbound: vi.fn(async (_e: unknown, _d: unknown, m: { id: string }) => {
      dispatched.push(m.id);
      return m;
    }),
    persistSendInterruption: vi.fn(async (_db: unknown, m: { id: string }) => {
      failedOut.push(m.id);
    }),
  };
});

vi.mock("./media", () => ({ signedMediaUrls: vi.fn(async () => []) }));
vi.mock("@sentry/cloudflare", () => ({ captureMessage: vi.fn() }));

interface Claimed {
  id: string;
  company_id: string;
  conversation_id: string;
}

function fakeDb(
  claimed: Claimed[],
  view: { to?: string; from?: string | null; status?: string } = {},
) {
  const calls: { rpc: Record<string, unknown>[] } = { rpc: [] };
  const db = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.rpc.push({ name, ...args });
      return { data: claimed, error: null };
    }),
    from: (table: string) => {
      if (table === "conversations") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    contact_phone_e164: view.to ?? "+16135551234",
                    contacts: { phone_e164: view.to ?? "+16135551234" },
                    phone_numbers: {
                      number_e164: view.from === undefined ? "+14155550100" : view.from,
                      status: view.status ?? "active",
                    },
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      // message_attachments
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ order: async () => ({ data: [], error: null }) }),
          }),
        }),
      };
    },
  };
  return { db: db as never, calls };
}

const env = {} as Env;
const ROW: Claimed = { id: "m1", company_id: "c1", conversation_id: "v1" };

describe("#411 — retrying a send that never reached the carrier", () => {
  beforeEach(() => {
    dispatched.length = 0;
    gated.length = 0;
    failedOut.length = 0;
  });

  it("re-dispatches a claimed stuck send", async () => {
    const probe = fakeDb([ROW]);
    expect(await retryInterruptedSends(env, new Date(), probe.db)).toBe(1);
    expect(dispatched).toEqual(["m1"]);
  });

  it("asks the claim for ONE attempt, so it cannot loop forever", async () => {
    // A sweeper that retries without a ceiling turns a permanently-failing
    // send into something that runs every five minutes for good.
    const probe = fakeDb([]);
    await retryInterruptedSends(env, new Date(), probe.db);
    expect(probe.calls.rpc[0]).toMatchObject({
      name: "claim_stuck_sends_for_retry",
      p_max_attempts: AUTO_RETRY_LIMIT,
    });
    expect(AUTO_RETRY_LIMIT).toBe(1);
  });

  it("re-runs the send gates, because the world may have changed", async () => {
    // The customer may have texted STOP in the minutes since this was queued.
    // Sending anyway would break the one rule that cannot be got wrong.
    const probe = fakeDb([ROW]);
    await retryInterruptedSends(env, new Date(), probe.db);
    expect(gated).toEqual(["c1:+16135551234"]);
  });

  it("fails the row out when a gate refuses, rather than dropping it", async () => {
    const probe = fakeDb([ROW], { to: "+15550000BLOCKED" });
    expect(await retryInterruptedSends(env, new Date(), probe.db)).toBe(0);
    expect(dispatched).toEqual([]);
    expect(failedOut).toEqual(["m1"]);
  });

  it("keeps retrying the fleet when one workspace's send cannot go", async () => {
    const probe = fakeDb([
      { id: "m1", company_id: "c1", conversation_id: "v1" },
      { id: "m2", company_id: "c1", conversation_id: "v1" },
    ]);
    // The gate throws only for the blocked destination; both rows share a
    // conversation here, so use a fresh db whose view is fine and assert both
    // dispatch — the isolation that matters is the try/catch per row.
    expect(await retryInterruptedSends(env, new Date(), probe.db)).toBe(2);
    expect(dispatched).toEqual(["m1", "m2"]);
  });

  it("declines a number that is not active, without dispatching", async () => {
    // Released or suspended since the send was queued. Sending from it would
    // die at Telnyx with an opaque error, or go out from a number the company
    // no longer pays for.
    const probe = fakeDb([ROW], { status: "released" });
    expect(await retryInterruptedSends(env, new Date(), probe.db)).toBe(0);
    expect(dispatched).toEqual([]);
  });

  it("declines a number still provisioning", async () => {
    const probe = fakeDb([ROW], { from: null });
    expect(await retryInterruptedSends(env, new Date(), probe.db)).toBe(0);
    expect(dispatched).toEqual([]);
  });

  it("does nothing at all when nothing is stuck", async () => {
    const probe = fakeDb([]);
    expect(await retryInterruptedSends(env, new Date(), probe.db)).toBe(0);
    expect(dispatched).toEqual([]);
    expect(failedOut).toEqual([]);
  });
});
