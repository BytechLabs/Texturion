/**
 * Calls v3 (#170, docs/CALLS-V3.md) — the PURE inbound-call state machine.
 *
 * `reduce(machine, event, nowMs)` is the §4 transition table as data:
 * `(state, event, context) → { machine', effects[], reply? }` with ZERO I/O.
 * Effect OUTCOMES that change state (answer success/failure, dial outcomes,
 * fan-out settled) re-enter as the internal events below under the same DO
 * FIFO (§4.1), so this module stays exhaustively unit-testable and the DO
 * shell (session-do.ts) owns exactly {queue, journal, effect execution,
 * 4xx-cause discrimination}.
 *
 * Every §4 row lives here. The three properties the tests pin forever:
 *   - T17 TOTALITY: an inbound-leg hangup — bri, vmi, or UNTAGGED — reaches a
 *     terminal state from EVERY non-terminal state (§15.1).
 *   - VM-ENTRY only under T1a, T1d zero-avenue, T10-alarm, or T3-exhaustion
 *     with zero live legs ∧ zero push-capable members (the founder invariant).
 *   - ring-me NEVER emits a hangup/cancel effect (§6, review R2-B2).
 */

/** §5: the one real ring window. The DO alarm at this deadline is the ONLY
 *  clock-based voicemail trigger. */
export const RING_WINDOW_SECS = 45;

/** §6: asserted ring-me debounce — only against a live ring_me-sourced leg. */
export const RING_ME_DEBOUNCE_MS = 4_000;

/** §13 cap-and-drop: engine fan-out + ring-me adds. */
export const MAX_LEGS_PER_SESSION = 24;

/** §13: derived, not flat — 3 × legs + 16 (= 88 at the current 24). Past it,
 *  commands drop EXCEPT the terminal-path exemption class (a session must
 *  always be able to end honestly). */
export const MAX_TELNYX_COMMANDS_PER_SESSION = 3 * MAX_LEGS_PER_SESSION + 16;

/** §4 T1d: bounded dial parallelism (batches; per-target try/catch). */
export const DIAL_BATCH_SIZE = 6;

/** §4.1: journal-resume alarm delay. */
export const JOURNAL_RESUME_MS = 2_000;

/** §5.5: fanout-settle alarm delay. */
export const FANOUT_SETTLE_MS = 10_000;

/** §13/T15: storage purge delay after a terminal state. */
export const PURGE_DELAY_MS = 15 * 60_000;

/** §4 T16: janitor forced resolution at started_at + 4h. */
export const JANITOR_MS = 4 * 60 * 60_000;

/** §7.4: intent expiry — TRANSFER_TIMEOUT_SECS (25) + 15s. */
export const INTENT_EXPIRY_MS = (25 + 15) * 1_000;

/** §17.5: FIFO admission-wait Sentry threshold (LOAD-BEARING telemetry). */
export const QUEUE_LATENCY_WARN_MS = 2_000;

export type CallState =
  | "ringing"
  | "answered"
  | "voicemail_greeting"
  | "voicemail_recording"
  | "ended_answered"
  | "ended_voicemail"
  | "ended_missed"
  | "ended_rejected";

export const CALL_STATES: readonly CallState[] = [
  "ringing",
  "answered",
  "voicemail_greeting",
  "voicemail_recording",
  "ended_answered",
  "ended_voicemail",
  "ended_missed",
  "ended_rejected",
];

export const TERMINAL_STATES: readonly CallState[] = [
  "ended_answered",
  "ended_voicemail",
  "ended_missed",
  "ended_rejected",
];

export function isTerminal(state: CallState): boolean {
  return state.startsWith("ended_");
}

/** §3: the `outcome` column mirror of each terminal state. */
export function outcomeForState(
  state: CallState,
): "answered" | "voicemail" | "missed" | null {
  switch (state) {
    case "ended_answered":
      return "answered";
    case "ended_voicemail":
      return "voicemail";
    case "ended_missed":
    case "ended_rejected":
      return "missed";
    default:
      return null;
  }
}

export type LegStatus =
  | "dialing"
  | "ringing"
  | "canceling"
  | "answered"
  | "dead"
  | "ambiguous";

const LIVE_LEG_STATUSES: readonly LegStatus[] = [
  "dialing",
  "ringing",
  "canceling",
];

export interface LegRecord {
  /** Storage key: `leg:pending:{uuid}` before the dial POST returns, re-keyed
   *  to `leg:{ccid}` after (§2.2 two-phase key). */
  key: string;
  ccid: string | null;
  userId: string;
  status: LegStatus;
  source: "engine" | "ring_me";
  dialedAtMs: number;
  /** §17.1 destination binding: the dialed SIP target — adoption verifies the
   *  event payload's destination matches before attaching a ccid. */
  sipTarget: string;
}

export interface SessionIntent {
  kind: "transfer" | "consult";
  targetUserId: string;
}

export interface AnswerIntent {
  memberCcid: string;
  userId: string;
  answeredAtIso: string;
}

/** The `machine` record (§2.2) plus the leg map the shell loads beside it. */
export interface SessionMachine {
  state: CallState;
  callSessionId: string;
  companyId: string;
  phoneNumberId: string | null;
  companyName: string;
  greeting: string | null;
  callerE164: string | null;
  businessNumberE164: string | null;
  inboundCcid: string | null;
  startedAtMs: number;
  answeredByUserId: string | null;
  answeredAtIso: string | null;
  rejectedForCap: boolean;
  unattended: boolean;
  wakeAttempted: boolean;
  /** §4 T7: userId of the answered owner whose leg died while an intent was
   *  live (the stand-down consumed the only observing event); null otherwise. */
  ownerLegDeadDuringIntent: string | null;
  /** §7.5.4: legacy-cutover machine — scopes §7.7 ledger-less minting. */
  adopted: boolean;
  pushCapableUserIds: string[];
  ringDeadlineMs: number | null;
  telnyxCommandCount: number;
  legs: LegRecord[];
  intent: SessionIntent | null;
  answerIntent: AnswerIntent | null;
}

/** What the shell resolved (I/O) before admitting `initiated` (§4 T1). */
export interface InitiatedContext {
  callSessionId: string;
  inboundCcid: string;
  companyId: string;
  phoneNumberId: string;
  companyName: string;
  greeting: string | null;
  callerE164: string | null;
  businessNumberE164: string;
  lineBusy: boolean;
  screeningDivert: boolean;
  suspendedOrInactive: boolean;
  overCap: boolean;
  dialTargets: { userId: string; sipUsername: string }[];
  /** §5.4: #106-'text'-eligible members holding ANY push channel AND
   *  push-enabled per notification_prefs (#146) — same filter the delegate
   *  applies (§5.5, review R2-I1). */
  pushAudience: string[];
}

export type SessionEvent =
  | { type: "initiated"; context: InitiatedContext }
  | {
      type: "member-leg-answered";
      ccid: string;
      userId: string;
      /** Telnyx-reported dial destination (§17.1 adoption binding). */
      destination: string | null;
    }
  | {
      type: "member-leg-hangup";
      ccid: string;
      userId: string;
      destination: string | null;
    }
  | {
      type: "inbound-hangup";
      tag: "untagged" | "bri" | "vmi";
      briAnsweredAtIso: string | null;
      /** Raw Telnyx payload — the event-mode terminal merge re-uses it. */
      payload: Record<string, unknown> | null;
    }
  | { type: "speak-ended" }
  | { type: "recording-saved"; payload: Record<string, unknown> }
  | {
      type: "ring-me";
      userId: string;
      sipUsername: string;
      noLocalLeg: boolean;
    }
  | { type: "set-owner"; userId: string }
  | { type: "register-intent"; kind: "transfer" | "consult"; targetUserId: string }
  | { type: "clear-intent" }
  | { type: "alarm-ring" }
  | { type: "alarm-janitor" }
  | { type: "alarm-intent-expiry" }
  // Internal events (§4.1: effect outcomes re-enter under the same FIFO):
  | {
      type: "answer-outcome";
      ok: boolean;
      memberCcid: string;
      userId: string;
      answeredAtIso: string;
    }
  | { type: "vm-answer-outcome"; ok: boolean }
  | { type: "push-fanout-settled"; unreachableUserIds: string[] }
  | {
      type: "dial-outcome";
      pendingKey: string;
      ccid: string | null;
      failure: "known-dead" | "ambiguous" | null;
    }
  | {
      /** T2's `canceling` defense (§17.2 unreachable-defensive): the member-leg
       *  GET before answering the caller into a doomed bridge. */
      type: "member-probe-outcome";
      ccid: string;
      userId: string;
      alive: boolean;
    };

export const EVENT_TYPES: readonly SessionEvent["type"][] = [
  "initiated",
  "member-leg-answered",
  "member-leg-hangup",
  "inbound-hangup",
  "speak-ended",
  "recording-saved",
  "ring-me",
  "set-owner",
  "register-intent",
  "clear-intent",
  "alarm-ring",
  "alarm-janitor",
  "alarm-intent-expiry",
  "answer-outcome",
  "vm-answer-outcome",
  "push-fanout-settled",
  "dial-outcome",
  "member-probe-outcome",
];

export type AlarmKind =
  | "ring"
  | "janitor"
  | "purge"
  | "intent-expiry"
  | "fanout-settle";

export type Effect =
  | {
      kind: "mirror";
      set: {
        state?: CallState;
        answered_by_user_id?: string | null;
        answered_at?: string | null;
      };
      /** Terminal mirrors retry until they land (§2.2). */
      terminal: boolean;
    }
  | {
      kind: "telnyx-dial";
      legs: {
        pendingKey: string;
        userId: string;
        sipTarget: string;
        source: "engine" | "ring_me";
      }[];
    }
  | { kind: "telnyx-answer-inbound"; ccid: string; answerIntent: AnswerIntent }
  | { kind: "telnyx-answer-vm"; ccid: string }
  | { kind: "telnyx-bridge"; memberCcid: string; inboundCcid: string }
  | { kind: "telnyx-hangup"; ccid: string; terminal: boolean }
  | { kind: "telnyx-reject"; ccid: string; cause: "USER_BUSY" }
  | { kind: "telnyx-speak"; ccid: string }
  | { kind: "telnyx-record-start"; ccid: string }
  | { kind: "telnyx-probe-member-leg"; ccid: string; userId: string }
  | { kind: "push-fanout"; userIds: string[] }
  | { kind: "push-call-end"; reason: "answered" | "voicemail" | "missed" }
  | { kind: "thread-at-answer" }
  | {
      kind: "terminal-merge";
      /** "event": replay the triggering Telnyx payload through the existing
       *  (replay-idempotent) terminal delegate. "synthetic": no payload exists
       *  (dead-inbound discrimination, janitor) — the executor merges from the
       *  machine's own facts. */
      mode: "event" | "synthetic";
      outcome: "answered" | "voicemail" | "missed";
      payload: Record<string, unknown> | null;
      briAnsweredAtIso: string | null;
    }
  | { kind: "voicemail-pipeline"; payload: Record<string, unknown> }
  | { kind: "sentry-warn"; message: string }
  | { kind: "arm-alarm"; alarm: AlarmKind; atMs: number }
  | { kind: "clear-alarm"; alarm: AlarmKind };

export interface RingMeReply {
  rang: boolean;
  state: CallState;
  reason?: "not_ringing" | "live_leg" | "recent_leg" | "dial_failed";
  /** Set when rang=true: the pending leg key whose dial decides the final
   *  reply (the shell downgrades to dial_failed if the dial never lands). */
  pendingKey?: string;
}

export interface ReduceResult {
  machine: SessionMachine | null;
  effects: Effect[];
  /** ring-me / register-intent replies (RPC surface). */
  reply?: RingMeReply | { state: CallState };
}

function liveLegs(machine: SessionMachine): LegRecord[] {
  return machine.legs.filter((leg) => LIVE_LEG_STATUSES.includes(leg.status));
}

function cloneMachine(machine: SessionMachine): SessionMachine {
  return {
    ...machine,
    pushCapableUserIds: [...machine.pushCapableUserIds],
    legs: machine.legs.map((leg) => ({ ...leg })),
    intent: machine.intent ? { ...machine.intent } : null,
    answerIntent: machine.answerIntent ? { ...machine.answerIntent } : null,
  };
}

/** Effects shared by every path out of `ringing`: cancel EVERY live leg from
 *  the DO's own leg map (exhaustive — §4 T9/T2/T5) and mark them canceling. */
function cancelAllLiveLegs(
  machine: SessionMachine,
  effects: Effect[],
  terminal: boolean,
): void {
  for (const leg of machine.legs) {
    if (!LIVE_LEG_STATUSES.includes(leg.status)) continue;
    if (leg.status === "canceling") continue;
    leg.status = "canceling";
    if (leg.ccid) {
      effects.push({ kind: "telnyx-hangup", ccid: leg.ccid, terminal });
    }
  }
}

/**
 * §4 T9 VM-ENTRY (from T1a, T1d zero-avenue, T3-exhaustion, or the ALARM).
 * Normative ordering (review R1-B1): state→voicemail_greeting is IN machine'
 * (persisted with the mirror as an effect) BEFORE any Telnyx command runs.
 * The answer's 4xx discrimination re-enters as `vm-answer-outcome`.
 */
function vmEntry(machine: SessionMachine, effects: Effect[]): void {
  machine.state = "voicemail_greeting";
  machine.ringDeadlineMs = null;
  effects.push({ kind: "mirror", set: { state: "voicemail_greeting" }, terminal: false });
  effects.push({ kind: "clear-alarm", alarm: "ring" });
  if (machine.inboundCcid) {
    // Terminal-path exemption class (§13): the voicemail answer must never
    // drop at the command cap — it is how the session ends honestly.
    effects.push({ kind: "telnyx-answer-vm", ccid: machine.inboundCcid });
  }
  effects.push({ kind: "push-call-end", reason: "voicemail" });
}

/** §4 T3's avenue ladder — total, in order; exhaustive by construction. */
function runAvenueLadder(machine: SessionMachine, effects: Effect[]): void {
  if (machine.state !== "ringing") return;
  if (liveLegs(machine).length > 0) return; // (1) any live leg → stay
  if (machine.pushCapableUserIds.length > 0) return; // (2) hold ringback
  vmEntry(machine, effects); // (3) explicit exhaustion
}

/** Terminal resolution shared by T5/T8/T12/T16/T17 and the dead-inbound
 *  discrimination branches. Mirrors state, cancels stragglers, merges, arms
 *  the purge alarm. */
function terminalize(
  machine: SessionMachine,
  effects: Effect[],
  nowMs: number,
  target: CallState,
  merge: Extract<Effect, { kind: "terminal-merge" }> | null,
  callEndReason: "answered" | "voicemail" | "missed" | null,
  extraMirror: {
    answered_by_user_id?: string | null;
    answered_at?: string | null;
  } = {},
): void {
  const wasRinging = machine.state === "ringing";
  const upgrade = isTerminal(machine.state);
  machine.state = target;
  machine.ringDeadlineMs = null;
  cancelAllLiveLegs(machine, effects, true);
  effects.push({
    kind: "mirror",
    set: { state: target, ...extraMirror },
    terminal: true,
  });
  if (merge) effects.push(merge);
  if (wasRinging && callEndReason) {
    effects.push({ kind: "push-call-end", reason: callEndReason });
  }
  if (!upgrade) {
    effects.push({ kind: "clear-alarm", alarm: "ring" });
    effects.push({ kind: "clear-alarm", alarm: "fanout-settle" });
    effects.push({ kind: "arm-alarm", alarm: "purge", atMs: nowMs + PURGE_DELAY_MS });
  }
}

/** §4 T7's teardown: hang up the customer leg; the bri hangup runs T8. */
function ownerDeathTeardown(machine: SessionMachine, effects: Effect[]): void {
  if (machine.inboundCcid) {
    effects.push({ kind: "telnyx-hangup", ccid: machine.inboundCcid, terminal: true });
  }
  machine.ownerLegDeadDuringIntent = null;
}

/**
 * The §4 transition table. Pure: no I/O, no clocks beyond `nowMs`, no
 * randomness beyond the caller-supplied `pendingKeyFor` (uuid minting is the
 * shell's; tests inject deterministic keys).
 */
export function reduce(
  machine: SessionMachine | null,
  event: SessionEvent,
  nowMs: number,
  pendingKeyFor: () => string,
): ReduceResult {
  // ---- T1: initiated (the only event that may mint a machine) -------------
  if (event.type === "initiated") {
    if (machine !== null) {
      // Replay guard: the machine exists — no-op (§4 T1 guard).
      return { machine, effects: [] };
    }
    return reduceInitiated(event.context, nowMs, pendingKeyFor);
  }

  if (machine === null) {
    // No machine: adoption/no-row-drop happen in the shell (§7.5) BEFORE the
    // reducer. Anything reaching here is a licensed no-op.
    return { machine: null, effects: [] };
  }

  const next = cloneMachine(machine);
  const effects: Effect[] = [];

  switch (event.type) {
    // ---- T2 / T3 / T7 / §7.7: member (brm) leg events ---------------------
    case "member-leg-answered":
      return reduceMemberAnswered(next, event, effects);
    case "member-leg-hangup":
      return reduceMemberHangup(next, event, effects);

    // ---- T5 / T8 / T12 / T17 (+ the §3 upgrade edges) ---------------------
    case "inbound-hangup":
      return reduceInboundHangup(next, event, effects, nowMs);

    // ---- T11 --------------------------------------------------------------
    case "speak-ended": {
      if (next.state !== "voicemail_greeting") return { machine: next, effects };
      next.state = "voicemail_recording";
      effects.push({ kind: "mirror", set: { state: "voicemail_recording" }, terminal: false });
      if (next.inboundCcid) {
        effects.push({ kind: "telnyx-record-start", ccid: next.inboundCcid });
      }
      return { machine: next, effects };
    }

    // ---- T13 (incl. the ended_missed → ended_voicemail upgrade) -----------
    case "recording-saved": {
      if (next.state !== "voicemail_recording" && next.state !== "ended_missed") {
        return { machine: next, effects }; // T14 dedup/guard no-op
      }
      const fromLive = next.state === "voicemail_recording";
      next.state = "ended_voicemail";
      next.ringDeadlineMs = null;
      effects.push({ kind: "voicemail-pipeline", payload: event.payload });
      effects.push({ kind: "mirror", set: { state: "ended_voicemail" }, terminal: true });
      if (fromLive) {
        effects.push({ kind: "arm-alarm", alarm: "purge", atMs: nowMs + PURGE_DELAY_MS });
      }
      return { machine: next, effects };
    }

    // ---- T4: ring-me v2 (§6 — additive, never cancels) --------------------
    case "ring-me":
      return reduceRingMe(next, event, effects, nowMs, pendingKeyFor);

    // ---- §7.4 owner/intent RPCs -------------------------------------------
    case "set-owner": {
      next.answeredByUserId = event.userId;
      // Owner changed → the stood-down-recovery condition ("owner unchanged")
      // can no longer hold.
      next.ownerLegDeadDuringIntent = null;
      effects.push({
        kind: "mirror",
        set: { answered_by_user_id: event.userId },
        terminal: false,
      });
      return { machine: next, effects };
    }
    case "register-intent": {
      next.intent = { kind: event.kind, targetUserId: event.targetUserId };
      effects.push({
        kind: "arm-alarm",
        alarm: "intent-expiry",
        atMs: nowMs + INTENT_EXPIRY_MS,
      });
      return { machine: next, effects, reply: { state: next.state } };
    }
    case "clear-intent":
    case "alarm-intent-expiry": {
      next.intent = null;
      effects.push({ kind: "clear-alarm", alarm: "intent-expiry" });
      // §4 T7 stood-down recovery: state=answered ∧ owner unchanged ∧ flag.
      if (
        next.state === "answered" &&
        next.ownerLegDeadDuringIntent !== null &&
        next.ownerLegDeadDuringIntent === next.answeredByUserId
      ) {
        ownerDeathTeardown(next, effects);
      } else {
        next.ownerLegDeadDuringIntent = null;
      }
      return { machine: next, effects };
    }

    // ---- T10: the ONLY clock-based voicemail trigger ----------------------
    case "alarm-ring": {
      if (next.state !== "ringing") return { machine: next, effects };
      vmEntry(next, effects);
      return { machine: next, effects };
    }

    // ---- T16: janitor -----------------------------------------------------
    case "alarm-janitor": {
      if (isTerminal(next.state)) return { machine: next, effects };
      if (next.state === "ringing") {
        terminalize(
          next,
          effects,
          nowMs,
          next.rejectedForCap ? "ended_rejected" : "ended_missed",
          { kind: "terminal-merge", mode: "synthetic", outcome: "missed", payload: null, briAnsweredAtIso: null },
          "missed",
        );
      } else if (next.state === "answered") {
        terminalize(
          next,
          effects,
          nowMs,
          "ended_answered",
          {
            kind: "terminal-merge",
            mode: "synthetic",
            outcome: "answered",
            payload: null,
            briAnsweredAtIso: next.answeredAtIso,
          },
          null,
        );
      } else {
        // voicemail_greeting / voicemail_recording → T12 semantics
        // (provisional; a later recording.saved still upgrades via T13).
        terminalize(
          next,
          effects,
          nowMs,
          "ended_missed",
          { kind: "terminal-merge", mode: "synthetic", outcome: "missed", payload: null, briAnsweredAtIso: null },
          null,
        );
      }
      return { machine: next, effects };
    }

    // ---- Internal: T2's journaled answer outcome --------------------------
    case "answer-outcome":
      return reduceAnswerOutcome(next, event, effects, nowMs);

    // ---- Internal: T9's answer discrimination -----------------------------
    case "vm-answer-outcome": {
      if (next.state !== "voicemail_greeting") return { machine: next, effects };
      if (event.ok) {
        if (next.inboundCcid) {
          effects.push({ kind: "telnyx-speak", ccid: next.inboundCcid });
        }
        cancelAllLiveLegs(next, effects, true);
        return { machine: next, effects };
      }
      // Dead/not-found: TERMINAL, never "stay" (reviews R1-B1 + R1-B3).
      terminalize(
        next,
        effects,
        nowMs,
        next.rejectedForCap ? "ended_rejected" : "ended_missed",
        { kind: "terminal-merge", mode: "synthetic", outcome: "missed", payload: null, briAnsweredAtIso: null },
        null,
      );
      return { machine: next, effects };
    }

    // ---- Internal: §5.5 settle re-check -----------------------------------
    case "push-fanout-settled": {
      next.wakeAttempted = true;
      effects.push({ kind: "clear-alarm", alarm: "fanout-settle" });
      const gone = new Set(event.unreachableUserIds);
      next.pushCapableUserIds = next.pushCapableUserIds.filter(
        (userId) => !gone.has(userId),
      );
      runAvenueLadder(next, effects); // may VM-ENTRY (rule 3's honesty)
      return { machine: next, effects };
    }

    // ---- Internal: §7.7 dial outcomes -------------------------------------
    case "dial-outcome": {
      const leg = next.legs.find((entry) => entry.key === event.pendingKey);
      if (!leg) return { machine: next, effects };
      if (event.ccid) {
        leg.ccid = event.ccid;
        leg.key = `leg:${event.ccid}`;
        if (leg.status === "dialing") leg.status = "ringing";
        return { machine: next, effects };
      }
      if (event.failure === "ambiguous") {
        // Counted as NOT live for the ladder, retained for reconciliation.
        leg.status = "ambiguous";
      } else {
        leg.status = "dead"; // T3's "dial POST threw with a KNOWN-dead outcome"
      }
      runAvenueLadder(next, effects);
      return { machine: next, effects };
    }

    // ---- Internal: T2 `canceling` probe (§17.2 unreachable-defensive) -----
    case "member-probe-outcome": {
      if (next.state !== "ringing") return { machine: next, effects };
      const leg = next.legs.find((entry) => entry.ccid === event.ccid);
      if (!leg) return { machine: next, effects };
      if (!event.alive) {
        // Treat as a leg death (T3): run the ladder; never answer the caller
        // into a doomed bridge (review R1-B2).
        leg.status = "dead";
        runAvenueLadder(next, effects);
        return { machine: next, effects };
      }
      // Alive → our cancel truly lost — proceed with the T2 answer sequence.
      const answeredAtIso = new Date(nowMs).toISOString();
      next.answerIntent = {
        memberCcid: event.ccid,
        userId: event.userId,
        answeredAtIso,
      };
      if (next.inboundCcid) {
        effects.push({
          kind: "telnyx-answer-inbound",
          ccid: next.inboundCcid,
          answerIntent: next.answerIntent,
        });
      }
      return { machine: next, effects };
    }

    default: {
      const exhaustive: never = event;
      void exhaustive;
      return { machine: next, effects };
    }
  }
}

// ---------------------------------------------------------------------------

function reduceInitiated(
  context: InitiatedContext,
  nowMs: number,
  pendingKeyFor: () => string,
): ReduceResult {
  const base: SessionMachine = {
    state: "ringing",
    callSessionId: context.callSessionId,
    companyId: context.companyId,
    phoneNumberId: context.phoneNumberId,
    companyName: context.companyName,
    greeting: context.greeting,
    callerE164: context.callerE164,
    businessNumberE164: context.businessNumberE164,
    inboundCcid: context.inboundCcid,
    startedAtMs: nowMs,
    answeredByUserId: null,
    answeredAtIso: null,
    rejectedForCap: false,
    unattended: false,
    wakeAttempted: false,
    ownerLegDeadDuringIntent: null,
    adopted: false,
    pushCapableUserIds: [...context.pushAudience],
    ringDeadlineMs: null,
    telnyxCommandCount: 0,
    legs: [],
    intent: null,
    answerIntent: null,
  };
  const effects: Effect[] = [
    { kind: "arm-alarm", alarm: "janitor", atMs: nowMs + JANITOR_MS },
  ];

  // T1a: line busy, or screening divert + flagged → VM-ENTRY now, state
  // minted voicemail_greeting (never a false `ringing` broadcast — §16.8).
  if (context.lineBusy || context.screeningDivert) {
    vmEntry(base, effects);
    return { machine: base, effects };
  }

  // T1b: suspended number / inactive subscription → unattended ring-out.
  if (context.suspendedOrInactive) {
    base.unattended = true;
    effects.push({ kind: "mirror", set: { state: "ringing" }, terminal: false });
    return { machine: base, effects };
  }

  // T1c: over voice cap → reject USER_BUSY; the hangup runs T5→ended_rejected.
  if (context.overCap) {
    base.rejectedForCap = true;
    effects.push({ kind: "telnyx-reject", ccid: context.inboundCcid, cause: "USER_BUSY" });
    effects.push({ kind: "mirror", set: { state: "ringing" }, terminal: false });
    return { machine: base, effects };
  }

  // T1d: immediate-exhaustion check — BOTH empty → voicemail NOW (§5.3).
  if (context.dialTargets.length === 0 && context.pushAudience.length === 0) {
    vmEntry(base, effects);
    return { machine: base, effects };
  }

  // RING-START.
  let targets = context.dialTargets;
  if (targets.length > MAX_LEGS_PER_SESSION) {
    effects.push({
      kind: "sentry-warn",
      message:
        `calls-v3 RING-START: ${targets.length} eligible targets exceed ` +
        `MAX_LEGS_PER_SESSION=${MAX_LEGS_PER_SESSION} — dialing the first ` +
        `${MAX_LEGS_PER_SESSION} by earliest membership (alert-before-the-cap)`,
    });
    targets = targets.slice(0, MAX_LEGS_PER_SESSION);
  }
  const dialLegs = targets.map((target) => {
    const pendingKey = `leg:pending:${pendingKeyFor()}`;
    base.legs.push({
      key: pendingKey,
      ccid: null,
      userId: target.userId,
      status: "dialing",
      source: "engine",
      dialedAtMs: nowMs,
      sipTarget: `sip:${target.sipUsername}@sip.telnyx.com`,
    });
    return {
      pendingKey,
      userId: target.userId,
      sipTarget: `sip:${target.sipUsername}@sip.telnyx.com`,
      source: "engine" as const,
    };
  });
  base.ringDeadlineMs = nowMs + RING_WINDOW_SECS * 1_000;
  effects.push({ kind: "mirror", set: { state: "ringing" }, terminal: false });
  if (dialLegs.length > 0) {
    effects.push({ kind: "telnyx-dial", legs: dialLegs });
  }
  // Push fan-out is a JOURNALED effect: it dispatches sends AND arms the
  // fanout-settle alarm (+10s) — §5.5 (eviction-safe settle).
  effects.push({ kind: "push-fanout", userIds: [...context.pushAudience] });
  effects.push({ kind: "arm-alarm", alarm: "fanout-settle", atMs: nowMs + FANOUT_SETTLE_MS });
  effects.push({ kind: "arm-alarm", alarm: "ring", atMs: base.ringDeadlineMs });
  return { machine: base, effects };
}

function reduceMemberAnswered(
  next: SessionMachine,
  event: Extract<SessionEvent, { type: "member-leg-answered" }>,
  effects: Effect[],
): ReduceResult {
  let leg = next.legs.find((entry) => entry.ccid === event.ccid);

  if (!leg) {
    // §7.7: adopt onto an existing pending/ambiguous record for the tag's
    // userId (state ringing) with §17.1 destination binding — never mint from
    // the tag alone (review R2-B3 forgery posture).
    if (next.state === "ringing") {
      const candidate = next.legs.find(
        (entry) =>
          entry.ccid === null &&
          (entry.status === "dialing" || entry.status === "ambiguous") &&
          entry.userId === event.userId &&
          (event.destination === null || entry.sipTarget === event.destination),
      );
      if (candidate) {
        candidate.ccid = event.ccid;
        candidate.key = `leg:${event.ccid}`;
        if (candidate.status === "ambiguous") candidate.status = "ringing";
        leg = candidate;
      }
    }
    if (!leg) {
      // Non-ringing states, non-matching records, forged tags: defensive
      // hangup + Sentry — never a state change, never a T2 entry (§7.7).
      effects.push({ kind: "telnyx-hangup", ccid: event.ccid, terminal: false });
      effects.push({
        kind: "sentry-warn",
        message:
          `calls-v3: orphan brm call.answered with no matching pending/` +
          `ambiguous record (user ${event.userId}) — defensively hung up ` +
          `(§7.7 forgery gate)`,
      });
      return { machine: next, effects };
    }
  }

  if (
    next.state !== "ringing" ||
    !LIVE_LEG_STATUSES.includes(leg.status)
  ) {
    // T14 / guard no-op: a late answer against voicemail/ended states is
    // reaped by the T2/T9 exit sweeps; nothing to do here beyond a defensive
    // hangup when the session has no use for the leg.
    if (!isTerminal(next.state) && next.state !== "ringing") {
      effects.push({ kind: "telnyx-hangup", ccid: event.ccid, terminal: false });
    }
    return { machine: next, effects };
  }

  if (leg.status === "canceling") {
    // Review R1-B2: cancel-vs-answer at Telnyx is not free — probe the member
    // leg first; dead → T3; alive → proceed (§17.2 defense-in-depth).
    effects.push({ kind: "telnyx-probe-member-leg", ccid: event.ccid, userId: event.userId });
    return { machine: next, effects };
  }

  // T2 step 1–2: persist answerIntent; answer the inbound leg FIRST (bri tag,
  // billing anchor D36). The 4xx discrimination re-enters as answer-outcome.
  const answeredAtIso = new Date().toISOString();
  next.answerIntent = { memberCcid: event.ccid, userId: event.userId, answeredAtIso };
  if (next.inboundCcid) {
    effects.push({
      kind: "telnyx-answer-inbound",
      ccid: next.inboundCcid,
      answerIntent: next.answerIntent,
    });
  }
  return { machine: next, effects };
}

function reduceAnswerOutcome(
  next: SessionMachine,
  event: Extract<SessionEvent, { type: "answer-outcome" }>,
  effects: Effect[],
  nowMs: number,
): ReduceResult {
  if (next.state !== "ringing") {
    // §17.4: answer-outcome in any other state is a licensed no-op.
    return { machine: next, effects };
  }
  if (!event.ok) {
    // T2's dead-inbound branch: TERMINAL, never "stay" (review R1-B3). Keep
    // answerIntent persisted until purge — the in-flight bri-tagged hangup
    // may later upgrade ended_missed → ended_answered (§3).
    const memberLeg = next.legs.find((entry) => entry.ccid === event.memberCcid);
    if (memberLeg && memberLeg.status !== "dead") {
      memberLeg.status = "canceling";
      effects.push({ kind: "telnyx-hangup", ccid: event.memberCcid, terminal: true });
    }
    terminalize(
      next,
      effects,
      nowMs,
      next.rejectedForCap ? "ended_rejected" : "ended_missed",
      { kind: "terminal-merge", mode: "synthetic", outcome: "missed", payload: null, briAnsweredAtIso: null },
      "missed",
    );
    return { machine: next, effects };
  }

  // T2 steps 3–7.
  next.state = "answered";
  next.answeredByUserId = event.userId;
  next.answeredAtIso = event.answeredAtIso;
  next.ringDeadlineMs = null;
  const winner = next.legs.find((entry) => entry.ccid === event.memberCcid);
  if (winner) winner.status = "answered";
  effects.push({
    kind: "mirror",
    set: {
      state: "answered",
      answered_by_user_id: event.userId,
      answered_at: event.answeredAtIso,
    },
    terminal: false,
  });
  if (next.inboundCcid) {
    effects.push({
      kind: "telnyx-bridge",
      memberCcid: event.memberCcid,
      inboundCcid: next.inboundCcid,
    });
  }
  // (5) Cancel all sibling legs.
  for (const leg of next.legs) {
    if (leg.ccid === event.memberCcid) continue;
    if (LIVE_LEG_STATUSES.includes(leg.status) && leg.status !== "canceling") {
      leg.status = "canceling";
      if (leg.ccid) {
        effects.push({ kind: "telnyx-hangup", ccid: leg.ccid, terminal: false });
      }
    }
  }
  effects.push({ kind: "thread-at-answer" });
  effects.push({ kind: "clear-alarm", alarm: "ring" });
  effects.push({ kind: "clear-alarm", alarm: "fanout-settle" });
  effects.push({ kind: "push-call-end", reason: "answered" });
  next.answerIntent = null; // step 3: clear on success
  return { machine: next, effects };
}

function reduceMemberHangup(
  next: SessionMachine,
  event: Extract<SessionEvent, { type: "member-leg-hangup" }>,
  effects: Effect[],
): ReduceResult {
  let leg = next.legs.find((entry) => entry.ccid === event.ccid);
  if (!leg && next.state === "ringing") {
    // §7.7 adoption for a hangup: attach to a matching pending/ambiguous
    // record so the ladder accounts the death; else drop (the leg is already
    // dead — nothing to defensively hang up).
    const candidate = next.legs.find(
      (entry) =>
        entry.ccid === null &&
        (entry.status === "dialing" || entry.status === "ambiguous") &&
        entry.userId === event.userId &&
        (event.destination === null || entry.sipTarget === event.destination),
    );
    if (candidate) {
      candidate.ccid = event.ccid;
      candidate.key = `leg:${event.ccid}`;
      leg = candidate;
    }
  }
  if (!leg) return { machine: next, effects };

  // T7: the answered OWNER's leg died mid-call.
  if (next.state === "answered" && leg.status === "answered") {
    leg.status = "dead";
    if (next.answeredByUserId !== event.userId) {
      return { machine: next, effects }; // teammate takeover — not stranded
    }
    if (next.intent !== null) {
      // Stand-down is NOT a silent no-op (review R1-B4): flag it so
      // clearIntent()/the intent-expiry alarm re-run the teardown.
      next.ownerLegDeadDuringIntent = event.userId;
      return { machine: next, effects };
    }
    ownerDeathTeardown(next, effects);
    return { machine: next, effects };
  }

  if (next.state !== "ringing") {
    // A loser/canceled leg dying outside ringing: bookkeeping only.
    if (leg.status !== "dead") leg.status = "dead";
    return { machine: next, effects };
  }

  // T3: leg death during the ring window.
  leg.status = "dead";
  runAvenueLadder(next, effects);
  return { machine: next, effects };
}

function reduceInboundHangup(
  next: SessionMachine,
  event: Extract<SessionEvent, { type: "inbound-hangup" }>,
  effects: Effect[],
  nowMs: number,
): ReduceResult {
  // Terminal states: T14 no-op, EXCEPT the §3 upgrade edge — a bri-tagged
  // inbound hangup arriving in ended_missed (T2 crash-window resolution).
  if (isTerminal(next.state)) {
    if (event.tag === "bri" && next.state === "ended_missed") {
      if (next.answerIntent) {
        next.answeredByUserId = next.answerIntent.userId;
        next.answeredAtIso = next.answerIntent.answeredAtIso;
      } else {
        effects.push({
          kind: "sentry-warn",
          message:
            "calls-v3 T17 upgrade: bri-tagged hangup in ended_missed with no " +
            "retained answerIntent — outcome upgraded unattributed (audit anomaly)",
        });
      }
      next.state = "ended_answered";
      effects.push({
        kind: "mirror",
        set: {
          state: "ended_answered",
          ...(next.answeredByUserId
            ? {
                answered_by_user_id: next.answeredByUserId,
                answered_at: next.answeredAtIso,
              }
            : {}),
        },
        terminal: true,
      });
      effects.push({
        kind: "terminal-merge",
        mode: "event",
        outcome: "answered",
        payload: event.payload,
        briAnsweredAtIso: event.briAnsweredAtIso ?? next.answerIntent?.answeredAtIso ?? null,
      });
    }
    return { machine: next, effects };
  }

  // T17 (with T5/T8/T12 as its specific cases): an inbound-leg hangup is
  // ALWAYS terminal — the tag refines WHICH terminal, never the license.
  if (event.tag === "bri") {
    // T8 (answered), or the T17 crash-window resolution from any state.
    if (next.answeredByUserId === null && next.answerIntent) {
      next.answeredByUserId = next.answerIntent.userId;
      next.answeredAtIso = next.answerIntent.answeredAtIso;
    }
    if (next.answeredByUserId === null) {
      effects.push({
        kind: "sentry-warn",
        message:
          "calls-v3 T17: bri-tagged inbound hangup with no answer stamp and " +
          "no retained answerIntent — terminal ended_answered stamped " +
          "unattributed (audit anomaly, never a stuck line)",
      });
    }
    terminalize(
      next,
      effects,
      nowMs,
      "ended_answered",
      {
        kind: "terminal-merge",
        mode: "event",
        outcome: "answered",
        payload: event.payload,
        briAnsweredAtIso:
          event.briAnsweredAtIso ?? next.answerIntent?.answeredAtIso ?? null,
      },
      "answered",
      next.answeredByUserId
        ? {
            answered_by_user_id: next.answeredByUserId,
            answered_at: next.answeredAtIso,
          }
        : {},
    );
    return { machine: next, effects };
  }

  if (event.tag === "vmi") {
    // T12 (voicemail states) / T17-vmi (the machine lost the transition):
    // ended_missed provisional; a late recording.saved upgrades via T13.
    terminalize(next, effects, nowMs, "ended_missed", {
      kind: "terminal-merge",
      mode: "event",
      outcome: "missed",
      payload: event.payload,
      briAnsweredAtIso: null,
    }, "missed");
    return { machine: next, effects };
  }

  // Untagged.
  if (next.state === "answered") {
    // Theoretically unreachable (the inbound leg always carries bri in
    // `answered`) — licensed anyway: totality beats optimism (§4 T17).
    effects.push({
      kind: "sentry-warn",
      message:
        "calls-v3 T17: UNTAGGED inbound hangup in state=answered " +
        "(theoretically unreachable) — resolved ended_answered per T8 semantics",
    });
    terminalize(next, effects, nowMs, "ended_answered", {
      kind: "terminal-merge",
      mode: "event",
      outcome: "answered",
      payload: event.payload,
      briAnsweredAtIso: next.answeredAtIso,
    }, null);
    return { machine: next, effects };
  }
  if (next.state === "voicemail_greeting" || next.state === "voicemail_recording") {
    // The failed-vm-answer window (review R1-B1's 4h-busy-line hole, pinned).
    terminalize(next, effects, nowMs, "ended_missed", {
      kind: "terminal-merge",
      mode: "event",
      outcome: "missed",
      payload: event.payload,
      briAnsweredAtIso: null,
    }, null);
    return { machine: next, effects };
  }
  // T5: ringing (plain caller-gave-up, the unattended ring-out, the cap
  // reject — one deterministic row; old T6 merged here).
  terminalize(
    next,
    effects,
    nowMs,
    next.rejectedForCap ? "ended_rejected" : "ended_missed",
    {
      kind: "terminal-merge",
      mode: "event",
      outcome: "missed",
      payload: event.payload,
      briAnsweredAtIso: null,
    },
    "missed",
  );
  return { machine: next, effects };
}

function reduceRingMe(
  next: SessionMachine,
  event: Extract<SessionEvent, { type: "ring-me" }>,
  effects: Effect[],
  nowMs: number,
  pendingKeyFor: () => string,
): ReduceResult {
  if (next.state !== "ringing") {
    return {
      machine: next,
      effects,
      reply: { rang: false, state: next.state, reason: "not_ringing" },
    };
  }

  const memberLive = next.legs.filter(
    (leg) => leg.userId === event.userId && LIVE_LEG_STATUSES.includes(leg.status),
  );

  if (!event.noLocalLeg) {
    // T4a — pre-v3 client: ANY live leg for this member, any age, any source
    // → NO-OP. An unasserted request can NEVER dial past a live leg.
    if (memberLive.length > 0) {
      return {
        machine: next,
        effects,
        reply: { rang: false, state: next.state, reason: "live_leg" },
      };
    }
  } else {
    // T4b — v3 client: debounce ONLY on a live ring_me-sourced leg dialed
    // within RING_ME_DEBOUNCE_MS (engine legs never debounce — §6).
    const recent = memberLive.some(
      (leg) =>
        leg.source === "ring_me" && nowMs - leg.dialedAtMs < RING_ME_DEBOUNCE_MS,
    );
    if (recent) {
      return {
        machine: next,
        effects,
        reply: { rang: false, state: next.state, reason: "recent_leg" },
      };
    }
  }

  // §13: past MAX_LEGS_PER_SESSION, ring-me returns dial_failed.
  if (next.legs.length >= MAX_LEGS_PER_SESSION) {
    effects.push({
      kind: "sentry-warn",
      message:
        `calls-v3 ring-me: session at MAX_LEGS_PER_SESSION=` +
        `${MAX_LEGS_PER_SESSION} — refusing the dial (cap-and-drop)`,
    });
    return {
      machine: next,
      effects,
      reply: { rang: false, state: next.state, reason: "dial_failed" },
    };
  }

  // T4c: dial a fresh leg. ring-me NEVER cancels anything (§6, review R2-B2).
  const pendingKey = `leg:pending:${pendingKeyFor()}`;
  const sipTarget = `sip:${event.sipUsername}@sip.telnyx.com`;
  next.legs.push({
    key: pendingKey,
    ccid: null,
    userId: event.userId,
    status: "dialing",
    source: "ring_me",
    dialedAtMs: nowMs,
    sipTarget,
  });
  effects.push({
    kind: "telnyx-dial",
    legs: [{ pendingKey, userId: event.userId, sipTarget, source: "ring_me" }],
  });
  return {
    machine: next,
    effects,
    reply: { rang: true, state: "ringing", pendingKey },
  };
}
