/**
 * #251 -- a webhook burst into the Worker on workerd, ramped until it breaks.
 *
 * `webhook-burst.load.ts` already proves the SHAPE under contention in node: a
 * retry storm writes one row and a burst of distinct events lands whole. This
 * is the same question on the real runtime and a real wire, and it adds the
 * axis that file cannot have: SIZE. The burst doubles until something gives,
 * and what gives is written down.
 *
 * Three things are measured at every level, kept apart because they fail
 * differently:
 *
 *  - **the ack**: what the carrier sees. A 2xx means "stop retrying". The
 *    Worker acks before it ingests (#617, deliberate), so a fast ack proves
 *    nothing about whether the message arrived.
 *  - **the landing**: whether every acked event became a message row, and how
 *    long the last one took. A row that never lands behind a 200 is the silent
 *    drop #251's third criterion is about.
 *  - **the ledger**: acked events whose `processed_at` is still null. Those are
 *    not lost: the section-11 sweeper re-drives them. They are the honest name
 *    for "acked, not yet ingested", and the count says how much work that is.
 *
 * Milliseconds here are rig milliseconds (wrangler on an 8-core VM) and say
 * nothing about Cloudflare. The shape, the counts and the level where it first
 * fails are the transferable findings.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { burst, capacityResult, emitCapacityResult, line } from "./load-report";
import { startRigStack, type RigStack } from "./rig-stack";

let stack: RigStack;

const OWNER_ID = "10a01251-0001-4001-8001-0000000000a1";
const COMPANY_ID = "10a01251-0002-4002-8002-0000000000a2";
const NUMBER_ID = "10a01251-0003-4003-8003-0000000000a3";
const NUMBER_E164 = "+16135550151";

/** Distinct events per level; each is delivered `COPIES` times. */
const LEVELS = (process.env.RIG_WEBHOOK_LEVELS ?? "25,50,100,200,400,800,1600")
  .split(",")
  .map(Number);
const COPIES = 2;
/** No progress for this long and the level is over, landed or not. */
const STALL_MS = 20_000;
const LEVEL_DEADLINE_MS = 180_000;

beforeAll(async () => {
  stack = await startRigStack();
  await cleanup();
  await stack.sql(`
    ${stack.seedUserSql(OWNER_ID, `${stack.runId}-owner@rig-load.test`, "Load Owner")}

    insert into public.companies
      (id, name, owner_user_id, country, requested_area_code,
       subscription_status, aup_accepted_at)
    values ('${COMPANY_ID}', 'Rig Load Plumbing', '${OWNER_ID}', 'CA', '613',
            'active', now());

    insert into public.company_members (company_id, user_id, role)
    values ('${COMPANY_ID}', '${OWNER_ID}', 'owner');

    insert into public.phone_numbers
      (id, company_id, status, provisioning_key, country, number_e164)
    values ('${NUMBER_ID}', '${COMPANY_ID}', 'active', 'rigload_${stack.runId}',
            'CA', '${NUMBER_E164}');
  `);
});

afterAll(async () => {
  if (!stack) return;
  try {
    await cleanup();
  } finally {
    await stack.stop();
  }
});

async function cleanup(): Promise<void> {
  await stack.sql(`
    delete from public.messages where company_id = '${COMPANY_ID}';
    delete from public.conversations where company_id = '${COMPANY_ID}';
    delete from public.contacts where company_id = '${COMPANY_ID}';
    delete from public.conversation_events where company_id = '${COMPANY_ID}';
    delete from public.opt_outs where company_id = '${COMPANY_ID}';
    delete from public.webhook_events where provider = 'telnyx'
      and event_id like 'rigload-%';
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
  const now = new Date().toISOString();
  return {
    data: {
      event_type: "message.received",
      id: eventId,
      occurred_at: now,
      payload: {
        id: messageId,
        type: "SMS",
        direction: "inbound",
        from: { phone_number: from, carrier: "Bell", line_type: "Wireless" },
        to: [{ phone_number: NUMBER_E164, status: "webhook_delivered" }],
        text,
        media: [],
        received_at: now,
        encoding: "GSM-7",
        parts: 1,
      },
    },
    meta: { attempt: 1 },
  };
}

async function messageCount(): Promise<number> {
  const out = await stack.sql(
    `select count(*) from public.messages where company_id = '${COMPANY_ID}';`,
  );
  return Number(out.trim());
}

async function ledger(
  prefix: string,
): Promise<{ ids: Set<string>; unprocessed: number }> {
  const out = await stack.sql(
    `select event_id, processed_at is null
       from public.webhook_events
      where provider = 'telnyx' and event_id like '${prefix}%';`,
  );
  const ids = new Set<string>();
  let unprocessed = 0;
  for (const row of out.trim().split("\n").filter(Boolean)) {
    const [id, pending] = row.split("|");
    ids.add(id);
    if (pending === "t") unprocessed += 1;
  }
  return { ids, unprocessed };
}

/** Wait until `target` rows exist, or progress stalls, or the level's deadline. */
async function settle(target: number, startedAt: number): Promise<{ count: number; ms: number }> {
  let last = -1;
  let lastChange = Date.now();
  for (;;) {
    const count = await messageCount();
    if (count >= target) return { count, ms: Date.now() - startedAt };
    if (count !== last) {
      last = count;
      lastChange = Date.now();
    }
    if (Date.now() - lastChange > STALL_MS || Date.now() - startedAt > LEVEL_DEADLINE_MS) {
      return { count, ms: Date.now() - startedAt };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

describe("#251 webhook burst on the rig, ramped", () => {
  it("a retry storm of one event, 100 concurrent copies, writes exactly one message", async () => {
    const before = await messageCount();
    const eventId = `rigload-${stack.runId}-storm`;
    const event = inbound(eventId, `${eventId}-msg`, "+16135550111", "Storm copy");

    const report = await burst("retry storm x100", 100, () => stack.injectTelnyx(event));
    console.log(line(report));
    const settled = await settle(before + 1, Date.now() - report.totalMs);
    // A further beat, so a late duplicate would be counted rather than missed.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const after = await messageCount();

    expect(after - before, "duplicates or drops from one event").toBe(1);
    expect(report.hangs).toBe(0);
    expect(report.throws).toBe(0);
    for (const status of Object.keys(report.statuses)) {
      expect(Number(status), `ack ${status}`).toBeGreaterThanOrEqual(200);
      expect(Number(status), `ack ${status}`).toBeLessThan(300);
    }

    emitCapacityResult(
      capacityResult({
        scenario: "rig-webhook-retry-storm",
        environment: "rig",
        tested_bound: { concurrent_copies: 100, distinct_events: 1 },
        ceiling_reached: false,
        measurements: {
          ack_wall_ms: report.totalMs,
          ack_p50_ms: report.p50,
          ack_p95_ms: report.p95,
          ack_max_ms: report.max,
          statuses: report.statuses,
          hangs: report.hangs,
          message_rows: after - before,
          landed_ms: settled.ms,
        },
        notes: [
          "Rig milliseconds (wrangler on a VM); the counts are the transferable evidence.",
        ],
      }),
    );
  });

  it("ramps distinct inbound events, each delivered twice, until something gives", async () => {
    let ceiling: string | null = null;

    for (const level of LEVELS) {
      const before = await messageCount();
      const prefix = `rigload-${stack.runId}-L${level}-`;
      const events = Array.from({ length: level }, (_, i) =>
        inbound(
          `${prefix}${i}`,
          `${prefix}${i}-msg`,
          // Distinct senders: one conversation each, which is the wide case.
          // Same-sender events thread into one row and measure row contention,
          // a narrower scenario the retry storm above already covers.
          `+1613${String(6_000_000 + i).padStart(7, "0")}`,
          `Level ${level} message ${i}`,
        ),
      );

      const acked = new Set<number>();
      const report = await burst(
        `inbound x${level} (each twice)`,
        level * COPIES,
        async (index) => {
          const which = Math.floor(index / COPIES);
          const ack = await stack.injectTelnyx(events[which]);
          if (ack.status >= 200 && ack.status < 300) acked.add(which);
          return ack;
        },
        60_000,
      );
      console.log(line(report));
      const settled = await settle(before + level, Date.now() - report.totalMs);
      // A beat for late duplicates, then until the ledger says every acked event
      // was finished with: the row lands before the ledger is marked.
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const landed = (await messageCount()) - before;
      const drainStart = Date.now();
      let rows = await ledger(prefix);
      while (rows.unprocessed > 0 && Date.now() - drainStart < STALL_MS) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        rows = await ledger(prefix);
      }
      const ledgerDrainedMs = Date.now() - drainStart;

      const non2xx = Object.entries(report.statuses)
        .filter(([status]) => !(Number(status) >= 200 && Number(status) < 300))
        .reduce((sum, [, n]) => sum + n, 0);
      const dropped = Math.max(0, level - landed);
      const duplicated = Math.max(0, landed - level);

      // What is NEVER acceptable at any level, ceiling or not: a duplicate, a
      // hang, or a throw. A refusal (non-2xx) and a slow landing are how a
      // ceiling is allowed to look; a duplicate is corruption.
      expect(duplicated, `level ${level}: duplicate messages`).toBe(0);
      expect(report.hangs, `level ${level}: acks that never came`).toBe(0);
      expect(report.throws, `level ${level}: acks that threw`).toBe(0);

      const crossed = non2xx > 0 || dropped > 0;
      emitCapacityResult(
        capacityResult({
          scenario: "rig-webhook-burst-ramp",
          environment: "rig",
          tested_bound: {
            distinct_events: level,
            copies_each: COPIES,
            posts: level * COPIES,
          },
          ceiling_reached: crossed,
          measurements: {
            ack_wall_ms: report.totalMs,
            ack_p50_ms: report.p50,
            ack_p95_ms: report.p95,
            ack_max_ms: report.max,
            statuses: report.statuses,
            hangs: report.hangs,
            expected_message_rows: level,
            landed_message_rows: landed,
            dropped_behind_ack: dropped,
            duplicated_rows: duplicated,
            landed_ms: settled.ms,
            ledger_events: rows.ids.size,
            ledger_unprocessed: rows.unprocessed,
            ledger_drained_after_landing_ms: ledgerDrainedMs,
          },
          notes: [
            "Rig milliseconds; wrangler dev on an 8-core VM, not Cloudflare.",
            "Acked-but-unprocessed events stay in the ledger for the section-11 sweeper; dropped_behind_ack counts rows that had not landed when progress stalled.",
          ],
        }),
      );

      if (crossed) {
        // What the Worker said while it refused, so the finding names a cause.
        console.log(`level ${level} worker log, by cause:`, stack.logCauses());
        ceiling = `level ${level}: ${non2xx} refused acks, ${dropped} not landed`;
        // The honest-degradation requirement, stated as code: crossing the
        // ceiling must be visible. Either the carrier was told (a non-2xx so
        // it retries) or the ledger still holds the event for the sweeper.
        // Neither is a silent loss. Silent means: acked 2xx, not landed, and
        // not in the ledger at all.
        let silent = 0;
        for (const which of acked) if (!rows.ids.has(`${prefix}${which}`)) silent += 1;
        expect(silent, `level ${level}: events acked but absent from the ledger`).toBe(0);
        break;
      }
    }

    console.log(ceiling ? `CEILING ${ceiling}` : `no ceiling to ${LEVELS.at(-1)} distinct events`);
    expect(true).toBe(true);
  });
});
