/**
 * What a scenario runner is handed, and what it hands back.
 *
 * Runners are written against these interfaces only: the run lease, the
 * robot, the browser lane and the app probe (the local API and database).
 * rigd builds the real ones; the tests build fakes, because no scenario can
 * run for real until the Telnyx partition exists.
 */
import type { StandingRole } from "@loonext/rig-protocol";
import type { HearOptions, PageHearing } from "@loonext/rig-lanes";
import type { RobotApi, Surface } from "@loonext/rig-robot";
import type { UndoAction } from "../lease.ts";

export type ScenarioResult =
  | { outcome: "pass"; detail?: string }
  | { outcome: "fail"; failure_class: string; detail: string; critical?: boolean }
  | { outcome: "infra"; component: string; detail: string }
  | { outcome: "preempted"; detail: string };

export interface LeaseHandle {
  readonly id: string;
  registerUndo(action: UndoAction): void;
}

export interface MemberPageApi {
  waitForRing(timeoutMs: number): Promise<number | undefined>;
  answer(): Promise<void>;
  hangUp(): Promise<void>;
  /** Opens the dialer, enters the role's number and presses Call. */
  dial(role: StandingRole): Promise<void>;
  waitForText(text: string, timeoutMs: number): Promise<boolean>;
  /** Turns on this browser's push the way a member does; false when the browser cannot subscribe. */
  enablePush(): Promise<boolean>;
  hear(options?: HearOptions): Promise<PageHearing>;
  mark(name: string): Promise<void>;
}

export interface BrowserApi {
  open(member: string, surface: Surface, path?: string): Promise<MemberPageApi>;
  closeAll(): Promise<void>;
}

export interface MessageRow {
  id: string;
  direction: "inbound" | "outbound" | "note";
  body: string;
  status: string | null;
  error_code: string | null;
  conversation_id: string;
  created_at: string;
}

export interface CallRow {
  call_session_id: string;
  outcome: "answered" | "voicemail" | "missed" | null;
  forward_seconds: number;
  started_at: string;
  ended_at: string | null;
  voicemail_path: string | null;
  voicemail_transcript: string | null;
  voicemail_intake: unknown;
}

export interface AutomatedText {
  kind: "away_reply" | "scheduled_send" | "reminder" | "emergency_ack" | "help_reply";
  body: string;
  /** held: kept back for quiet hours. sent: released to Telnyx. */
  state: "held" | "sent" | "pending";
}

export type SendResult = { ok: true; messageId: string } | { ok: false; status: number; code?: string };

/** The rig's own Loonext, read and driven from outside, as a member and as the database. */
export interface AppApi {
  /** Texts as a member, from one of the tenant's numbers, through the local API. */
  sendText(args: { member: string; fromRole: StandingRole; toRole: StandingRole; body: string }): Promise<SendResult>;
  /** Messages in a tenant with exactly this body, oldest first. */
  messages(args: { tenant: string; body: string; since: number }): Promise<MessageRow[]>;
  usageFor(messageId: string): Promise<{ type: string; quantity: number; stripe_reported_at: string | null }[]>;
  pushAttempts(args: { tenant: string; since: number; purpose?: "ring" | "call_end" | "alert" }): Promise<
    { purpose: string; platform: string; response_class: string; attempted_at: string }[]
  >;
  /** A member's push subscriptions and device tokens: the places a push can go. */
  pushTargets(args: { member: string }): Promise<number>;
  /** The tenant's opt-out row for a role's number, or null when there has never been one. */
  optOut(args: { tenant: string; role: StandingRole }): Promise<{ active: boolean; source: string } | null>;
  /** When a plain-English opt-out was flagged on the thread with that number. */
  optOutHint(args: { tenant: string; role: StandingRole }): Promise<string | null>;
  calls(args: { tenant: string; callerRole: StandingRole; since: number }): Promise<CallRow[]>;
  /** Billable seconds the voice meter recorded for a call's forward leg. */
  meteredSeconds(args: { tenant: string; callSessionId: string }): Promise<number>;
  /** Voice seconds metered for the tenant since a time, every leg. */
  voiceSecondsSince(args: { tenant: string; since: number }): Promise<number>;
  /**
   * D43's single-use tokens for calls to a role since a time: `calls` is the
   * outbound call rows, each of which only a consumed token creates, and
   * `left` the tokens minted and never consumed.
   */
  outboundTokenUse(args: { tenant: string; toRole: StandingRole; since: number }): Promise<{ calls: number; left: number }>;
  /**
   * Makes sure the member's workspace delivers these webhook events to the
   * robot's sink at the edge. Throws when the rig cannot name that sink.
   */
  ensureRobotWebhook(args: { member: string; events: string[] }): Promise<void>;
  /** Telnyx recordings still held for a call session, read through the guard. */
  telnyxRecordings(callSessionId: string): Promise<number>;
  /** Fires one of the API's crons at an instant, as the rig's timers do. */
  fireCron(cron: string, at?: number): Promise<void>;
  /** Seeds S25's automations for a nonce; the undo removes them. */
  armAutomations(args: { tenant: string; toRole: StandingRole; nonce: string }): Promise<{ undo: { kind: string; params: Record<string, unknown> } }>;
  automatedTexts(args: { tenant: string; nonce: string }): Promise<AutomatedText[]>;
}

export interface ScenarioContext {
  scenario: string;
  runId: string;
  attempt: number;
  lease: LeaseHandle;
  robot: RobotApi;
  app: AppApi;
  browser: BrowserApi;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Unique to this attempt; every body a scenario sends carries it. */
  nonce: string;
  /** Ids, timings, RTP statistics and verdict numbers. Never audio, never a phone number. */
  evidence: Record<string, unknown>;
}

export interface ScenarioRunner {
  id: string;
  run(ctx: ScenarioContext): Promise<ScenarioResult>;
  /** Checked after the lease's undos ran; a result here overrides a pass. */
  afterRelease?(ctx: ScenarioContext): Promise<ScenarioResult | undefined>;
}

export const pass = (detail?: string): ScenarioResult => ({ outcome: "pass", detail });
export const fail = (failure_class: string, detail: string, options: { critical?: boolean } = {}): ScenarioResult => ({
  outcome: "fail",
  failure_class,
  detail,
  ...(options.critical ? { critical: true } : {}),
});
export const infra = (component: string, detail: string): ScenarioResult => ({ outcome: "infra", component, detail });

/** Polls until `probe` returns something, or undefined at the deadline. */
export async function poll<T>(
  ctx: Pick<ScenarioContext, "now" | "sleep">,
  probe: () => Promise<T | undefined | null | false>,
  timeoutMs: number,
  intervalMs = 1_000,
): Promise<T | undefined> {
  const deadline = ctx.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== null && value !== false) return value;
    if (ctx.now() >= deadline) return undefined;
    await ctx.sleep(Math.min(intervalMs, Math.max(0, deadline - ctx.now())));
  }
}

/** Word error rate: edits to turn the reference into the hypothesis, over reference words. */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
  const ref = words(reference);
  const hyp = words(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  let previous = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const current = [i];
    for (let j = 1; j <= hyp.length; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[hyp.length]! / ref.length;
}
