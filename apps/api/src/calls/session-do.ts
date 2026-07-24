/**
 * Calls v3 (#170, docs/CALLS-V3.md) — CallSessionDO: the single Durable Object
 * per inbound call session that OWNS the state machine. Every webhook event,
 * ring-me, answer claim, transfer intent, and the ring-window alarm run here,
 * serialized by the §4.1 explicit per-object FIFO, so the founder's ledger
 * races are impossible by construction.
 *
 * The shell owns exactly {queue, journal, effect execution, 4xx-cause
 * discrimination, alarm multiplexing, adoption, forgery gates}; the PURE
 * reducer (transitions.ts) owns the state logic; the runtime (runtime.ts) owns
 * the I/O. This file wires them.
 *
 * §17.3 admission-promise plumbing: onTelnyxEvent resolves the webhook caller's
 * promise at the step-1 atomic persist (admission) while the FIFO slot stays
 * occupied through effect execution — an event admitted during another
 * transition's effect phase observes the COMPLETED state (pinned by a shell
 * test). §4.1 Fact-1: the FIFO is REQUIRED because input gates do NOT serialize
 * across Telnyx fetches; a bare blockConcurrencyWhile would not compose with
 * the journal-resume rule.
 */
import { DurableObject } from "cloudflare:workers";

import type { Env } from "../env";
import {
  BROWSER_INBOUND_STATE,
  parseBrowserAnsweredAtMs,
  parseMemberRingState,
  VOICEMAIL_INBOUND_STATE,
} from "../messaging/inbound-ring";
import type { TelnyxEvent } from "../messaging/types";
import {
  parseOutboundPlacerState,
  parseOutboundSessionId,
} from "../messaging/voice-webhook";

import { createSessionRuntime, type AdoptionRow, type SessionRuntime } from "./runtime";
import {
  type AlarmKind,
  type CallState,
  type DeclineReply,
  type Effect,
  JANITOR_MS,
  JOURNAL_RESUME_MS,
  MAX_TELNYX_COMMANDS_PER_SESSION,
  PURGE_DELAY_MS,
  QUEUE_LATENCY_WARN_MS,
  RING_WINDOW_SECS,
  reduce,
  type RingMeReply,
  type SessionEvent,
  type SessionMachine,
} from "./transitions";

/** The freshest machine view the /state route serves (read-your-writes). */
export interface SessionSnapshot {
  state: CallState;
  /** #211: inbound | outbound (additive — the /state route reads direction from
   *  the row, but the snapshot carries it too for a read-your-writes consumer). */
  direction: "inbound" | "outbound";
  answered_by_user_id: string | null;
  answered_at: string | null;
  started_at: string;
  caller_e164: string | null;
  phone_number_id: string | null;
  legs: { call_control_id: string; user_id: string; status: string }[];
}

/** Journal head (the transition currently mid-flight). effects===null marks
 *  "not yet reduced" so a crash-resume never re-applies the reducer's machine
 *  mutation — it continues executing effects from `cursor`. */
interface JournalHead {
  event: SessionEvent;
  effects: Effect[] | null;
  cursor: number;
}

/** §4.1 journal: covers the WHOLE cascade from one admitted external event —
 *  the head plus the internal-event follow-ups (`rest`) its effect outcomes
 *  spawn (answer-outcome, dial-outcome, push-fanout-settled, …). Cleared only
 *  when the cascade fully drains. */
interface Journal {
  eventId: string | null;
  head: JournalHead | null;
  rest: SessionEvent[];
}

/** A mirror write that failed and must retry until it lands (§2.2). */
interface PendingMirror {
  set: {
    state?: CallState;
    answered_by_user_id?: string | null;
    answered_at?: string | null;
  };
  attempts: number;
}

const SEEN_CAP = 256;
const MAX_MIRROR_ATTEMPTS = 12;
const MIRROR_RETRY_MS = 3_000;

/** Minimal Telnyx payload surface the DO parses. */
interface CallPayload {
  call_control_id?: string;
  call_session_id?: string;
  client_state?: string | null;
  direction?: string;
  to?: string;
  from?: string;
  hangup_cause?: string | null;
  call_screening_result?: string;
  shaken_stir_attestation?: string;
  caller_id_name?: string;
  /** #213: custom SIP headers on the leg — plumbed to
   *  loadOutboundInitiatedContext's X-RTC defense guard. */
  custom_headers?: { name?: string; value?: string }[] | null;
}

/** Read a Telnyx event's payload as the inbound-call surface the DO parses. */
function callPayload(event: TelnyxEvent): CallPayload | undefined {
  return event.data?.payload as unknown as CallPayload | undefined;
}

/** Alarm bucket keys — the reducer's AlarmKind plus the two shell-owned ones. */
type AlarmSlot = AlarmKind | "journal-resume" | "mirror-retry";

export class CallSessionDO extends DurableObject<Env> {
  private queue: Promise<unknown> = Promise.resolve();
  private _runtime: SessionRuntime | undefined;

  /** Test seam: inject a fake runtime (no Telnyx / no PostgREST). */
  installRuntime(runtime: SessionRuntime): void {
    this._runtime = runtime;
  }

  private get rt(): SessionRuntime {
    return (this._runtime ??= createSessionRuntime(this.env));
  }

  // ---- §4.1 FIFO: every entrypoint enqueues its ENTIRE body ---------------
  //
  // `this.queue = this.queue.then(run)` with error isolation. A transition runs
  // to completion before the next event is admitted. The returned promise is
  // the caller's; the chain's own link swallows the error so one failure never
  // wedges the whole object (each caller still sees its own rejection).
  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  // ---- RPC surface (§7.1) -------------------------------------------------

  /**
   * §7.2 dispatch: the edge AWAITS this in the request path, then stamps
   * processed_at and ACKs. Returns whether processed_at should be stamped —
   * false ONLY for a no-row inbound call.hangup (§7.5.1), so the sweeper can
   * replay it against a machine a delayed call.initiated retry mints later.
   */
  async onTelnyxEvent(event: TelnyxEvent): Promise<boolean> {
    const enqueuedAt = Date.now();
    return this.enqueue(async () => {
      const waited = Date.now() - enqueuedAt;
      if (waited > QUEUE_LATENCY_WARN_MS) {
        // §17.5 LOAD-BEARING telemetry: the drift alarm for the webhook-ack
        // budget (worst-case ~3-4s behind a 24-target dial).
        this.rt.sentryWarn(
          `calls-v3 FIFO admission wait ${waited}ms exceeds ${QUEUE_LATENCY_WARN_MS}ms ` +
            `for ${event.data?.event_type} — webhook-ack budget drift`,
        );
      }
      await this.resumeJournalIfAny();
      const parsed = await this.parseTelnyxEvent(event);
      if (parsed === "drop-no-stamp") return false;
      if (parsed === "dedup" || parsed === null) return true;
      await this.admitAndDrain(parsed.event, event.data?.id ?? null);
      return true;
    });
  }

  async ringMe(input: {
    sessionId: string;
    userId: string;
    sipUsername: string;
    noLocalLeg: boolean;
  }): Promise<RingMeReply> {
    return this.enqueue(async () => {
      await this.rememberSessionId(input.sessionId);
      await this.resumeJournalIfAny();
      const machine = await this.load();
      if (!machine) {
        // Adoption for an RPC hitting an empty DO: reconstruct from the row.
        const adopted = await this.adoptFromRow();
        if (!adopted) {
          return { rang: false, state: "ended_missed" as CallState, reason: "not_ringing" };
        }
      }
      const reply = await this.admitAndDrain(
        { type: "ring-me", userId: input.userId, sipUsername: input.sipUsername, noLocalLeg: input.noLocalLeg },
        null,
      );
      const r = reply as RingMeReply | undefined;
      if (!r) {
        const m = await this.load();
        return { rang: false, state: (m?.state ?? "ended_missed") as CallState, reason: "not_ringing" };
      }
      // The dial's success is only known after the telnyx-dial effect ran; the
      // reducer returned rang:true optimistically. A SUCCESSFUL dial re-keys the
      // pending leg to `leg:{ccid}` (so it is no longer found by pendingKey); a
      // FAILED dial leaves the pending record present with status dead/ambiguous
      // and ccid null. Downgrade only in the latter case.
      if (r.rang && r.pendingKey) {
        const m = await this.load();
        const stillPending = m?.legs.find((entry) => entry.key === r.pendingKey);
        if (stillPending && (stillPending.ccid === null || stillPending.status === "dead")) {
          return { rang: false, state: (m?.state ?? "ringing") as CallState, reason: "dial_failed" };
        }
      }
      return { rang: r.rang, state: r.state, reason: r.reason };
    });
  }

  /**
   * #171 POST /v1/calls/live/:session/decline — a member explicitly declines
   * the ring. Routes into the reducer's DECLINE transition: cancel this
   * member's ring legs, drop them from the avenue/audience set, re-run the T3
   * ladder (single-member → voicemail; multi → others keep ringing). Always
   * resolves — `declined:true` for a live (ringing) session, `declined:false`
   * (idempotent no-op) for an already-resolved/ended one. Never a state-based
   * error: the route always returns 200 with this body.
   */
  async decline(input: {
    sessionId: string;
    userId: string;
  }): Promise<DeclineReply> {
    return this.enqueue(async () => {
      await this.rememberSessionId(input.sessionId);
      await this.resumeJournalIfAny();
      const machine = await this.load();
      if (!machine) {
        // Empty DO: adopt from the row (a purged/ended session reconstructs as
        // its terminal state → the reducer no-ops declined:false).
        const adopted = await this.adoptFromRow();
        if (!adopted) {
          return {
            declined: false,
            state: "ended_missed" as CallState,
            reason: "not_ringing",
          };
        }
      }
      const reply = await this.admitAndDrain(
        { type: "decline", userId: input.userId },
        null,
      );
      const r = reply as DeclineReply | undefined;
      if (!r) {
        const m = await this.load();
        return {
          declined: false,
          state: (m?.state ?? "ended_missed") as CallState,
          reason: "not_ringing",
        };
      }
      return { declined: r.declined, state: r.state, reason: r.reason };
    });
  }

  async snapshot(sessionId?: string): Promise<SessionSnapshot | null> {
    return this.enqueue(async () => {
      if (sessionId) await this.rememberSessionId(sessionId);
      await this.resumeJournalIfAny();
      const machine = await this.load();
      if (!machine) return null;
      return {
        state: machine.state,
        direction: machine.direction,
        answered_by_user_id: machine.answeredByUserId,
        answered_at: machine.answeredAtIso,
        started_at: new Date(machine.startedAtMs).toISOString(),
        caller_e164: machine.callerE164,
        phone_number_id: machine.phoneNumberId,
        legs: machine.legs
          .filter((leg) => leg.ccid !== null)
          .map((leg) => ({
            call_control_id: leg.ccid as string,
            user_id: leg.userId,
            status: leg.status,
          })),
      };
    });
  }

  async setOwner(input: { sessionId?: string; userId: string }): Promise<void> {
    await this.enqueue(async () => {
      if (input.sessionId) await this.rememberSessionId(input.sessionId);
      await this.resumeJournalIfAny();
      if (!(await this.load())) return;
      await this.admitAndDrain({ type: "set-owner", userId: input.userId }, null);
    });
  }

  async registerIntent(input: {
    sessionId?: string;
    kind: "transfer" | "consult";
    targetUserId: string;
  }): Promise<{ state: CallState }> {
    return this.enqueue(async () => {
      if (input.sessionId) await this.rememberSessionId(input.sessionId);
      await this.resumeJournalIfAny();
      const machine = await this.load();
      if (!machine) return { state: "ended_missed" as CallState };
      await this.admitAndDrain(
        { type: "register-intent", kind: input.kind, targetUserId: input.targetUserId },
        null,
      );
      const after = await this.load();
      return { state: (after?.state ?? machine.state) as CallState };
    });
  }

  async clearIntent(): Promise<void> {
    await this.enqueue(async () => {
      await this.resumeJournalIfAny();
      if (!(await this.load())) return;
      await this.admitAndDrain({ type: "clear-intent" }, null);
    });
  }

  async alarm(): Promise<void> {
    await this.enqueue(async () => {
      await this.resumeJournalIfAny();
      const now = Date.now();
      const alarms = await this.getAlarms();
      // Collect every due slot, clear it, then process — purge last.
      const due: AlarmSlot[] = [];
      for (const [slot, atMs] of Object.entries(alarms) as [AlarmSlot, number][]) {
        if (atMs <= now + 50) due.push(slot);
      }
      // Deterministic order: journal-resume, mirror-retry, fanout-settle,
      // intent-expiry, ring, janitor, purge (purge tears storage down last).
      const order: AlarmSlot[] = [
        "journal-resume",
        "mirror-retry",
        "fanout-settle",
        "intent-expiry",
        "ring",
        "janitor",
        "purge",
      ];
      due.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      for (const slot of due) {
        await this.clearAlarmSlot(slot);
        await this.fireAlarm(slot, now);
        if (slot === "purge") return; // storage gone
      }
      await this.reconcileAlarm();
    });
  }

  // ---- Alarm dispatch -----------------------------------------------------

  private async fireAlarm(slot: AlarmSlot, _now: number): Promise<void> {
    if (slot === "journal-resume") {
      // resumeJournalIfAny already ran at the top; nothing else to do.
      return;
    }
    if (slot === "mirror-retry") {
      await this.retryPendingMirror();
      return;
    }
    if (slot === "purge") {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }
    const machine = await this.load();
    if (!machine) return;
    if (slot === "fanout-settle") {
      // §5.5 backstop: the real settle never landed (mid-fanout eviction).
      // Recompute the audience and synthesize the settle so pruning + the T3
      // ladder re-check are guaranteed to run once.
      const current = await this.rt.computePushAudience(
        machine.companyId,
        machine.phoneNumberId,
      );
      const live = new Set(current);
      const unreachable = machine.pushCapableUserIds.filter((u) => !live.has(u));
      await this.admitAndDrain(
        { type: "push-fanout-settled", unreachableUserIds: unreachable },
        null,
      );
      return;
    }
    if (slot === "ring") {
      await this.admitAndDrain({ type: "alarm-ring" }, null);
      return;
    }
    if (slot === "janitor") {
      await this.admitAndDrain({ type: "alarm-janitor" }, null);
      return;
    }
    if (slot === "intent-expiry") {
      await this.admitAndDrain({ type: "alarm-intent-expiry" }, null);
      return;
    }
  }

  // ---- §4.1 admission + drain ---------------------------------------------

  /** Admit an event under the FIFO (dedup, atomic persist), then drain the
   *  whole internal-event cascade. Returns the reducer's reply for the head. */
  private async admitAndDrain(
    event: SessionEvent,
    eventId: string | null,
  ): Promise<RingMeReply | DeclineReply | { state: CallState } | undefined> {
    if (eventId && (await this.isSeen(eventId))) {
      // Seen-marked with no unfinished journal → true duplicate no-op.
      return undefined;
    }
    const journal: Journal = {
      eventId,
      head: { event, effects: null, cursor: 0 },
      rest: [],
    };
    if (eventId) await this.markSeen(eventId);
    await this.putJournal(journal);
    await this.setAlarmSlot("journal-resume", Date.now() + JOURNAL_RESUME_MS);
    return this.drain(journal);
  }

  /** Resume an unfinished journal left by a crash/eviction (§4.1 step 2). */
  private async resumeJournalIfAny(): Promise<void> {
    const journal = await this.getJournal();
    if (!journal || !journal.head) return;
    await this.drain(journal);
  }

  private async drain(
    journal: Journal,
  ): Promise<RingMeReply | DeclineReply | { state: CallState } | undefined> {
    let headReply: RingMeReply | DeclineReply | { state: CallState } | undefined;
    let first = true;
    while (journal.head) {
      const head = journal.head;
      if (head.effects === null) {
        const machine = await this.load();
        const result = reduce(machine, head.event, Date.now(), () => this.rt.uuid());
        if (result.machine) {
          await this.save(result.machine);
        } else if (machine) {
          // reducer returned null machine (should not happen mid-session) —
          // keep the prior machine.
        }
        head.effects = result.effects;
        head.cursor = 0;
        if (first) headReply = result.reply;
        await this.putJournal(journal);
      }
      while (head.cursor < head.effects.length) {
        const effect = head.effects[head.cursor];
        const followUps = await this.execute(effect);
        head.cursor += 1;
        for (const followUp of followUps) journal.rest.push(followUp);
        await this.putJournal(journal);
      }
      const nextEvent = journal.rest.shift();
      journal.head = nextEvent ? { event: nextEvent, effects: null, cursor: 0 } : null;
      first = false;
      await this.putJournal(journal);
    }
    await this.clearJournal();
    await this.clearAlarmSlot("journal-resume");
    await this.reconcileAlarm();
    return headReply;
  }

  // ---- Effect execution (§7.3 + §4.1 discrimination) ----------------------
  //
  // Returns any internal follow-up SessionEvents whose OUTCOMES must re-enter
  // the reducer (answer/vm-answer/dial outcomes, probe, settle).
  private async execute(effect: Effect): Promise<SessionEvent[]> {
    const machine = await this.load();
    switch (effect.kind) {
      case "mirror": {
        if (!machine) return [];
        await this.doMirror(machine.callSessionId, effect.set, effect.terminal);
        return [];
      }
      case "telnyx-dial": {
        if (!machine) return [];
        // Each leg dials with per-target try/catch and re-enters as a
        // dial-outcome. A leg record already exists (persisted before this).
        const followUps: SessionEvent[] = [];
        for (const leg of effect.legs) {
          if (!this.spendCommand(machine, false)) {
            followUps.push({ type: "dial-outcome", pendingKey: leg.pendingKey, ccid: null, failure: "known-dead" });
            continue;
          }
          const clientState = this.rt.buildClientStates.memberRing({
            sessionId: machine.callSessionId,
            userId: leg.userId,
            caller: machine.callerE164,
            inboundCcid: machine.customerCcid ?? "",
          });
          const result = await this.rt.telnyx.dial({
            sipTarget: leg.sipTarget,
            fromE164: machine.businessNumberE164 ?? "",
            clientState,
            // CALLS-CLIENT-V2 §3.2: the same S built into clientState above,
            // stamped as the X-Loonext-Session custom SIP header on the dial.
            sessionId: machine.callSessionId,
            // #212: the real caller rides X-Loonext-Caller so the member's
            // ring shows who is calling, not our own business number (from).
            caller: machine.callerE164,
          });
          if ("ccid" in result) {
            await this.rt.ledgerInsert({
              sessionId: machine.callSessionId,
              ccid: result.ccid,
              companyId: machine.companyId,
              userId: leg.userId,
            });
            followUps.push({ type: "dial-outcome", pendingKey: leg.pendingKey, ccid: result.ccid, failure: null });
          } else {
            followUps.push({ type: "dial-outcome", pendingKey: leg.pendingKey, ccid: null, failure: result.failure });
          }
        }
        await this.save(machine);
        return followUps;
      }
      case "telnyx-dial-placer": {
        // #213: dial the PLACER's own SIP credential as the `op` leg. Same dial
        // primitive as a member ring, but with the op client_state + the customer
        // as X-Loonext-Caller (so the placer's browser shows who it's calling, not
        // our own number) + X-Loonext-Session=S (so the browser correlates the
        // INVITE to its pending placement and AUTO-answers). Re-enters as a
        // dial-outcome that re-keys the pending op leg (or resolves the call on a
        // known-dead placer dial).
        if (!machine) return [];
        if (!this.spendCommand(machine, false)) {
          return [{ type: "dial-outcome", pendingKey: effect.pendingKey, ccid: null, failure: "known-dead" }];
        }
        const clientState = this.rt.buildClientStates.outboundPlacer(
          machine.callSessionId,
          effect.userId,
        );
        const result = await this.rt.telnyx.dial({
          sipTarget: effect.sipTarget,
          fromE164: machine.businessNumberE164 ?? "",
          clientState,
          sessionId: machine.callSessionId,
          // The placer is calling the CUSTOMER (machine.callerE164 holds the
          // customer number for an outbound call), so show them the customer.
          caller: machine.callerE164,
        });
        if ("ccid" in result) {
          await this.rt.ledgerInsert({
            sessionId: machine.callSessionId,
            ccid: result.ccid,
            companyId: machine.companyId,
            userId: effect.userId,
          });
          await this.save(machine);
          return [{ type: "dial-outcome", pendingKey: effect.pendingKey, ccid: result.ccid, failure: null }];
        }
        await this.save(machine);
        return [{ type: "dial-outcome", pendingKey: effect.pendingKey, ccid: null, failure: result.failure }];
      }
      case "telnyx-answer-inbound": {
        if (!machine || !effect.ccid) return [];
        if (!this.spendCommand(machine, true)) return [];
        const clientState = this.rt.buildClientStates.briAnswered(
          machine.callerE164,
          effect.answerIntent.answeredAtIso,
        );
        const outcome = await this.rt.telnyx.answerInbound(effect.ccid, clientState);
        await this.save(machine);
        return [
          {
            type: "answer-outcome",
            ok: outcome === "ok",
            memberCcid: effect.answerIntent.memberCcid,
            userId: effect.answerIntent.userId,
            answeredAtIso: effect.answerIntent.answeredAtIso,
          },
        ];
      }
      case "telnyx-answer-vm": {
        if (!machine || !effect.ccid) return [];
        // Terminal-path exemption class (§13): never dropped at the cap.
        this.spendCommand(machine, true);
        const clientState = this.rt.buildClientStates.vmi(machine.callerE164);
        const outcome = await this.rt.telnyx.answerVm(effect.ccid, clientState);
        await this.save(machine);
        return [{ type: "vm-answer-outcome", ok: outcome === "ok" }];
      }
      case "telnyx-bridge": {
        if (!machine) return [];
        if (!this.spendCommand(machine, true)) return [];
        const outcome = await this.rt.telnyx.bridge(effect.memberCcid, effect.customerCcid);
        await this.save(machine);
        if (outcome === "dead") {
          // Genuinely dead: hang up both legs; the bri hangup runs T8/T17.
          await this.rt.telnyx.hangup(effect.memberCcid);
          await this.rt.telnyx.hangup(effect.customerCcid);
        }
        return [];
      }
      case "telnyx-hangup": {
        // Terminal-path hangups never drop; non-terminal cancels obey the cap.
        if (machine && !this.spendCommand(machine, effect.terminal)) return [];
        const outcome = await this.rt.telnyx.hangup(effect.ccid);
        if (machine) await this.save(machine);
        if (
          outcome === "dead" &&
          effect.terminal &&
          machine &&
          effect.ccid === machine.customerCcid
        ) {
          // #208 F4: a TERMINAL hangup of the CUSTOMER leg discriminated
          // "dead": the leg was already gone, so the bri hangup webhook that
          // runs T8 may never arrive. Re-enter the reducer so it synthesizes
          // the terminal instead of stranding the row outcome-null for the 4h
          // janitor window (the busy-line wedge class; see the terminal
          // handler NOTE in messaging/voice-webhook.ts).
          return [{ type: "inbound-leg-gone" }];
        }
        return [];
      }
      case "telnyx-reject": {
        if (machine) this.spendCommand(machine, true);
        await this.rt.telnyx.reject(effect.ccid, effect.cause);
        if (machine) await this.save(machine);
        return [];
      }
      case "telnyx-speak": {
        if (!machine) return [];
        this.spendCommand(machine, true); // voicemail speak is terminal-path
        const greeting = this.rt.greetingText(machine);
        const clientState = this.rt.buildClientStates.vmi(machine.callerE164);
        await this.rt.telnyx.speak(effect.ccid, greeting, clientState);
        await this.save(machine);
        return [];
      }
      case "telnyx-record-start": {
        if (machine) this.spendCommand(machine, true);
        await this.rt.telnyx.recordStart(effect.ccid);
        if (machine) await this.save(machine);
        return [];
      }
      case "telnyx-probe-member-leg": {
        const alive = await this.rt.telnyx.probeLegAlive(effect.ccid);
        return [{ type: "member-probe-outcome", ccid: effect.ccid, userId: effect.userId, alive }];
      }
      case "push-fanout": {
        if (!machine) return [];
        const report = await this.rt.pushFanout({
          companyId: machine.companyId,
          userIds: effect.userIds,
          caller: machine.callerE164,
          sessionId: machine.callSessionId,
        });
        // The real settle landed synchronously — clear the +10s backstop alarm.
        await this.clearAlarmSlot("fanout-settle");
        return [{ type: "push-fanout-settled", unreachableUserIds: report.unreachableUserIds }];
      }
      case "push-call-end": {
        if (!machine) return [];
        await this.rt.pushCallEnd({
          companyId: machine.companyId,
          userIds: this.pushEndAudience(machine),
          sessionId: machine.callSessionId,
          reason: effect.reason,
        });
        return [];
      }
      case "thread-at-answer": {
        if (machine) await this.rt.threadAtAnswer(machine);
        return [];
      }
      case "terminal-merge": {
        if (!machine) return [];
        if (effect.mode === "event" && effect.payload) {
          // #211 M1: for outbound, the raw hangup keys on Telnyx's T, but the
          // calls row is under S — so carry S as an explicit session-id override
          // (propagates to the existence check, upsert, thread, recordCallDuration)
          // AND machine.answeredAtIso as the talk-time anchor (bills mirror-
          // independently even if the answered_at mirror never landed). Inbound
          // passes no opts → byte-identical to today.
          await this.rt.terminalMergeEvent(
            effect.payload,
            machine.direction === "outbound"
              ? {
                  outboundSessionId: machine.callSessionId,
                  outboundAnsweredAtIso: effect.briAnsweredAtIso,
                }
              : undefined,
          );
        } else {
          await this.rt.terminalMergeSynthetic(machine, effect.outcome, effect.briAnsweredAtIso);
        }
        return [];
      }
      case "voicemail-pipeline": {
        await this.rt.voicemailPipeline(effect.payload);
        return [];
      }
      case "sentry-warn": {
        this.rt.sentryWarn(effect.message);
        return [];
      }
      case "arm-alarm": {
        await this.setAlarmSlot(effect.alarm, effect.atMs);
        return [];
      }
      case "clear-alarm": {
        await this.clearAlarmSlot(effect.alarm);
        return [];
      }
      default: {
        const exhaustive: never = effect;
        void exhaustive;
        return [];
      }
    }
  }

  /** The audience for a call_end revocation push: everyone who could have been
   *  woken (dial targets + push audience) — recomputed as the union of leg
   *  users and the remaining push-capable set. */
  private pushEndAudience(machine: SessionMachine): string[] {
    const users = new Set<string>(machine.pushCapableUserIds);
    for (const leg of machine.legs) users.add(leg.userId);
    return [...users];
  }

  /** §13 command cap with the terminal-path exemption class. Returns true when
   *  the command may run. Terminal-path commands NEVER drop. */
  private spendCommand(machine: SessionMachine, terminalExempt: boolean): boolean {
    machine.telnyxCommandCount += 1;
    const cap = MAX_TELNYX_COMMANDS_PER_SESSION;
    if (terminalExempt) return true;
    if (machine.telnyxCommandCount > cap) {
      this.rt.sentryWarn(
        `calls-v3 command cap ${cap} exceeded for ${machine.callSessionId} — ` +
          `dropping non-terminal command (cap-and-drop)`,
      );
      return false;
    }
    if (machine.telnyxCommandCount === Math.floor(cap / 2)) {
      this.rt.sentryWarn(
        `calls-v3 command count at 50% of cap ${cap} for ${machine.callSessionId} (alert-before-the-cap)`,
      );
    }
    return true;
  }

  // ---- Mirror with retry-until-lands (§2.2) -------------------------------

  private async doMirror(
    sessionId: string,
    set: PendingMirror["set"],
    terminal: boolean,
  ): Promise<void> {
    try {
      await this.rt.mirror(sessionId, set);
      return;
    } catch (cause) {
      this.rt.sentryError(cause);
      // MERGE into any existing pending mirror rather than overwriting it: a
      // second failed mirror carrying DIFFERENT columns would otherwise drop the
      // first one's (e.g. answered_at), and the retry would re-apply only the
      // latest set — losing earlier state or re-applying a stale one over a
      // terminal one. Newer values win per-column; keep the accumulated attempts.
      const prev = await this.getPendingMirror();
      await this.putPendingMirror({
        set: { ...prev?.set, ...set },
        attempts: prev?.attempts ?? 1,
      });
      await this.setAlarmSlot("mirror-retry", Date.now() + MIRROR_RETRY_MS);
      // A terminal mirror must eventually land; a non-terminal one likewise
      // retries but never blocks the transition (the machine is authoritative).
      void terminal;
    }
  }

  private async retryPendingMirror(): Promise<void> {
    const pending = await this.getPendingMirror();
    if (!pending) return;
    const machine = await this.load();
    if (!machine) {
      await this.clearPendingMirror();
      return;
    }
    try {
      await this.rt.mirror(machine.callSessionId, pending.set);
      await this.clearPendingMirror();
    } catch (cause) {
      this.rt.sentryError(cause);
      pending.attempts += 1;
      if (pending.attempts >= MAX_MIRROR_ATTEMPTS) {
        this.rt.sentryWarn(
          `calls-v3 mirror gave up after ${pending.attempts} attempts for ` +
            `${machine.callSessionId} — call may be missing from the log`,
        );
        await this.clearPendingMirror();
        return;
      }
      await this.putPendingMirror(pending);
      await this.setAlarmSlot("mirror-retry", Date.now() + MIRROR_RETRY_MS);
    }
  }

  // ---- Telnyx event parsing + adoption (§7.2 / §7.5) ----------------------

  /** Returns the parsed reducer event, "dedup" for a seen event, or null to
   *  drop. Runs adoption for a non-initiated event hitting an empty DO. */
  private async parseTelnyxEvent(
    raw: TelnyxEvent,
  ): Promise<{ event: SessionEvent } | "dedup" | "drop-no-stamp" | null> {
    const eventType = raw.data?.event_type;
    const payload = callPayload(raw);
    const eventId = raw.data?.id;
    if (!eventType || !payload) return null;
    if (eventId && (await this.isSeen(eventId)) && !(await this.hasUnfinishedJournalFor(eventId))) {
      return "dedup";
    }

    const memberState = parseMemberRingState(payload.client_state);
    // #211: the server session id S carried in a 4-part oc tag's part-4 (a valid
    // UUID), or null. Present for EVERY oc lifecycle event (initiated/answered/
    // hangup); it is the id THIS DO is keyed on (part-4 == S == idFromName), NOT
    // payload.call_session_id (Telnyx's T, which differs for outbound).
    const outboundSession = parseOutboundSessionId(payload.client_state);
    // #213: the placer (op) leg carries `op|S|userId`; S (part-2, a valid UUID)
    // is the id THIS DO is keyed on. Present for op answered/hangup (its
    // initiated is a no-op — the DO dialed it and stamps its ccid via dial-outcome).
    const placerState = parseOutboundPlacerState(payload.client_state);

    if (eventType === "call.initiated") {
      // #213: the placer (op) leg's own call.initiated is a no-op — the DO
      // server-dialed it and stamps its ccid from the dial response (dial-outcome);
      // the webhook is redundant and must NOT fall through to the inbound
      // loadInitiatedContext (its `to` is a sip: URI, direction outgoing).
      if (placerState) return null;
      // #211 T-O1: a 4-part oc call.initiated (SERVER-dialed outbound customer
      // leg, part-4 = a well-formed UUID = S) mints an OUTBOUND machine. The router
      // only routes it here when part-4 is a valid UUID; loadOutboundInitiatedContext
      // is the authority (nonce consume + tag-part-4==nonce-bound-S check) and
      // rejects-without-minting on any mismatch (S1/M3).
      if (outboundSession) {
        const ctx = await this.rt.loadOutboundInitiatedContext({
          call_control_id: payload.call_control_id ?? "",
          call_session_id: payload.call_session_id ?? "",
          client_state: payload.client_state ?? null,
          to: payload.to ?? "",
          from: payload.from,
          custom_headers: payload.custom_headers ?? null,
        });
        if (ctx === "drop") return null;
        if (ctx === "reject") {
          // Terminal-exempt: hang up the unauthorized / forged-part-4 / non-NANP
          // / over-cap / line-busy leg and mint NOTHING. There is no machine, so
          // nothing to journal; the leg is a live PSTN channel we must not leave
          // ringing (the legacy telnyxRejectLeg posture).
          if (payload.call_control_id) {
            await this.rt.telnyx.hangup(payload.call_control_id);
          }
          return null;
        }
        return { event: { type: "outbound-initiated", context: ctx } };
      }

      // T0: a tagged initiated (our own leg family / forgery) or an unowned
      // number is dropped by loadInitiatedContext.
      if (memberState || (payload.client_state && payload.direction === "incoming")) {
        return null;
      }
      const context = await this.rt.loadInitiatedContext({
        call_control_id: payload.call_control_id ?? "",
        call_session_id: payload.call_session_id ?? "",
        to: payload.to ?? "",
        from: payload.from,
        call_screening_result: payload.call_screening_result,
        shaken_stir_attestation: payload.shaken_stir_attestation,
        caller_id_name: payload.caller_id_name,
      });
      if (context === "drop" || context === "replay-ended") return null;
      return { event: { type: "initiated", context } };
    }

    // Learn the session id this object is keyed on: brm legs carry it in the
    // tag (S); a 4-part oc leg carries it as part-4 (S); an op placer leg carries
    // it as part-2 (S); every other inbound leg in payload.call_session_id. For
    // an oc/op leg, the tag's S is authoritative — NEVER payload.call_session_id
    // (Telnyx's T, which differs for a server-dialed outbound leg).
    const sessionId =
      memberState?.sessionId ??
      outboundSession ??
      placerState?.sessionId ??
      payload.call_session_id;
    if (sessionId) await this.rememberSessionId(sessionId);

    // Every non-initiated event needs a machine — adopt if the DO is empty.
    let machine = await this.load();
    if (!machine) {
      machine = await this.adoptFromRow(raw);
      if (!machine) {
        // §7.5.1: a no-row inbound (or oc) call.hangup returns WITHOUT stamping
        // so the sweeper can replay it against a machine a delayed initiated
        // retry mints minutes later; every other no-row drop stamps as today.
        if (eventType === "call.hangup") return "drop-no-stamp";
        return null; // forged / unknown → drop
      }
    }

    // #211 T-O2 / T-O3: the outbound customer (oc) leg's answered / hangup route
    // to the outbound machine (keyed on S). call.initiated was handled above; a
    // stray oc lifecycle event (e.g. bridging) is an acked no-op.
    if (outboundSession) {
      if (eventType === "call.answered") {
        return { event: { type: "outbound-answered" } };
      }
      if (eventType === "call.hangup") {
        return {
          event: {
            type: "outbound-hangup",
            payload: payload as Record<string, unknown>,
          },
        };
      }
      return null;
    }

    // #213 T-O4 / T-O5: the placer (op) leg's answered / hangup route to the
    // outbound machine (keyed on S = the op tag's part-2). answered → bridge
    // op↔oc; hangup → owner-death teardown (or expected post-transfer). Its
    // initiated was a no-op above.
    if (placerState && payload.call_control_id) {
      if (eventType === "call.answered") {
        return {
          event: {
            type: "outbound-placer-answered",
            ccid: payload.call_control_id,
            userId: placerState.userId,
            destination: payload.to ?? null,
          },
        };
      }
      if (eventType === "call.hangup") {
        return {
          event: {
            type: "outbound-placer-hangup",
            ccid: payload.call_control_id,
            userId: placerState.userId,
          },
        };
      }
      return null;
    }

    if (memberState && payload.call_control_id) {
      const destination = payload.to ?? null;
      if (eventType === "call.answered") {
        return {
          event: {
            type: "member-leg-answered",
            ccid: payload.call_control_id,
            userId: memberState.userId,
            destination,
          },
        };
      }
      if (eventType === "call.hangup") {
        return {
          event: {
            type: "member-leg-hangup",
            ccid: payload.call_control_id,
            userId: memberState.userId,
            destination,
          },
        };
      }
      return null;
    }

    // vmi voicemail pipeline legs.
    if (eventType === "call.speak.ended") {
      return { event: { type: "speak-ended" } };
    }
    if (eventType === "call.recording.saved") {
      return { event: { type: "recording-saved", payload: payload as Record<string, unknown> } };
    }

    if (eventType === "call.hangup") {
      const tag = this.classifyInboundTag(payload.client_state);
      const briAnsweredAtMs = parseBrowserAnsweredAtMs(payload.client_state);
      return {
        event: {
          type: "inbound-hangup",
          tag,
          briAnsweredAtIso:
            briAnsweredAtMs !== null ? new Date(briAnsweredAtMs).toISOString() : null,
          payload: payload as Record<string, unknown>,
        },
      };
    }

    return null; // other lifecycle events → acked no-op
  }

  private classifyInboundTag(
    clientState: string | null | undefined,
  ): "untagged" | "bri" | "vmi" {
    if (!clientState) return "untagged";
    let decoded: string;
    try {
      decoded = atob(clientState);
    } catch {
      return "untagged";
    }
    const tag = decoded.split("|")[0];
    if (tag === BROWSER_INBOUND_STATE) return "bri";
    if (tag === VOICEMAIL_INBOUND_STATE) return "vmi";
    return "untagged";
  }

  /** §7.5 adoption: reconstruct a machine from the calls row for an empty DO. */
  private async adoptFromRow(raw?: TelnyxEvent): Promise<SessionMachine | null> {
    const sessionId = await this.sessionIdHint();
    if (!sessionId) return null;
    const row = await this.rt.loadAdoptionRow(sessionId);
    if (!row) return null;
    const machine = this.reconstructMachine(row, raw);
    await this.save(machine);
    return machine;
  }

  private reconstructMachine(
    row: AdoptionRow,
    raw?: TelnyxEvent,
  ): SessionMachine {
    const eventType = raw?.data?.event_type;
    const clientState = callPayload(raw ?? ({} as TelnyxEvent))?.client_state;
    const tag = this.classifyInboundTag(clientState);

    let state: CallState;
    if (row.direction === "outbound") {
      // #211 D15: an outbound row reconstructs EXPLICITLY — never the inbound
      // default below that would arm a false 45s ring deadline and mis-evaluate
      // decline/ring-me gates. outcome -> ended_*; answered_at -> 'answered';
      // else 'dialing'. loadAdoptionRow's kind='ring' leg read is empty for
      // outbound, so there are no legs and no ringDeadline (set below).
      state = row.outcome
        ? row.outcome === "answered"
          ? "ended_answered"
          : row.outcome === "voicemail"
            ? "ended_voicemail"
            : "ended_missed"
        : row.answeredAt
          ? "answered"
          : "dialing";
    } else if (row.outcome) {
      // §7.5.2: reconstruct the terminal state.
      state =
        row.outcome === "answered"
          ? "ended_answered"
          : row.outcome === "voicemail"
            ? "ended_voicemail"
            : "ended_missed";
    } else if (
      eventType === "call.speak.ended" ||
      eventType === "call.recording.saved" ||
      (eventType === "call.hangup" && tag === "vmi")
    ) {
      // §7.5.3: an in-flight legacy voicemail — the event proves it.
      state = eventType === "call.speak.ended" ? "voicemail_greeting" : "voicemail_recording";
    } else if (eventType === "call.hangup" && tag === "bri" && !row.answeredAt) {
      state = "ringing"; // T17 will resolve it via the bri tag
    } else if (row.answeredAt) {
      state = "answered";
    } else {
      state = "ringing";
    }

    const machine: SessionMachine = {
      state,
      callSessionId: row.callSessionId,
      companyId: row.companyId,
      phoneNumberId: row.phoneNumberId,
      companyName: row.companyName,
      greeting: row.greeting,
      callerE164: row.callerE164,
      businessNumberE164: row.businessNumberE164,
      customerCcid: row.customerCallControlId,
      direction: row.direction === "outbound" ? "outbound" : "inbound",
      startedAtMs: row.startedAtMs,
      answeredByUserId: row.answeredByUserId,
      answeredAtIso: row.answeredAt,
      rejectedForCap: false,
      unattended: false,
      wakeAttempted: false,
      ownerLegDeadDuringIntent: null,
      adopted: true, // §7.5.4: scopes §7.7 ledger-less minting to cutover
      pushCapableUserIds: [],
      declinedUserIds: [],
      ringDeadlineMs: state === "ringing" ? row.startedAtMs + RING_WINDOW_SECS * 1_000 : null,
      telnyxCommandCount: 0,
      legs: row.ledgerLegs.map((leg) => ({
        key: `leg:${leg.ccid}`,
        ccid: leg.ccid,
        userId: leg.userId,
        status: leg.state === "answered" ? "answered" : leg.state === "ringing" ? "ringing" : "dead",
        source: "engine" as const,
        dialedAtMs: row.startedAtMs,
        sipTarget: "",
      })),
      intent: null,
      answerIntent: null,
    };
    return machine;
  }

  private hintedSessionId: string | null = null;

  /** The session id this object is keyed on. In production the id derives from
   *  idFromName(sessionId); we stash it from the first event/RPC that carries
   *  it, falling back to storage. */
  private async sessionIdHint(): Promise<string | null> {
    if (this.hintedSessionId) return this.hintedSessionId;
    const stored = await this.ctx.storage.get<string>("sessionId");
    return stored ?? null;
  }

  private async rememberSessionId(sessionId: string): Promise<void> {
    if (this.hintedSessionId === sessionId) return;
    this.hintedSessionId = sessionId;
    await this.ctx.storage.put("sessionId", sessionId);
  }

  // ---- Storage helpers ----------------------------------------------------

  private cachedMachine: SessionMachine | null | undefined;

  private async load(): Promise<SessionMachine | null> {
    if (this.cachedMachine !== undefined) return this.cachedMachine;
    const machine = (await this.ctx.storage.get<SessionMachine>("machine")) ?? null;
    if (machine) {
      // #211 in-flight deploy compat: a machine persisted BEFORE the
      // inboundCcid->customerCcid rename (D6) has no `customerCcid`, and any
      // pre-#211 machine has no `direction`. Alias both on load so a call
      // spanning the deploy keeps working; the next save() writes the new keys.
      const legacy = machine as Partial<SessionMachine> & {
        inboundCcid?: string | null;
      };
      if (legacy.customerCcid === undefined) {
        machine.customerCcid = legacy.inboundCcid ?? null;
      }
      if (legacy.direction === undefined) {
        machine.direction = "inbound";
      }
    }
    this.cachedMachine = machine;
    return machine;
  }

  private async save(machine: SessionMachine): Promise<void> {
    this.cachedMachine = machine;
    await this.ctx.storage.put("machine", machine);
    await this.rememberSessionId(machine.callSessionId);
  }

  private async getJournal(): Promise<Journal | null> {
    return (await this.ctx.storage.get<Journal>("journal")) ?? null;
  }

  private async putJournal(journal: Journal): Promise<void> {
    await this.ctx.storage.put("journal", journal);
  }

  private async clearJournal(): Promise<void> {
    await this.ctx.storage.delete("journal");
  }

  private async hasUnfinishedJournalFor(eventId: string): Promise<boolean> {
    const journal = await this.getJournal();
    return Boolean(journal && journal.head && journal.eventId === eventId);
  }

  private async isSeen(eventId: string): Promise<boolean> {
    const seen = (await this.ctx.storage.get<string[]>("seen")) ?? [];
    return seen.includes(eventId);
  }

  private async markSeen(eventId: string): Promise<void> {
    let seen = (await this.ctx.storage.get<string[]>("seen")) ?? [];
    if (seen.includes(eventId)) return;
    seen.push(eventId);
    if (seen.length > SEEN_CAP) seen = seen.slice(seen.length - SEEN_CAP);
    await this.ctx.storage.put("seen", seen);
  }

  private async getPendingMirror(): Promise<PendingMirror | null> {
    return (await this.ctx.storage.get<PendingMirror>("pendingMirror")) ?? null;
  }

  private async putPendingMirror(pending: PendingMirror): Promise<void> {
    await this.ctx.storage.put("pendingMirror", pending);
  }

  private async clearPendingMirror(): Promise<void> {
    await this.ctx.storage.delete("pendingMirror");
  }

  // ---- Alarm multiplexing (one platform alarm, many logical deadlines) ----

  private async getAlarms(): Promise<Partial<Record<AlarmSlot, number>>> {
    return (await this.ctx.storage.get<Partial<Record<AlarmSlot, number>>>("alarms")) ?? {};
  }

  private async setAlarmSlot(slot: AlarmSlot, atMs: number): Promise<void> {
    const alarms = await this.getAlarms();
    alarms[slot] = atMs;
    await this.ctx.storage.put("alarms", alarms);
    await this.reconcileAlarm(alarms);
  }

  private async clearAlarmSlot(slot: AlarmSlot): Promise<void> {
    const alarms = await this.getAlarms();
    if (!(slot in alarms)) return;
    delete alarms[slot];
    await this.ctx.storage.put("alarms", alarms);
    await this.reconcileAlarm(alarms);
  }

  /** Set the single platform alarm to the nearest logical deadline. */
  private async reconcileAlarm(
    alarms?: Partial<Record<AlarmSlot, number>>,
  ): Promise<void> {
    const map = alarms ?? (await this.getAlarms());
    const deadlines = Object.values(map).filter((v): v is number => typeof v === "number");
    if (deadlines.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const soonest = Math.min(...deadlines);
    await this.ctx.storage.setAlarm(soonest);
  }
}

/** Exported for the shell tests: the DO-facing constants a driver needs. */
export { JANITOR_MS, PURGE_DELAY_MS, RING_WINDOW_SECS };
