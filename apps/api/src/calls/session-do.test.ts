/**
 * Calls v3 (#170 §15.2 + §15.3) — the DO SHELL + the three founder sequences
 * as deterministic end-to-end regressions. Drives the real CallSessionDO
 * against an in-memory storage double and a fake runtime (no Telnyx, no
 * PostgREST — the cloudflare:workers base is the §15.2 aliased double).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildMemberRingState } from "../messaging/inbound-ring";
import type { TelnyxEvent } from "../messaging/types";

import { CallSessionDO } from "./session-do";
import type { AdoptionRow, SessionRuntime } from "./runtime";
import type { InitiatedContext, OutboundInitiatedContext } from "./transitions";
import {
  buildOutboundPlacerState,
  buildOutboundState,
  OUTBOUND_CUSTOMER_STATE,
} from "../messaging/voice-webhook";

// ---- in-memory storage double ----------------------------------------------

function makeStorage() {
  const map = new Map<string, unknown>();
  let alarmAt: number | null = null;
  const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
  return {
    map,
    getAlarmAt: () => alarmAt,
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        return clone(map.get(key)) as T | undefined;
      },
      async put(key: string, value: unknown): Promise<void> {
        map.set(key, clone(value));
      },
      async delete(key: string): Promise<void> {
        map.delete(key);
      },
      async deleteAll(): Promise<void> {
        map.clear();
      },
      async setAlarm(scheduledTime: number): Promise<void> {
        alarmAt = scheduledTime;
      },
      async getAlarm(): Promise<number | null> {
        return alarmAt;
      },
      async deleteAlarm(): Promise<void> {
        alarmAt = null;
      },
    },
  };
}

// ---- fake runtime ----------------------------------------------------------

interface FakeConfig {
  initiated?: InitiatedContext | "drop" | "replay-ended";
  /** #211: what loadOutboundInitiatedContext returns for a 4-part oc initiated. */
  outboundInitiated?: OutboundInitiatedContext | "reject" | "drop";
  adoptionRow?: AdoptionRow | null;
  dialResult?: () => { ccid: string } | { failure: "known-dead" | "ambiguous" };
  answerInbound?: () => "ok" | "dead";
  answerVm?: () => "ok" | "dead";
  /** #208 F4: per-ccid hangup discrimination ("dead" = leg already gone). */
  hangupResult?: (ccid: string) => "ok" | "dead";
  probeAlive?: () => boolean;
  pushUnreachable?: () => string[];
  pushAudience?: string[];
  mirrorThrows?: () => boolean;
  pushFanoutThrows?: () => boolean;
}

function makeRuntime(config: FakeConfig = {}) {
  let dialN = 0;
  const calls = {
    dials: [] as { sipTarget: string; sessionId: string; ccid: string | null }[],
    hangups: [] as string[],
    answersInbound: [] as string[],
    answersVm: [] as string[],
    bridges: [] as { member: string; inbound: string }[],
    speaks: [] as string[],
    mirrors: [] as Record<string, unknown>[],
    callEnds: [] as { reason: string; userIds: string[] }[],
    terminalMerges: [] as string[],
    /** #211: opts passed to terminalMergeEvent (S override + answered-at anchor). */
    terminalMergeEventOpts: [] as (
      | { outboundSessionId?: string; outboundAnsweredAtIso?: string | null }
      | undefined
    )[],
    voicemailPipelines: 0,
    sentryWarns: [] as string[],
    sentryErrors: 0,
    threads: 0,
  };
  const runtime: SessionRuntime = {
    now: () => Date.now(),
    uuid: () => `uuid-${dialN++}`,
    telnyx: {
      async dial(input) {
        const result = config.dialResult ? config.dialResult() : { ccid: `cc${calls.dials.length}` };
        calls.dials.push({ sipTarget: input.sipTarget, sessionId: input.sessionId, ccid: "ccid" in result ? result.ccid : null });
        return result;
      },
      async answerInbound(ccid) {
        calls.answersInbound.push(ccid);
        return config.answerInbound ? config.answerInbound() : "ok";
      },
      async answerVm(ccid) {
        calls.answersVm.push(ccid);
        return config.answerVm ? config.answerVm() : "ok";
      },
      async bridge(member, inbound) {
        calls.bridges.push({ member, inbound });
        return "ok";
      },
      async hangup(ccid) {
        calls.hangups.push(ccid);
        return config.hangupResult ? config.hangupResult(ccid) : "ok";
      },
      async reject(ccid) {
        calls.hangups.push(`reject:${ccid}`);
      },
      async speak(ccid) {
        calls.speaks.push(ccid);
      },
      async recordStart() {},
      async probeLegAlive() {
        return config.probeAlive ? config.probeAlive() : true;
      },
    },
    async mirror(_sessionId, set) {
      if (config.mirrorThrows && config.mirrorThrows()) {
        throw new Error("mirror boom");
      }
      calls.mirrors.push(set);
    },
    async ledgerInsert() {},
    async loadInitiatedContext() {
      return config.initiated ?? "drop";
    },
    async loadOutboundInitiatedContext() {
      return config.outboundInitiated ?? "reject";
    },
    async loadAdoptionRow() {
      return config.adoptionRow ?? null;
    },
    async memberEligible() {
      return true;
    },
    async computePushAudience() {
      return config.pushAudience ?? [];
    },
    async pushFanout() {
      if (config.pushFanoutThrows && config.pushFanoutThrows()) {
        throw new Error("fanout boom");
      }
      return { unreachableUserIds: config.pushUnreachable ? config.pushUnreachable() : [] };
    },
    async pushCallEnd(input) {
      calls.callEnds.push({ reason: input.reason, userIds: input.userIds });
    },
    async threadAtAnswer() {
      calls.threads += 1;
    },
    async terminalMergeEvent(_payload, opts?) {
      calls.terminalMerges.push("event");
      calls.terminalMergeEventOpts.push(opts);
    },
    async terminalMergeSynthetic(_m, outcome) {
      calls.terminalMerges.push(`synthetic:${outcome}`);
    },
    async voicemailPipeline() {
      calls.voicemailPipelines += 1;
    },
    sentryWarn(message) {
      calls.sentryWarns.push(message);
    },
    sentryError() {
      calls.sentryErrors += 1;
    },
    buildClientStates: {
      memberRing: () => "brm-state",
      briAnswered: () => "bri-state",
      vmi: () => "vmi-state",
      outboundPlacer: () => "op-state",
    },
    greetingText: () => "Hello from Acme",
  };
  return { runtime, calls };
}

// ---- driver ----------------------------------------------------------------

const SESSION = "sess-1";

function ctx(overrides: Partial<InitiatedContext> = {}): InitiatedContext {
  return {
    callSessionId: SESSION,
    inboundCcid: "cust-ccid",
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
    dialTargets: [{ userId: "u1", sipUsername: "s1" }],
    pushAudience: ["u1"],
    ...overrides,
  };
}

function makeDO(config: FakeConfig) {
  const store = makeStorage();
  const { runtime, calls } = makeRuntime(config);
  const instance = new CallSessionDO({ storage: store.storage } as never, {} as never);
  instance.installRuntime(runtime);
  return { instance, calls, store, runtime };
}

/** Rebuild a DO on the SAME storage — simulates isolate eviction. */
function reviveDO(store: ReturnType<typeof makeStorage>, config: FakeConfig) {
  const { runtime, calls } = makeRuntime(config);
  const instance = new CallSessionDO({ storage: store.storage } as never, {} as never);
  instance.installRuntime(runtime);
  return { instance, calls };
}

function initiatedEvent(id: string): TelnyxEvent {
  return {
    data: {
      id,
      event_type: "call.initiated",
      payload: { call_control_id: "cust-ccid", call_session_id: SESSION, direction: "incoming", to: "+19995000", from: "+15551000" } as never,
    },
  };
}

function memberAnsweredEvent(id: string, ccid: string): TelnyxEvent {
  return {
    data: {
      id,
      event_type: "call.answered",
      payload: {
        call_control_id: ccid,
        client_state: buildMemberRingState({ sessionId: SESSION, userId: "u1", caller: "+15551000", inboundCcid: "cust-ccid" }),
        to: "sip:s1@sip.telnyx.com",
      } as never,
    },
  };
}

function memberHangupEvent(id: string, ccid: string): TelnyxEvent {
  return {
    data: {
      id,
      event_type: "call.hangup",
      payload: {
        call_control_id: ccid,
        client_state: buildMemberRingState({ sessionId: SESSION, userId: "u1", caller: "+15551000", inboundCcid: "cust-ccid" }),
        to: "sip:s1@sip.telnyx.com",
      } as never,
    },
  };
}

function inboundHangupEvent(id: string, tag: "bri" | "vmi" | "untagged"): TelnyxEvent {
  const clientState =
    tag === "bri" ? btoa("bri||2026-01-01T00:00:00.000Z") : tag === "vmi" ? btoa("vmi|") : undefined;
  return {
    data: {
      id,
      event_type: "call.hangup",
      payload: { call_control_id: "cust-ccid", call_session_id: SESSION, direction: "incoming", client_state: clientState } as never,
    },
  };
}

async function snapshot(instance: CallSessionDO) {
  return instance.snapshot(SESSION);
}

// ---- #211 outbound (oc) helpers --------------------------------------------

/** The server session id S — a valid UUID (part-4 must pass parseOutboundSessionId).
 *  Deliberately != the Telnyx call_session_id below, to pin the S-vs-T split. */
const OUTBOUND_S = "11111111-1111-4111-8111-111111111111";
const OUTBOUND_CUSTOMER = "+15551234567";
const OC_STATE = buildOutboundState(
  OUTBOUND_CUSTOMER_STATE,
  OUTBOUND_CUSTOMER,
  "nonce-1",
  OUTBOUND_S,
);

function ocCtx(overrides: Partial<OutboundInitiatedContext> = {}): OutboundInitiatedContext {
  return {
    callSessionId: OUTBOUND_S,
    customerCcid: "oc-ccid",
    companyId: "co1",
    phoneNumberId: "pn1",
    userId: "placer-1",
    placerSipUsername: "placer-sip",
    customer: OUTBOUND_CUSTOMER,
    businessNumberE164: "+19995000",
    ...overrides,
  };
}

function ocEvent(id: string, eventType: string, extra: Record<string, unknown> = {}): TelnyxEvent {
  return {
    data: {
      id,
      event_type: eventType,
      payload: {
        call_control_id: "oc-ccid",
        // Telnyx's own session id — differs from S; the DO must NEVER key on it.
        call_session_id: "telnyx-T-9999",
        direction: "outgoing",
        to: OUTBOUND_CUSTOMER,
        from: "+19995000",
        client_state: OC_STATE,
        ...extra,
      } as never,
    },
  };
}

/** #213: an op (placer) leg event. Its ccid is the fake dial's first result
 *  ("cc0" — the mint dials exactly one op leg), and it carries the op tag. */
function opEvent(id: string, eventType: string, ccid = "cc0"): TelnyxEvent {
  return {
    data: {
      id,
      event_type: eventType,
      payload: {
        call_control_id: ccid,
        call_session_id: "telnyx-T-op",
        direction: "outgoing",
        to: "sip:placer-sip@sip.telnyx.com",
        from: "+19995000",
        client_state: buildOutboundPlacerState(OUTBOUND_S, "placer-1"),
      } as never,
    },
  };
}

/** An adopted outbound calls row (direction outbound). */
function outboundRow(overrides: Partial<AdoptionRow> = {}): AdoptionRow {
  return {
    callSessionId: OUTBOUND_S,
    companyId: "co1",
    phoneNumberId: "pn1",
    callerE164: OUTBOUND_CUSTOMER,
    outcome: null,
    answeredAt: null,
    answeredByUserId: "placer-1",
    startedAtMs: Date.now(),
    customerCallControlId: "oc-ccid",
    direction: "outbound",
    companyName: "Acme",
    greeting: null,
    businessNumberE164: "+19995000",
    ledgerLegs: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-17T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

// ---- shell tests -----------------------------------------------------------

describe("CallSessionDO — admission + serialization (§4.1)", () => {
  it("T1d RING-START dials, pushes, mirrors ringing, arms the ring alarm", async () => {
    const { instance, calls, store } = makeDO({ initiated: ctx() });
    const stamp = await instance.onTelnyxEvent(initiatedEvent("e1"));
    expect(stamp).toBe(true);
    expect(calls.dials).toHaveLength(1);
    // CALLS-CLIENT-V2 §3.2: the DO (T1d/T4) dial receives the call_session_id so
    // runtime.ts stamps it as the X-Loonext-Session custom SIP header.
    expect(calls.dials[0].sessionId).toBe(SESSION);
    const snap = await snapshot(instance);
    expect(snap?.state).toBe("ringing");
    expect(store.getAlarmAt()).not.toBeNull();
  });

  it("snapshot rides the FIFO — observes the completed transition (§17.3)", async () => {
    const { instance } = makeDO({ initiated: ctx() });
    // Fire the event and the snapshot without awaiting between: both enqueue.
    const p1 = instance.onTelnyxEvent(initiatedEvent("e1"));
    const p2 = snapshot(instance);
    const [, snap] = await Promise.all([p1, p2]);
    expect(snap?.state).toBe("ringing"); // snapshot saw the completed T1
  });

  it("duplicate event id is a dedup no-op (idempotent)", async () => {
    const { instance, calls } = makeDO({ initiated: ctx() });
    await instance.onTelnyxEvent(initiatedEvent("e1"));
    await instance.onTelnyxEvent(memberAnsweredEvent("e2", "cc0"));
    const dialsBefore = calls.dials.length;
    await instance.onTelnyxEvent(memberAnsweredEvent("e2", "cc0")); // replay
    expect(calls.dials.length).toBe(dialsBefore);
  });
});

describe("CallSessionDO — journal resume after eviction (§4.1)", () => {
  it("a crash mid-effects resumes on the next admission and completes", async () => {
    // pushFanout throws → the T1 transition rejects mid-effects, leaving an
    // unfinished journal.
    let boom = true;
    const { instance, store } = makeDO({ initiated: ctx(), pushFanoutThrows: () => boom });
    await expect(instance.onTelnyxEvent(initiatedEvent("e1"))).rejects.toThrow();
    expect(store.map.has("journal")).toBe(true);

    // Revive on the same storage with a healthy runtime; any admission resumes.
    boom = false;
    const revived = reviveDO(store, { initiated: ctx() });
    const snap = await revived.instance.snapshot(SESSION);
    expect(snap?.state).toBe("ringing");
    expect(store.map.has("journal")).toBe(false); // journal drained
  });
});

describe("CallSessionDO — adoption (§7.5)", () => {
  it("an empty DO adopts an in-flight ringing row and continues", async () => {
    const row: AdoptionRow = {
      callSessionId: SESSION,
      companyId: "co1",
      phoneNumberId: "pn1",
      callerE164: "+15551000",
      outcome: null,
      answeredAt: null,
      answeredByUserId: null,
      startedAtMs: Date.now(),
      customerCallControlId: "cust-ccid",
      direction: "inbound",
      companyName: "Acme",
      greeting: null,
      businessNumberE164: "+19995000",
      ledgerLegs: [],
    };
    const { instance } = makeDO({ adoptionRow: row });
    // A vmi speak.ended as the first v3 event on an empty DO.
    const snap = await instance.snapshot(SESSION);
    expect(snap).toBeNull(); // no machine yet (snapshot doesn't adopt)
    // An inbound hangup adopts (row exists) then terminates.
    const stamp = await instance.onTelnyxEvent(inboundHangupEvent("h1", "untagged"));
    expect(stamp).toBe(true);
    const after = await instance.snapshot(SESSION);
    expect(after?.state).toBe("ended_missed");
  });

  it("no row → a no-row inbound hangup returns stamp=false (§7.5.1, sweeper replay)", async () => {
    const { instance } = makeDO({ adoptionRow: null });
    const stamp = await instance.onTelnyxEvent(inboundHangupEvent("h1", "untagged"));
    expect(stamp).toBe(false);
  });
});

describe("CallSessionDO — forgery gate (§7.7, review R2-B3)", () => {
  it("a forged brm answer with no pending record → defensive hangup + Sentry, NO answer", async () => {
    const { instance, calls } = makeDO({ initiated: ctx() });
    await instance.onTelnyxEvent(initiatedEvent("e1"));
    // Forged: an unknown ccid for a different user with no pending/ambiguous record.
    const forged: TelnyxEvent = {
      data: {
        id: "f1",
        event_type: "call.answered",
        payload: {
          call_control_id: "forged-ccid",
          client_state: buildMemberRingState({ sessionId: SESSION, userId: "attacker", caller: "+15551000", inboundCcid: "cust-ccid" }),
          to: "sip:evil@sip.telnyx.com",
        } as never,
      },
    };
    await instance.onTelnyxEvent(forged);
    expect(calls.answersInbound).toHaveLength(0); // NEVER answered into a forged leg
    expect(calls.hangups).toContain("forged-ccid"); // defensively hung up
    expect(calls.sentryWarns.some((m) => m.includes("orphan brm"))).toBe(true);
  });
});

describe("CallSessionDO — decline (#171)", () => {
  it("solo decline → cancels the leg, drops the avenue, answers voicemail; always-200 declined:true", async () => {
    const { instance, calls } = makeDO({ initiated: ctx() });
    await instance.onTelnyxEvent(initiatedEvent("e1")); // dials cc0 for u1
    const reply = await instance.decline({ sessionId: SESSION, userId: "u1" });
    expect(reply).toEqual({ declined: true, state: "voicemail_greeting" });
    expect(calls.hangups).toContain("cc0"); // decliner's ring leg hung up
    expect(calls.answersVm).toHaveLength(1); // no avenue left → voicemail
    const snap = await snapshot(instance);
    expect(snap?.state).toBe("voicemail_greeting");
  });

  it("multi-member decline → others keep ringing, NO voicemail", async () => {
    const { instance, calls } = makeDO({
      initiated: ctx({
        dialTargets: [
          { userId: "u1", sipUsername: "s1" },
          { userId: "u2", sipUsername: "s2" },
        ],
        pushAudience: ["u1", "u2"],
      }),
    });
    await instance.onTelnyxEvent(initiatedEvent("e1")); // cc0=u1, cc1=u2
    const reply = await instance.decline({ sessionId: SESSION, userId: "u1" });
    expect(reply).toEqual({ declined: true, state: "ringing" });
    expect(calls.hangups).toContain("cc0"); // u1's leg canceled
    expect(calls.answersVm).toHaveLength(0); // caller still ringing u2
    const snap = await snapshot(instance);
    expect(snap?.state).toBe("ringing");
  });

  it("decline of an already-answered session → idempotent 200 {declined:false}", async () => {
    const { instance } = makeDO({ initiated: ctx() });
    await instance.onTelnyxEvent(initiatedEvent("e1"));
    await instance.onTelnyxEvent(memberAnsweredEvent("e2", "cc0")); // → answered
    const reply = await instance.decline({ sessionId: SESSION, userId: "u1" });
    expect(reply).toEqual({ declined: false, state: "answered", reason: "not_ringing" });
  });

  it("decline against an empty DO with no row → {declined:false} (never throws)", async () => {
    const { instance } = makeDO({ adoptionRow: null });
    const reply = await instance.decline({ sessionId: SESSION, userId: "u1" });
    expect(reply).toEqual({ declined: false, state: "ended_missed", reason: "not_ringing" });
  });

  it("a declined member is never re-rung by a later ring-me within the session", async () => {
    const { instance, calls } = makeDO({
      initiated: ctx({
        dialTargets: [
          { userId: "u1", sipUsername: "s1" },
          { userId: "u2", sipUsername: "s2" },
        ],
        pushAudience: ["u1", "u2"],
      }),
    });
    await instance.onTelnyxEvent(initiatedEvent("e1"));
    await instance.decline({ sessionId: SESSION, userId: "u1" });
    const dialsBefore = calls.dials.length;
    const rm = await instance.ringMe({ sessionId: SESSION, userId: "u1", sipUsername: "s1", noLocalLeg: true });
    expect(rm).toMatchObject({ rang: false, reason: "declined" });
    expect(calls.dials.length).toBe(dialsBefore); // no re-dial for the decliner
  });
});

describe("CallSessionDO (#208 F4): dead-customer-leg teardown", () => {
  it("owner death where the customer leg is ALREADY dead synthesizes the terminal (no 4h outcome-null wedge)", async () => {
    const { instance, calls } = makeDO({
      initiated: ctx(),
      // The T7 teardown's hangup of the customer leg discriminates "dead":
      // the leg was already gone, so no bri webhook will ever run T8.
      hangupResult: (ccid) => (ccid === "cust-ccid" ? "dead" : "ok"),
    });
    await instance.onTelnyxEvent(initiatedEvent("e1"));
    await instance.onTelnyxEvent(memberAnsweredEvent("e2", "cc0")); // → answered
    // The owner's leg dies with NO intent live → T7 hangs up the customer leg.
    await instance.onTelnyxEvent(memberHangupEvent("e3", "cc0"));
    expect(calls.hangups).toContain("cust-ccid"); // the teardown DID try
    const snap = await snapshot(instance);
    expect(snap?.state).toBe("ended_answered"); // synthesized, not stranded
    expect(calls.terminalMerges).toContain("synthetic:answered");
    expect(calls.mirrors.some((m) => m.state === "ended_answered")).toBe(true);
  });

  it("counterfactual: a LIVE customer leg is not synthesized (its own bri hangup runs T8)", async () => {
    const { instance, calls } = makeDO({ initiated: ctx() }); // hangup → "ok"
    await instance.onTelnyxEvent(initiatedEvent("e1"));
    await instance.onTelnyxEvent(memberAnsweredEvent("e2", "cc0"));
    await instance.onTelnyxEvent(memberHangupEvent("e3", "cc0"));
    const snap = await snapshot(instance);
    expect(snap?.state).toBe("answered"); // the bri hangup will run T8
    expect(calls.terminalMerges).toHaveLength(0);
  });
});

// ---- THE THREE FOUNDER SEQUENCES (§15.3) -----------------------------------

describe("Founder sequence 1 — FOREGROUND (banner never vanishes → answer)", () => {
  it("initiated → member answers → answered; NO voicemail ever fires", async () => {
    const { instance, calls } = makeDO({ initiated: ctx() });
    await instance.onTelnyxEvent(initiatedEvent("e1"));
    // The engine leg was dialed (ccid cc0). The member answers it.
    await instance.onTelnyxEvent(memberAnsweredEvent("e2", "cc0"));
    const snap = await snapshot(instance);
    expect(snap?.state).toBe("answered");
    expect(snap?.answered_by_user_id).toBe("u1");
    expect(calls.answersVm).toHaveLength(0); // voicemail NEVER answered
    expect(calls.bridges).toHaveLength(1);
    expect(calls.callEnds.some((e) => e.reason === "answered")).toBe(true);
  });

  it("counterfactual: nobody answers → the t+45 ALARM (and only the alarm) starts voicemail", async () => {
    const { instance, calls, store } = makeDO({ initiated: ctx() });
    await instance.onTelnyxEvent(initiatedEvent("e1"));
    // No leg death, no answer. Advance past the ring window and fire the alarm.
    vi.setSystemTime(new Date(Date.now() + 46_000));
    await instance.alarm();
    const snap = await snapshot(instance);
    expect(snap?.state).toBe("voicemail_greeting");
    expect(calls.answersVm).toHaveLength(1);
    void store;
  });
});

describe("Founder sequence 2 — KILLED APP (ringback held → push wake → ring-me → answer)", () => {
  it("engine leg fails fast → stays ringing on the push avenue → ring-me dials → answered", async () => {
    // The engine dial fails fast (unregistered SIP) but a push channel exists.
    let firstDial = true;
    const { instance, calls } = makeDO({
      initiated: ctx(),
      dialResult: () => {
        if (firstDial) {
          firstDial = false;
          return { failure: "known-dead" };
        }
        return { ccid: "ringme-cc" };
      },
      pushAudience: ["u1"],
    });
    await instance.onTelnyxEvent(initiatedEvent("e1"));
    // The engine leg died on dial → T3 ladder holds ringback (push avenue u1).
    let snap = await snapshot(instance);
    expect(snap?.state).toBe("ringing");
    expect(calls.answersVm).toHaveLength(0); // NO early voicemail

    // Woken client rings itself on the FIRST ring-me (asserted, no local leg).
    const reply = await instance.ringMe({ sessionId: SESSION, userId: "u1", sipUsername: "s1", noLocalLeg: true });
    expect(reply.rang).toBe(true);

    // The fresh leg (ringme-cc) answers.
    await instance.onTelnyxEvent(memberAnsweredEvent("e3", "ringme-cc"));
    snap = await snapshot(instance);
    expect(snap?.state).toBe("answered");
  });
});

describe("Founder sequence 3 — BACKGROUND (ring-me coexists with a live engine leg, cancels nothing)", () => {
  it("ring-me while the engine leg is LIVE dials a second leg and cancels NOTHING", async () => {
    const { instance, calls } = makeDO({ initiated: ctx() });
    await instance.onTelnyxEvent(initiatedEvent("e1"));
    const dialsAfterStart = calls.dials.length;
    const hangupsAfterStart = calls.hangups.length;

    // The frozen-socket client wakes and rings itself, asserting no LOCAL leg —
    // the engine leg is still live (possibly presenting on another device).
    const reply = await instance.ringMe({ sessionId: SESSION, userId: "u1", sipUsername: "s1", noLocalLeg: true });
    expect(reply.rang).toBe(true);
    expect(calls.dials.length).toBe(dialsAfterStart + 1); // a SECOND leg coexists
    expect(calls.hangups.length).toBe(hangupsAfterStart); // ring-me canceled NOTHING

    const snap = await snapshot(instance);
    const liveLegs = (snap?.legs ?? []).filter((l) => l.status === "ringing" || l.status === "dialing");
    expect(liveLegs.length).toBeGreaterThanOrEqual(1);
  });

  it("an UNASSERTED ring-me (pre-v3) with a live leg is a NO-OP (kills the push-chase)", async () => {
    const { instance, calls } = makeDO({ initiated: ctx() });
    await instance.onTelnyxEvent(initiatedEvent("e1"));
    const dialsBefore = calls.dials.length;
    const reply = await instance.ringMe({ sessionId: SESSION, userId: "u1", sipUsername: "s1", noLocalLeg: false });
    expect(reply).toMatchObject({ rang: false, reason: "live_leg" });
    expect(calls.dials.length).toBe(dialsBefore); // no dial
    expect(calls.hangups).toHaveLength(0); // and no cancel
  });
});

// ---- #211 outbound (oc) sessions -------------------------------------------

describe("CallSessionDO — outbound (oc) sessions (#211)", () => {
  it("T-O1: a 4-part oc call.initiated mints a 'dialing' outbound machine, owner from mint", async () => {
    const { instance, calls, store } = makeDO({ outboundInitiated: ocCtx() });
    const stamp = await instance.onTelnyxEvent(ocEvent("e1", "call.initiated"));
    expect(stamp).toBe(true);
    // Owner is mirrored from mint; state 'dialing'.
    const snap = await instance.snapshot(OUTBOUND_S);
    expect(snap?.state).toBe("dialing");
    expect(snap?.direction).toBe("outbound");
    expect(snap?.answered_by_user_id).toBe("placer-1");
    // #213: the mint dials the PLACER (op) leg to their SIP credential; the
    // janitor is armed but no ring alarm.
    expect(calls.dials).toHaveLength(1);
    expect(calls.dials[0]).toMatchObject({
      sipTarget: "sip:placer-sip@sip.telnyx.com",
      sessionId: OUTBOUND_S,
    });
    expect(store.getAlarmAt()).not.toBeNull();
    const mirrored = calls.mirrors.find((m) => m.state === "dialing");
    expect(mirrored).toMatchObject({ state: "dialing", answered_by_user_id: "placer-1" });
  });

  it("T-O1 reject: a rejected context hangs up the leg and mints NOTHING", async () => {
    const { instance, calls } = makeDO({ outboundInitiated: "reject" });
    const stamp = await instance.onTelnyxEvent(ocEvent("e1", "call.initiated"));
    expect(stamp).toBe(true);
    // The unauthorized leg is hung up; no machine minted.
    expect(calls.hangups).toContain("oc-ccid");
    const snap = await instance.snapshot(OUTBOUND_S);
    expect(snap).toBeNull();
  });

  it("T-O2: oc call.answered moves 'dialing' → 'answered' and mirrors answered_at", async () => {
    const { instance, calls } = makeDO({ outboundInitiated: ocCtx() });
    await instance.onTelnyxEvent(ocEvent("e1", "call.initiated"));
    await instance.onTelnyxEvent(ocEvent("e2", "call.answered"));
    const snap = await instance.snapshot(OUTBOUND_S);
    expect(snap?.state).toBe("answered");
    expect(snap?.answered_at).not.toBeNull();
    expect(calls.mirrors.some((m) => m.state === "answered" && m.answered_at)).toBe(true);
  });

  it("T-O3 answered: hangup → ended_answered; terminal-merge carries S + the answered-at anchor (M1)", async () => {
    const { instance, calls } = makeDO({ outboundInitiated: ocCtx() });
    await instance.onTelnyxEvent(ocEvent("e1", "call.initiated"));
    await instance.onTelnyxEvent(ocEvent("e2", "call.answered"));
    const answeredSnap = await instance.snapshot(OUTBOUND_S);
    const answeredAt = answeredSnap?.answered_at;
    await instance.onTelnyxEvent(
      ocEvent("e3", "call.hangup", {
        hangup_cause: "normal_clearing",
        start_time: "2026-07-17T12:00:00.000Z",
        end_time: "2026-07-17T12:05:00.000Z",
      }),
    );
    const snap = await instance.snapshot(OUTBOUND_S);
    expect(snap?.state).toBe("ended_answered");
    // The EVENT-mode merge ran (meters Stripe), keyed on S with the answered-at
    // anchor — NOT Telnyx's T, and mirror-independent.
    expect(calls.terminalMerges).toContain("event");
    const opts = calls.terminalMergeEventOpts.at(-1);
    expect(opts?.outboundSessionId).toBe(OUTBOUND_S);
    expect(opts?.outboundAnsweredAtIso).toBe(answeredAt);
  });

  it("T-O3 from dialing (never answered) → ended_missed, no answered-at anchor", async () => {
    const { instance, calls } = makeDO({ outboundInitiated: ocCtx() });
    await instance.onTelnyxEvent(ocEvent("e1", "call.initiated"));
    await instance.onTelnyxEvent(
      ocEvent("e2", "call.hangup", { hangup_cause: "originator_cancel" }),
    );
    const snap = await instance.snapshot(OUTBOUND_S);
    expect(snap?.state).toBe("ended_missed");
    const opts = calls.terminalMergeEventOpts.at(-1);
    expect(opts?.outboundSessionId).toBe(OUTBOUND_S);
    expect(opts?.outboundAnsweredAtIso).toBeNull();
  });

  it("adoption: an empty DO adopts an outbound ANSWERED row as 'answered' (no ringDeadline, D15)", async () => {
    const { instance } = makeDO({
      outboundInitiated: ocCtx(),
      adoptionRow: outboundRow({ answeredAt: "2026-07-17T12:00:00.000Z" }),
    });
    // First event on an empty DO is a hangup — adopts the outbound row, then T-O3.
    const stamp = await instance.onTelnyxEvent(
      ocEvent("h1", "call.hangup", {
        hangup_cause: "normal_clearing",
        start_time: "2026-07-17T12:00:00.000Z",
        end_time: "2026-07-17T12:03:00.000Z",
      }),
    );
    expect(stamp).toBe(true);
    const snap = await instance.snapshot(OUTBOUND_S);
    // Adopted as 'answered' (answered_at present) then hung up → ended_answered.
    expect(snap?.state).toBe("ended_answered");
  });

  it("part-4 != S: loadOutboundInitiatedContext rejecting mints nothing (S1/M3 self-DoS bound)", async () => {
    // The runtime is the authority; a 'reject' here models a forged part-4 that
    // did not equal the nonce-bound S. The shell hangs up and never mints.
    const { instance, calls } = makeDO({ outboundInitiated: "reject" });
    await instance.onTelnyxEvent(ocEvent("e1", "call.initiated"));
    expect(await instance.snapshot(OUTBOUND_S)).toBeNull();
    expect(calls.mirrors).toHaveLength(0); // no state ever mirrored
    expect(calls.hangups).toContain("oc-ccid");
  });

  // ---- #213: the placer (op) leg on the DO ---------------------------------

  it("T-O4: the placer answering EARLY-bridges op↔oc (ringback), still 'dialing' until the customer answers", async () => {
    const { instance, calls } = makeDO({ outboundInitiated: ocCtx() });
    await instance.onTelnyxEvent(ocEvent("e1", "call.initiated")); // mint + dial op (cc0)
    await instance.onTelnyxEvent(opEvent("e2", "call.answered")); // placer answers first
    // Early bridge fired (so Telnyx relays ringback and will tear op on oc death).
    expect(calls.bridges).toContainEqual({ member: "cc0", inbound: "oc-ccid" });
    expect((await instance.snapshot(OUTBOUND_S))?.state).toBe("dialing");
    await instance.onTelnyxEvent(ocEvent("e3", "call.answered")); // customer answers
    expect((await instance.snapshot(OUTBOUND_S))?.state).toBe("answered");
    // The guaranteed fallback bridge also fired (harmless re-bridge of the pair).
    expect(calls.bridges.filter((b) => b.member === "cc0" && b.inbound === "oc-ccid")).toHaveLength(2);
  });

  it("op call.initiated is a no-op — never misrouted to the inbound loadInitiatedContext", async () => {
    const { instance, calls } = makeDO({ outboundInitiated: ocCtx() });
    await instance.onTelnyxEvent(ocEvent("e1", "call.initiated"));
    const dialsBefore = calls.dials.length;
    const stamp = await instance.onTelnyxEvent(opEvent("e2", "call.initiated"));
    expect(stamp).toBe(true);
    // No inbound mint, no extra dial — the DO already dialed the op leg.
    expect(calls.dials.length).toBe(dialsBefore);
    expect((await instance.snapshot(OUTBOUND_S))?.direction).toBe("outbound");
  });

  it("T-O5: the placer hanging up after answer tears the call down (customer hung up)", async () => {
    const { instance, calls } = makeDO({ outboundInitiated: ocCtx() });
    await instance.onTelnyxEvent(ocEvent("e1", "call.initiated"));
    await instance.onTelnyxEvent(opEvent("e2", "call.answered"));
    await instance.onTelnyxEvent(ocEvent("e3", "call.answered")); // customer picks up → answered
    expect((await instance.snapshot(OUTBOUND_S))?.state).toBe("answered");
    await instance.onTelnyxEvent(opEvent("e4", "call.hangup")); // placer ends the call
    // Owner (the placer) dropped with no intent → teardown hangs up the customer.
    expect(calls.hangups).toContain("oc-ccid");
  });
});
