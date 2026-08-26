/**
 * #251 — the webhook burst, driven concurrently against the real handlers.
 *
 * ## Why this scenario, and why it is worth more than a latency number
 *
 * #251 names a carrier retry storm as one of its five unknowns and says the
 * reason plainly: "Telnyx delivers on their schedule, not ours. A carrier retry
 * storm after a partial outage arrives as a spike, and that is precisely when we
 * are least able to absorb it."
 *
 * The interesting question there is not how fast we are. It is whether the
 * SHAPE of our behaviour survives concurrency:
 *
 * 1. **The same event delivered many times at once must produce one row.**
 *    Idempotency is normally tested sequentially, where a `webhook_events`
 *    insert has already committed before the retry arrives. Under a real storm
 *    it has not, and every copy races the same check. A duplicate here is
 *    duplicate customer messages in a thread and a duplicate notification —
 *    data corruption, not slowness.
 * 2. **A burst of DISTINCT events must land completely.** Not "mostly": a
 *    dropped inbound message is a customer whose text nobody in the workspace
 *    ever sees, and there is no error anywhere to notice.
 * 3. **Whatever happens must be visible in the response.** #251's third
 *    acceptance criterion is that a ceiling produces a truthful failure rather
 *    than a hang. `load-report.ts` counts hangs separately for that reason.
 *
 * ## What these numbers are, and are not
 *
 * Node, on a laptop, against a docker Postgres. The MILLISECONDS mean nothing
 * about production — there is no workerd, no isolate limit, no CPU-time limit,
 * and no network. The COUNTS mean everything: duplicates, drops and hangs are
 * properties of our own code and they transfer.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startHarness, type Harness } from "./harness";
import {
  burst,
  burstCapacityResult,
  emitCapacityResult,
  line,
} from "./load-report";

let h: Harness;

const OWNER_ID = "10a01251-0001-4001-8001-000000000001";
const COMPANY_ID = "10a01251-0002-4002-8002-000000000002";
const NUMBER_ID = "10a01251-0003-4003-8003-000000000003";
const NUMBER_E164 = "+16135550251";

/**
 * The storm size. Big enough that copies genuinely overlap in Postgres, small
 * enough that the suite stays a minute rather than a coffee break — the value
 * of this scenario is the shape, and the shape is visible well below the point
 * where a laptop becomes the bottleneck.
 */
const STORM = 25;
const DISTINCT = 40;

beforeAll(async () => {
  h = await startHarness();
  cleanup();
  h.sql(`
    ${h.seedUserSql(OWNER_ID, `${h.runId}-owner@load.test`, "Load Owner")}

    insert into public.companies
      (id, name, owner_user_id, country, requested_area_code,
       subscription_status, aup_accepted_at)
    values ('${COMPANY_ID}', 'Load Plumbing', '${OWNER_ID}', 'CA', '613',
            'active', now());

    insert into public.company_members (company_id, user_id, role)
    values ('${COMPANY_ID}', '${OWNER_ID}', 'owner');

    insert into public.phone_numbers
      (id, company_id, status, provisioning_key, country, number_e164)
    values ('${NUMBER_ID}', '${COMPANY_ID}', 'active', 'load_${h.runId}',
            'CA', '${NUMBER_E164}');
  `);
}, 120_000);

afterAll(async () => {
  if (h) {
    cleanup();
    await h.close();
  }
});

function cleanup(): void {
  h.sql(`
    delete from public.messages where company_id = '${COMPANY_ID}';
    delete from public.conversations where company_id = '${COMPANY_ID}';
    delete from public.contacts where company_id = '${COMPANY_ID}';
    delete from public.conversation_events where company_id = '${COMPANY_ID}';
    delete from public.opt_outs where company_id = '${COMPANY_ID}';
    delete from public.webhook_events where provider = 'telnyx'
      and event_id like 'load-${h.runId}%';
    delete from public.phone_numbers where company_id = '${COMPANY_ID}';
    delete from public.company_members where company_id = '${COMPANY_ID}';
    delete from public.egress_events where company_id = '${COMPANY_ID}';
    delete from public.inbound_notification_days where company_id = '${COMPANY_ID}';
    delete from public.companies where id = '${COMPANY_ID}';
    delete from public.profiles where user_id = '${OWNER_ID}';
    delete from auth.users where id = '${OWNER_ID}';
  `);
}

function inbound(eventId: string, messageId: string, from: string, text: string) {
  return {
    data: {
      event_type: "message.received",
      id: eventId,
      occurred_at: new Date().toISOString(),
      payload: {
        id: messageId,
        type: "SMS",
        direction: "inbound",
        from: { phone_number: from, carrier: "Bell", line_type: "Wireless" },
        to: [{ phone_number: NUMBER_E164, status: "webhook_delivered" }],
        text,
        media: [],
        received_at: new Date().toISOString(),
        encoding: "GSM-7",
        parts: 1,
      },
    },
    meta: { attempt: 1 },
  };
}

async function messageCount(): Promise<number> {
  const { count, error } = await h.db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("company_id", COMPANY_ID);
  expect(error).toBeNull();
  return count ?? 0;
}

describe("#251 webhook burst", () => {
  it("a carrier retry storm of ONE event still writes exactly one message", async () => {
    const eventId = `load-${h.runId}-storm`;
    const messageId = `load-${h.runId}-storm-msg`;
    const event = inbound(eventId, messageId, "+16135551111", "Storm copy");

    const report = await burst(`retry storm ×${STORM}`, STORM, () =>
      h.injectTelnyx(event),
    );
    console.log(line(report));

    // THE ASSERTION THAT MATTERS. Every copy raced the same `webhook_events`
    // check with nothing committed ahead of it. One row, or the thread shows a
    // customer's text N times and N notifications go out.
    expect(await messageCount()).toBe(1);

    // And the storm was ABSORBED rather than survived by luck: nothing hung,
    // and nothing came back as an unhandled throw.
    expect(report.hangs).toBe(0);
    expect(report.throws).toBe(0);

    // Whatever the handler decided, it decided it out loud. A 5xx here would be
    // honest and acceptable; silence would not.
    for (const status of Object.keys(report.statuses)) {
      expect(Number(status)).toBeGreaterThanOrEqual(200);
    }

    emitCapacityResult(
      burstCapacityResult(
        "webhook-retry-storm",
        report,
        { concurrent_copies: STORM, distinct_events: 1 },
        { message_rows: 1 },
      ),
    );
  });

  it("a burst of DISTINCT inbound messages lands completely, none dropped", async () => {
    const before = await messageCount();

    const report = await burst(`distinct inbound ×${DISTINCT}`, DISTINCT, (i) =>
      h.injectTelnyx(
        inbound(
          `load-${h.runId}-distinct-${i}`,
          `load-${h.runId}-distinct-msg-${i}`,
          // Distinct senders: same-sender events thread into one conversation
          // and would measure row contention on a single thread instead, which
          // is a different scenario and a narrower one.
          `+1613555${String(2000 + i).padStart(4, "0")}`,
          `Distinct ${i}`,
        ),
      ),
    );
    console.log(line(report));

    expect(report.hangs).toBe(0);
    expect(report.throws).toBe(0);

    // Completeness, which is the property a dropped inbound message violates
    // with no error anywhere to notice.
    expect(await messageCount()).toBe(before + DISTINCT);

    emitCapacityResult(
      burstCapacityResult(
        "webhook-distinct-inbound-burst",
        report,
        { concurrent_events: DISTINCT },
        { expected_message_rows: DISTINCT, landed_message_rows: DISTINCT },
      ),
    );
  });

  it("concurrent reads of a workspace answer, rather than hanging", async () => {
    // #251's Supabase-pooler unknown, in the only half a local stack can speak
    // to honestly: not WHERE the managed pooler refuses, but what our code does
    // while many requests contend for connections at once. A truthful error is
    // acceptable; a hang is the failure.
    const token = await h.token(OWNER_ID);
    const report = await burst("concurrent conversation reads ×40", 40, () =>
      h.call("GET", "/v1/conversations", { token, companyId: COMPANY_ID }),
    );
    console.log(line(report));

    expect(report.hangs).toBe(0);
    expect(report.throws).toBe(0);
    // Every request got a real HTTP answer. This is the honest-degradation
    // criterion: a 500 under contention would pass here and SHOULD, because the
    // requirement is truthfulness rather than success.
    expect(report.count).toBe(
      Object.values(report.statuses).reduce((sum, n) => sum + n, 0),
    );

    emitCapacityResult(
      burstCapacityResult("concurrent-conversation-reads", report, {
        concurrent_requests: 40,
      }),
    );
  });
});
