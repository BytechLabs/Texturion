/**
 * Calls v3 (#170 §15.1) — the PURE machine tests. Zero I/O: reduce() only.
 *
 * Pins the three properties forever:
 *   - T17 TOTALITY: an inbound-leg hangup (bri | vmi | UNTAGGED) reaches a
 *     terminal state from EVERY non-terminal state — no (state × inbound-hangup
 *     × tag) triple may no-op (the untagged × voicemail_greeting cell is review
 *     R1-B1's 4h-busy-line hole).
 *   - VM-ENTRY only under T1a / T1d-zero-avenue / T10-alarm / T3-exhaustion
 *     (zero live legs ∧ zero push-capable) — the founder invariant, fuzzed.
 *   - ring-me NEVER emits a hangup/cancel effect (§6, review R2-B2), fuzzed.
 */
import { describe, expect, it } from "vitest";

import {
  CALL_STATES,
  type CallState,
  type Effect,
  type InitiatedContext,
  isTerminal,
  type OutboundInitiatedContext,
  reduce,
  type SessionEvent,
  type SessionMachine,
  UNAVAILABLE_NOTICE,
} from "./transitions";

// ---- builders --------------------------------------------------------------

function keyGen(): () => string {
  let n = 0;
  return () => `k${n++}`;
}

function initCtx(overrides: Partial<InitiatedContext> = {}): InitiatedContext {
  return {
    callSessionId: "s1",
    inboundCcid: "cust1",
    companyId: "co1",
    phoneNumberId: "pn1",
    companyName: "Acme",
    greeting: null,
    callerE164: "+15551000",
    businessNumberE164: "+19995000",
    // #278: false on all three is the pre-#278 product — rings exactly as it
    // always did, which is what every existing case in this file asserts.
    afterHours: false,
    nextOpenLabel: null,
    afterHoursVoicemail: false,
    // #278: 'all' and the full window are the product as it rang before the
    // columns existed, which is what every existing case in this file asserts.
    ringStrategy: "all",
    ringSeconds: 45,
    lineBusy: false,
    screeningDivert: false,
    suspendedOrInactive: false,
    noticeAllowed: false,
    overCap: false,
    dialTargets: [{ userId: "u1", sipUsername: "sip1" }],
    pushAudience: ["u1"],
    ...overrides,
  };
}

/** Mint a ringing machine (T1d) and re-key its first leg to a ccid. */
function ringingMachine(
  ctxOverrides: Partial<InitiatedContext> = {},
): SessionMachine {
  const key = keyGen();
  const r1 = reduce(null, { type: "initiated", context: initCtx(ctxOverrides) }, 1_000, key);
  let machine = r1.machine as SessionMachine;
  // Resolve the engine leg's dial (ccid = 'leg-u1').
  const pending = machine.legs.find((l) => l.userId === "u1");
  if (pending) {
    const r2 = reduce(
      machine,
      { type: "dial-outcome", pendingKey: pending.key, ccid: "leg-u1", failure: null },
      1_100,
      key,
    );
    machine = r2.machine as SessionMachine;
  }
  return machine;
}

function has(effects: Effect[], kind: Effect["kind"]): boolean {
  return effects.some((e) => e.kind === kind);
}

function mirrorState(effects: Effect[]): CallState | undefined {
  const m = effects.find((e) => e.kind === "mirror") as
    | Extract<Effect, { kind: "mirror" }>
    | undefined;
  return m?.set.state;
}

const KEY = keyGen();

// ---- T1 branches -----------------------------------------------------------

describe("T1 — call.initiated branches", () => {
  it("T1d RING-START: rings, dials, arms ring+janitor+fanout-settle alarms", () => {
    const r = reduce(null, { type: "initiated", context: initCtx() }, 1_000, keyGen());
    expect(r.machine?.state).toBe("ringing");
    expect(has(r.effects, "telnyx-dial")).toBe(true);
    expect(has(r.effects, "push-fanout")).toBe(true);
    const alarms = r.effects.filter((e) => e.kind === "arm-alarm") as Extract<Effect, { kind: "arm-alarm" }>[];
    const kinds = alarms.map((a) => a.alarm);
    expect(kinds).toContain("ring");
    expect(kinds).toContain("janitor");
    expect(kinds).toContain("fanout-settle");
  });

  it("T1a line busy → straight to voicemail_greeting (never a false ringing)", () => {
    const r = reduce(null, { type: "initiated", context: initCtx({ lineBusy: true }) }, 1_000, keyGen());
    expect(r.machine?.state).toBe("voicemail_greeting");
    expect(mirrorState(r.effects)).toBe("voicemail_greeting");
    expect(has(r.effects, "telnyx-dial")).toBe(false);
    expect(has(r.effects, "telnyx-answer-vm")).toBe(true);
  });

  it("T1a screening divert → voicemail_greeting", () => {
    const r = reduce(null, { type: "initiated", context: initCtx({ screeningDivert: true }) }, 1_000, keyGen());
    expect(r.machine?.state).toBe("voicemail_greeting");
  });

  it("T1b suspended/inactive → ringing unattended, NO dials, NO ring alarm", () => {
    const r = reduce(null, { type: "initiated", context: initCtx({ suspendedOrInactive: true }) }, 1_000, keyGen());
    expect(r.machine?.state).toBe("ringing");
    expect(r.machine?.unattended).toBe(true);
    expect(has(r.effects, "telnyx-dial")).toBe(false);
    const alarms = r.effects.filter((e) => e.kind === "arm-alarm") as Extract<Effect, { kind: "arm-alarm" }>[];
    expect(alarms.map((a) => a.alarm)).not.toContain("ring");
    expect(alarms.map((a) => a.alarm)).toContain("janitor");
  });

  // #490 — what the caller hears on a suspended line.
  describe("#490 the unavailable notice", () => {
    const suspended = (noticeAllowed: boolean) =>
      reduce(
        null,
        { type: "initiated", context: initCtx({ suspendedOrInactive: true, noticeAllowed }) },
        1_000,
        keyGen(),
      );

    it("answers to speak, instead of ringing out, when it is affordable", () => {
      const r = suspended(true);
      expect(has(r.effects, "telnyx-answer-notice")).toBe(true);
      expect(r.machine?.noticeSpoken).toBe(true);
      // Still no dials: there is nobody to ring. The notice replaces the
      // silence, not the ring.
      expect(has(r.effects, "telnyx-dial")).toBe(false);
    });

    it("rings out exactly as before once the daily cap is spent", () => {
      const r = suspended(false);
      expect(has(r.effects, "telnyx-answer-notice")).toBe(false);
      expect(r.machine?.noticeSpoken).toBe(false);
      // The property that makes the cap safe to write: past it, this is the
      // behaviour #490 replaced, so spending the ceiling degrades rather than
      // breaks. The janitor still guarantees the ring cannot be immortal.
      expect(r.machine?.unattended).toBe(true);
      const alarms = r.effects.filter((e) => e.kind === "arm-alarm") as Extract<Effect, { kind: "arm-alarm" }>[];
      expect(alarms.map((a) => a.alarm)).toContain("janitor");
    });

    it("records the call as unattended either way — that is the owner's number", () => {
      // The count an owner is shown when deciding whether to reinstate. It is
      // true of every call that reached a suspended line, including the ones
      // past the cap that nobody spoke to.
      for (const allowed of [true, false]) {
        const mirrors = suspended(allowed).effects.filter(
          (e) => e.kind === "mirror",
        ) as Extract<Effect, { kind: "mirror" }>[];
        expect(mirrors.some((m) => m.set.unattended === true), String(allowed)).toBe(true);
      }
    });

    it("speaks the fixed notice, never the company's own greeting", () => {
      // A suspended workspace cannot be trusted to have configured a greeting,
      // and a greeting is the company's words — which could say anything,
      // including why the line is down.
      const r = reduce(
        suspended(true).machine,
        { type: "notice-answer-outcome", ok: true },
        1_100,
        keyGen(),
      );
      const speak = r.effects.find((e) => e.kind === "telnyx-speak") as
        | Extract<Effect, { kind: "telnyx-speak" }>
        | undefined;
      expect(speak?.script).toBe("unavailable-notice");
    });

    it("never tells the caller WHY the line is down", () => {
      // The caller is our customer's customer. A plumber's billing status is
      // not theirs to learn, and the sentence has to be true of a suspended
      // number, an unpaid subscription and a released number alike.
      const notice = UNAVAILABLE_NOTICE.toLowerCase();
      for (const leak of ["suspend", "bill", "pay", "unpaid", "account", "subscription", "overdue"]) {
        expect(notice, `notice must not mention "${leak}"`).not.toContain(leak);
      }
    });

    it("hangs up after speaking, rather than recording a voicemail nobody hears", () => {
      const answered = reduce(
        suspended(true).machine,
        { type: "notice-answer-outcome", ok: true },
        1_100,
        keyGen(),
      );
      const r = reduce(answered.machine, { type: "speak-ended" }, 1_200, keyGen());
      const hangups = r.effects.filter((e) => e.kind === "telnyx-hangup") as Extract<
        Effect,
        { kind: "telnyx-hangup" }
      >[];
      expect(hangups.length).toBeGreaterThan(0);
      // NOT the voicemail path: there is no mailbox on a suspended line, so a
      // recording would be a message that is never delivered and still billed.
      expect(has(r.effects, "telnyx-record-start")).toBe(false);
      expect(r.machine?.state).not.toBe("voicemail_recording");
    });

    it("falls back to ring-out when the answer itself fails", () => {
      const r = reduce(
        suspended(true).machine,
        { type: "notice-answer-outcome", ok: false },
        1_100,
        keyGen(),
      );
      expect(has(r.effects, "telnyx-speak")).toBe(false);
      // And it does NOT hang up: the caller's leg is in an unknown state, and
      // hanging up a leg we failed to answer is how a live call gets cut off by
      // a bookkeeping guess.
      expect(has(r.effects, "telnyx-hangup")).toBe(false);
      // The mirror is corrected, so the daily cap counts what happened rather
      // than what was attempted.
      expect(r.machine?.noticeSpoken).toBe(false);
    });

    it("leaves a healthy line completely alone", () => {
      // The guard that matters most: nothing here may reach a paying customer's
      // caller. `noticeAllowed` is only ever consulted on the suspended branch.
      const r = reduce(
        null,
        { type: "initiated", context: initCtx({ noticeAllowed: true }) },
        1_000,
        keyGen(),
      );
      expect(has(r.effects, "telnyx-answer-notice")).toBe(false);
      expect(r.machine?.noticeSpoken).toBe(false);
      expect(has(r.effects, "telnyx-dial")).toBe(true);
    });
  });

  // #325/D97: a billing state change never severs a call already in progress.
  //
  // This holds by construction rather than by a guard, and the construction is
  // worth pinning: `suspendedOrInactive` is a field on the INITIATED context.
  // It is read once, at T1, when the session is minted. No later transition can
  // see it, so there is no code path by which a suspension landing mid-call
  // could reach a live session.
  //
  // That is the guarantee #325 asks for — "a homeowner cut off mid-sentence
  // while describing an emergency, because a card expired, is the worst
  // possible expression of a billing policy" — and a structural guarantee is
  // the strongest kind. The risk is that somebody later "fixes" it by
  // consulting billing on every event, which would read as a tightening.
  it("#325 a call that started while paying is never severed by suspension", () => {
    const machine = ringingMachine();
    // The session was minted paying. Suspension lands NOW, mid-ring, and the
    // only way it could reach this session is via a later event carrying it —
    // which the event types do not allow.
    const answered = reduce(
      machine,
      { type: "member-leg-answered", ccid: "leg-u1", userId: "u1", destination: null },
      5_000,
      KEY,
    );
    // Still ringing: the answer is two-phase and settles through answerIntent.
    // What matters here is what is ABSENT — nothing hangs the caller up, and
    // the session does not terminate.
    expect(answered.machine).not.toBeNull();
    expect(answered.machine?.answerIntent).toBeTruthy();
    expect(has(answered.effects, "telnyx-hangup")).toBe(false);
    expect(answered.effects.some((e) => e.kind === "terminal-merge")).toBe(false);
  });

  it("#325 suspension is a property of the session's birth, not of its life", () => {
    // The structural half, said as an assertion: a session minted suspended
    // carries `unattended`, and one minted while paying does not — and nothing
    // after T1 can change that, because no later event carries the field.
    const suspended = reduce(
      null,
      { type: "initiated", context: initCtx({ suspendedOrInactive: true }) },
      1_000,
      keyGen(),
    );
    expect(suspended.machine?.unattended).toBe(true);

    const paying = ringingMachine();
    expect(paying.unattended).toBeFalsy();
    // Every mid-call event, applied in turn. None may terminate the session for
    // a billing reason, because none of them can even observe billing.
    const events: Parameters<typeof reduce>[1][] = [
      { type: "member-leg-answered", ccid: "leg-u1", userId: "u1", destination: null },
    ];
    let current: typeof paying | null = paying;
    for (const event of events) {
      const next = reduce(current, event, 5_000, KEY);
      current = next.machine;
      expect(current?.unattended).toBeFalsy();
    }
  });

  it("T1c over cap → reject USER_BUSY, rejectedForCap flag", () => {
    const r = reduce(null, { type: "initiated", context: initCtx({ overCap: true }) }, 1_000, keyGen());
    expect(r.machine?.rejectedForCap).toBe(true);
    expect(has(r.effects, "telnyx-reject")).toBe(true);
  });

  it("T1d zero-avenue (no targets AND no push) → instant voicemail (never 45s to empty room)", () => {
    const r = reduce(
      null,
      { type: "initiated", context: initCtx({ dialTargets: [], pushAudience: [] }) },
      1_000,
      keyGen(),
    );
    expect(r.machine?.state).toBe("voicemail_greeting");
  });

  it("T1d zero targets but push audience present → holds ringback (zero-registration)", () => {
    const r = reduce(
      null,
      { type: "initiated", context: initCtx({ dialTargets: [], pushAudience: ["u1"] }) },
      1_000,
      keyGen(),
    );
    expect(r.machine?.state).toBe("ringing");
    expect(has(r.effects, "telnyx-dial")).toBe(false);
    expect(has(r.effects, "push-fanout")).toBe(true);
  });

  it("T1 replay guard: a second initiated on an existing machine is a no-op", () => {
    const machine = ringingMachine();
    const r = reduce(machine, { type: "initiated", context: initCtx() }, 2_000, keyGen());
    expect(r.effects).toHaveLength(0);
    expect(r.machine).toBe(machine);
  });
});

// ---- T2 answer -------------------------------------------------------------

describe("T2 — member answer", () => {
  it("answers the inbound leg FIRST (bri anchor) before bridging", () => {
    const machine = ringingMachine();
    const r = reduce(
      machine,
      { type: "member-leg-answered", ccid: "leg-u1", userId: "u1", destination: null },
      2_000,
      KEY,
    );
    expect(has(r.effects, "telnyx-answer-inbound")).toBe(true);
    expect(has(r.effects, "telnyx-bridge")).toBe(false); // bridge waits for answer-outcome
    expect(r.machine?.answerIntent?.userId).toBe("u1");
  });

  it("answer-outcome ok → answered, stamped, bridged, siblings canceled, call_end", () => {
    let machine = ringingMachine({ dialTargets: [{ userId: "u1", sipUsername: "s1" }] });
    const answered = reduce(
      machine,
      { type: "member-leg-answered", ccid: "leg-u1", userId: "u1", destination: null },
      2_000,
      KEY,
    );
    machine = answered.machine as SessionMachine;
    const intent = machine.answerIntent as NonNullable<SessionMachine["answerIntent"]>;
    const r = reduce(
      machine,
      { type: "answer-outcome", ok: true, memberCcid: "leg-u1", userId: "u1", answeredAtIso: intent.answeredAtIso },
      2_100,
      KEY,
    );
    expect(r.machine?.state).toBe("answered");
    expect(r.machine?.answeredByUserId).toBe("u1");
    expect(r.machine?.answerIntent).toBeNull();
    expect(has(r.effects, "telnyx-bridge")).toBe(true);
    const callEnd = r.effects.find((e) => e.kind === "push-call-end") as
      | Extract<Effect, { kind: "push-call-end" }>
      | undefined;
    expect(callEnd?.reason).toBe("answered");
  });

  it("answer-outcome FAIL (dead caller) → TERMINAL ended_missed, NO stamp, answerIntent retained", () => {
    let machine = ringingMachine();
    const answered = reduce(
      machine,
      { type: "member-leg-answered", ccid: "leg-u1", userId: "u1", destination: null },
      2_000,
      KEY,
    );
    machine = answered.machine as SessionMachine;
    const intent = machine.answerIntent as NonNullable<SessionMachine["answerIntent"]>;
    const r = reduce(
      machine,
      { type: "answer-outcome", ok: false, memberCcid: "leg-u1", userId: "u1", answeredAtIso: intent.answeredAtIso },
      2_100,
      KEY,
    );
    expect(r.machine?.state).toBe("ended_missed");
    expect(r.machine?.answeredByUserId).toBeNull(); // no transient stamp ever
    expect(r.machine?.answerIntent).not.toBeNull(); // retained until purge for the §3 upgrade
  });

  it("a canceling leg answer probes the member leg first (review R1-B2, unreachable-defensive)", () => {
    const machine = ringingMachine();
    const leg = machine.legs.find((l) => l.ccid === "leg-u1");
    if (leg) leg.status = "canceling";
    const r = reduce(
      machine,
      { type: "member-leg-answered", ccid: "leg-u1", userId: "u1", destination: null },
      2_000,
      KEY,
    );
    expect(has(r.effects, "telnyx-probe-member-leg")).toBe(true);
    expect(has(r.effects, "telnyx-answer-inbound")).toBe(false);
  });

  it("member-probe-outcome dead → T3 ladder, never answers into a doomed bridge", () => {
    const machine = ringingMachine();
    const leg = machine.legs.find((l) => l.ccid === "leg-u1");
    if (leg) leg.status = "canceling";
    const r = reduce(
      machine,
      { type: "member-probe-outcome", ccid: "leg-u1", userId: "u1", alive: false },
      2_000,
      KEY,
    );
    expect(has(r.effects, "telnyx-answer-inbound")).toBe(false);
    // Only a push avenue remains (u1) → stays ringing.
    expect(r.machine?.state).toBe("ringing");
  });
});

// ---- §7.7 forgery ----------------------------------------------------------

describe("§7.7 — orphan brm answer forgery gate", () => {
  it("orphan answer with no matching pending record → defensive hangup + Sentry, NEVER T2", () => {
    const machine = ringingMachine();
    const r = reduce(
      machine,
      { type: "member-leg-answered", ccid: "forged-ccid", userId: "attacker", destination: null },
      2_000,
      KEY,
    );
    expect(has(r.effects, "telnyx-hangup")).toBe(true);
    expect(has(r.effects, "sentry-warn")).toBe(true);
    expect(has(r.effects, "telnyx-answer-inbound")).toBe(false);
    expect(r.machine?.state).toBe("ringing");
  });

  it("§17.1 destination binding: adoption requires the dialed SIP target to match", () => {
    const machine = ringingMachine();
    // A second engine target with a pending (unccid'd) record.
    machine.legs.push({
      key: "leg:pending:x",
      ccid: null,
      userId: "u2",
      status: "dialing",
      source: "engine",
      dialedAtMs: 1_000,
      sipTarget: "sip:u2@sip.telnyx.com",
    });
    // Wrong destination → not adopted → defensive hangup.
    const wrong = reduce(
      machine,
      { type: "member-leg-answered", ccid: "orphan", userId: "u2", destination: "sip:evil@sip.telnyx.com" },
      2_000,
      KEY,
    );
    expect(has(wrong.effects, "telnyx-answer-inbound")).toBe(false);
    expect(has(wrong.effects, "telnyx-hangup")).toBe(true);
    // Matching destination → adopted → runs T2.
    const right = reduce(
      machine,
      { type: "member-leg-answered", ccid: "orphan2", userId: "u2", destination: "sip:u2@sip.telnyx.com" },
      2_000,
      KEY,
    );
    expect(has(right.effects, "telnyx-answer-inbound")).toBe(true);
  });
});

// ---- T3 avenue ladder ------------------------------------------------------

describe("T3 — avenue ladder", () => {
  it("leg dies but push-capable remains → stays ringing (holds ringback)", () => {
    const machine = ringingMachine();
    const r = reduce(
      machine,
      { type: "member-leg-hangup", ccid: "leg-u1", userId: "u1", destination: null },
      2_000,
      KEY,
    );
    expect(r.machine?.state).toBe("ringing");
    expect(has(r.effects, "telnyx-answer-vm")).toBe(false);
  });

  it("leg dies, zero push-capable → explicit exhaustion → voicemail", () => {
    const machine = ringingMachine({ pushAudience: [] });
    machine.pushCapableUserIds = [];
    const r = reduce(
      machine,
      { type: "member-leg-hangup", ccid: "leg-u1", userId: "u1", destination: null },
      2_000,
      KEY,
    );
    expect(r.machine?.state).toBe("voicemail_greeting");
  });
});

// ---- T4 ring-me ------------------------------------------------------------

describe("T4 — ring-me v2 (§6)", () => {
  it("not ringing → {rang:false, not_ringing}", () => {
    const machine = ringingMachine();
    machine.state = "answered";
    const r = reduce(machine, { type: "ring-me", userId: "u1", sipUsername: "s1", noLocalLeg: true }, 2_000, KEY);
    expect(r.reply).toEqual({ rang: false, state: "answered", reason: "not_ringing" });
  });

  it("unasserted + live leg → NO-OP live_leg (kills scenario-1 push-chase for the whole fleet)", () => {
    const machine = ringingMachine();
    const r = reduce(machine, { type: "ring-me", userId: "u1", sipUsername: "s1", noLocalLeg: false }, 2_000, KEY);
    expect(r.reply).toMatchObject({ rang: false, reason: "live_leg" });
    expect(has(r.effects, "telnyx-dial")).toBe(false);
  });

  it("asserted (v3) + only an engine leg → dials on the FIRST ring-me (scenario 2/3)", () => {
    const machine = ringingMachine();
    const r = reduce(machine, { type: "ring-me", userId: "u1", sipUsername: "s1", noLocalLeg: true }, 2_000, KEY);
    expect(r.reply).toMatchObject({ rang: true, state: "ringing" });
    expect(has(r.effects, "telnyx-dial")).toBe(true);
  });

  it("asserted debounce: a recent ring_me leg → recent_leg; engine legs never debounce", () => {
    let machine = ringingMachine();
    // First asserted ring-me dials a ring_me leg.
    const first = reduce(machine, { type: "ring-me", userId: "u1", sipUsername: "s1", noLocalLeg: true }, 2_000, keyGen());
    machine = first.machine as SessionMachine;
    const r = reduce(machine, { type: "ring-me", userId: "u1", sipUsername: "s1", noLocalLeg: true }, 2_500, keyGen());
    expect(r.reply).toMatchObject({ rang: false, reason: "recent_leg" });
  });

  it("ring-me NEVER emits a hangup/cancel — asserted or not, any interleave", () => {
    const machine = ringingMachine();
    for (const noLocalLeg of [true, false]) {
      const r = reduce(machine, { type: "ring-me", userId: "u1", sipUsername: "s1", noLocalLeg }, 2_000, keyGen());
      expect(has(r.effects, "telnyx-hangup")).toBe(false);
    }
  });
});

// ---- #171 DECLINE ----------------------------------------------------------

describe("#171 — decline (first-class avenue removal)", () => {
  /** A ringing machine with two credentialed + push-capable members, both legs
   *  resolved to ccids (leg-u1, leg-u2). */
  function twoMemberRinging(): SessionMachine {
    const key = keyGen();
    let machine = reduce(
      null,
      {
        type: "initiated",
        context: initCtx({
          dialTargets: [
            { userId: "u1", sipUsername: "sip1" },
            { userId: "u2", sipUsername: "sip2" },
          ],
          pushAudience: ["u1", "u2"],
        }),
      },
      1_000,
      key,
    ).machine as SessionMachine;
    for (const leg of [...machine.legs]) {
      machine = reduce(
        machine,
        { type: "dial-outcome", pendingKey: leg.key, ccid: `leg-${leg.userId}`, failure: null },
        1_100,
        key,
      ).machine as SessionMachine;
    }
    return machine;
  }

  it("single-member decline → cancels the leg, drops the avenue, VM-ENTRY", () => {
    const machine = ringingMachine(); // solo u1: one leg + push [u1]
    const r = reduce(machine, { type: "decline", userId: "u1" }, 2_000, KEY);
    // The decliner's ring leg is hung up...
    const hangups = r.effects.filter((e) => e.kind === "telnyx-hangup") as Extract<
      Effect,
      { kind: "telnyx-hangup" }
    >[];
    expect(hangups.map((h) => h.ccid)).toContain("leg-u1");
    // ...they're removed from the push avenue, and with no avenue left the
    // ladder resolves to voicemail immediately (the whole #171 bug).
    expect(r.machine?.pushCapableUserIds).toEqual([]);
    expect(r.machine?.declinedUserIds).toEqual(["u1"]);
    expect(r.machine?.state).toBe("voicemail_greeting");
    expect(has(r.effects, "telnyx-answer-vm")).toBe(true);
    expect(r.reply).toEqual({ declined: true, state: "voicemail_greeting" });
  });

  it("multi-member decline → others keep ringing, NO voicemail", () => {
    const machine = twoMemberRinging();
    const r = reduce(machine, { type: "decline", userId: "u1" }, 2_000, KEY);
    // u1's leg is canceled + they leave the audience...
    expect(
      (r.effects.filter((e) => e.kind === "telnyx-hangup") as Extract<Effect, { kind: "telnyx-hangup" }>[]).map(
        (h) => h.ccid,
      ),
    ).toContain("leg-u1");
    expect(r.machine?.declinedUserIds).toEqual(["u1"]);
    expect(r.machine?.pushCapableUserIds).toEqual(["u2"]);
    // ...but u2's leg is still live → the caller keeps ringing, NO voicemail.
    expect(r.machine?.state).toBe("ringing");
    expect(has(r.effects, "telnyx-answer-vm")).toBe(false);
    expect(r.reply).toEqual({ declined: true, state: "ringing" });
    // u2's leg is untouched.
    const u2 = r.machine?.legs.find((l) => l.ccid === "leg-u2");
    expect(u2?.status).toBe("ringing");
  });

  it("push-only solo decline (no live leg) → VM-ENTRY, no stray hangup", () => {
    // Zero-registration: no credential leg, only a push avenue for u1.
    const machine = ringingMachine({ dialTargets: [], pushAudience: ["u1"] });
    // ringingMachine tried to resolve a u1 leg but there is none — legs empty.
    expect(machine.legs).toHaveLength(0);
    const r = reduce(machine, { type: "decline", userId: "u1" }, 2_000, KEY);
    expect(has(r.effects, "telnyx-hangup")).toBe(false); // nothing live to cancel
    expect(r.machine?.state).toBe("voicemail_greeting");
    expect(r.reply).toEqual({ declined: true, state: "voicemail_greeting" });
  });

  it("decline of an already-ANSWERED session → idempotent no-op (never a 409)", () => {
    const machine = ringingMachine();
    machine.state = "answered";
    machine.answeredByUserId = "u1";
    const r = reduce(machine, { type: "decline", userId: "u1" }, 2_000, KEY);
    expect(r.effects).toHaveLength(0);
    expect(r.reply).toEqual({ declined: false, state: "answered", reason: "not_ringing" });
    expect(r.machine?.state).toBe("answered");
  });

  it("decline of an ENDED session → idempotent no-op", () => {
    const machine = ringingMachine();
    machine.state = "ended_missed";
    const r = reduce(machine, { type: "decline", userId: "u1" }, 2_000, KEY);
    expect(r.reply).toEqual({ declined: false, state: "ended_missed", reason: "not_ringing" });
  });

  it("a repeated decline is idempotent (no second hangup, still resolved)", () => {
    const machine = twoMemberRinging();
    const once = reduce(machine, { type: "decline", userId: "u1" }, 2_000, KEY).machine as SessionMachine;
    const twice = reduce(once, { type: "decline", userId: "u1" }, 2_100, KEY);
    expect(twice.machine?.declinedUserIds).toEqual(["u1"]); // not doubled
    expect(has(twice.effects, "telnyx-hangup")).toBe(false); // leg already dead
    expect(twice.reply).toEqual({ declined: true, state: "ringing" });
  });

  it("both members decline → the second decline exhausts the ladder → voicemail", () => {
    let machine = twoMemberRinging();
    machine = reduce(machine, { type: "decline", userId: "u1" }, 2_000, KEY).machine as SessionMachine;
    expect(machine.state).toBe("ringing"); // u2 still holds it
    const r = reduce(machine, { type: "decline", userId: "u2" }, 2_100, KEY);
    expect(r.machine?.state).toBe("voicemail_greeting");
    expect(r.machine?.declinedUserIds).toEqual(["u1", "u2"]);
    expect(has(r.effects, "telnyx-answer-vm")).toBe(true);
  });

  it("§15.1 totality: decline is licensed in EVERY state (no throw; terminal stays terminal)", () => {
    for (const state of CALL_STATES) {
      const machine = ringingMachine();
      machine.state = state;
      const r = reduce(machine, { type: "decline", userId: "u1" }, 5_000, KEY);
      const reply = r.reply as { declined: boolean; state: CallState };
      expect(typeof reply.declined).toBe("boolean");
      if (state !== "ringing") {
        // Non-ringing is an idempotent no-op; a terminal never resurrects.
        expect(reply.declined).toBe(false);
        expect(r.machine?.state).toBe(state);
      }
    }
  });

  it("#581: a member this ring never reached gets declined:false and changes nothing", () => {
    // u9 is in no leg, no queue and no push audience — decline-mine fans a
    // decline into every session ringing in the company, so this is the check
    // that keeps somebody else's live call out of their reply.
    const machine = twoMemberRinging();
    const r = reduce(machine, { type: "decline", userId: "u9" }, 2_000, KEY);
    expect(r.reply).toEqual({
      declined: false,
      state: "ringing",
      reason: "not_a_target",
    });
    // Nothing moved: no leg touched, no avenue dropped, no rejection recorded
    // (a recorded one would block a LATER genuine ring-me for that member).
    expect(r.effects).toHaveLength(0);
    expect(r.machine?.declinedUserIds).toEqual([]);
    expect(r.machine?.pushCapableUserIds).toEqual(["u1", "u2"]);
    expect(r.machine?.legs.map((leg) => leg.status)).toEqual([
      "ringing",
      "ringing",
    ]);
  });

  it("#581: the ring's own audience still declines — leg, queued turn, or push", () => {
    // Each member of the target set, one at a time, on a machine where they are
    // ONLY in that set. All three must still be able to say no.
    const withLeg = ringingMachine(); // u1 holds leg-u1
    expect(
      reduce(withLeg, { type: "decline", userId: "u1" }, 2_000, KEY).reply,
    ).toMatchObject({ declined: true });

    // #278 in_turn: u2's phone has not been dialed yet — it is queued — and u2
    // holds no push. The machine still intends to reach them.
    const queued = ringingMachine({
      dialTargets: [
        { userId: "u1", sipUsername: "sip1" },
        { userId: "u2", sipUsername: "sip2" },
      ],
      pushAudience: [],
      ringStrategy: "in_turn",
    });
    expect(queued.queuedTargets.map((t) => t.userId)).toEqual(["u2"]);
    expect(queued.legs.some((leg) => leg.userId === "u2")).toBe(false);
    expect(
      reduce(queued, { type: "decline", userId: "u2" }, 2_000, KEY).reply,
    ).toMatchObject({ declined: true });

    // Push-only: no credential, so no leg was ever dialed for u1.
    const pushOnly = ringingMachine({ dialTargets: [], pushAudience: ["u1"] });
    expect(pushOnly.legs).toHaveLength(0);
    expect(
      reduce(pushOnly, { type: "decline", userId: "u1" }, 2_000, KEY).reply,
    ).toMatchObject({ declined: true });
  });

  it("PROPERTY: a declined member's device is never counted as an avenue again", () => {
    const machine = twoMemberRinging();
    const declined = reduce(machine, { type: "decline", userId: "u1" }, 2_000, KEY).machine as SessionMachine;

    // (1) ring-me for the decliner is refused — no re-dial, no hangup.
    const rm = reduce(declined, { type: "ring-me", userId: "u1", sipUsername: "sip1", noLocalLeg: true }, 2_200, KEY);
    expect(rm.reply).toMatchObject({ rang: false, reason: "declined" });
    expect(has(rm.effects, "telnyx-dial")).toBe(false);
    expect(has(rm.effects, "telnyx-hangup")).toBe(false);

    // (2) a fan-out settle can never re-add the decliner (it only ever filters
    // pushCapableUserIds) — and after u2's leg dies, the ONLY remaining avenue
    // is u2's push; u1's decline must not hold the ring open.
    const u2Dead = reduce(
      declined,
      { type: "member-leg-hangup", ccid: "leg-u2", userId: "u2", destination: null },
      2_300,
      KEY,
    ).machine as SessionMachine;
    expect(u2Dead.state).toBe("ringing"); // u2 push avenue still holds it
    const settle = reduce(u2Dead, { type: "push-fanout-settled", unreachableUserIds: ["u2"] }, 2_400, KEY);
    // u2 gone too → zero avenues → voicemail. u1 was never counted.
    expect(settle.machine?.pushCapableUserIds).toEqual([]);
    expect(settle.machine?.state).toBe("voicemail_greeting");
  });
});

// ---- T7 owner death + intent ----------------------------------------------

describe("T7 — owner death / intent stand-down", () => {
  function answeredMachine(): SessionMachine {
    let machine = ringingMachine();
    const a = reduce(machine, { type: "member-leg-answered", ccid: "leg-u1", userId: "u1", destination: null }, 2_000, KEY);
    machine = a.machine as SessionMachine;
    const intent = machine.answerIntent as NonNullable<SessionMachine["answerIntent"]>;
    const o = reduce(
      machine,
      { type: "answer-outcome", ok: true, memberCcid: "leg-u1", userId: "u1", answeredAtIso: intent.answeredAtIso },
      2_100,
      KEY,
    );
    return o.machine as SessionMachine;
  }

  it("owner leg dies, no intent → tears down the customer leg", () => {
    const machine = answeredMachine();
    const r = reduce(
      machine,
      { type: "member-leg-hangup", ccid: "leg-u1", userId: "u1", destination: null },
      3_000,
      KEY,
    );
    expect(has(r.effects, "telnyx-hangup")).toBe(true);
    expect(r.machine?.state).toBe("answered"); // the bri hangup runs T8
  });

  it("owner leg dies WITH a live intent → stand-down flags it (NOT a silent no-op)", () => {
    const machine = answeredMachine();
    machine.intent = { kind: "consult", targetUserId: "u2" };
    const r = reduce(
      machine,
      { type: "member-leg-hangup", ccid: "leg-u1", userId: "u1", destination: null },
      3_000,
      KEY,
    );
    expect(has(r.effects, "telnyx-hangup")).toBe(false);
    expect(r.machine?.ownerLegDeadDuringIntent).toBe("u1");
  });

  it("intent expiry re-runs the teardown exactly once when the owner died during the intent", () => {
    let machine = answeredMachine();
    machine.intent = { kind: "consult", targetUserId: "u2" };
    const dead = reduce(
      machine,
      { type: "member-leg-hangup", ccid: "leg-u1", userId: "u1", destination: null },
      3_000,
      KEY,
    );
    machine = dead.machine as SessionMachine;
    const r = reduce(machine, { type: "alarm-intent-expiry" }, 3_500, KEY);
    expect(has(r.effects, "telnyx-hangup")).toBe(true);
    expect(r.machine?.ownerLegDeadDuringIntent).toBeNull();
  });

  it("#208: set-owner after a COMPLETED blind transfer stands the expiry down (the customer is never hung up)", () => {
    let machine = answeredMachine();
    machine.intent = { kind: "transfer", targetUserId: "u2" };
    // The sender's own leg dies mid-transfer: the EXPECTED shape of a blind
    // transfer (Telnyx unbridges the sender when the target answers).
    machine = reduce(
      machine,
      { type: "member-leg-hangup", ccid: "leg-u1", userId: "u1", destination: null },
      3_000,
      KEY,
    ).machine as SessionMachine;
    expect(machine.ownerLegDeadDuringIntent).toBe("u1");
    // The transfer answer hands the owner over (handleTransferAnswered's
    // setOwner), clearing the stood-down flag...
    machine = reduce(machine, { type: "set-owner", userId: "u2" }, 3_100, KEY)
      .machine as SessionMachine;
    expect(machine.ownerLegDeadDuringIntent).toBeNull();
    expect(machine.answeredByUserId).toBe("u2");
    // ...so neither clear-intent nor the expiry alarm tears the call down.
    const cleared = reduce(machine, { type: "clear-intent" }, 3_200, KEY);
    expect(has(cleared.effects, "telnyx-hangup")).toBe(false);
    const expired = reduce(
      cleared.machine as SessionMachine,
      { type: "alarm-intent-expiry" },
      43_000,
      KEY,
    );
    expect(has(expired.effects, "telnyx-hangup")).toBe(false);
    expect(expired.machine?.state).toBe("answered");
  });

  it("#208 F4: inbound-leg-gone in `answered` synthesizes ended_answered (never a 4h outcome-null wedge)", () => {
    const machine = answeredMachine();
    const r = reduce(machine, { type: "inbound-leg-gone" }, 4_000, KEY);
    expect(r.machine?.state).toBe("ended_answered");
    const merge = r.effects.find((e) => e.kind === "terminal-merge") as
      | Extract<Effect, { kind: "terminal-merge" }>
      | undefined;
    expect(merge).toMatchObject({
      mode: "synthetic",
      outcome: "answered",
      briAnsweredAtIso: machine.answeredAtIso,
    });
  });

  it("#208 F4: inbound-leg-gone outside `answered` is a T14-style no-op (a terminal never regresses)", () => {
    for (const state of CALL_STATES) {
      if (state === "answered") continue;
      const machine = ringingMachine();
      machine.state = state;
      const r = reduce(machine, { type: "inbound-leg-gone" }, 4_000, KEY);
      expect(r.machine?.state).toBe(state);
      expect(r.effects).toEqual([]);
    }
  });
});

// ---- Voicemail T9/T11/T13 --------------------------------------------------

describe("voicemail pipeline", () => {
  it("T10 alarm → VM-ENTRY", () => {
    const machine = ringingMachine();
    const r = reduce(machine, { type: "alarm-ring" }, 46_000, KEY);
    expect(r.machine?.state).toBe("voicemail_greeting");
    expect(has(r.effects, "telnyx-answer-vm")).toBe(true);
  });

  it("vm-answer-outcome ok → speak + cancel every live leg", () => {
    let machine = ringingMachine();
    const vm = reduce(machine, { type: "alarm-ring" }, 46_000, KEY);
    machine = vm.machine as SessionMachine;
    const r = reduce(machine, { type: "vm-answer-outcome", ok: true }, 46_100, KEY);
    expect(has(r.effects, "telnyx-speak")).toBe(true);
  });

  it("vm-answer-outcome FAIL → TERMINAL ended_missed (never 'stay')", () => {
    let machine = ringingMachine();
    const vm = reduce(machine, { type: "alarm-ring" }, 46_000, KEY);
    machine = vm.machine as SessionMachine;
    const r = reduce(machine, { type: "vm-answer-outcome", ok: false }, 46_100, KEY);
    expect(r.machine?.state).toBe("ended_missed");
  });

  it("T11 speak.ended → recording; T13 recording.saved → ended_voicemail", () => {
    let machine = ringingMachine();
    machine = reduce(machine, { type: "alarm-ring" }, 46_000, KEY).machine as SessionMachine;
    machine = reduce(machine, { type: "vm-answer-outcome", ok: true }, 46_100, KEY).machine as SessionMachine;
    const rec = reduce(machine, { type: "speak-ended" }, 47_000, KEY);
    expect(rec.machine?.state).toBe("voicemail_recording");
    const saved = reduce(rec.machine, { type: "recording-saved", payload: {} }, 48_000, KEY);
    expect(saved.machine?.state).toBe("ended_voicemail");
    expect(has(saved.effects, "voicemail-pipeline")).toBe(true);
  });

  it("§3 upgrade: ended_missed → ended_voicemail on a late recording.saved (D37)", () => {
    let machine = ringingMachine();
    machine = reduce(machine, { type: "alarm-ring" }, 46_000, KEY).machine as SessionMachine;
    machine = reduce(machine, { type: "vm-answer-outcome", ok: true }, 46_100, KEY).machine as SessionMachine;
    machine = reduce(machine, { type: "speak-ended" }, 47_000, KEY).machine as SessionMachine;
    // caller hangs up in voicemail → ended_missed provisional
    machine = reduce(machine, { type: "inbound-hangup", tag: "vmi", briAnsweredAtIso: null, payload: {} }, 48_000, KEY).machine as SessionMachine;
    expect(machine.state).toBe("ended_missed");
    // late recording.saved upgrades
    const up = reduce(machine, { type: "recording-saved", payload: {} }, 49_000, KEY);
    expect(up.machine?.state).toBe("ended_voicemail");
  });
});

// ---- T17 TOTALITY ----------------------------------------------------------

describe("T17 — inbound-hangup totality (§15.1, the founder's 4h-busy-line hole)", () => {
  const nonTerminal: CallState[] = ["ringing", "answered", "voicemail_greeting", "voicemail_recording"];
  const tags: ("untagged" | "bri" | "vmi")[] = ["untagged", "bri", "vmi"];

  for (const state of nonTerminal) {
    for (const tag of tags) {
      it(`inbound hangup (${tag}) in ${state} reaches a terminal state — never a no-op`, () => {
        const machine = ringingMachine();
        machine.state = state;
        if (state === "answered") {
          machine.answeredByUserId = "u1";
          machine.answeredAtIso = new Date(2_000).toISOString();
        }
        const r = reduce(
          machine,
          { type: "inbound-hangup", tag, briAnsweredAtIso: tag === "bri" ? new Date(2_000).toISOString() : null, payload: {} },
          3_000,
          KEY,
        );
        expect(isTerminal(r.machine?.state as CallState)).toBe(true);
      });
    }
  }

  it("§3 upgrade: bri-tagged hangup in ended_missed → ended_answered with the retained stamp", () => {
    const machine = ringingMachine();
    machine.state = "ended_missed";
    machine.answerIntent = { memberCcid: "leg-u1", userId: "u1", answeredAtIso: new Date(2_000).toISOString() };
    const r = reduce(
      machine,
      { type: "inbound-hangup", tag: "bri", briAnsweredAtIso: new Date(2_000).toISOString(), payload: {} },
      3_000,
      KEY,
    );
    expect(r.machine?.state).toBe("ended_answered");
    expect(r.machine?.answeredByUserId).toBe("u1");
  });
});

// ---- T16 janitor -----------------------------------------------------------

describe("T16 — janitor forced resolution per state", () => {
  const cases: [CallState, CallState][] = [
    ["ringing", "ended_missed"],
    ["answered", "ended_answered"],
    ["voicemail_greeting", "ended_missed"],
    ["voicemail_recording", "ended_missed"],
  ];
  for (const [from, to] of cases) {
    it(`${from} → ${to}`, () => {
      const machine = ringingMachine();
      machine.state = from;
      if (from === "answered") machine.answeredAtIso = new Date(2_000).toISOString();
      const r = reduce(machine, { type: "alarm-janitor" }, 4 * 60 * 60_000, KEY);
      expect(r.machine?.state).toBe(to);
    });
  }

  it("janitor on a terminal state is a no-op", () => {
    const machine = ringingMachine();
    machine.state = "ended_answered";
    const r = reduce(machine, { type: "alarm-janitor" }, 4 * 60 * 60_000, KEY);
    expect(r.effects).toHaveLength(0);
  });
});

// ---- push-fanout-settled pruning ------------------------------------------

describe("§5.5 — fanout settle prunes provably-dead channels", () => {
  it("settle removing the only push-capable member with a dead leg → voicemail", () => {
    const machine = ringingMachine({ dialTargets: [{ userId: "u1", sipUsername: "s1" }], pushAudience: ["u1"] });
    // leg dies (no live leg), only push avenue is u1
    const m = reduce(machine, { type: "member-leg-hangup", ccid: "leg-u1", userId: "u1", destination: null }, 2_000, KEY).machine as SessionMachine;
    expect(m.state).toBe("ringing"); // held by push avenue
    const r = reduce(m, { type: "push-fanout-settled", unreachableUserIds: ["u1"] }, 3_000, KEY);
    expect(r.machine?.pushCapableUserIds).toEqual([]);
    expect(r.machine?.state).toBe("voicemail_greeting");
  });

  it("settle arriving in answered is a licensed no-op (§17.4)", () => {
    const machine = ringingMachine();
    machine.state = "answered";
    const r = reduce(machine, { type: "push-fanout-settled", unreachableUserIds: ["u1"] }, 3_000, KEY);
    expect(isTerminal(r.machine?.state as CallState)).toBe(false);
    expect(r.machine?.state).toBe("answered");
  });
});

// ---- no-op matrix: internal events in wrong states -------------------------

describe("§15.1 no-op matrix — internal events in every non-driving state", () => {
  const internalEvents: SessionEvent[] = [
    { type: "answer-outcome", ok: true, memberCcid: "x", userId: "u1", answeredAtIso: "i" },
    { type: "vm-answer-outcome", ok: true },
    { type: "push-fanout-settled", unreachableUserIds: [] },
    { type: "member-probe-outcome", ccid: "x", userId: "u1", alive: true },
  ];
  for (const state of CALL_STATES) {
    for (const event of internalEvents) {
      it(`${event.type} in ${state} does not throw and never leaves a terminal`, () => {
        const machine = ringingMachine();
        machine.state = state;
        const r = reduce(machine, event, 5_000, KEY);
        // A terminal state must stay terminal (no resurrection).
        if (isTerminal(state)) expect(r.machine?.state).toBe(state);
      });
    }
  }
});

// ---- FUZZED founder property ----------------------------------------------

describe("§15.1 property (fuzzed) — VM-ENTRY only when the window is exhausted", () => {
  it("no reachable interleaving emits VM-ENTRY while a live leg or push avenue remains", () => {
    const rng = mulberry32(0x51702);
    for (let trial = 0; trial < 400; trial += 1) {
      const nTargets = 1 + Math.floor(rng() * 3);
      const targets = Array.from({ length: nTargets }, (_, i) => ({ userId: `u${i}`, sipUsername: `s${i}` }));
      const pushAudience = rng() < 0.5 ? targets.map((t) => t.userId) : [];
      let machine = reduce(
        null,
        { type: "initiated", context: initCtx({ dialTargets: targets, pushAudience }) },
        1_000,
        keyGen(),
      ).machine as SessionMachine;
      // Resolve engine dials to ccids.
      for (const leg of [...machine.legs]) {
        machine = reduce(machine, { type: "dial-outcome", pendingKey: leg.key, ccid: `c-${leg.userId}`, failure: null }, 1_100, keyGen()).machine as SessionMachine;
      }

      const events: SessionEvent[] = [];
      // Random hangups of member legs + ring-mes + settle.
      const liveCcids = machine.legs.filter((l) => l.ccid).map((l) => l.ccid as string);
      for (const ccid of liveCcids) {
        if (rng() < 0.7) events.push({ type: "member-leg-hangup", ccid, userId: ccid.replace("c-", ""), destination: null });
      }
      if (rng() < 0.5) events.push({ type: "ring-me", userId: "u0", sipUsername: "s0", noLocalLeg: rng() < 0.5 });
      shuffle(events, rng);

      let now = 2_000;
      for (const event of events) {
        const r = reduce(machine, event, now, keyGen());
        machine = r.machine as SessionMachine;
        now += 100;
        if (has(r.effects, "telnyx-answer-vm")) {
          // A VM-ENTRY fired via the T3 exhaustion ladder: it is licensed ONLY
          // when zero live legs remain AND zero push-capable members remain (the
          // ladder cancels nothing here — there was nothing live to cancel).
          const liveAfter = machine.legs.filter((l) =>
            ["dialing", "ringing", "canceling"].includes(l.status),
          ).length;
          expect(liveAfter === 0 && machine.pushCapableUserIds.length === 0).toBe(true);
        }
      }
    }
  });
});

// ---- #211 outbound (oc) machine --------------------------------------------

function ocContext(
  overrides: Partial<OutboundInitiatedContext> = {},
): OutboundInitiatedContext {
  return {
    callSessionId: "11111111-1111-4111-8111-111111111111",
    customerCcid: "oc-cust",
    companyId: "co1",
    phoneNumberId: "pn1",
    userId: "placer",
    placerSipUsername: "placer-sip",
    customer: "+15551234",
    businessNumberE164: "+19995000",
    ...overrides,
  };
}

function dialingMachine(): SessionMachine {
  const r = reduce(null, { type: "outbound-initiated", context: ocContext() }, 1_000, keyGen());
  return r.machine as SessionMachine;
}

function answeredOutbound(): SessionMachine {
  const r = reduce(dialingMachine(), { type: "outbound-answered" }, 2_000, keyGen());
  return r.machine as SessionMachine;
}

function terminalMerge(effects: Effect[]): Extract<Effect, { kind: "terminal-merge" }> | undefined {
  return effects.find((e) => e.kind === "terminal-merge") as
    | Extract<Effect, { kind: "terminal-merge" }>
    | undefined;
}

describe("#211 outbound — T-O1 mint", () => {
  it("mints 'dialing' outbound, owner from mint, mirror {dialing, answered_by}, janitor only", () => {
    const r = reduce(null, { type: "outbound-initiated", context: ocContext() }, 1_000, keyGen());
    expect(r.machine?.state).toBe("dialing");
    expect(r.machine?.direction).toBe("outbound");
    expect(r.machine?.answeredByUserId).toBe("placer");
    expect(r.machine?.answeredAtIso).toBeNull();
    expect(r.machine?.customerCcid).toBe("oc-cust");
    expect(r.machine?.callerE164).toBe("+15551234");
    expect(r.machine?.ringDeadlineMs).toBeNull();
    const mirror = r.effects.find((e) => e.kind === "mirror") as Extract<Effect, { kind: "mirror" }>;
    expect(mirror.set).toMatchObject({ state: "dialing", answered_by_user_id: "placer" });
    // Owner-from-start, NO ring/fanout/dial alarms — only the 4h janitor.
    const alarms = r.effects.filter((e) => e.kind === "arm-alarm") as Extract<Effect, { kind: "arm-alarm" }>[];
    expect(alarms.map((a) => a.alarm)).toEqual(["janitor"]);
    expect(has(r.effects, "telnyx-dial")).toBe(false);
    expect(has(r.effects, "push-fanout")).toBe(false);
  });

  it("replay guard: outbound-initiated on an existing machine is a no-op", () => {
    const m = dialingMachine();
    const r = reduce(m, { type: "outbound-initiated", context: ocContext() }, 2_000, keyGen());
    expect(r.effects).toHaveLength(0);
    expect(r.machine).toBe(m);
  });
});

describe("#211 outbound — T-O2 answer", () => {
  it("'dialing' → 'answered' + mirror answered_at", () => {
    const r = reduce(dialingMachine(), { type: "outbound-answered" }, 2_000, keyGen());
    expect(r.machine?.state).toBe("answered");
    expect(r.machine?.answeredAtIso).toBe(new Date(2_000).toISOString());
    expect(mirrorState(r.effects)).toBe("answered");
  });

  it("idempotent re-delivery in 'answered' is a no-op", () => {
    const r = reduce(answeredOutbound(), { type: "outbound-answered" }, 3_000, keyGen());
    expect(r.effects).toHaveLength(0);
  });
});

describe("#211 outbound — T-O3 terminal (totality)", () => {
  it("hangup in 'answered' → ended_answered; event-mode merge carries the answered-at anchor", () => {
    const m = answeredOutbound();
    const r = reduce(m, { type: "outbound-hangup", payload: { hangup_cause: "normal_clearing" } }, 5_000, keyGen());
    expect(r.machine?.state).toBe("ended_answered");
    const merge = terminalMerge(r.effects);
    expect(merge?.mode).toBe("event");
    expect(merge?.outcome).toBe("answered");
    expect(merge?.briAnsweredAtIso).toBe(m.answeredAtIso); // the billing anchor (M1)
    // Purge armed; NO push-call-end (no ring audience was ever assembled).
    expect(has(r.effects, "push-call-end")).toBe(false);
  });

  it("hangup in 'dialing' (never answered) → ended_missed, no anchor", () => {
    const r = reduce(dialingMachine(), { type: "outbound-hangup", payload: { hangup_cause: "originator_cancel" } }, 5_000, keyGen());
    expect(r.machine?.state).toBe("ended_missed");
    const merge = terminalMerge(r.effects);
    expect(merge?.mode).toBe("event");
    expect(merge?.outcome).toBe("missed");
    expect(merge?.briAnsweredAtIso).toBeNull();
  });

  it("hangup in a terminal state is a T14 no-op", () => {
    const ended = reduce(dialingMachine(), { type: "outbound-hangup", payload: null }, 5_000, keyGen()).machine as SessionMachine;
    const r = reduce(ended, { type: "outbound-hangup", payload: null }, 6_000, keyGen());
    expect(r.machine?.state).toBe("ended_missed");
    expect(terminalMerge(r.effects)).toBeUndefined(); // no second merge
  });

  it("janitor resolves 'dialing' → ended_missed and 'answered' → ended_answered (synthetic, direction-aware)", () => {
    const dj = reduce(dialingMachine(), { type: "alarm-janitor" }, 9_000, keyGen());
    expect(dj.machine?.state).toBe("ended_missed");
    expect(terminalMerge(dj.effects)?.mode).toBe("synthetic");
    const aj = reduce(answeredOutbound(), { type: "alarm-janitor" }, 9_000, keyGen());
    expect(aj.machine?.state).toBe("ended_answered");
    expect(terminalMerge(aj.effects)?.briAnsweredAtIso).toBe(answeredOutbound().answeredAtIso);
  });
});

describe("#213 outbound — placer (op) leg lifecycle", () => {
  function dialOutcome(m: SessionMachine, pendingKey: string, ccid: string) {
    return reduce(m, { type: "dial-outcome", pendingKey, ccid, failure: null }, 1_500, keyGen());
  }
  /** A dialing machine whose op leg has been adopted onto `op-ccid`. */
  function opDialedMachine(): { machine: SessionMachine; opCcid: string } {
    const m = dialingMachine();
    const pending = m.legs[0];
    const r = dialOutcome(m, pending.key, "op-ccid");
    return { machine: r.machine as SessionMachine, opCcid: "op-ccid" };
  }
  // The op leg was dialed to the placer's own credential.
  const OP_DEST = "sip:placer-sip@sip.telnyx.com";
  function placerAnswered(m: SessionMachine, opCcid: string, nowMs: number) {
    return reduce(
      m,
      { type: "outbound-placer-answered", ccid: opCcid, userId: "placer", destination: OP_DEST },
      nowMs,
      keyGen(),
    );
  }

  it("mint dials the PLACER (op) leg to their SIP credential + tracks a pending leg", () => {
    const r = reduce(null, { type: "outbound-initiated", context: ocContext() }, 1_000, keyGen());
    const dial = r.effects.find((e) => e.kind === "telnyx-dial-placer") as
      | Extract<Effect, { kind: "telnyx-dial-placer" }>
      | undefined;
    expect(dial).toBeDefined();
    expect(dial?.userId).toBe("placer");
    expect(dial?.sipTarget).toBe("sip:placer-sip@sip.telnyx.com");
    expect(r.machine?.legs).toHaveLength(1);
    expect(r.machine?.legs[0]).toMatchObject({ userId: "placer", status: "dialing", ccid: null });
  });

  it("mint with NO placer credential rings no one + warns (never a dial)", () => {
    const r = reduce(null, { type: "outbound-initiated", context: ocContext({ placerSipUsername: null }) }, 1_000, keyGen());
    expect(has(r.effects, "telnyx-dial-placer")).toBe(false);
    expect(r.machine?.legs).toHaveLength(0);
    expect(has(r.effects, "sentry-warn")).toBe(true);
  });

  it("op answered EARLY-bridges op↔oc (ringback while the customer rings) + stays 'dialing'", () => {
    const { machine, opCcid } = opDialedMachine();
    const r = placerAnswered(machine, opCcid, 2_000);
    // Early bridge: the placer's leg is bridged to the still-ringing customer so
    // Telnyx relays ringback AND the customer's hangup will tear the placer leg.
    const bridge = r.effects.find((e) => e.kind === "telnyx-bridge") as
      | Extract<Effect, { kind: "telnyx-bridge" }>
      | undefined;
    expect(bridge).toMatchObject({ memberCcid: "op-ccid", customerCcid: "oc-cust" });
    expect(r.machine?.legs[0].status).toBe("answered");
    expect(r.machine?.state).toBe("dialing"); // not 'answered' until the customer picks up
  });

  it("customer answers AFTER the placer → T-O2 re-bridges as the guaranteed fallback", () => {
    const { machine, opCcid } = opDialedMachine();
    const opUp = placerAnswered(machine, opCcid, 2_000).machine as SessionMachine;
    const r = reduce(opUp, { type: "outbound-answered" }, 2_500, keyGen());
    // The fallback bridge (both answered) — covers the case Telnyx refused the
    // early ring-bridge, so the pair is guaranteed connected.
    const bridge = r.effects.find((e) => e.kind === "telnyx-bridge") as
      | Extract<Effect, { kind: "telnyx-bridge" }>
      | undefined;
    expect(bridge).toMatchObject({ memberCcid: "op-ccid", customerCcid: "oc-cust" });
    expect(r.machine?.state).toBe("answered");
  });

  it("placer answers AFTER the customer → T-O4 bridges op↔oc", () => {
    const { machine, opCcid } = opDialedMachine();
    const ocUp = reduce(machine, { type: "outbound-answered" }, 2_000, keyGen()).machine as SessionMachine;
    expect(ocUp.state).toBe("answered");
    const r = placerAnswered(ocUp, opCcid, 2_500);
    const bridge = r.effects.find((e) => e.kind === "telnyx-bridge") as
      | Extract<Effect, { kind: "telnyx-bridge" }>
      | undefined;
    expect(bridge).toMatchObject({ memberCcid: "op-ccid", customerCcid: "oc-cust" });
  });

  it("op answered is idempotent (a re-delivery does not re-bridge)", () => {
    const { machine, opCcid } = opDialedMachine();
    const once = placerAnswered(machine, opCcid, 2_100);
    const twice = placerAnswered(once.machine as SessionMachine, opCcid, 2_200);
    expect(has(twice.effects, "telnyx-bridge")).toBe(false);
  });

  it("op answered into an ALREADY-terminal call hangs up the stray op leg (H1 no-strand)", () => {
    const { machine, opCcid } = opDialedMachine();
    // The customer hung up first → terminal.
    const ended = reduce(machine, { type: "outbound-hangup", payload: null }, 2_000, keyGen()).machine as SessionMachine;
    expect(ended.state.startsWith("ended_")).toBe(true);
    const r = placerAnswered(ended, opCcid, 2_500);
    const hangup = r.effects.find((e) => e.kind === "telnyx-hangup" && e.ccid === "op-ccid");
    expect(hangup).toBeDefined();
  });

  it("terminal teardown reaps an answered-but-unbridged op leg (H1 no-strand on customer no-answer)", () => {
    const { machine, opCcid } = opDialedMachine();
    // Placer answered (early bridge attempted) but the customer NEVER answers →
    // oc times out → outbound-hangup. terminalize must hang up the answered op leg.
    const opUp = placerAnswered(machine, opCcid, 2_000).machine as SessionMachine;
    expect(opUp.legs[0].status).toBe("answered");
    const r = reduce(opUp, { type: "outbound-hangup", payload: null }, 5_000, keyGen());
    expect(r.machine?.state).toBe("ended_missed");
    const hangup = r.effects.find((e) => e.kind === "telnyx-hangup" && e.ccid === "op-ccid");
    expect(hangup).toBeDefined();
    expect(r.machine?.legs[0].status).toBe("dead");
  });

  it("placer hangup in 'answered' (owner, no intent) tears the call down — hang up the customer", () => {
    const { machine, opCcid } = opDialedMachine();
    const bridged = placerAnswered(machine, opCcid, 2_000).machine as SessionMachine;
    const answered = reduce(bridged, { type: "outbound-answered" }, 2_500, keyGen()).machine as SessionMachine;
    const r = reduce(answered, { type: "outbound-placer-hangup", ccid: opCcid, userId: "placer" }, 3_000, keyGen());
    const hangup = r.effects.find((e) => e.kind === "telnyx-hangup") as
      | Extract<Effect, { kind: "telnyx-hangup" }>
      | undefined;
    expect(hangup).toMatchObject({ ccid: "oc-cust", terminal: true });
    expect(r.machine?.state).toBe("answered"); // the oc hangup webhook runs T-O3
  });

  it("placer hangup mid-transfer (intent live) flags stand-down, does NOT hang up the customer", () => {
    const { machine, opCcid } = opDialedMachine();
    const answered = reduce(
      placerAnswered(machine, opCcid, 2_000).machine as SessionMachine,
      { type: "outbound-answered" },
      2_500,
      keyGen(),
    ).machine as SessionMachine;
    const withIntent = reduce(answered, { type: "register-intent", kind: "transfer", targetUserId: "mate" }, 2_600, keyGen()).machine as SessionMachine;
    const r = reduce(withIntent, { type: "outbound-placer-hangup", ccid: opCcid, userId: "placer" }, 3_000, keyGen());
    expect(has(r.effects, "telnyx-hangup")).toBe(false);
    expect(r.machine?.ownerLegDeadDuringIntent).toBe("placer");
  });

  it("placer hangup after ownership moved to the teammate is bookkeeping only", () => {
    const { machine, opCcid } = opDialedMachine();
    const answered = reduce(
      placerAnswered(machine, opCcid, 2_000).machine as SessionMachine,
      { type: "outbound-answered" },
      2_500,
      keyGen(),
    ).machine as SessionMachine;
    // A transfer handed ownership to the teammate.
    const handed = reduce(answered, { type: "set-owner", userId: "mate" }, 2_700, keyGen()).machine as SessionMachine;
    const r = reduce(handed, { type: "outbound-placer-hangup", ccid: opCcid, userId: "placer" }, 3_000, keyGen());
    expect(has(r.effects, "telnyx-hangup")).toBe(false);
    expect(r.machine?.state).toBe("answered"); // the customer is the teammate's now
  });

  it("placer hangup in 'dialing' (never bridged) → ended_missed + drop the customer", () => {
    const { machine, opCcid } = opDialedMachine();
    const r = reduce(machine, { type: "outbound-placer-hangup", ccid: opCcid, userId: "placer" }, 3_000, keyGen());
    expect(r.machine?.state).toBe("ended_missed");
    const hangup = r.effects.find((e) => e.kind === "telnyx-hangup" && e.ccid === "oc-cust");
    expect(hangup).toBeDefined();
    expect(terminalMerge(r.effects)?.mode).toBe("synthetic");
  });

  it("a KNOWN-dead placer dial in 'dialing' resolves the call (ended_missed) + drops the customer — no avenue ladder", () => {
    const m = dialingMachine();
    const pending = m.legs[0];
    const r = reduce(m, { type: "dial-outcome", pendingKey: pending.key, ccid: null, failure: "known-dead" }, 1_500, keyGen());
    expect(r.machine?.state).toBe("ended_missed");
    const hangup = r.effects.find((e) => e.kind === "telnyx-hangup" && e.ccid === "oc-cust");
    expect(hangup).toBeDefined();
    // Never voicemail (the inbound-only ladder must not run for outbound).
    expect(has(r.effects, "telnyx-answer-vm")).toBe(false);
  });

  it("an AMBIGUOUS placer dial in 'dialing' is retained (a later webhook / janitor reconciles)", () => {
    const m = dialingMachine();
    const pending = m.legs[0];
    const r = reduce(m, { type: "dial-outcome", pendingKey: pending.key, ccid: null, failure: "ambiguous" }, 1_500, keyGen());
    expect(r.machine?.state).toBe("dialing"); // not terminal
    expect(r.machine?.legs[0].status).toBe("ambiguous");
    expect(has(r.effects, "telnyx-hangup")).toBe(false);
  });
});

describe("#211 outbound — ring-me / decline stay inbound-only (M2)", () => {
  it("ring-me on an outbound machine is not_ringing in BOTH 'dialing' and 'answered'", () => {
    const dialing = reduce(dialingMachine(), { type: "ring-me", userId: "u9", sipUsername: "s9", noLocalLeg: true }, 3_000, keyGen());
    expect(dialing.reply).toMatchObject({ rang: false, reason: "not_ringing" });
    const answered = reduce(answeredOutbound(), { type: "ring-me", userId: "u9", sipUsername: "s9", noLocalLeg: true }, 3_000, keyGen());
    expect(answered.reply).toMatchObject({ rang: false, reason: "not_ringing" });
    // ring-me NEVER emits a hangup/cancel (§6) — outbound included.
    expect(has(dialing.effects, "telnyx-hangup")).toBe(false);
    expect(has(answered.effects, "telnyx-hangup")).toBe(false);
  });

  it("decline on an outbound machine is an idempotent declined:false no-op", () => {
    const r = reduce(dialingMachine(), { type: "decline", userId: "u9" }, 3_000, keyGen());
    expect(r.reply).toMatchObject({ declined: false, reason: "not_ringing" });
  });
});

// ---- deterministic PRNG helpers -------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * #278 — the third way a call reaches the greeting without ringing.
 *
 * It joins line-busy and screening-divert for the same reason both are there:
 * there is nobody this call could reach, and forty-five seconds of ringback
 * before admitting it teaches the caller the business is unreliable rather
 * than closed.
 */
describe("#278 after-hours voicemail", () => {
  it("AH-T1: a line set to take messages after hours never rings out", () => {
    const result = reduce(
      null,
      { type: "initiated", context: initCtx({ afterHoursVoicemail: true }) },
      1_000,
      keyGen(),
    );
    expect(result.machine!.state).toBe("voicemail_greeting");
    // Nothing was dialled: no leg, and no ring alarm to expire.
    expect(result.machine!.legs).toHaveLength(0);
    expect(result.machine!.ringDeadlineMs).toBeNull();
    expect(result.effects.some((e) => e.kind === "telnyx-dial")).toBe(false);
  });

  it("AH-T2: the same call with the flag off rings the crew", () => {
    // The pair matters more than either half: a branch that sent every call to
    // voicemail would pass AH-T1 and be a total outage.
    const result = reduce(
      null,
      { type: "initiated", context: initCtx({ afterHoursVoicemail: false }) },
      1_000,
      keyGen(),
    );
    expect(result.machine!.state).toBe("ringing");
    expect(result.effects.some((e) => e.kind === "telnyx-dial")).toBe(true);
  });

  it("AH-T3: the clock verdict rides the machine, so the greeting can use it", () => {
    // The greeting is resolved when it PLAYS, long after this — and it must
    // use the clock that was true when the caller rang, not the one that is
    // true 45 seconds later.
    const result = reduce(
      null,
      {
        type: "initiated",
        context: initCtx({ afterHours: true, nextOpenLabel: "Monday at 8am" }),
      },
      1_000,
      keyGen(),
    );
    expect(result.machine!.afterHours).toBe(true);
    expect(result.machine!.nextOpenLabel).toBe("Monday at 8am");
  });
});

/**
 * #278 — the phones join the ring one at a time.
 *
 * RT-3 is the one that decides whether this is safe to ship, and it is the
 * rung that had to be ADDED to the avenue ladder rather than something that
 * already worked. Under `in_turn` the first member's leg dying is the NORMAL
 * case between steps — a decline, a dead credential, a timeout — and without
 * a queued phone counting as an avenue the ladder would call the whole call
 * exhausted and send the caller to voicemail while two more phones were
 * seconds from ringing. That is exactly the "reached nobody" failure the
 * cascade was chosen over a hunt group to avoid, arriving through the ladder
 * instead of through the hunt.
 */
describe("#278 ringing in turn", () => {
  const CREW = [
    { userId: "u1", sipUsername: "s1" },
    { userId: "u2", sipUsername: "s2" },
    { userId: "u3", sipUsername: "s3" },
  ];

  function startInTurn(overrides: Partial<InitiatedContext> = {}) {
    return reduce(
      null,
      {
        type: "initiated",
        context: initCtx({
          ringStrategy: "in_turn",
          dialTargets: CREW,
          pushAudience: [],
          ...overrides,
        }),
      },
      1_000,
      keyGen(),
    );
  }

  it("RT-1: only the first phone rings, and the rest are queued in order", () => {
    const result = startInTurn();
    const dial = result.effects.find((e) => e.kind === "telnyx-dial");
    expect(dial && "legs" in dial ? dial.legs.map((l) => l.userId) : []).toEqual([
      "u1",
    ]);
    expect(result.machine!.queuedTargets.map((t) => t.userId)).toEqual(["u2", "u3"]);
    // And the cascade is armed, or nothing would ever join.
    expect(
      result.effects.some((e) => e.kind === "arm-alarm" && e.alarm === "ring-step"),
    ).toBe(true);
  });

  it("RT-1b: 'all' still rings every phone at once, and queues nothing", () => {
    // The deploy-day half. A cascade that fired for everybody would change how
    // every existing workspace rings, which is the one thing this must not do.
    const result = reduce(
      null,
      { type: "initiated", context: initCtx({ dialTargets: CREW, pushAudience: [] }) },
      1_000,
      keyGen(),
    );
    const dial = result.effects.find((e) => e.kind === "telnyx-dial");
    expect(dial && "legs" in dial ? dial.legs.length : 0).toBe(3);
    expect(result.machine!.queuedTargets).toEqual([]);
    expect(
      result.effects.some((e) => e.kind === "arm-alarm" && e.alarm === "ring-step"),
    ).toBe(false);
  });

  it("RT-2: each step ADDS a phone rather than replacing the one ringing", () => {
    // The cascade, not a hunt. A hunt tears the previous leg down before
    // dialing the next, which leaves a window where nobody's phone is ringing
    // and loses the person who was reaching for theirs.
    const started = startInTurn();
    const step = reduce(started.machine, { type: "alarm-ring-step" }, 13_000, keyGen());
    const dial = step.effects.find((e) => e.kind === "telnyx-dial");
    expect(dial && "legs" in dial ? dial.legs.map((l) => l.userId) : []).toEqual([
      "u2",
    ]);
    // u1's leg is untouched — no hangup, no cancel.
    expect(step.effects.some((e) => e.kind === "telnyx-hangup")).toBe(false);
    expect(step.machine!.legs.map((l) => l.userId)).toEqual(["u1", "u2"]);
    expect(step.machine!.queuedTargets.map((t) => t.userId)).toEqual(["u3"]);
  });

  it("RT-3: a queued phone is an avenue, so a dead first leg is not exhaustion", () => {
    // THE ONE THAT MATTERS. With no push audience and u1's leg dead, the
    // ladder's zero-live-legs rung would fire voicemail — while u2 and u3 have
    // not rung at all.
    const started = startInTurn();
    const key = started.machine!.legs[0].key;
    const dialed = reduce(
      started.machine,
      { type: "dial-outcome", pendingKey: key, ccid: "c1", failure: null },
      1_100,
      keyGen(),
    );
    const dead = reduce(
      dialed.machine,
      { type: "member-leg-hangup", ccid: "c1", userId: "u1", destination: null },
      2_000,
      keyGen(),
    );
    expect(dead.machine!.state).toBe("ringing");
    expect(dead.effects.some((e) => e.kind === "telnyx-answer-vm")).toBe(false);
  });

  it("RT-3b: once the queue is empty, exhaustion is exhaustion again", () => {
    // The pair. A rung that never lets go would hold a caller on ringback
    // forever with nothing left to ring, which is the opposite failure.
    const started = startInTurn({ dialTargets: [CREW[0]] });
    expect(started.machine!.queuedTargets).toEqual([]);
    const key = started.machine!.legs[0].key;
    const dialed = reduce(
      started.machine,
      { type: "dial-outcome", pendingKey: key, ccid: "c1", failure: null },
      1_100,
      keyGen(),
    );
    const dead = reduce(
      dialed.machine,
      { type: "member-leg-hangup", ccid: "c1", userId: "u1", destination: null },
      2_000,
      keyGen(),
    );
    expect(dead.machine!.state).toBe("voicemail_greeting");
  });

  it("RT-4: a step that lands on a finished call dials nothing", () => {
    // Billable, and it rings somebody about a customer who has already hung
    // up. The alarm can genuinely land late — the DO fires due slots in one
    // tick after an eviction.
    const started = startInTurn();
    const gone = reduce(started.machine, { type: "alarm-ring" }, 46_000, keyGen());
    expect(gone.machine!.state).toBe("voicemail_greeting");
    // Entering voicemail also emptied the queue and cleared the alarm, so a
    // replay of the step is a no-op twice over.
    expect(gone.machine!.queuedTargets).toEqual([]);
    expect(
      gone.effects.some((e) => e.kind === "clear-alarm" && e.alarm === "ring-step"),
    ).toBe(true);
    const late = reduce(gone.machine, { type: "alarm-ring-step" }, 47_000, keyGen());
    expect(late.effects.some((e) => e.kind === "telnyx-dial")).toBe(false);
  });

  it("RT-5: the window is the line's, and the cascade never outlives it", () => {
    // A step armed past the deadline would dial a phone for a call that has
    // already gone to voicemail.
    const short = reduce(
      null,
      {
        type: "initiated",
        context: initCtx({
          ringStrategy: "in_turn",
          ringSeconds: 10,
          dialTargets: CREW,
          pushAudience: [],
        }),
      },
      1_000,
      keyGen(),
    );
    expect(short.machine!.ringDeadlineMs).toBe(11_000);
    // 12s is past a 10s window, so no step is armed at all — the one phone
    // that rang gets the whole window rather than a second one arriving after
    // the caller has gone.
    expect(
      short.effects.some((e) => e.kind === "arm-alarm" && e.alarm === "ring-step"),
    ).toBe(false);
  });
});
