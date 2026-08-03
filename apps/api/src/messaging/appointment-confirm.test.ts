/**
 * #237 — a customer confirming, and the three ways that could go wrong.
 *
 * The interesting failures here are not "did it mark the task". They are:
 *
 *   1. confirming a job the customer was never asked about, so a dispatcher
 *      trusts a "confirmed" that came from an unrelated "ok";
 *   2. thanking somebody twice for one confirmation;
 *   3. — the expensive one — consuming a carrier keyword. `inbound.ts` owns
 *      that ordering; `appointment-confirm-keywords.test.ts` owns the
 *      vocabulary. What this file pins is that the handler itself does nothing
 *      for a STOP even if it somehow reached one.
 */
import { describe, expect, it, vi } from "vitest";

import { confirmAppointmentFromReply } from "./appointment-reminders";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "22222222-2222-4222-8222-222222222222";
const TASK = "33333333-3333-4333-8333-333333333333";

/**
 * The two reads and one write this handler makes, as a chainable double.
 *
 * Hand-rolled rather than routed through the HTTP harness because the whole
 * function is two queries and an RPC — a fetch-level stub would test PostgREST's
 * query-string encoding, and what is worth pinning here is the decision.
 */
function db(options: {
  remindedTask?: string | null;
  confirmOutcome?: string;
  eventError?: string;
}) {
  const rpcCalls: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  /**
   * Every `.eq(column, value)` the lookup applied.
   *
   * RECORDED, not ignored. The first version of this double swallowed filters
   * and returned the same rows regardless — so deleting `.eq("status","sent")`
   * from the handler, which is the whole "was this customer actually asked"
   * guarantee, left every test in this file green. A double that cannot tell
   * one query from another cannot test a query.
   */
  const filters: [string, unknown][] = [];
  const builder = () => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "not", "order"]) {
      chain[method] = () => chain;
    }
    chain.eq = (column: string, value: unknown) => {
      filters.push([column, value]);
      return chain;
    };
    chain.limit = () =>
      Promise.resolve({
        data:
          options.remindedTask === undefined
            ? [{ task_id: TASK }]
            : options.remindedTask === null
              ? []
              : [{ task_id: options.remindedTask }],
        error: null,
      });
    chain.insert = (row: Record<string, unknown>) => {
      events.push(row);
      return Promise.resolve({
        data: null,
        error: options.eventError ? { message: options.eventError } : null,
      });
    };
    return chain;
  };
  return {
    client: {
      from: () => builder(),
      rpc: (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, ...args });
        return Promise.resolve({
          data: { outcome: options.confirmOutcome ?? "confirmed" },
          error: null,
        });
      },
    } as never,
    rpcCalls,
    events,
    filters,
  };
}

describe("#237 confirmAppointmentFromReply", () => {
  it("confirms the job the customer was reminded about", async () => {
    const { client, rpcCalls, events, filters } = db({});
    const taskId = await confirmAppointmentFromReply(client, {
      companyId: COMPANY,
      conversationId: CONVERSATION,
      body: "C",
    });

    expect(taskId).toBe(TASK);
    expect(rpcCalls[0]).toMatchObject({
      name: "api_confirm_task",
      p_task_id: TASK,
      // 'crew' is a note to ourselves; 'customer' is a promise. The dispatcher
      // reads them differently, so the handler must never claim the stronger one.
      p_by: "customer",
    });
    expect(events).toHaveLength(1);

    // The query asked about REMINDERS THAT WENT, on this thread, in this
    // workspace. Each of these is load-bearing: without `sent` an unrelated
    // "ok" confirms a job nobody was asked about, and without `company_id` one
    // workspace's reply reaches another's job.
    expect(filters).toContainEqual(["origin", "reminder"]);
    expect(filters).toContainEqual(["status", "sent"]);
    expect(filters).toContainEqual(["company_id", COMPANY]);
    expect(filters).toContainEqual(["conversation_id", CONVERSATION]);
  });

  it("does nothing when no reminder for this thread has been sent", async () => {
    // THE ONE THAT MATTERS. Without this, "ok" in an unrelated exchange marks a
    // job confirmed and a dispatcher trusts it. The question has to have been
    // asked before an answer can mean anything.
    const { client, rpcCalls, events } = db({ remindedTask: null });
    const taskId = await confirmAppointmentFromReply(client, {
      companyId: COMPANY,
      conversationId: CONVERSATION,
      body: "yes",
    });

    expect(taskId).toBeNull();
    expect(rpcCalls, "a job nobody was asked about was confirmed").toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("does nothing for a reply that is not a confirmation", async () => {
    const { client, rpcCalls } = db({});
    for (const body of ["can we do Friday instead?", "no", "STOP"]) {
      expect(
        await confirmAppointmentFromReply(client, {
          companyId: COMPANY,
          conversationId: CONVERSATION,
          body,
        }),
        body,
      ).toBeNull();
    }
    expect(rpcCalls).toHaveLength(0);
  });

  it("records nothing the second time somebody confirms", async () => {
    // A customer who replies to both reminders confirmed once. The RPC is
    // idempotent; this is about the TIMELINE, which would otherwise say it
    // twice and read as two different customers answering.
    const { client, events } = db({ confirmOutcome: "already" });
    const taskId = await confirmAppointmentFromReply(client, {
      companyId: COMPANY,
      conversationId: CONVERSATION,
      body: "C",
    });

    expect(taskId).toBeNull();
    expect(events).toHaveLength(0);
  });

  it("surfaces a failed timeline write rather than reporting success", async () => {
    // The job IS confirmed at this point. Swallowing the event error would
    // leave the crew with a confirmed job and no line saying who confirmed it,
    // which is the silence docs/DECISIONS.md rules out.
    const { client } = db({ eventError: "insert exploded" });
    await expect(
      confirmAppointmentFromReply(client, {
        companyId: COMPANY,
        conversationId: CONVERSATION,
        body: "C",
      }),
    ).rejects.toThrow(/insert exploded/);
  });

  it("makes no query at all for an obviously unrelated message", async () => {
    // The cheap-exit. This runs on EVERY inbound message in the product, so a
    // version that queried first and matched second would put two reads on the
    // hot path of every text a customer sends.
    const spy = vi.fn();
    const client = { from: spy, rpc: spy } as never;
    await confirmAppointmentFromReply(client, {
      companyId: COMPANY,
      conversationId: CONVERSATION,
      body: "the boiler is making a noise again",
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
