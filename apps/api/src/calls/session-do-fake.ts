/**
 * The CallSessionDO test doubles, shared by the node suite and the workerd one.
 *
 * ## Why this is a module rather than a local helper
 *
 * `session-do.test.ts` built these inline and drove the DO in node with a fake
 * storage map. That answers everything about our FIFO, because the FIFO is
 * plain JavaScript — and nothing about workerd, which is where the object
 * actually runs. #251's last open row is Durable Object saturation, and the
 * only honest way to measure it is to run THIS class, with THIS runtime, on the
 * real runtime.
 *
 * So the doubles move here and both harnesses import them. One fake, driven two
 * ways: a second one written for the load test would be a fake that agrees with
 * itself rather than with the suite that pins the behaviour.
 *
 * Nothing here asserts. `makeDO`/`reviveDO` deliberately stayed behind in the
 * node suite — they construct the object with a storage double, which is
 * exactly the part workerd must NOT share.
 */


import type { AdoptionRow, SessionRuntime } from "./runtime";
import type { InitiatedContext, OutboundInitiatedContext } from "./transitions";

// ---- in-memory storage double ----------------------------------------------

export function makeStorage() {
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
      /**
       * Mirrors the real DurableObjectStorage overloads: `put(key, value)` and
       * the multi-key `put({k: v, …})`, which commits every entry in ONE durable
       * transaction. §4.1 admission and the drain's reduce step both depend on
       * the object form, so the double has to speak it or those atomicity fixes
       * would be silently untested.
       */
      async put(
        keyOrEntries: string | Record<string, unknown>,
        value?: unknown,
      ): Promise<void> {
        if (typeof keyOrEntries === "string") {
          map.set(keyOrEntries, clone(value));
          return;
        }
        for (const [key, entry] of Object.entries(keyOrEntries)) {
          map.set(key, clone(entry));
        }
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

export interface FakeConfig {
  /** #309: false = Telnyx refused the audio, so the caller must get TTS. */
  playbackResult?: () => boolean;
  /** #309: null = no recorded greeting, which is every workspace by default. */
  greetingAudioUrl?: () => string | null;
  initiated?: InitiatedContext | "drop" | "replay-ended";
  /** #211: what loadOutboundInitiatedContext returns for a 4-part oc initiated. */
  outboundInitiated?: OutboundInitiatedContext | "reject" | "drop";
  adoptionRow?: AdoptionRow | null;
  /**
   * #251: may return a PROMISE, so a test can hold a dial open and observe how
   * many are in flight at once. That is the only way to tell a serial fan-out
   * from a batched one — at one dial target they are identical.
   */
  dialResult?: () =>
    | { ccid: string }
    | { failure: "known-dead" | "ambiguous" }
    | Promise<{ ccid: string } | { failure: "known-dead" | "ambiguous" }>;
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

export function makeRuntime(config: FakeConfig = {}) {
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
    // #309: which recorded greetings were played, and from what URL.
    playbacks: [] as { ccid: string; audioUrl: string }[],
  };
  const runtime: SessionRuntime = {
    now: () => Date.now(),
    uuid: () => `uuid-${dialN++}`,
    telnyx: {
      async dial(input) {
        const result = config.dialResult
          ? await config.dialResult()
          : { ccid: `cc${calls.dials.length}` };
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
      // #309: recorded greetings. `playbackResult` lets a test say the audio
      // is unfetchable, which is the case that must fall back to speak rather
      // than leave the caller listening to nothing.
      async playAudio(ccid, audioUrl) {
        calls.playbacks.push({ ccid, audioUrl });
        return config.playbackResult ? config.playbackResult() : true;
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
    // Null is the default because it is production's default: no workspace
    // has a recorded greeting until somebody records one.
    greetingAudioUrl: async () =>
      config.greetingAudioUrl ? config.greetingAudioUrl() : null,
  };
  return { runtime, calls };
}

// ---- driver ----------------------------------------------------------------

export const SESSION = "sess-1";

export function ctx(overrides: Partial<InitiatedContext> = {}): InitiatedContext {
  return {
    callSessionId: SESSION,
    inboundCcid: "cust-ccid",
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
    ringStrategy: "all",
    ringSeconds: 45,
    lineBusy: false,
    screeningDivert: false,
    suspendedOrInactive: false,
    noticeAllowed: false,
    overCap: false,
    dialTargets: [{ userId: "u1", sipUsername: "s1" }],
    pushAudience: ["u1"],
    ...overrides,
  };
}
