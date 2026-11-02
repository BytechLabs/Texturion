/**
 * #251 -- many calls ringing at once, through the real CallSessionDO on workerd.
 *
 * `docs/CAPACITY.md` asks what happens to a 20-tech crew when twelve calls are
 * live and the carrier's webhooks arrive together. `load/call-session-do.workerd.ts`
 * answered the structural half with a storage double for the runtime; this is the
 * whole path: signed webhooks over HTTP into the Worker on workerd, the router,
 * one Durable Object per call, the real command layer talking to a fake switch,
 * and the rig's Postgres for the call rows.
 *
 * ## The ramp
 *
 * N workspaces, each with its own line and a crew of CREW technicians, take one
 * inbound call each at the same moment. N doubles until something gives. Every
 * level runs the three phases a call has, and each phase is a different load:
 *
 *   1. **ring**: N `call.initiated` webhooks at once. Each object dials its
 *      first batch of the crew, and the switch's `call.initiated` for every ring
 *      leg comes back as a second wave of webhooks.
 *   2. **answer**: every call is answered by one technician at once. The object
 *      must bridge that leg and hang the rest up.
 *   3. **end**: every caller hangs up at once and every object must finish.
 *
 * ## What is a failure and what is a ceiling
 *
 * Slow is a ceiling: a phase that has not finished by its deadline, or an ack
 * that is a 5xx. Wrong is a failure at ANY level and fails the suite: a call
 * answered by someone who did not answer, a leg left alive after the call ended,
 * an object that dialled past its bound, or a replayed webhook that dialled the
 * crew twice.
 *
 * The clock is the driver's, outside the isolate. A Worker's own clock only
 * advances on I/O, so the latencies here are measured by the process that sent
 * the webhooks, which is the same way a carrier would see them.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DIAL_BATCH_SIZE, MAX_LEGS_PER_SESSION } from "../src/calls/transitions";
import type { FakeLeg, TelnyxWebhookEvent } from "./fake-telnyx-voice";
import { capacityResult, emitCapacityResult } from "./load-report";
import { startRigStack, type RigStack } from "./rig-stack";

let stack: RigStack;

const LEVELS = (process.env.RIG_CALL_LEVELS ?? "2,4,8,12,16,24").split(",").map(Number);
const CREW = Number(process.env.RIG_CALL_CREW ?? "12");
const LINES = Math.max(...LEVELS) + 1;
/** A call rings its whole crew, up to the per-session leg cap. */
const DIALS_PER_CALL = Math.min(CREW, MAX_LEGS_PER_SESSION);
/** The far end of every call. Fictional, and never dialled: the switch is a fake. */
const farEnd = (index: number) => `+1613555${String(4000 + index).padStart(4, "0")}`;
const lineE164 = (index: number) => `+1613555${String(3000 + index).padStart(4, "0")}`;

const PHASE_DEADLINE_MS = 60_000;
/** The fake switch is quiet this long and every webhook has been delivered. */
const QUIET_MS = 700;

interface Line {
  index: number;
  companyId: string;
  e164: string;
  userIds: string[];
  sipUsernames: string[];
  /** Which technician each softphone login belongs to. */
  userBySip: Map<string, string>;
}

const lines: Line[] = [];
const deliveredEventIds: string[] = [];
let sipToLine = new Map<string, Line>();

async function seed(): Promise<void> {
  const statements: string[] = [];
  for (let index = 0; index < LINES; index += 1) {
    const companyId = crypto.randomUUID();
    const phoneNumberId = crypto.randomUUID();
    const userIds = Array.from({ length: CREW }, () => crypto.randomUUID());
    lines.push({ index, companyId, e164: lineE164(index), userIds, sipUsernames: [], userBySip: new Map() });
    statements.push(`
      ${userIds
        .map((id, member) =>
          stack.seedUserSql(id, `${stack.runId}-${index}-${member}@rig-calls.test`, `Crew ${member}`),
        )
        .join("\n")}
      insert into public.companies
        (id, name, owner_user_id, country, us_texting_enabled, requested_area_code,
         subscription_status, plan, current_period_start, current_period_end,
         aup_accepted_at)
      values ('${companyId}', 'Rig Calls ${index}', '${userIds[0]}', 'CA', false, '613',
              'active', 'starter', now(), now() + interval '30 days', now());
      insert into public.company_members (company_id, user_id, role)
      values ${userIds
        .map((id, member) => `('${companyId}', '${id}', '${member === 0 ? "owner" : "member"}')`)
        .join(", ")};
      insert into public.phone_numbers
        (id, company_id, status, provisioning_key, country, number_e164,
         telnyx_phone_number_id)
      values ('${phoneNumberId}', '${companyId}', 'active',
              'rigcalls_${index}_${stack.runId}', 'CA', '${lineE164(index)}',
              'pn-rigcalls-${index}-${stack.runId}');
    `);
  }
  await stack.sql(statements.join("\n"));

  // Mint every technician's softphone login the way the app does, so each has a
  // SIP identity the dial fan-out can target. A dozen at a time: this is setup,
  // and the load under test starts after it.
  const members = lines.flatMap((line) =>
    line.userIds.map((userId) => ({ line, userId })),
  );
  for (let at = 0; at < members.length; at += 12) {
    await Promise.all(
      members.slice(at, at + 12).map(async ({ line, userId }) => {
        const token = await stack.token(userId);
        const minted = await stack.call("POST", "/v1/webrtc/token", {
          token,
          companyId: line.companyId,
        });
        expect(minted.status, `minting a softphone login: ${JSON.stringify(minted.json)}`).toBe(200);
        const sip = (minted.json as { sip_username: string }).sip_username;
        line.sipUsernames.push(sip);
        line.userBySip.set(sip, userId);
      }),
    );
  }
  sipToLine = new Map(
    lines.flatMap((line) => line.sipUsernames.map((sip) => [sip, line] as const)),
  );
}

async function cleanup(): Promise<void> {
  if (lines.length === 0) return;
  const companies = lines.map((l) => `'${l.companyId}'`).join(",");
  const users = lines.flatMap((l) => l.userIds.map((u) => `'${u}'`)).join(",");
  const events = deliveredEventIds.map((id) => `'${id}'`).join(",");
  await stack.sql(`
    delete from public.call_member_legs where call_session_id in
      (select call_session_id from public.calls where company_id in (${companies}));
    delete from public.calls where company_id in (${companies});
    delete from public.call_records where company_id in (${companies});
    delete from public.messages where company_id in (${companies});
    delete from public.conversation_events where company_id in (${companies});
    delete from public.conversations where company_id in (${companies});
    delete from public.contacts where company_id in (${companies});
    delete from public.usage_events where company_id in (${companies});
    delete from public.provider_costs where company_id in (${companies});
    delete from public.egress_events where company_id in (${companies});
    delete from public.inbound_notification_days where company_id in (${companies});
    delete from public.member_telephony_credentials where company_id in (${companies});
    delete from public.notification_prefs where company_id in (${companies});
    ${events ? `delete from public.webhook_events where provider = 'telnyx' and event_id in (${events});` : ""}
    update public.phone_numbers set status = 'released' where company_id in (${companies});
    delete from public.company_members where company_id in (${companies});
    delete from public.phone_numbers where company_id in (${companies});
    delete from public.companies where id in (${companies});
    delete from public.profiles where user_id in (${users});
    delete from auth.users where id in (${users});
  `);
}

beforeAll(async () => {
  stack = await startRigStack();
  await seed();
}, 600_000);

afterAll(async () => {
  if (!stack) return;
  try {
    await cleanup();
  } finally {
    await stack.stop();
  }
}, 300_000);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface DeliveryTally {
  posts: number;
  statuses: Record<string, number>;
}

/**
 * Deliver the switch's webhooks until it has nothing more to say. Each round is
 * sent concurrently, because Telnyx does not wait for one session before it
 * sends another's, and the object's FIFO is exactly what has to cope.
 */
async function drain(): Promise<DeliveryTally> {
  const voice = stack.telnyx.voice;
  const tally: DeliveryTally = { posts: 0, statuses: {} };
  let quietSince: number | null = null;
  for (;;) {
    const batch: TelnyxWebhookEvent[] = [];
    for (let event = voice.takeEvent(); event; event = voice.takeEvent()) batch.push(event);
    if (batch.length > 0) {
      quietSince = null;
      const acks = await Promise.all(batch.map((event) => stack.injectTelnyx(event)));
      for (const [at, ack] of acks.entries()) {
        tally.posts += 1;
        tally.statuses[ack.status] = (tally.statuses[ack.status] ?? 0) + 1;
        deliveredEventIds.push(batch[at].data.id);
      }
      continue;
    }
    quietSince ??= Date.now();
    if (Date.now() - quietSince > QUIET_MS) return tally;
    await sleep(50);
  }
}

async function states(sessionIds: string[]): Promise<Map<string, { state: string; by: string | null }>> {
  const out = await stack.sql(
    `select call_session_id, state, coalesce(answered_by_user_id::text, '')
       from public.calls
      where call_session_id::text in (${sessionIds.map((id) => `'${id}'`).join(",")});`,
  );
  const map = new Map<string, { state: string; by: string | null }>();
  for (const row of out.trim().split("\n").filter(Boolean)) {
    const [id, state, by] = row.split("|");
    map.set(id, { state, by: by || null });
  }
  return map;
}

/** Poll until every session shows `state`; resolves with how long that took. */
async function until(
  sessionIds: string[],
  state: string,
  startedAt: number,
): Promise<{ ms: number | null; reached: number }> {
  let reached = 0;
  while (Date.now() - startedAt < PHASE_DEADLINE_MS) {
    const now = await states(sessionIds);
    reached = [...now.values()].filter((row) => row.state === state).length;
    if (reached === sessionIds.length) return { ms: Date.now() - startedAt, reached };
    await sleep(100);
  }
  return { ms: null, reached };
}

function ringLegs(): FakeLeg[] {
  return stack.telnyx.voice.live().filter((leg) => leg.origin === "dial");
}

function lineOf(leg: FakeLeg): Line | undefined {
  const match = /^sip:([^@]+)@/.exec(leg.to);
  return match ? sipToLine.get(match[1]) : undefined;
}

describe("#251 simultaneous inbound calls through the Durable Object on the rig", () => {
  it("a replayed call.initiated, 40 copies at once, dials the crew exactly once", async () => {
    const voice = stack.telnyx.voice;
    voice.resetCalls();
    const line = lines[LINES - 1];
    const customer = voice.incoming({ from: farEnd(line.index), to: line.e164 });
    const event = voice.takeEvent();
    expect(event?.data.event_type).toBe("call.initiated");

    const acks = await Promise.all(
      Array.from({ length: 40 }, () => stack.injectTelnyx(event)),
    );
    deliveredEventIds.push(event!.data.id);
    await drain();
    const settled = await until([customer.callSessionId], "ringing", Date.now());

    expect(acks.every((ack) => ack.status >= 200 && ack.status < 300)).toBe(true);
    expect(settled.reached).toBe(1);
    const dials = voice.ledger().dials;
    expect(dials, "the crew was dialled once per replay").toBe(DIALS_PER_CALL);

    // Nothing is left ringing for the ramp or the cleanup.
    voice.hangup(customer.callControlId);
    for (const leg of ringLegs()) voice.hangup(leg.callControlId);
    await drain();

    emitCapacityResult(
      capacityResult({
        scenario: "rig-call-replay-storm",
        environment: "rig",
        tested_bound: { concurrent_copies: 40, crew: CREW },
        ceiling_reached: false,
        measurements: { dials, bound: DIALS_PER_CALL },
        notes: ["A webhook the carrier redelivers must not dial the crew again."],
      }),
    );
  });

  it("ramps simultaneous calls until a phase misses its deadline", async () => {
    const voice = stack.telnyx.voice;
    let ceiling: string | null = null;

    for (const level of LEVELS) {
      voice.resetCalls();
      const active = lines.slice(0, level);
      const customers = active.map((line) =>
        voice.incoming({ from: farEnd(line.index), to: line.e164 }),
      );
      const sessionIds = customers.map((leg) => leg.callSessionId);
      const acks: Record<string, number> = {};
      const noteAcks = (tally: DeliveryTally) => {
        for (const [status, n] of Object.entries(tally.statuses)) {
          acks[status] = (acks[status] ?? 0) + n;
        }
      };

      // Phase 1: ring.
      const ringStart = Date.now();
      noteAcks(await drain());
      const ringed = await until(sessionIds, "ringing", ringStart);

      const perLine = new Map<Line, number>();
      for (const leg of voice.legs().filter((l) => l.origin === "dial")) {
        const owner = lineOf(leg);
        if (owner) perLine.set(owner, (perLine.get(owner) ?? 0) + 1);
      }
      const maxDialsPerCall = Math.max(0, ...perLine.values());
      const dialsAfterRing = voice.ledger().dials;

      // The bound the object claims. A breach is corruption, not a ceiling.
      expect(maxDialsPerCall, `level ${level}: dials in one call`).toBeLessThanOrEqual(
        MAX_LEGS_PER_SESSION,
      );
      expect(dialsAfterRing, `level ${level}: dials in total`).toBeLessThanOrEqual(
        level * DIALS_PER_CALL,
      );

      // Phase 2: answer. Whoever is ringing first picks up.
      let answerMs: number | null = null;
      let answered = 0;
      const answeringLeg = new Map<Line, FakeLeg>();
      if (ringed.ms !== null) {
        for (const leg of ringLegs()) {
          const owner = lineOf(leg);
          if (owner && !answeringLeg.has(owner)) answeringLeg.set(owner, leg);
        }
        const answerStart = Date.now();
        for (const leg of answeringLeg.values()) voice.answer(leg.callControlId);
        noteAcks(await drain());
        const result = await until(sessionIds, "answered", answerStart);
        answerMs = result.ms;
        answered = result.reached;
      }

      // Wrong, at any level: a call answered by someone who did not answer.
      if (answered > 0) {
        const now = await states(sessionIds);
        for (const [at, line] of active.entries()) {
          const row = now.get(sessionIds[at]);
          const leg = answeringLeg.get(line);
          if (row?.state !== "answered" || !leg) continue;
          const sip = /^sip:([^@]+)@/.exec(leg.to)?.[1];
          const expected = sip ? line.userBySip.get(sip) : undefined;
          expect(row.by, `level ${level}: line ${line.index} answered by`).toBe(expected);
        }
      }

      // Phase 3: every caller hangs up.
      let endMs: number | null = null;
      let ended = 0;
      if (answerMs !== null) {
        const endStart = Date.now();
        for (const customer of customers) voice.hangup(customer.callControlId);
        noteAcks(await drain());
        const result = await until(sessionIds, "ended_answered", endStart);
        endMs = result.ms;
        ended = result.reached;
      }

      // Wrong, at any level: a leg still alive after its call is over.
      const leaked = endMs === null ? 0 : voice.live().length;
      if (endMs !== null) expect(leaked, `level ${level}: legs left alive`).toBe(0);

      const refused = Object.entries(acks)
        .filter(([status]) => Number(status) >= 500)
        .reduce((sum, [, n]) => sum + n, 0);
      const phaseMissed = ringed.ms === null ? "ring" : answerMs === null ? "answer" : endMs === null ? "end" : null;
      const crossed = phaseMissed !== null || refused > 0;

      const ledger = voice.ledger();
      emitCapacityResult(
        capacityResult({
          scenario: "rig-call-burst-ramp",
          environment: "rig",
          tested_bound: {
            simultaneous_calls: level,
            crew_per_call: CREW,
            dial_batch_size: DIAL_BATCH_SIZE,
          },
          ceiling_reached: crossed,
          measurements: {
            ring_ms: ringed.ms,
            answer_ms: answerMs,
            end_ms: endMs,
            sessions_ringing: ringed.reached,
            sessions_answered: answered,
            sessions_ended: ended,
            webhook_posts: Object.values(acks).reduce((sum, n) => sum + n, 0),
            ack_statuses: acks,
            dials: ledger.dials,
            max_dials_in_one_call: maxDialsPerCall,
            peak_concurrent_legs: ledger.peakConcurrentLegs,
            legs_alive_after_end: leaked,
            phase_missed: phaseMissed,
          },
          notes: [
            "Latencies are the driver's wall clock around real HTTP to wrangler on a VM; a Worker's own clock only advances on I/O.",
            "A phase that misses its deadline is a ceiling; a wrong answerer, a leaked leg or a dial past the bound fails the suite at any level.",
          ],
        }),
      );

      if (crossed) {
        ceiling = `level ${level}: ${phaseMissed ? `${phaseMissed} phase missed ${PHASE_DEADLINE_MS} ms` : `${refused} 5xx acks`}`;
        // Leave nothing ringing for the next test or the cleanup.
        for (const leg of voice.live()) voice.hangup(leg.callControlId);
        await drain();
        break;
      }
    }

    console.log(ceiling ? `CEILING ${ceiling}` : `no ceiling to ${LEVELS.at(-1)} simultaneous calls`);
  });
});
