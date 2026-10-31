/**
 * Fakes of the robot, the app probe and the browser lane, for running the
 * scenario runners with no rig. Each fake is a small simulation of the
 * behaviour a passing run would see; a test breaks one piece to see the
 * runner name the failure.
 */
import type { PageHearing } from "@loonext/rig-lanes";
import type { CallPlan, CallRecord, InboxMessage, RobotApi, SinkDelivery, Surface } from "@loonext/rig-robot";
import type { UndoAction } from "../lease.ts";
import type {
  AppApi,
  AutomatedText,
  BrowserApi,
  CallRow,
  MemberPageApi,
  MessageRow,
  ScenarioContext,
  SendResult,
} from "./context.ts";

export class FakeTime {
  now = Date.UTC(2026, 9, 31, 15, 0, 0);
  sleep = async (ms: number) => {
    this.now += ms;
  };
}

export class FakeRobot implements RobotApi {
  readonly plans: CallPlan[] = [];
  readonly sent: { from_role: string; to_role: string; text: string }[] = [];
  inboxItems: InboxMessage[] = [];
  sinkItems: SinkDelivery[] = [];
  /** How the call each plan makes ends up. */
  outcome: (plan: CallPlan) => Partial<CallRecord> = (plan) => ({
    state: "done",
    answered_at: "2026-10-31T15:00:04.000Z",
    from_role: plan.direction === "inbound" ? "DEV-W1" : undefined,
    recording_deleted: true,
    judgement: plan.expect
      ? {
          verdict: "heard",
          answered: plan.expect,
          heard: [plan.expect],
          echo: null,
          surfaces: {},
          silent_frames: 0,
          announcement_ms: 0,
          pass: true,
          expected: plan.expect,
          channel: 0,
          channels: 1,
          sample_rate: 8000,
          duration_ms: 25_000,
        }
      : undefined,
    spoke: plan.voicemail?.phrase,
  });
  onSms: (message: { from_role: string; to_role: string; text: string }) => void = () => undefined;
  readonly #time: FakeTime;

  constructor(time: FakeTime) {
    this.#time = time;
  }

  async dial(plan: CallPlan) {
    this.plans.push(plan);
    return this.#record(plan, "ringing");
  }

  async expect(plan: CallPlan) {
    this.plans.push(plan);
    return this.#record(plan, "waiting");
  }

  async wait(planId: string) {
    const plan = this.plans[Number(planId.slice("plan-".length))]!;
    return { ...this.#record(plan, "done"), ...this.outcome(plan) } as CallRecord;
  }

  async sms(message: { from_role: string; to_role: string; text: string }) {
    this.sent.push({ from_role: message.from_role, to_role: message.to_role, text: message.text });
    this.onSms(message);
    return { id: `sms-${this.sent.length}` };
  }

  deliver(item: Omit<InboxMessage, "id" | "event" | "received_at"> & { event?: string }) {
    this.inboxItems.push({ id: `in-${this.inboxItems.length}`, event: "message.received", received_at: this.#time.now, ...item });
  }

  async inbox(query: { to_role?: string; since?: number }) {
    return this.inboxItems.filter((m) => (!query.to_role || m.to_role === query.to_role) && (query.since === undefined || m.received_at >= query.since));
  }

  async sink(query: { since?: number; type?: string }) {
    return this.sinkItems.filter((d) => (!query.type || d.type === query.type) && (query.since === undefined || d.received_at >= query.since));
  }

  #record(plan: CallPlan, state: CallRecord["state"]): CallRecord {
    return {
      plan_id: `plan-${this.plans.indexOf(plan)}`,
      plan,
      state,
      ids: { call_control_id: "ccid-1", call_leg_id: "leg-1", call_session_id: "session-1" },
      events: [],
      dtmf: "",
      errors: [],
    };
  }
}

export class FakeApp implements AppApi {
  readonly sends: { member: string; fromRole: string; toRole: string; body: string }[] = [];
  rows: (MessageRow & { tenant: string })[] = [];
  usage = new Map<string, { type: string; quantity: number; stripe_reported_at: string | null }[]>();
  pushes: { tenant: string; purpose: string; platform: string; response_class: string; attempted_at: string }[] = [];
  /** Push subscriptions and device tokens by member. */
  targets = new Map<string, number>([["qa-w-owner", 1]]);
  /** Webhook endpoints by member: the events each delivers to the robot's sink. */
  webhooks = new Map<string, string[]>();
  /** Set to make ensureRobotWebhook fail the way a rig without the sink's secret does. */
  webhookRefusal: string | undefined;
  optOuts = new Map<string, { active: boolean; source: string }>();
  hints = new Map<string, string>();
  callRows: (CallRow & { tenant: string })[] = [];
  metered = 25;
  voiceSeconds = 25;
  /** Outbound call rows a consumed token created, and tokens left unused. */
  tokenUse = { calls: 1, left: 0 };
  recordingsLeft = 0;
  automations: AutomatedText[] = [];
  /** What a send does: the default is a delivered text that reaches the robot. */
  onSend: (send: { member: string; fromRole: string; toRole: string; body: string }, id: string) => SendResult = (_send, id) => ({ ok: true, messageId: id });
  readonly #time: FakeTime;

  constructor(time: FakeTime) {
    this.#time = time;
  }

  async sendText(args: { member: string; fromRole: string; toRole: string; body: string }) {
    this.sends.push(args);
    return this.onSend(args, `msg-${this.sends.length}`);
  }

  thread(tenant: string, body: string, direction: MessageRow["direction"], extra: Partial<MessageRow> = {}) {
    this.rows.push({
      tenant,
      id: `row-${this.rows.length}`,
      direction,
      body,
      status: direction === "outbound" ? "delivered" : "received",
      error_code: null,
      conversation_id: "conv-1",
      created_at: new Date(this.#time.now).toISOString(),
      ...extra,
    });
  }

  async messages(args: { tenant: string; body: string; since: number }) {
    return this.rows.filter((r) => r.tenant === args.tenant && r.body === args.body);
  }
  async usageFor(messageId: string) {
    return this.usage.get(messageId) ?? [];
  }
  async pushAttempts(args: { tenant: string }) {
    return this.pushes.filter((p) => p.tenant === args.tenant);
  }
  async pushTargets(args: { member: string }) {
    return this.targets.get(args.member) ?? 0;
  }
  async ensureRobotWebhook(args: { member: string; events: string[] }) {
    if (this.webhookRefusal) throw new Error(this.webhookRefusal);
    this.webhooks.set(args.member, [...new Set([...(this.webhooks.get(args.member) ?? []), ...args.events])]);
  }
  async optOut(args: { tenant: string; role: string }) {
    return this.optOuts.get(`${args.tenant}/${args.role}`) ?? null;
  }
  async optOutHint(args: { tenant: string; role: string }) {
    return this.hints.get(`${args.tenant}/${args.role}`) ?? null;
  }
  async calls(args: { tenant: string }) {
    return this.callRows.filter((r) => r.tenant === args.tenant);
  }
  async meteredSeconds() {
    return this.metered;
  }
  async voiceSecondsSince() {
    return this.voiceSeconds;
  }
  async outboundTokenUse() {
    return this.tokenUse;
  }
  async telnyxRecordings() {
    return this.recordingsLeft;
  }
  async fireCron() {}
  async armAutomations() {
    return { undo: { kind: "app.disarm-automations", params: {} } };
  }
  async automatedTexts() {
    return this.automations;
  }
}

export interface FakePageScript {
  ringsAfterMs?: number;
  heard?: Surface | null;
  energyBeforeAnswer?: number;
  showsText?: boolean;
  /** Whether the browser can subscribe to push; called back when it does. */
  canPush?: boolean;
  onPush?: (member: string) => void;
}

export class FakeBrowser implements BrowserApi {
  readonly opened: { member: string; surface: Surface; path?: string }[] = [];
  readonly actions: string[] = [];
  script: FakePageScript = { ringsAfterMs: 1_500, heard: "robot", energyBeforeAnswer: 0.4, showsText: true };

  async open(member: string, surface: Surface, path?: string): Promise<MemberPageApi> {
    this.opened.push({ member, surface, path });
    const script = this.script;
    const actions = this.actions;
    return {
      async waitForRing(timeoutMs) {
        const after = script.ringsAfterMs;
        return after !== undefined && after <= timeoutMs ? after : undefined;
      },
      async answer() {
        actions.push(`${member} answer`);
      },
      async hangUp() {
        actions.push(`${member} hang up`);
      },
      async dial(role) {
        actions.push(`${member} dial ${role}`);
      },
      async waitForText() {
        return script.showsText ?? true;
      },
      async enablePush() {
        actions.push(`${member} enable push`);
        if (!script.canPush) return false;
        script.onPush?.(member);
        return true;
      },
      async hear(): Promise<PageHearing> {
        const heard = script.heard ?? null;
        return {
          detection: {
            verdict: heard ? "heard" : "silent",
            answered: heard,
            heard: heard ? [heard] : [],
            echo: null,
            scores: {},
            window: { startMs: 2000, endMs: 12000, silentFrames: 0, announcementMs: 0 },
            frameMs: 20,
          },
          capture: { sampleRate: 16000, startedAt: 0, marks: [], stats: [], remoteStreams: 1 },
          concealedRatio: 0.01,
          energyBeforeAnswer: script.energyBeforeAnswer,
        };
      },
      async mark(name) {
        actions.push(`${member} mark ${name}`);
      },
    };
  }

  async closeAll() {}
}

export function fakeContext(scenario: string) {
  const time = new FakeTime();
  const robot = new FakeRobot(time);
  const app = new FakeApp(time);
  const browser = new FakeBrowser();
  const undo: UndoAction[] = [];
  const ctx: ScenarioContext = {
    scenario,
    runId: `${scenario}-test`,
    attempt: 1,
    lease: { id: "lease-test", registerUndo: (action) => undo.push(action) },
    robot,
    app,
    browser,
    now: () => time.now,
    sleep: time.sleep,
    nonce: "n0nce",
    evidence: {},
  };
  return { ctx, time, robot, app, browser, undo };
}
