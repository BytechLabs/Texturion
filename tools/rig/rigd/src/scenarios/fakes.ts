/**
 * Fakes of every lane a runner is handed, for running the scenario runners
 * with no rig. Each fake is a small simulation of the behaviour a passing run
 * would see, with its state in public fields; a test breaks one piece to see
 * the runner name the failure.
 */
import type { GuardHealth, LeaseActivity } from "@loonext/rig-protocol";
import type { CallTestId, DeviceState, NetworkImpairment, PageHearing, StandbyBucket } from "@loonext/rig-lanes";
import type { CallPlan, CallRecord, Detection, InboxMessage, RobotApi, SinkDelivery, Surface } from "@loonext/rig-robot";
import type { UndoAction } from "../lease.ts";
import type { SeenEvent } from "../sentry-relay.ts";
import type {
  ApiAnswer,
  AppApi,
  AudioLinkApi,
  AutomatedText,
  BrowserApi,
  CallRow,
  CallStart,
  CompanyField,
  DeviceApi,
  DevicesApi,
  GraceState,
  GuardApi,
  GuardProbe,
  GuardProbeAnswer,
  HandoffApi,
  MailApi,
  MailMessage,
  MemberPageApi,
  MessageRow,
  NumberHandoff,
  NumberRow,
  PublicPageApi,
  RigApi,
  RigHealthReport,
  ScenarioContext,
  ScenarioHistoryApi,
  ScenarioLanes,
  SendResult,
  StripeApi,
  VoiceCapState,
  WebhookDelivery,
  WorkspaceState,
} from "./context.ts";

export class FakeTime {
  now = Date.UTC(2026, 9, 31, 15, 0, 0);
  sleep = async (ms: number) => {
    this.now += ms;
  };
}

export class FakeRobot implements RobotApi {
  readonly plans: CallPlan[] = [];
  readonly sent: { from_role: string; to_role: string; text: string; media?: string }[] = [];
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
          segments: plan.segments?.map((segment) => ({ name: segment.name, verdict: "heard", heard: [plan.expect!] })),
        }
      : undefined,
    spoke: plan.voicemail?.phrase,
  });
  onSms: (message: { from_role: string; to_role: string; text: string; media?: string }) => void = () => undefined;
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

  async sms(message: { from_role: string; to_role: string; text: string; media?: "gps-jpeg" }) {
    this.sent.push({ from_role: message.from_role, to_role: message.to_role, text: message.text, ...(message.media ? { media: message.media } : {}) });
    this.onSms(message);
    return { id: `sms-${this.sent.length}`, ...(message.media ? { media_sha256: "f".repeat(64) } : {}) };
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

const NO_STATE: WorkspaceState = { subscription_status: "active", canceled_at: null };

/**
 * What the local API reports when rig mode's database gate refuses a send or
 * a dial to a stranger: the trigger raises, the route's write fails, and
 * onError answers 500 and captures it.
 */
export function destinationRefusedEvent(route: "POST /v1/conversations" | "POST /v1/calls/browser", at: number): SeenEvent {
  const value =
    route === "POST /v1/conversations"
      ? "gate_outbound_send failed: rig_destination_refused: outbound text to a number outside loonext.rig_endpoints"
      : "outbound line claim failed: rig_destination_refused: outbound call to a number outside loonext.rig_endpoints";
  return { at, level: "error", tags: { route }, exceptions: [{ type: "Error", value }] };
}

const INTERNAL_ERROR = { ok: false as const, status: 500, code: "internal_error" };

export class FakeApp implements AppApi {
  readonly sends: { member: string; fromRole: string; toRole: string; body: string }[] = [];
  /** Sends to fictional numbers, which the fake refuses as rig mode does. */
  readonly fictionalSends: { member: string; e164: string; body: string }[] = [];
  rows: (MessageRow & { tenant: string; withRole?: string })[] = [];
  usage = new Map<string, { type: string; quantity: number; stripe_reported_at: string | null }[]>();
  pushes: { tenant: string; purpose: string; platform: string; response_class: string; attempted_at: string; priority?: string | null }[] = [];
  /** Where the API's own error reports go; fakeLanes hands them to the rig's record of them. */
  onApiError: (event: SeenEvent) => void = () => undefined;
  beacons: { tenant: string; member?: string; stage: string; platform: string; occurred_at: string; call_session_id: string | null }[] = [];
  /** Push subscriptions and device tokens by member. */
  targets = new Map<string, number>([["qa-w-owner", 1]]);
  /** Webhook endpoints by member: the events each delivers to the robot's sink. */
  webhooks = new Map<string, string[]>();
  /** Set to make ensureRobotWebhook fail the way a rig without the sink's secret does. */
  webhookRefusal: string | undefined;
  optOuts = new Map<string, { active: boolean; source: string }>();
  hints = new Map<string, string>();
  /** Call rows, each with the role of the number that called. */
  callRows: (CallRow & { tenant: string; caller_role: string })[] = [];
  legs = new Map<string, { member: string | null; state: string; kind: string | null }[]>();
  metered = 25;
  voiceSeconds = 25;
  /** Outbound call rows a consumed token created, and tokens left unused. */
  tokenUse = { calls: 1, left: 0 };
  recordingsLeft = 0;
  automations: AutomatedText[] = [];
  /** What a send does: the default is a delivered text that reaches the robot. */
  onSend: (send: { member: string; fromRole: string; toRole: string; body: string }, id: string) => SendResult = (_send, id) => ({ ok: true, messageId: id });
  /** What a browser call authorisation answers. */
  onPlaceCall: (args: { member: string; fromRole: string; to: string }) => CallStart = () => ({ ok: true, sessionId: "session-1" });
  /** What a token mint answers, by member. */
  tokenAnswer: (member: string) => ApiAnswer = () => ({ status: 200 });
  readonly signedOut = new Set<string>();
  readonly firedCrons: { cron: string; at?: number }[] = [];
  escalationRows: {
    tenant: string;
    created_at: string;
    kind: string;
    on_call_user_id: string | null;
    escalate_at: string;
    escalated_at: string | null;
    acknowledged_at: string | null;
  }[] = [];
  webhookEventRows: { received_at: string; event_id: string; event_type: string; processed_at: string | null; attempts: number }[] = [];
  attachmentRows = new Map<string, { storage_path: string; content_type: string; size_bytes: number; quarantined_at: string | null }[]>();
  objects = new Map<string, Uint8Array>();
  flags = new Map<string, boolean>();
  companies = new Map<string, Record<string, unknown>>();
  numberStatus = new Map<string, string>();
  readonly shifts: { id: string; tenant: string; member: string; role: string; startsAt: number; endsAt: number }[] = [];
  audiences = new Map<string, "text" | "note">();
  readonly seeded: { marker: string; tenant: string; type: string; quantity: number }[] = [];
  /** What the voice gates read this period; seeded call records add to it. */
  voiceCap: VoiceCapState = { plan: "pro", overage_cap_multiplier: 3, forward_seconds: 0, forwarded_calls: 0 };
  readonly seededCalls: { marker: string; tenant: string; leg: string; rows: number; billableSeconds: number }[] = [];
  readonly seededSegments: { marker: string; tenant: string; role: string; segments: number; body: string }[] = [];
  ai = new Map<string, number>();
  suggestions: ApiAnswer<{ suggestions?: unknown[]; reason?: string }> = { status: 200, body: { suggestions: ["Rig draft"] } };
  simulated: ApiAnswer<{ session_id?: string; reachable?: boolean }> = { status: 201, body: { session_id: "synthetic-1", reachable: true } };
  greetingCapture: ApiAnswer = { status: 202 };
  greetingRows: { tenant: string; id: string; created_at: string; storage_path: string; mime_type: string | null; duration_ms: number | null }[] = [];
  widget: { start: ApiAnswer<{ verificationId?: string }>; verify: ApiAnswer; verifications: number } = {
    start: { status: 202, body: { verificationId: "verification-1" } },
    verify: { status: 200 },
    verifications: 1,
  };
  totp = { aal: "aal2" as string | null, meStatus: 200 };
  readonly invites: { member: string; email: string }[] = [];
  provisioned: ApiAnswer<{ id?: string; status?: string }> = { status: 201, body: { id: "number-row-1", status: "pending" } };
  numbers = new Map<string, NumberRow[]>();
  workspaces = new Map<string, WorkspaceState>();
  grace = new Map<string, Omit<GraceState, keyof WorkspaceState | "numbers">>();
  readonly #time: FakeTime;

  constructor(time: FakeTime) {
    this.#time = time;
  }

  async sendText(args: { member: string; fromRole: string; toRole: string; body: string }) {
    this.sends.push(args);
    return this.onSend(args, `msg-${this.sends.length}`);
  }

  async sendTextToFictional(args: { member: string; fromRole: string; e164: string; body: string }): Promise<SendResult> {
    this.fictionalSends.push({ member: args.member, e164: args.e164, body: args.body });
    this.onApiError(destinationRefusedEvent("POST /v1/conversations", this.#time.now));
    return INTERNAL_ERROR;
  }

  async sendMms(args: { member: string; fromRole: string; toRole: string; body: string }) {
    return this.sendText(args);
  }

  thread(tenant: string, body: string, direction: MessageRow["direction"], extra: Partial<MessageRow> & { withRole?: string } = {}) {
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
    return this.rows.filter((r) => r.tenant === args.tenant && r.body === args.body && Date.parse(r.created_at) >= args.since);
  }
  async messagesWith(args: { tenant: string; role: string; since: number }) {
    return this.rows.filter((r) => r.tenant === args.tenant && r.withRole === args.role && Date.parse(r.created_at) >= args.since);
  }
  async usageFor(messageId: string) {
    return this.usage.get(messageId) ?? [];
  }
  async attachments(messageId: string) {
    return this.attachmentRows.get(messageId) ?? [];
  }
  async storedObject(args: { bucket: string; path: string }) {
    const bytes = this.objects.get(`${args.bucket}/${args.path}`);
    if (!bytes) throw new Error(`no object ${args.bucket}/${args.path}`);
    return bytes;
  }
  async pushAttempts(args: { tenant: string; since: number; purpose?: string }) {
    return this.pushes.filter(
      (p) => p.tenant === args.tenant && Date.parse(p.attempted_at) >= args.since && (!args.purpose || p.purpose === args.purpose),
    );
  }
  async pushTargets(args: { member: string }) {
    return this.targets.get(args.member) ?? 0;
  }
  async ringBeacons(args: { tenant: string; since: number; member?: string }) {
    return this.beacons
      .filter((b) => b.tenant === args.tenant && (!args.member || b.member === args.member) && Date.parse(b.occurred_at) >= args.since)
      .map(({ stage, platform, occurred_at, call_session_id }) => ({
        stage,
        platform,
        occurred_at,
        call_session_id,
        app_version: "1.0.0",
        device_idle: null,
        screen_locked: null,
        standby_bucket: null,
      }));
  }
  async ensureRobotWebhook(args: { member: string; events: string[] }) {
    if (this.webhookRefusal) throw new Error(this.webhookRefusal);
    this.webhooks.set(args.member, [...new Set([...(this.webhooks.get(args.member) ?? []), ...args.events])]);
  }
  async webhookEvents(args: { since: number; type?: string }) {
    return this.webhookEventRows
      .filter((row) => Date.parse(row.received_at) >= args.since && (!args.type || row.event_type === args.type))
      .map(({ received_at: _received, ...row }) => row);
  }
  async optOut(args: { tenant: string; role: string }) {
    return this.optOuts.get(`${args.tenant}/${args.role}`) ?? null;
  }
  async optOutHint(args: { tenant: string; role: string }) {
    return this.hints.get(`${args.tenant}/${args.role}`) ?? null;
  }
  /** As the probe reads them: the caller's rows, from a minute before `since`. */
  async calls(args: { tenant: string; callerRole: string; since: number }) {
    return this.callRows.filter(
      (r) => r.tenant === args.tenant && r.caller_role === args.callerRole && Date.parse(r.started_at) >= args.since - 60_000,
    );
  }
  async callLegs(args: { tenant: string; callSessionId: string }) {
    return this.legs.get(`${args.tenant}/${args.callSessionId}`) ?? [];
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
  async placeCall(args: { member: string; fromRole: string; to: string | { fictional: string } }) {
    if (typeof args.to !== "string") {
      this.onApiError(destinationRefusedEvent("POST /v1/calls/browser", this.#time.now));
      return INTERNAL_ERROR;
    }
    return this.onPlaceCall({ member: args.member, fromRole: args.fromRole, to: args.to });
  }
  /** A signed-out session is refused as auth/company.ts refuses every revoked one. */
  async voiceToken(args: { member: string; fresh?: boolean }) {
    if (args.fresh) this.signedOut.delete(args.member);
    return this.signedOut.has(args.member) ? { status: 401, code: "unauthorized" } : this.tokenAnswer(args.member);
  }
  async signOutSession(args: { member: string }) {
    this.signedOut.add(args.member);
    return { status: 200 };
  }
  async escalations(args: { tenant: string; since: number }) {
    return this.escalationRows
      .filter((row) => row.tenant === args.tenant && Date.parse(row.created_at) >= args.since)
      .map(({ tenant: _tenant, created_at: _created, ...row }) => row);
  }
  async telnyxRecordings() {
    return this.recordingsLeft;
  }
  async fireCron(cron: string, at?: number) {
    this.firedCrons.push({ cron, ...(at === undefined ? {} : { at }) });
  }
  async armAutomations() {
    return { undo: { kind: "app.disarm-automations", params: {} } };
  }
  async automatedTexts() {
    return this.automations;
  }
  async flag(key: string) {
    return this.flags.get(key) ?? null;
  }
  async setFlag(key: string, enabled: boolean | null) {
    if (enabled === null) this.flags.delete(key);
    else this.flags.set(key, enabled);
  }
  async companySettings(args: { tenant: string; fields: readonly CompanyField[] }) {
    const current = this.companies.get(args.tenant) ?? {};
    return Object.fromEntries(args.fields.map((field) => [field, current[field] ?? null]));
  }
  async patchCompany(args: { tenant: string; values: Partial<Record<CompanyField, unknown>> }) {
    const current = this.companies.get(args.tenant) ?? {};
    const previous = Object.fromEntries(Object.keys(args.values).map((key) => [key, current[key] ?? null]));
    this.companies.set(args.tenant, { ...current, ...args.values });
    return previous;
  }
  async numberStatusOf(args: { tenant: string; role: string }) {
    return this.numberStatus.get(`${args.tenant}/${args.role}`) ?? "active";
  }
  async setNumberStatus(args: { tenant: string; role: string; status: string }) {
    const key = `${args.tenant}/${args.role}`;
    const previous = this.numberStatus.get(key) ?? "active";
    this.numberStatus.set(key, args.status);
    return previous;
  }
  async addOnCallShift(args: { tenant: string; member: string; role: string; startsAt: number; endsAt: number; id?: string }) {
    const { id = `shift-${this.shifts.length + 1}`, ...shift } = args;
    this.shifts.push({ id, ...shift });
    return { id };
  }
  async ringAudience(args: { tenant: string; role: string; member: string }) {
    return this.audiences.get(`${args.tenant}/${args.role}/${args.member}`) ?? null;
  }
  async setRingAudience(args: { tenant: string; role: string; member: string; level: "text" | "note" | null }) {
    const key = `${args.tenant}/${args.role}/${args.member}`;
    const previous = this.audiences.get(key) ?? null;
    if (args.level) this.audiences.set(key, args.level);
    else this.audiences.delete(key);
    return previous;
  }
  async seedUsage(args: { tenant: string; type: string; quantity: number }) {
    const marker = `rig-seed-${this.seeded.length + 1}`;
    this.seeded.push({ marker, ...args });
    return { marker };
  }
  async voiceCapState() {
    return { ...this.voiceCap };
  }
  async seedCallRecords(args: { tenant: string; leg: "out_customer" | "in_browser"; rows: number; billableSeconds: number }) {
    const marker = `rig-seed-calls-${this.seededCalls.length + 1}`;
    this.seededCalls.push({ marker, ...args });
    // The minute cap counts every seeded second; the dial ceiling counts only dials.
    if (args.leg === "out_customer") this.voiceCap.forwarded_calls += args.rows;
    this.voiceCap.forward_seconds += args.rows * args.billableSeconds;
    return { marker };
  }
  async seedOutboundSegments(args: { tenant: string; role: string; segments: number; body: string }) {
    const marker = `rig-seed-messages-${this.seededSegments.length + 1}`;
    this.seededSegments.push({ marker, ...args });
    return { marker };
  }
  async userIdOf(member: string) {
    return `user-${member}`;
  }
  async aiUsage(args: { tenant: string }) {
    return [...this.ai]
      .filter(([key]) => key.startsWith(`${args.tenant}/`))
      .map(([key, count]) => ({ feature: key.slice(args.tenant.length + 1), period: "2026-10", request_count: count }));
  }
  async seedAiUsage(args: { tenant: string; feature: string; requestCount: number | null }) {
    const key = `${args.tenant}/${args.feature}`;
    const previous = this.ai.get(key) ?? null;
    if (args.requestCount === null) this.ai.delete(key);
    else this.ai.set(key, args.requestCount);
    return previous;
  }
  async replySuggestions() {
    return this.suggestions;
  }
  async simulateIncoming() {
    return this.simulated;
  }
  async startGreetingCapture() {
    return this.greetingCapture;
  }
  async greetings(args: { tenant: string; since: number }) {
    return this.greetingRows.filter((row) => row.tenant === args.tenant && Date.parse(row.created_at) >= args.since);
  }
  async widgetStart(args: { turnstileToken?: string }) {
    return args.turnstileToken === undefined ? { status: 403, code: "turnstile_required" } : this.widget.start;
  }
  async widgetVerify() {
    return this.widget.verify;
  }
  async widgetVerifications() {
    return this.widget.verifications;
  }
  async signInWithTotp() {
    return this.totp;
  }
  /** routes/team.ts answers with the invite row itself. */
  async invite(args: { member: string; email: string }) {
    this.invites.push(args);
    return { status: 201, body: { id: `invite-${this.invites.length}`, email_sent: true } };
  }
  readonly passwordResets: string[] = [];
  signUps = new Map<string, { company_id: string; subscription_status: string; stripe_subscription_id: string | null }>();
  async sendPasswordReset(args: { member: string }) {
    this.passwordResets.push(args.member);
    return 200;
  }
  async workspaceOf(args: { ownerEmail: string }) {
    return this.signUps.get(args.ownerEmail) ?? null;
  }
  async provisionNumber() {
    return this.provisioned;
  }
  async numberRows(args: { tenant: string }) {
    return this.numbers.get(args.tenant) ?? [];
  }
  async markNumberReleased(args: { phoneNumberId: string }) {
    for (const rows of this.numbers.values()) {
      for (const row of rows) if (row.id === args.phoneNumberId) row.status = "released";
    }
  }
  async backdateCancellation(args: { tenant: string; daysAgo: number }) {
    const before = this.workspaces.get(args.tenant) ?? NO_STATE;
    this.workspaces.set(args.tenant, {
      subscription_status: "canceled",
      canceled_at: new Date(this.#time.now - args.daysAgo * 86_400_000).toISOString(),
    });
    for (const row of this.numbers.get(args.tenant) ?? []) if (row.status === "active") row.status = "suspended";
    return before;
  }
  async graceState(args: { tenant: string }) {
    return {
      ...(this.workspaces.get(args.tenant) ?? NO_STATE),
      notices: [],
      live_campaigns: 0,
      ...this.grace.get(args.tenant),
      numbers: await this.numberRows(args),
    };
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
  notifications?: { title: string; body: string; tag: string }[];
  /** Makes a consult transfer fail the way a call bar with no consult control does. */
  noConsult?: boolean;
  /** How long until the page holds no call; undefined never clears. */
  clearsAfterMs?: number;
}

export class FakeBrowser implements BrowserApi {
  readonly opened: { member: string; surface: Surface; path?: string }[] = [];
  readonly publicPages: string[] = [];
  readonly actions: string[] = [];
  script: FakePageScript = { ringsAfterMs: 1_500, heard: "robot", energyBeforeAnswer: 0.4, showsText: true, clearsAfterMs: 500 };
  /** What the public flows answer. */
  publicScript = {
    signUp: { ok: true } as { ok: boolean; alert?: string },
    onboarding: true,
    checkout: { returned: true, challenged: false },
    portalHost: "billing.stripe.com" as string | null,
    path: "/",
  };

  async open(member: string, surface: Surface, path?: string): Promise<MemberPageApi> {
    this.opened.push({ member, surface, path });
    const script = this.script;
    const actions = this.actions;
    return {
      async waitForRing(timeoutMs) {
        const after = script.ringsAfterMs;
        return after !== undefined && after <= timeoutMs ? after : undefined;
      },
      async waitForCallCleared(timeoutMs) {
        const after = script.clearsAfterMs;
        return after !== undefined && after <= timeoutMs ? after : undefined;
      },
      async answer() {
        actions.push(`${member} answer`);
      },
      async decline() {
        actions.push(`${member} decline`);
      },
      async hangUp() {
        actions.push(`${member} hang up`);
      },
      async dial(role) {
        actions.push(`${member} dial ${role}`);
      },
      async hold(on) {
        actions.push(`${member} ${on ? "hold" : "resume"}`);
      },
      async mute(on) {
        actions.push(`${member} ${on ? "mute" : "unmute"}`);
      },
      async pressKeys(digits) {
        actions.push(`${member} keys ${digits}`);
      },
      async transfer(args) {
        if (args.mode === "consult" && script.noConsult) throw new Error("browser lane: the call bar offered no consult transfer");
        actions.push(`${member} ${args.mode} transfer to ${args.to}`);
      },
      async completeTransfer() {
        actions.push(`${member} complete transfer`);
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
      async background() {
        actions.push(`${member} background`);
      },
      async notifications() {
        return script.notifications ?? [];
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

  async openPublic(path: string): Promise<PublicPageApi> {
    this.publicPages.push(path);
    const script = this.publicScript;
    const actions = this.actions;
    return {
      async goto(target) {
        actions.push(`public goto ${target}`);
        script.path = target.startsWith("/") ? target : new URL(target).pathname;
      },
      async path() {
        return script.path;
      },
      async waitForText() {
        return true;
      },
      async signUp(args) {
        actions.push(`public sign up ${args.email}`);
        return script.signUp;
      },
      async completeOnboarding() {
        return script.onboarding;
      },
      async checkout() {
        return script.checkout;
      },
      async openBillingPortal() {
        return script.portalHost;
      },
      async close() {},
    };
  }

  async closeAll() {}
}

export class FakeGuard implements GuardApi {
  healthBody: GuardHealth = {
    ok: true,
    balance_above_floor: true,
    room: 4,
    version_id: "fake",
    telnyx: { key: "present", safety: { state: "ok", reasons: [], checked_at: 0 } },
    paid_dials: { enabled: true, blockers: [], room: 4, window_start_hour_utc: 4, window_measured_at: null, in_window: true },
    ordering: { enabled: true, blockers: [] },
    mail: { heartbeat_fresh: true, halted: false, pending: 0 },
    ai_neurons_today: 0,
  };
  /** The lease's log, by `<caller> <METHOD> <path> <outcome>`. */
  log: Record<string, number> = {};
  /** What each probe answers; the default is the refusal the guard's policy gives. */
  probes: Record<GuardProbe, GuardProbeAnswer> = {
    "foreign-connection": { status: 403, refused_by_guard: true, rule: "dial.connection_not_nonprod" },
    "text-from-outside": { status: 403, refused_by_guard: true, rule: "message.from_not_owned" },
    "dial-to-unowned": { status: 403, refused_by_guard: true, rule: "dial.to_not_owned" },
  };
  /** Telnyx ids the partition holds; anything else reads 404. */
  held = new Set<string>();
  readonly released: string[] = [];
  deliveries: WebhookDelivery[] = [];

  async health() {
    return this.healthBody;
  }
  async partition() {
    return { owned: 8 + this.held.size, standing: 8, messaging_profiles: 5 };
  }
  async activity(leaseId: string): Promise<LeaseActivity> {
    return { lease_id: leaseId, scenario: "S00", expires_at: "", live: true, activity: { ...this.log } };
  }
  async probe(kind: GuardProbe) {
    return this.probes[kind];
  }
  async numberStatus(id: string) {
    return this.held.has(id) ? { status: 200, in_group: true } : { status: 404, in_group: false };
  }
  async releaseNumber(id: string) {
    const held = this.held.delete(id);
    if (held) this.released.push(id);
    return { status: held ? 200 : 404, rule: null };
  }
  async webhookDeliveries() {
    return this.deliveries;
  }
}

const RESTING: DeviceState = {
  boot_completed: true,
  sdk_int: 36,
  locked: false,
  doze: "ACTIVE",
  battery_saver: false,
  standby_bucket: "active",
  app_version: "1.0.0",
  play_services_version: 250_000_000,
  bluetooth_bonded: 1,
};

export class FakeDevice implements DeviceApi {
  readonly name: string;
  readonly actions: string[] = [];
  reachableNow = true;
  deviceState: DeviceState = { ...RESTING };
  /** How long until Telecom and the full-screen ring show; undefined never rings. */
  rings: { telecom_ms?: number; full_screen_ms?: number } | undefined = { telecom_ms: 2_000, full_screen_ms: 2_500 };
  call: "ringing" | "active" | "holding" | "disconnected" | "none" = "none";
  onScreen = new Set<string>(["call_answer", "call_decline"]);
  /** The installed build's declared Play services minimum; null when it declares none. */
  gmsMinimum: number | null = 12_451_000;
  readonly audio?: AudioLinkApi;

  constructor(name: string, audio?: AudioLinkApi) {
    this.name = name;
    if (audio) this.audio = audio;
  }

  async reachable() {
    return this.reachableNow;
  }
  async state() {
    return this.deviceState;
  }
  async kill() {
    this.actions.push("kill");
  }
  async forceStop() {
    this.actions.push("force-stop");
  }
  async forceDoze() {
    this.actions.push("force doze");
    this.deviceState.doze = "IDLE";
  }
  async exitDoze() {
    this.actions.push("exit doze");
    this.deviceState.doze = "ACTIVE";
  }
  async idleNaturally() {
    this.actions.push("idle naturally");
    this.deviceState.doze = "IDLE";
  }
  async setStandbyBucket(bucket: StandbyBucket) {
    this.actions.push(`bucket ${bucket}`);
    this.deviceState.standby_bucket = bucket;
  }
  async batterySaver(on: boolean) {
    this.actions.push(`battery saver ${on ? "on" : "off"}`);
    this.deviceState.battery_saver = on;
  }
  async hibernate(on: boolean) {
    this.actions.push(`hibernate ${on ? "on" : "off"}`);
  }
  async notificationsAllowed(on: boolean) {
    this.actions.push(`notifications ${on ? "allowed" : "revoked"}`);
  }
  async lock() {
    this.actions.push("lock");
    this.deviceState.locked = true;
  }
  async unlock() {
    this.actions.push("unlock");
    this.deviceState.locked = false;
  }
  async reboot(options: { unlock?: boolean } = {}) {
    this.actions.push(`reboot${options.unlock === false ? " locked" : ""}`);
    this.deviceState.locked = options.unlock === false;
  }
  async install(build: "current" | "previous") {
    this.actions.push(`install ${build}`);
    return "com.loonext.android.nonprod";
  }
  async uninstall() {
    this.actions.push("uninstall");
  }
  async launch(path?: string) {
    this.actions.push(`launch ${path ?? "/"}`);
  }
  async waitForRinging(timeoutMs: number) {
    const rings = this.rings;
    if (!rings || (rings.telecom_ms ?? Infinity) > timeoutMs) return undefined;
    this.call = "ringing";
    return rings;
  }
  async callState() {
    return this.call;
  }
  async tap(id: CallTestId) {
    if (!this.onScreen.has(id)) return false;
    this.actions.push(`tap ${id}`);
    if (id === "call_answer") this.call = "active";
    if (id === "call_hang_up" || id === "call_decline") this.call = "disconnected";
    return true;
  }
  async showing(target: { id: CallTestId } | { text: string }) {
    return "id" in target ? this.onScreen.has(target.id) : this.onScreen.has(target.text);
  }
  async tapText(text: string) {
    if (!this.onScreen.has(text)) return false;
    this.actions.push(`tap "${text}"`);
    return true;
  }
  async type(text: string) {
    this.actions.push(`type ${text}`);
  }
  async signIn(member: string) {
    this.actions.push(`sign in ${member}`);
    return true;
  }
  async dial(role: string) {
    this.actions.push(`dial ${role}`);
    this.call = "active";
  }
  async playServicesMinimum() {
    return this.gmsMinimum;
  }
}

export class FakeAudioLink implements AudioLinkApi {
  connectedNow = true;
  heard: Surface | null = "robot";
  transcript = "";
  readonly played: Surface[] = [];

  async connected() {
    return this.connectedNow;
  }
  async playCode(surface: Surface) {
    this.played.push(surface);
  }
  async stop() {}
  async hear(): Promise<Detection> {
    const heard = this.heard;
    return {
      verdict: heard ? "heard" : "silent",
      answered: heard,
      heard: heard ? [heard] : [],
      echo: null,
      scores: {},
      window: { startMs: 0, endMs: 10_000, silentFrames: 0, announcementMs: 0 },
      frameMs: 20,
    };
  }
  async transcribe() {
    return this.transcript;
  }
}

export class FakeDevices implements DevicesApi {
  readonly audio = new FakeAudioLink();
  readonly pixelDevice = new FakeDevice("pixel", this.audio);
  readonly emulators = new Map<number, FakeDevice>([34, 35, 36].map((api) => [api, new FakeDevice(`emulator-${api}`)]));
  readonly actions: string[] = [];

  pixel() {
    return this.pixelDevice;
  }
  emulator(api: 34 | 35 | 36) {
    return this.emulators.get(api)!;
  }
  async bootEmulator(api: 34 | 35 | 36) {
    this.actions.push(`boot ${api}`);
  }
  async shutdownEmulator(api: 34 | 35 | 36) {
    this.actions.push(`shutdown ${api}`);
  }
  async powerCycle() {
    this.actions.push("power cycle");
  }
}

export class FakeRig implements RigApi {
  report: RigHealthReport = { at: "2026-10-31T15:00:00.000Z", sha: "abc1234", results: [{ name: "api", pass: true }], room: 4 };
  events: SeenEvent[] = [];
  readonly faults: number[] = [];
  impairment: NetworkImpairment | null = null;
  readonly outages: number[] = [];
  transcript = "";

  async health() {
    return this.report;
  }
  async apiEvents(since: number) {
    return this.events.filter((event) => event.at >= since);
  }
  async failNextCallEvent(status: 503) {
    this.faults.push(status);
  }
  async disarmCallEventFault() {
    this.faults.length = 0;
  }
  async impairNetwork(impairment: NetworkImpairment | null) {
    this.impairment = impairment;
  }
  async networkOutage(ms: number) {
    this.outages.push(ms);
  }
  async transcribe() {
    return this.transcript;
  }
}

export class FakeMail implements MailApi {
  robot: MailMessage[] = [];
  auth: MailMessage[] = [];
  /** Statuses by link; anything else answers 200. */
  links = new Map<string, { status: number; location: string | null }>();
  mailbox: string | undefined = "rig-robot@example.invalid";

  robotAddress(tag: string) {
    if (!this.mailbox) return undefined;
    const [local, domain] = this.mailbox.split("@");
    return `${local}+${tag}@${domain}`;
  }
  async robotMail(args: { since: number; tag?: string }) {
    const to = args.tag ? this.robotAddress(args.tag) : undefined;
    return this.robot.filter((mail) => Date.parse(mail.received_at) >= args.since && (!to || mail.to === to));
  }
  async mailpit(args: { to: string; since: number }) {
    return this.auth.filter((mail) => mail.to === args.to && Date.parse(mail.received_at) >= args.since);
  }
  async openLink(url: string) {
    return this.links.get(url) ?? { status: 200, location: null };
  }
}

export class FakeStripe implements StripeApi {
  readonly requests: { method: string; path: string; params?: Record<string, unknown> }[] = [];
  /** Answers by `METHOD path`; anything unlisted answers `{}`. */
  answers = new Map<string, Record<string, unknown>>();
  subscriptions = new Map<string, { id: string; status: string }>();

  async request<T>(method: "GET" | "POST" | "DELETE", path: string, params?: Record<string, unknown>) {
    this.requests.push({ method, path, ...(params ? { params } : {}) });
    return (this.answers.get(`${method} ${path}`) ?? {}) as T;
  }
  async subscriptionOf(tenant: string) {
    return this.subscriptions.get(tenant) ?? null;
  }
}

export class FakeHistory implements ScenarioHistoryApi {
  /** Earlier attempts, newest first. */
  rows: Awaited<ReturnType<ScenarioHistoryApi["attempts"]>> = [];
  async attempts(args: { since: number }) {
    return this.rows.filter((row) => Date.parse(row.finished_at) >= args.since);
  }
}

export class FakeHandoff implements HandoffApi {
  record: NumberHandoff | null = null;
  async read() {
    return this.record;
  }
  async write(record: NumberHandoff) {
    this.record = { ...record };
  }
  async clear() {
    this.record = null;
  }
}

/** Every lane, faked, sharing one clock. */
export function fakeLanes(time: FakeTime) {
  const app = new FakeApp(time);
  const rig = new FakeRig();
  app.onApiError = (event) => rig.events.push(event);
  return {
    robot: new FakeRobot(time),
    app,
    browser: new FakeBrowser(),
    guard: new FakeGuard(),
    devices: new FakeDevices(),
    rig,
    mail: new FakeMail(),
    stripe: new FakeStripe(),
    handoff: new FakeHandoff(),
  } satisfies ScenarioLanes;
}

export function fakeContext(scenario: string) {
  const time = new FakeTime();
  const lanes = fakeLanes(time);
  const history = new FakeHistory();
  const undo: UndoAction[] = [];
  const ctx: ScenarioContext = {
    scenario,
    runId: `${scenario}-test`,
    attempt: 1,
    slot: { index: 0 },
    lease: { id: "lease-test", registerUndo: (action) => undo.push(action) },
    ...lanes,
    history,
    now: () => time.now,
    sleep: time.sleep,
    nonce: "n0nce",
    evidence: {},
  };
  return { ctx, time, undo, history, ...lanes };
}
