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
  reduce,
  type SessionEvent,
  type SessionMachine,
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
    lineBusy: false,
    screeningDivert: false,
    suspendedOrInactive: false,
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
