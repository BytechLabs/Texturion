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
import type { InitiatedContext } from "./transitions";

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
  killSwitch?: boolean;
  initiated?: InitiatedContext | "drop" | "replay-ended";
  adoptionRow?: AdoptionRow | null;
  dialResult?: () => { ccid: string } | { failure: "known-dead" | "ambiguous" };
  answerInbound?: () => "ok" | "dead";
  answerVm?: () => "ok" | "dead";
  probeAlive?: () => boolean;
  pushUnreachable?: () => string[];
  pushAudience?: string[];
  mirrorThrows?: () => boolean;
  pushFanoutThrows?: () => boolean;
}

function makeRuntime(config: FakeConfig = {}) {
  let dialN = 0;
  const calls = {
    dials: [] as { sipTarget: string; ccid: string | null }[],
    hangups: [] as string[],
    answersInbound: [] as string[],
    answersVm: [] as string[],
    bridges: [] as { member: string; inbound: string }[],
    speaks: [] as string[],
    mirrors: [] as Record<string, unknown>[],
    callEnds: [] as { reason: string; userIds: string[] }[],
    terminalMerges: [] as string[],
    voicemailPipelines: 0,
    sentryWarns: [] as string[],
    sentryErrors: 0,
    threads: 0,
  };
  const runtime: SessionRuntime = {
    now: () => Date.now(),
    uuid: () => `uuid-${dialN++}`,
    legacyKillSwitch: () => config.killSwitch === true,
    telnyx: {
      async dial(input) {
        const result = config.dialResult ? config.dialResult() : { ccid: `cc${calls.dials.length}` };
        calls.dials.push({ sipTarget: input.sipTarget, ccid: "ccid" in result ? result.ccid : null });
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
    async terminalMergeEvent() {
      calls.terminalMerges.push("event");
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

describe("CallSessionDO — kill switch (§12.4)", () => {
  it("alarm() no-ops under the flag but RE-ARMS a coarse re-check (no immortal storage)", async () => {
    const { instance, store, calls } = makeDO({ initiated: ctx(), killSwitch: true });
    await instance.alarm();
    // The real alarms did not fire (no dial/answer), and a re-check alarm is set.
    expect(calls.answersVm).toHaveLength(0);
    expect(store.getAlarmAt()).not.toBeNull();
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
