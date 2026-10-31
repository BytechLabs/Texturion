/**
 * Fakes for the robot's tests and for the scenario tests in rigd: a Call
 * Control API that records every command, and a clock that only moves when
 * told to. Numbers are in the fictional 555-01xx range.
 */
import type { Clock } from "./robot.ts";
import type { CallControlApi, CallIds, RequestContext } from "./telnyx.ts";
import { numberBook } from "./numbers.ts";

export const TEST_NUMBERS = numberBook({
  "ROBOT-1": "+14165550101",
  "ROBOT-2": "+14165550102",
  "STRANGER-1": "+14165550103",
  "DEV-W1": "+14165550111",
  "DEV-W2": "+14165550112",
  "DEV-A1": "+14165550121",
  "DEV-C1": "+14165550131",
  "DEV-E1": "+14165550141",
});

export class ManualClock implements Clock {
  #now: number;
  #timers: { at: number; fn: () => void }[] = [];

  constructor(start = Date.UTC(2026, 9, 31, 5, 0, 0)) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  after(ms: number, fn: () => void): () => void {
    const timer = { at: this.#now + ms, fn };
    this.#timers.push(timer);
    return () => {
      this.#timers = this.#timers.filter((t) => t !== timer);
    };
  }

  advance(ms: number): void {
    const target = this.#now + ms;
    for (;;) {
      const due = this.#timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.#timers = this.#timers.filter((t) => t !== due);
      this.#now = due.at;
      due.fn();
    }
    this.#now = target;
  }
}

export interface Command {
  name: string;
  id?: string;
  body?: unknown;
  context: RequestContext;
}

export class FakeCallControl implements CallControlApi {
  readonly commands: Command[] = [];
  readonly recordings = new Map<string, string[]>();
  failNext?: Error;
  #legs = 0;

  #log(name: string, id: string | undefined, body: unknown, context: RequestContext): void {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = undefined;
      throw error;
    }
    this.commands.push({ name, id, body, context });
  }

  named(name: string): Command[] {
    return this.commands.filter((c) => c.name === name);
  }

  async dial(command: Parameters<CallControlApi["dial"]>[0], context: RequestContext): Promise<CallIds> {
    this.#log("dial", undefined, command, context);
    this.#legs++;
    return { call_control_id: `ccid-${this.#legs}`, call_leg_id: `leg-${this.#legs}`, call_session_id: `session-${this.#legs}` };
  }
  async answer(id: string, body: unknown, context: RequestContext) {
    this.#log("answer", id, body, context);
  }
  async reject(id: string, cause: string, context: RequestContext) {
    this.#log("reject", id, { cause }, context);
  }
  async playbackStart(id: string, body: unknown, context: RequestContext) {
    this.#log("playback_start", id, body, context);
  }
  async playbackStop(id: string, context: RequestContext) {
    this.#log("playback_stop", id, undefined, context);
  }
  async recordStart(id: string, body: unknown, context: RequestContext) {
    this.#log("record_start", id, body, context);
  }
  async gather(id: string, body: unknown, context: RequestContext) {
    this.#log("gather", id, body, context);
  }
  async speak(id: string, body: unknown, context: RequestContext) {
    this.#log("speak", id, body, context);
  }
  async sendDtmf(id: string, digits: string, context: RequestContext) {
    this.#log("send_dtmf", id, { digits }, context);
  }
  async hangup(id: string, context: RequestContext) {
    this.#log("hangup", id, undefined, context);
  }
  async listRecordings(filter: { call_leg_id: string }, context: RequestContext) {
    this.#log("list_recordings", undefined, filter, context);
    return (this.recordings.get(filter.call_leg_id) ?? []).map((id) => ({ id }));
  }
  async deleteRecording(id: string, context: RequestContext) {
    this.#log("delete_recording", id, undefined, context);
  }
  async sendMessage(message: { from: string; to: string; text: string }, context: RequestContext) {
    this.#log("send_message", undefined, message, context);
    return { id: `msg-${this.commands.length}` };
  }
}

/** A Telnyx webhook body as the edge relays it. */
export function telnyxEvent(type: string, payload: Record<string, unknown>, occurredAt = new Date().toISOString()) {
  return { data: { record_type: "event", event_type: type, id: `evt-${Math.random()}`, occurred_at: occurredAt, payload } };
}
