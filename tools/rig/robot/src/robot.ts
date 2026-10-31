/**
 * The robot: the far end of every call, on ROBOT-1, ROBOT-2
 * and STRANGER-1.
 *
 * A scenario hands it a plan: dial or expect a call, play a surface's code,
 * record what it hears, wait for a voicemail beep and speak, gather digits,
 * hang up on time. The robot runs the plan as Telnyx's events arrive through
 * the edge, and leaves a record: the call's ids and RTP statistics, taken at
 * test time because Telnyx's own evidence expires within minutes, and the
 * verdict on its recording, judged here and then deleted from Telnyx.
 */
import { randomUUID } from "node:crypto";
import type { Calibration } from "./audio/calibrate.ts";
import type { Margins } from "./audio/detect.ts";
import { type Surface } from "./audio/surfaces.ts";
import { judgeRecording, type RecordingJudgement } from "./judge.ts";
import type { ProbeSource } from "./probe.ts";
import { GuardRefusedError, type CallControlApi, type RequestContext } from "./telnyx.ts";

export const ROBOT_ROLES = ["ROBOT-1", "ROBOT-2", "STRANGER-1"] as const;
export type RobotRole = (typeof ROBOT_ROLES)[number];

export function isRobotRole(value: unknown): value is RobotRole {
  return typeof value === "string" && (ROBOT_ROLES as readonly string[]).includes(value);
}

/** Numbers by role, from the rig's private config; no number is ever spelled in code. */
export interface NumberBook {
  number(role: string): string | undefined;
  role(e164: string): string | undefined;
}

export interface CallPlan {
  scenario: string;
  /** Required to dial: the guard refuses a dial without a live lease. */
  lease_id?: string;
  direction: "outbound" | "inbound";
  /** The robot's number: the caller when dialing, the called number when expecting. */
  role: RobotRole;
  /** Outbound only: a role (DEV-W1) or a `sip:` address. Never a raw number. */
  to?: string;
  /** Inbound only: how long the robot lets it ring. */
  answer_after_ms?: number;
  /** Inbound only: how long to wait for the call before giving up. */
  expect_within_ms?: number;
  /** The code the robot plays; null plays nothing. Defaults to the robot's own. */
  play?: Surface | null;
  /** Defaults to true. */
  record?: boolean;
  /** The surface that should answer, or null for a line that should stay silent. */
  expect?: Surface | null;
  exclusive?: boolean;
  /** A calibration call: this surface's code is on the line, and its margin is set from the recording. */
  calibrate?: Surface;
  /** Judging window from answer; defaults to 2-12 s. */
  window?: { start_ms: number; end_ms: number };
  /** Wait for the voicemail beep, then say this. */
  voicemail?: { phrase: string; beep_timeout_ms?: number };
  gather?: { max_digits: number; terminating_digit?: string; timeout_ms?: number };
  /** Talk time from answer before the robot hangs up. */
  hangup_after_ms: number;
  /** Outbound only: give up ringing, as a caller who hangs up would. */
  hangup_before_answer_ms?: number;
  ring_timeout_secs?: number;
}

export type CallState = "dialing" | "waiting" | "ringing" | "answered" | "ended" | "done" | "failed";

export interface CallRecord {
  plan_id: string;
  plan: CallPlan;
  state: CallState;
  ids: { call_control_id?: string; call_leg_id?: string; call_session_id?: string };
  /** Inbound only: the caller's role as the number book knows it, the caller ID check. */
  from_role?: string;
  events: { type: string; at: string }[];
  dialed_at?: string;
  answered_at?: string;
  ended_at?: string;
  hangup?: { cause?: string; source?: string; sip_cause?: string };
  /** Telnyx's `call_quality_stats` from the hang-up event. */
  rtp?: unknown;
  amd?: { detection?: string; greeting?: string };
  spoke?: string;
  dtmf: string;
  gathered?: { digits: string; status?: string };
  judgement?: RecordingJudgement;
  recording_deleted?: boolean;
  errors: string[];
}

export interface Clock {
  now(): number;
  /** Runs `fn` after `ms`; the returned function cancels it. */
  after(ms: number, fn: () => void): () => void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  after(ms, fn) {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
};

export interface RobotOptions {
  telnyx: CallControlApi;
  numbers: NumberBook;
  probe: ProbeSource;
  /** The `nonprod-robot` Call Control app, as the guard's live partition names it now. */
  connectionId: () => string;
  /** Fetches a recording into memory. */
  download(url: string): Promise<Uint8Array>;
  margins?: () => Margins;
  /** Called with a calibration call's result, to keep the margin it set. */
  onCalibration?: (calibration: Calibration) => void;
  clock?: Clock;
  voice?: string;
  /** `inbound` records only what the robot hears; `dual`, both legs, is the fallback. */
  recordMode?: "inbound" | "dual";
  recordingWaitMs?: number;
  newId?: () => string;
}

const DEFAULT_EXPECT_WITHIN_MS = 120_000;
const DEFAULT_RECORDING_WAIT_MS = 120_000;
const DEFAULT_BEEP_TIMEOUT_MS = 30_000;
const HANGUP_AFTER_SPEECH_MS = 1_500;
const FINAL_STATES: ReadonlySet<CallState> = new Set(["done", "failed"]);

interface TelnyxEvent {
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export class Robot {
  readonly #o: Required<Pick<RobotOptions, "clock" | "voice" | "recordMode" | "recordingWaitMs" | "newId">> & RobotOptions;
  readonly #records = new Map<string, CallRecord>();
  readonly #byLeg = new Map<string, string>();
  /** Inbound plans by the called number. */
  readonly #waiting = new Map<string, string>();
  readonly #timers = new Map<string, (() => void)[]>();
  readonly #listeners = new Map<string, (() => void)[]>();
  readonly #pending = new Set<Promise<unknown>>();

  constructor(options: RobotOptions) {
    this.#o = {
      clock: systemClock,
      voice: "female",
      recordMode: "inbound",
      recordingWaitMs: DEFAULT_RECORDING_WAIT_MS,
      newId: randomUUID,
      ...options,
    };
  }

  get(planId: string): CallRecord | undefined {
    return this.#records.get(planId);
  }

  /** Resolves once the call is done or failed, or after `timeoutMs` with whatever it has. */
  wait(planId: string, timeoutMs: number): Promise<CallRecord | undefined> {
    const record = this.#records.get(planId);
    if (!record || FINAL_STATES.has(record.state)) return Promise.resolve(record);
    return new Promise((resolve) => {
      const cancel = this.#o.clock.after(timeoutMs, () => resolve(this.#records.get(planId)));
      const listeners = this.#listeners.get(planId) ?? [];
      listeners.push(() => {
        cancel();
        resolve(this.#records.get(planId));
      });
      this.#listeners.set(planId, listeners);
    });
  }

  /** Settles every command and judgement started so far; for tests and shutdown. */
  async idle(): Promise<void> {
    while (this.#pending.size > 0) await Promise.allSettled([...this.#pending]);
  }

  async dial(plan: CallPlan): Promise<CallRecord> {
    const record = this.#create(plan, "dialing");
    try {
      if (plan.direction !== "outbound") throw new Error("dial: the plan is not outbound");
      if (!plan.lease_id) throw new Error("dial: a run lease is required");
      const from = this.#numberOf(plan.role);
      const to = this.#destination(plan.to);
      const ringSecs = plan.ring_timeout_secs ?? 30;
      const ids = await this.#o.telnyx.dial(
        {
          connection_id: this.#o.connectionId(),
          from,
          to,
          timeout_secs: ringSecs,
          time_limit_secs: Math.min(600, Math.ceil(plan.hangup_after_ms / 1000) + 60),
          answering_machine_detection: plan.voicemail ? "detect_beep" : undefined,
          client_state: clientState(record.plan_id),
          command_id: `${record.plan_id}:dial`,
        },
        context(plan),
      );
      record.ids = { ...ids };
      record.dialed_at = this.#iso();
      this.#byLeg.set(ids.call_control_id, record.plan_id);
      this.#setState(record, "ringing");
      if (plan.hangup_before_answer_ms !== undefined) {
        this.#timer(record, plan.hangup_before_answer_ms, () => {
          if (record.state === "ringing") this.#command(record, "hangup", (id, c) => this.#o.telnyx.hangup(id, c));
        });
      }
      // However the call goes, no leg outlives its plan.
      this.#timer(record, ringSecs * 1000 + plan.hangup_after_ms + 60_000, () => {
        if (record.state === "ringing" || record.state === "answered") {
          record.errors.push("plan overran; hung up by the robot's own deadline");
          this.#command(record, "hangup", (id, c) => this.#o.telnyx.hangup(id, c));
        }
      });
    } catch (error) {
      this.#fail(record, describe(error));
    }
    return record;
  }

  expect(plan: CallPlan): CallRecord {
    const record = this.#create(plan, "waiting");
    try {
      if (plan.direction !== "inbound") throw new Error("expect: the plan is not inbound");
      const number = this.#numberOf(plan.role);
      if (this.#waiting.has(number)) throw new Error(`expect: ${plan.role} already expects a call`);
      this.#waiting.set(number, record.plan_id);
      this.#timer(record, plan.expect_within_ms ?? DEFAULT_EXPECT_WITHIN_MS, () => {
        if (record.state === "waiting") {
          this.#waiting.delete(number);
          this.#fail(record, "no call arrived");
        }
      });
    } catch (error) {
      this.#fail(record, describe(error));
    }
    return record;
  }

  /** One Telnyx webhook body, relayed by rigd. Unknown events are ignored. */
  handleEvent(body: unknown): void {
    const event = parseEvent(body);
    if (!event) return;
    const id = str(event.payload.call_control_id);
    if (event.type === "call.initiated" && str(event.payload.direction) === "incoming") {
      this.#inbound(event);
      return;
    }
    const planId = (id && this.#byLeg.get(id)) || planFromState(event.payload.client_state);
    const record = planId ? this.#records.get(planId) : undefined;
    if (!record) return;
    record.events.push({ type: event.type, at: event.occurredAt });
    switch (event.type) {
      case "call.answered":
        this.#answered(record, event);
        break;
      case "call.machine.detection.ended":
      case "call.machine.premium.detection.ended":
        record.amd = { ...record.amd, detection: str(event.payload.result) };
        break;
      case "call.machine.greeting.ended":
      case "call.machine.premium.greeting.ended":
        record.amd = { ...record.amd, greeting: str(event.payload.result) };
        this.#speakVoicemail(record);
        break;
      case "call.speak.ended":
        if (record.plan.voicemail && record.spoke) {
          this.#timer(record, HANGUP_AFTER_SPEECH_MS, () =>
            this.#command(record, "hangup", (leg, c) => this.#o.telnyx.hangup(leg, c)),
          );
        }
        break;
      case "call.dtmf.received":
        record.dtmf += str(event.payload.digit) ?? "";
        break;
      case "call.gather.ended":
        record.gathered = { digits: str(event.payload.digits) ?? "", status: str(event.payload.status) };
        break;
      case "call.hangup":
        this.#hungUp(record, event);
        break;
      case "call.recording.saved":
        this.#track(this.#recordingSaved(record, event));
        break;
    }
  }

  #inbound(event: TelnyxEvent): void {
    const to = str(event.payload.to);
    const id = str(event.payload.call_control_id);
    if (!id) return;
    const planId = to ? this.#waiting.get(to) : undefined;
    const record = planId ? this.#records.get(planId) : undefined;
    if (!record) {
      // Nothing expects this call. A robot line that rings out would be an abandoned call.
      this.#track(this.#o.telnyx.reject(id, "USER_BUSY", {}).catch(() => undefined));
      return;
    }
    this.#waiting.delete(to!);
    const from = str(event.payload.from);
    record.from_role = (from && this.#o.numbers.role(from)) || "unknown";
    record.ids = {
      call_control_id: id,
      call_leg_id: str(event.payload.call_leg_id),
      call_session_id: str(event.payload.call_session_id),
    };
    record.events.push({ type: event.type, at: event.occurredAt });
    this.#byLeg.set(id, record.plan_id);
    this.#setState(record, "ringing");
    this.#timer(record, record.plan.answer_after_ms ?? 0, () => {
      if (record.state !== "ringing") return;
      this.#command(record, "answer", (leg, c) =>
        this.#o.telnyx.answer(leg, { client_state: clientState(record.plan_id), command_id: `${record.plan_id}:answer` }, c),
      );
    });
    this.#timer(record, (record.plan.answer_after_ms ?? 0) + record.plan.hangup_after_ms + 60_000, () => {
      if (record.state === "ringing" || record.state === "answered") {
        record.errors.push("plan overran; hung up by the robot's own deadline");
        this.#command(record, "hangup", (leg, c) => this.#o.telnyx.hangup(leg, c));
      }
    });
  }

  #answered(record: CallRecord, event: TelnyxEvent): void {
    if (record.state === "answered") return;
    record.answered_at = event.occurredAt;
    this.#setState(record, "answered");
    const { plan } = record;
    const play = plan.play === undefined ? "robot" : plan.play;
    if (play && !plan.voicemail) {
      this.#command(record, "playback", async (leg, c) =>
        this.#o.telnyx.playbackStart(leg, await this.#o.probe.playback(play), c),
      );
    }
    if (plan.record ?? true) {
      this.#command(record, "record", (leg, c) =>
        this.#o.telnyx.recordStart(
          leg,
          this.#o.recordMode === "inbound"
            ? { format: "wav", channels: "single", recording_track: "inbound" }
            : { format: "wav", channels: "dual" },
          c,
        ),
      );
    }
    if (plan.gather) {
      const gather = plan.gather;
      this.#command(record, "gather", (leg, c) =>
        this.#o.telnyx.gather(
          leg,
          {
            minimum_digits: 1,
            maximum_digits: gather.max_digits,
            terminating_digit: gather.terminating_digit ?? "#",
            timeout_millis: gather.timeout_ms ?? plan.hangup_after_ms,
            gather_id: record.plan_id,
          },
          c,
        ),
      );
    }
    if (plan.voicemail) {
      this.#timer(record, plan.voicemail.beep_timeout_ms ?? DEFAULT_BEEP_TIMEOUT_MS, () => {
        if (!record.spoke) {
          record.amd = { ...record.amd, greeting: record.amd?.greeting ?? "timeout" };
          this.#speakVoicemail(record);
        }
      });
    } else {
      this.#timer(record, plan.hangup_after_ms, () =>
        this.#command(record, "hangup", (leg, c) => this.#o.telnyx.hangup(leg, c)),
      );
    }
  }

  #speakVoicemail(record: CallRecord): void {
    const voicemail = record.plan.voicemail;
    if (!voicemail || record.spoke || record.state !== "answered") return;
    record.spoke = voicemail.phrase;
    this.#command(record, "speak", (leg, c) =>
      this.#o.telnyx.speak(leg, { payload: voicemail.phrase, voice: this.#o.voice, language: "en-US", payload_type: "text" }, c),
    );
    // A speak.ended that never comes must not hold the line open.
    this.#timer(record, Math.min(record.plan.hangup_after_ms, 60_000), () =>
      this.#command(record, "hangup", (leg, c) => this.#o.telnyx.hangup(leg, c)),
    );
  }

  #hungUp(record: CallRecord, event: TelnyxEvent): void {
    if (record.state === "ended" || FINAL_STATES.has(record.state)) return;
    const wasAnswered = record.state === "answered";
    record.ended_at = event.occurredAt;
    record.hangup = {
      cause: str(event.payload.hangup_cause),
      source: str(event.payload.hangup_source),
      sip_cause: str(event.payload.sip_hangup_cause),
    };
    record.rtp = event.payload.call_quality_stats ?? undefined;
    this.#cancelTimers(record);
    const recorded = wasAnswered && (record.plan.record ?? true);
    if (recorded && record.recording_deleted === undefined) {
      this.#setState(record, "ended");
      this.#timer(record, this.#o.recordingWaitMs, () => {
        if (record.state === "ended") this.#fail(record, "the recording never arrived");
      });
      return;
    }
    if (recorded && !record.judgement) this.#fail(record, "the recording could not be judged");
    else this.#setState(record, "done");
  }

  async #recordingSaved(record: CallRecord, event: TelnyxEvent): Promise<void> {
    if (record.judgement || record.recording_deleted !== undefined) return;
    const urls = event.payload.recording_urls as { wav?: unknown } | undefined;
    const url = str(urls?.wav);
    try {
      if (!url) throw new Error("call.recording.saved carried no WAV URL");
      const wav = await this.#o.download(url);
      record.judgement = judgeRecording(wav, {
        own: record.plan.play === undefined ? "robot" : (record.plan.play ?? undefined),
        expect: record.plan.expect,
        exclusive: record.plan.exclusive,
        answerOffsetMs: answerOffset(record.answered_at, str(event.payload.recording_started_at)),
        windowStartMs: record.plan.window?.start_ms,
        windowEndMs: record.plan.window?.end_ms,
        margins: this.#o.margins?.(),
        calibrate: record.plan.calibrate,
      });
      if (record.judgement.calibration) this.#o.onCalibration?.(record.judgement.calibration);
    } catch (error) {
      record.errors.push(`judge: ${describe(error)}`);
    }
    record.recording_deleted = await this.#deleteRecordings(record, str(event.payload.recording_id));
    // A recording can close before the call does; the hang-up then finishes the record.
    if (record.state !== "ended") return;
    if (record.judgement) this.#setState(record, "done");
    else this.#fail(record, "the recording could not be judged");
  }

  /** Deletes Telnyx's copy; the robot keeps none of the audio (D112). */
  async #deleteRecordings(record: CallRecord, recordingId: string | undefined): Promise<boolean> {
    const c = context(record.plan);
    try {
      const ids = recordingId
        ? [recordingId]
        : record.ids.call_leg_id
          ? (await this.#o.telnyx.listRecordings({ call_leg_id: record.ids.call_leg_id }, c)).map((r) => r.id)
          : [];
      if (ids.length === 0) {
        record.errors.push("delete: no recording id to delete");
        return false;
      }
      for (const id of ids) await this.#o.telnyx.deleteRecording(id, c);
      return true;
    } catch (error) {
      record.errors.push(`delete: ${describe(error)}`);
      return false;
    }
  }

  #create(plan: CallPlan, state: CallState): CallRecord {
    const record: CallRecord = {
      plan_id: this.#o.newId(),
      plan,
      state,
      ids: {},
      events: [],
      dtmf: "",
      errors: [],
    };
    this.#records.set(record.plan_id, record);
    return record;
  }

  #numberOf(role: RobotRole): string {
    if (!isRobotRole(role)) throw new Error(`${String(role)} is not a robot line`);
    const number = this.#o.numbers.number(role);
    if (!number) throw new Error(`no number is configured for ${role}`);
    return number;
  }

  #destination(to: string | undefined): string {
    if (!to) throw new Error("dial: no destination");
    if (to.startsWith("sip:")) return to;
    if (/^\+?\d/.test(to)) throw new Error("dial: destinations are roles or sip: addresses, never raw numbers");
    const number = this.#o.numbers.number(to);
    if (!number) throw new Error(`dial: no number is configured for ${to}`);
    return number;
  }

  #command(
    record: CallRecord,
    name: string,
    run: (leg: string, c: RequestContext) => Promise<unknown>,
  ): void {
    const leg = record.ids.call_control_id;
    if (!leg) return;
    this.#track(
      run(leg, context(record.plan)).catch((error: unknown) => {
        record.errors.push(`${name}: ${describe(error)}`);
      }),
    );
  }

  #timer(record: CallRecord, ms: number, fn: () => void): void {
    const cancels = this.#timers.get(record.plan_id) ?? [];
    cancels.push(this.#o.clock.after(ms, fn));
    this.#timers.set(record.plan_id, cancels);
  }

  #cancelTimers(record: CallRecord): void {
    for (const cancel of this.#timers.get(record.plan_id) ?? []) cancel();
    this.#timers.delete(record.plan_id);
  }

  #setState(record: CallRecord, state: CallState): void {
    record.state = state;
    if (!FINAL_STATES.has(state)) return;
    this.#cancelTimers(record);
    for (const listener of this.#listeners.get(record.plan_id) ?? []) listener();
    this.#listeners.delete(record.plan_id);
  }

  #fail(record: CallRecord, error: string): void {
    record.errors.push(error);
    this.#setState(record, "failed");
  }

  #track(promise: Promise<unknown>): void {
    this.#pending.add(promise);
    void promise.finally(() => this.#pending.delete(promise));
  }

  #iso(): string {
    return new Date(this.#o.clock.now()).toISOString();
  }
}

function context(plan: CallPlan): RequestContext {
  return { lease: plan.lease_id, scenario: plan.scenario };
}

function clientState(planId: string): string {
  return Buffer.from(`robot:${planId}`).toString("base64");
}

function planFromState(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const decoded = Buffer.from(value, "base64").toString("utf8");
  return decoded.startsWith("robot:") ? decoded.slice("robot:".length) : undefined;
}

function answerOffset(answeredAt: string | undefined, recordingStartedAt: string | undefined): number {
  const answered = answeredAt ? Date.parse(answeredAt) : Number.NaN;
  const started = recordingStartedAt ? Date.parse(recordingStartedAt) : Number.NaN;
  return Number.isFinite(answered) && Number.isFinite(started) ? answered - started : 0;
}

function parseEvent(body: unknown): TelnyxEvent | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const outer = body as { data?: unknown };
  const data = (typeof outer.data === "object" && outer.data !== null ? outer.data : body) as {
    event_type?: unknown;
    occurred_at?: unknown;
    payload?: unknown;
  };
  if (typeof data.event_type !== "string") return undefined;
  const payload = typeof data.payload === "object" && data.payload !== null ? (data.payload as Record<string, unknown>) : {};
  return {
    type: data.event_type,
    occurredAt: typeof data.occurred_at === "string" ? data.occurred_at : new Date().toISOString(),
    payload,
  };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function describe(error: unknown): string {
  if (error instanceof GuardRefusedError) return `guard_refused:${error.rule}`;
  return error instanceof Error ? error.message : String(error);
}
