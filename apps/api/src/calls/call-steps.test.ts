/**
 * #725: the call's own timeline, driven through the real reducer the way the
 * session drives it: one `callStepsBetween` per transition.
 */
import { CALL_STEP_KINDS, type CallStepKind } from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { callStepsBetween, type CallStep } from "./call-steps";
import {
  type InitiatedContext,
  type OutboundInitiatedContext,
  reduce,
  type SessionEvent,
  type SessionMachine,
} from "./transitions";

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
    afterHours: false,
    nextOpenLabel: null,
    afterHoursVoicemail: false,
    ringStrategy: "all",
    ringSeconds: 45,
    lineBusy: false,
    screeningDivert: false,
    suspendedOrInactive: false,
    noticeAllowed: false,
    overCap: false,
    blocked: false,
    dialTargets: [
      { userId: "u1", sipUsername: "sip1" },
      { userId: "u2", sipUsername: "sip2" },
    ],
    pushAudience: ["u1", "u2"],
    ...overrides,
  };
}

function ocContext(): OutboundInitiatedContext {
  return {
    callSessionId: "11111111-1111-4111-8111-111111111111",
    customerCcid: "oc-cust",
    companyId: "co1",
    phoneNumberId: "pn1",
    userId: "placer",
    placerSipUsername: "placer-sip",
    customer: "+15551234",
    businessNumberE164: "+19995000",
  };
}

/** Runs events through the reducer, collecting each transition's steps. */
function drive(
  events: (SessionEvent | ((m: SessionMachine) => SessionEvent))[],
): { machine: SessionMachine; steps: CallStep[] } {
  const key = keyGen();
  let machine: SessionMachine | null = null;
  const steps: CallStep[] = [];
  let now = 1_000;
  for (const raw of events) {
    const event = typeof raw === "function" ? raw(machine as SessionMachine) : raw;
    const result = reduce(machine, event, now, key);
    if (result.machine) {
      steps.push(...callStepsBetween(machine, result.machine, now));
      machine = result.machine;
    }
    now += 1_000;
  }
  return { machine: machine as SessionMachine, steps };
}

const kinds = (steps: CallStep[]) => steps.map((s) => s.kind);
const rekey = (userId: string) => (m: SessionMachine): SessionEvent => ({
  type: "dial-outcome",
  pendingKey: m.legs.find((l) => l.userId === userId)!.key,
  ccid: `leg-${userId}`,
  failure: null,
});

describe("#725 a call's steps", () => {
  it("an inbound call everyone declined: arrived, rang both, two declines, voicemail, ended", () => {
    const { steps } = drive([
      { type: "initiated", context: initCtx() },
      rekey("u1"),
      rekey("u2"),
      { type: "decline", userId: "u1" },
      { type: "decline", userId: "u2" },
      { type: "inbound-hangup", tag: "vmi", briAnsweredAtIso: null, payload: null },
    ]);
    expect(kinds(steps)).toEqual([
      "call_arrived",
      "call_rang",
      "call_declined",
      "call_declined",
      "call_voicemail",
      "call_ended",
    ]);
    expect(steps[0].payload).toEqual({ routing: "rang" });
    expect(steps[1].payload).toEqual({ user_ids: ["u1", "u2"] });
    expect(steps.filter((s) => s.kind === "call_declined").map((s) => s.actorUserId)).toEqual([
      "u1",
      "u2",
    ]);
    expect(steps[4].payload).toEqual({ cause: "declined_by_everyone" });
    expect(steps[5].payload).toMatchObject({ reason: "declined_by_everyone" });
  });

  it("re-keying a pending leg is not a second ring", () => {
    const { steps } = drive([{ type: "initiated", context: initCtx() }, rekey("u1"), rekey("u2")]);
    expect(kinds(steps).filter((k) => k === "call_rang")).toHaveLength(1);
  });

  it("an answered inbound call names who picked up, then ends answered", () => {
    const { steps } = drive([
      { type: "initiated", context: initCtx() },
      rekey("u1"),
      { type: "member-leg-answered", ccid: "leg-u1", userId: "u1", destination: null },
      (m) => ({
        type: "answer-outcome",
        ok: true,
        memberCcid: "leg-u1",
        userId: "u1",
        answeredAtIso: m.answerIntent!.answeredAtIso,
      }),
      { type: "inbound-hangup", tag: "bri", briAnsweredAtIso: null, payload: null },
    ]);
    const answered = steps.find((s) => s.kind === "call_answered");
    expect(answered?.actorUserId).toBe("u1");
    expect(steps.at(-1)).toMatchObject({ kind: "call_ended", payload: { reason: "answered" } });
  });

  it("a call that arrives after hours goes to voicemail for that reason", () => {
    const { steps } = drive([
      { type: "initiated", context: initCtx({ afterHoursVoicemail: true }) },
    ]);
    expect(kinds(steps)).toEqual(["call_arrived", "call_voicemail"]);
    expect(steps[1].payload).toEqual({ cause: "after_hours" });
  });

  it("an outbound call: placed by the member, answered by the customer, no rings", () => {
    const { steps } = drive([
      { type: "outbound-initiated", context: ocContext() },
      { type: "outbound-answered" },
    ]);
    expect(kinds(steps)).toEqual(["call_placed", "call_answered"]);
    expect(steps[0].actorUserId).toBe("placer");
    expect(steps[1].actorType).toBe("customer");
  });

  it("every step kind is reachable from a real call", () => {
    // A kind no scenario produces is a sentence nobody will ever read; a kind
    // produced but not listed would be refused by the database.
    const seen = new Set<CallStepKind>();
    for (const run of [
      drive([
        { type: "initiated", context: initCtx() },
        rekey("u1"),
        { type: "decline", userId: "u1" },
        { type: "decline", userId: "u2" },
        { type: "inbound-hangup", tag: "vmi", briAnsweredAtIso: null, payload: null },
      ]),
      drive([
        { type: "outbound-initiated", context: ocContext() },
        { type: "outbound-answered" },
      ]),
    ]) {
      for (const s of run.steps) seen.add(s.kind);
    }
    expect([...seen].sort()).toEqual([...CALL_STEP_KINDS].sort());
  });
});
