/**
 * What a scenario runner is handed, and what it hands back.
 *
 * Runners are written against these interfaces only: the run lease, the
 * robot, the browser lane, the app probe (the local API and database), the
 * guard, the Android devices, the rig box itself, the robot's mail, the
 * Stripe sandbox and the hand-off between two runs. rigd builds the real
 * ones; the tests build fakes, because no scenario can run for real until the
 * Telnyx partition exists.
 */
import type { GuardHealth, LeaseActivity, StandingRole } from "@loonext/rig-protocol";
import type { CallTestId, DeviceState, HearOptions, NetworkImpairment, PageHearing, StandbyBucket } from "@loonext/rig-lanes";
import type { Detection, RobotApi, Surface } from "@loonext/rig-robot";
import type { UndoAction } from "../lease.ts";
import type { SeenEvent } from "../sentry-relay.ts";

export type ScenarioResult =
  | { outcome: "pass"; detail?: string }
  | { outcome: "fail"; failure_class: string; detail: string; critical?: boolean }
  | { outcome: "infra"; component: string; detail: string }
  | { outcome: "preempted"; detail: string };

export interface LeaseHandle {
  readonly id: string;
  registerUndo(action: UndoAction): void;
}

/**
 * Numbers in the fictional 555-01xx range: no rig number owns them and no
 * carrier routes them, so a send or dial to one proves a refusal without
 * reaching anyone. scripts/check-rig-no-e164.mjs allows exactly this range.
 */
export const FICTIONAL_E164 = ["+14165550199", "+14165550198"] as const;

export function isFictional(e164: string): boolean {
  return /^\+1\d{3}55501\d{2}$/.test(e164);
}

export interface MemberPageApi {
  waitForRing(timeoutMs: number): Promise<number | undefined>;
  /** Waits until neither the ring dialog nor the call bar shows, which is how a surface that did not win the call shows it. */
  waitForCallCleared(timeoutMs: number): Promise<number | undefined>;
  answer(): Promise<void>;
  decline(): Promise<void>;
  hangUp(): Promise<void>;
  /** Opens the dialer, enters the role's number and presses Call. */
  dial(role: StandingRole): Promise<void>;
  /** The in-call controls, as a member uses them. */
  hold(on: boolean): Promise<void>;
  mute(on: boolean): Promise<void>;
  /** Presses each digit on the in-call keypad. */
  pressKeys(digits: string): Promise<void>;
  /** Transfers the live call to a teammate, named as the transfer picker lists them, or to a number's role. */
  transfer(args: { to: string; mode: "blind" | "consult" }): Promise<void>;
  /** Completes the consult transfer `transfer` started. */
  completeTransfer(): Promise<void>;
  waitForText(text: string, timeoutMs: number): Promise<boolean>;
  /** Turns on this browser's push the way a member does; false when the browser cannot subscribe. */
  enablePush(): Promise<boolean>;
  /** Puts another tab in front, so this page carries on as a background tab. */
  background(): Promise<void>;
  /** The notifications the app's service worker is showing now. */
  notifications(): Promise<{ title: string; body: string; tag: string }[]>;
  hear(options?: HearOptions): Promise<PageHearing>;
  mark(name: string): Promise<void>;
}

/** A page with nobody signed in yet: the public sign-up, then the new owner's own app. */
export interface PublicPageApi {
  goto(pathOrUrl: string): Promise<void>;
  path(): Promise<string>;
  waitForText(text: string, timeoutMs: number): Promise<boolean>;
  /** The public sign-up form, passed by Turnstile's always-pass test key. */
  signUp(args: { email: string; password: string; name: string }): Promise<{ ok: boolean; alert?: string }>;
  /** Walks onboarding to the end with this business name; false when a step never offered its control. */
  completeOnboarding(args: { business: string }): Promise<boolean>;
  /** Starts Checkout from billing, pays with a Stripe test card, and waits to be sent back. */
  checkout(args: { card: string }): Promise<{ returned: boolean; challenged: boolean }>;
  /** Opens the customer portal from billing; resolves with the portal page's host, or null. */
  openBillingPortal(): Promise<string | null>;
  close(): Promise<void>;
}

export interface BrowserApi {
  open(member: string, surface: Surface, path?: string): Promise<MemberPageApi>;
  openPublic(path: string): Promise<PublicPageApi>;
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
  direction?: "inbound" | "outbound";
  state?: string | null;
  answered_at?: string | null;
  answered_by_user_id?: string | null;
  notice_spoken?: unknown;
}

export interface AutomatedText {
  kind: "away_reply" | "scheduled_send" | "reminder" | "emergency_ack" | "help_reply";
  body: string;
  /** held: kept back for quiet hours. sent: released to Telnyx. */
  state: "held" | "sent" | "pending";
  /**
   * An answer to the customer's own text. D4 exempts replies from quiet hours
   * (messaging/away-reply.ts), so these arrive by night as well as by day.
   */
  reply: boolean;
}

/**
 * A send the API filed and then failed is refused too: its status is the
 * API's 2xx and its code the message's `error_code`. Rig mode's destination
 * gate refuses that way in apps/api's dispatch (messaging/send.ts).
 */
export type SendResult = { ok: true; messageId: string } | { ok: false; status: number; code?: string };

/** What an API call answered when the scenario expects a refusal as often as a success. */
export interface ApiAnswer<T = Record<string, unknown>> {
  status: number;
  /** The API's `error.code`, when it refused. */
  code?: string;
  body?: T;
}

/** Where a call goes: a standing number by role, or a fictional one. */
export type Destination = StandingRole | { fictional: string };

export type CallStart = { ok: true; sessionId: string } | { ok: false; status: number; code?: string };

export interface NumberRow {
  id: string;
  status: string;
  telnyx_phone_number_id: string | null;
  voice_connection_id: string | null;
  label: string | null;
  suspended_at: string | null;
  released_at: string | null;
}

/** A workspace's subscription state, as S29 changes it and its undo puts it back. */
export interface WorkspaceState {
  subscription_status: string;
  canceled_at: string | null;
}

export interface GraceState extends WorkspaceState {
  /** `grace_notices` threshold days ledgered for the current cancellation: 1, 15, 27, then 30 for the release. */
  notices: number[];
  numbers: NumberRow[];
  /** Campaigns with a Telnyx id and no `deactivated_at`: what grace still owes the release. */
  live_campaigns: number;
}

/** Company settings a scenario may change under its lease; the undo writes the previous values back. */
export const COMPANY_FIELDS = [
  "business_hours",
  "business_hours_exceptions",
  "timezone",
  "away_enabled",
  "away_message",
  "after_hours_calls",
  "ring_strategy",
  "ring_seconds",
  "on_call_escalate_after_minutes",
  "emergency_keyword_enabled",
  "emergency_reply_enabled",
  "emergency_keywords",
  "emergency_message",
  "paused_at",
] as const;
export type CompanyField = (typeof COMPANY_FIELDS)[number];

export interface VoiceCapState {
  plan: "starter" | "pro" | null;
  overage_cap_multiplier: number | null;
  forward_seconds: number;
  forwarded_calls: number;
}

/** The rig's own Loonext, read and driven from outside, as a member and as the database. */
export interface AppApi {
  /** Texts as a member, from one of the tenant's numbers, through the local API. */
  sendText(args: { member: string; fromRole: StandingRole; toRole: StandingRole; body: string }): Promise<SendResult>;
  /** The same send to a fictional number, which rig mode must refuse before any request leaves. */
  sendTextToFictional(args: { member: string; fromRole: StandingRole; e164: string; body: string }): Promise<SendResult>;
  /** A picture message: the body and one image, through `POST /v1/messages/send`. */
  sendMms(args: {
    member: string;
    fromRole: StandingRole;
    toRole: StandingRole;
    body: string;
    media: { bytes: Uint8Array; contentType: string };
  }): Promise<SendResult>;
  /** Messages in a tenant with exactly this body, oldest first. */
  messages(args: { tenant: string; body: string; since: number }): Promise<MessageRow[]>;
  /** Every message in the tenant's threads with a role's number since a time, oldest first. */
  messagesWith(args: { tenant: string; role: StandingRole; since: number }): Promise<MessageRow[]>;
  usageFor(messageId: string): Promise<{ type: string; quantity: number; stripe_reported_at: string | null }[]>;
  /** A message's attachments, and the bytes storage holds for one. */
  attachments(messageId: string): Promise<{ storage_path: string; content_type: string; size_bytes: number; quarantined_at: string | null }[]>;
  storedObject(args: { bucket: string; path: string }): Promise<Uint8Array>;
  pushAttempts(args: { tenant: string; since: number; purpose?: "ring" | "call_end" | "alert" }): Promise<
    {
      purpose: string;
      platform: string;
      response_class: string;
      attempted_at: string;
      priority?: string | null;
      call_session_id?: string | null;
      user_id?: string | null;
    }[]
  >;
  /** A member's push subscriptions and device tokens: the places a push can go. */
  pushTargets(args: { member: string }): Promise<number>;
  /** The ring beacons a tenant's devices reported, oldest first; with `member`, that member's only. */
  ringBeacons(args: { tenant: string; since: number; member?: string }): Promise<
    {
      stage: string;
      platform: string;
      occurred_at: string;
      call_session_id: string | null;
      app_version: string | null;
      device_idle: boolean | null;
      screen_locked: boolean | null;
      standby_bucket: string | null;
    }[]
  >;
  /** The tenant's opt-out row for a role's number, or null when there has never been one. */
  optOut(args: { tenant: string; role: StandingRole }): Promise<{ active: boolean; source: string } | null>;
  /** When a plain-English opt-out was flagged on the thread with that number. */
  optOutHint(args: { tenant: string; role: StandingRole }): Promise<string | null>;
  calls(args: { tenant: string; callerRole: StandingRole; since: number }): Promise<CallRow[]>;
  /** The legs a call rang, by member key: who rang, who answered, who was cancelled. */
  callLegs(args: { tenant: string; callSessionId: string }): Promise<{ member: string | null; state: string; kind: string | null }[]>;
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
  /** `POST /v1/calls/browser` as the member: the authorisation an outbound browser call starts with. */
  placeCall(args: { member: string; fromRole: StandingRole; to: Destination }): Promise<CallStart>;
  /**
   * `POST /v1/webrtc/token` as the member: whether this person may hold a
   * voice credential now. It uses the probe's session for the member, the one
   * `signOutSession` revoked, unless `fresh` signs in again.
   */
  voiceToken(args: { member: string; fresh?: boolean }): Promise<ApiAnswer>;
  /** Signs the probe's session for the member out through `POST /v1/sessions/revoke`, as a member signing a device out does (D130). */
  signOutSession(args: { member: string }): Promise<ApiAnswer>;
  /** The alert escalations opened in a tenant since a time. */
  escalations(args: { tenant: string; since: number }): Promise<
    { kind: string; on_call_user_id: string | null; escalate_at: string; escalated_at: string | null; acknowledged_at: string | null }[]
  >;
  /**
   * Makes sure the member's workspace delivers these webhook events to the
   * robot's sink at the edge. Throws when the rig cannot name that sink.
   */
  ensureRobotWebhook(args: { member: string; events: string[] }): Promise<void>;
  /** Telnyx webhook events the API recorded since a time: one row per event id, however often Telnyx sent it. */
  webhookEvents(args: { since: number; type?: string }): Promise<{ event_id: string; event_type: string; processed_at: string | null; attempts: number }[]>;
  /** Telnyx recordings still held for a call session, read through the guard. */
  telnyxRecordings(callSessionId: string): Promise<number>;
  /** Fires one of the API's crons at an instant, as the rig's timers do. */
  fireCron(cron: string, at?: number): Promise<void>;
  /** Seeds S25's automations for a nonce; the undo removes them. */
  armAutomations(args: { tenant: string; toRole: StandingRole; nonce: string }): Promise<{ undo: { kind: string; params: Record<string, unknown> } }>;
  automatedTexts(args: { tenant: string; nonce: string }): Promise<AutomatedText[]>;

  /** A local feature flag's global value, or null when no row sets it. Kill switches are flags that are on until killed. */
  flag(key: string): Promise<boolean | null>;
  /** Sets a local flag, or removes its row with null. Register `app.flag` with the previous value first. */
  setFlag(key: string, enabled: boolean | null): Promise<void>;
  /** Company settings as they stand, read before a change so `app.company-restore` can be registered first. */
  companySettings(args: { tenant: string; fields: readonly CompanyField[] }): Promise<Partial<Record<CompanyField, unknown>>>;
  /** Writes company settings and resolves with their previous values, for `app.company-restore`. */
  patchCompany(args: { tenant: string; values: Partial<Record<CompanyField, unknown>> }): Promise<Partial<Record<CompanyField, unknown>>>;
  /** A standing number's row status, read before a change so `app.number-status` can be registered first. */
  numberStatusOf(args: { tenant: string; role: StandingRole }): Promise<string>;
  /** Sets a standing number's row status and resolves with the previous one, for `app.number-status`. */
  setNumberStatus(args: { tenant: string; role: StandingRole; status: "active" | "suspended" | "released" }): Promise<string>;
  /**
   * Puts a member on call for a number; the undo is `app.remove-on-call` with
   * the id. With `id`, the row takes it, so the undo can be registered first.
   */
  addOnCallShift(args: { tenant: string; member: string; role: StandingRole; startsAt: number; endsAt: number; id?: string }): Promise<{ id: string }>;
  /** A member's level on a number now, read before a change so `app.ring-audience` can be registered first. */
  ringAudience(args: { tenant: string; role: StandingRole; member: string }): Promise<"text" | "note" | null>;
  /**
   * A member's level on a number (#106): `text` rings them, `note` and null do
   * not. Resolves with the previous level, for `app.ring-audience`.
   */
  setRingAudience(args: { tenant: string; role: StandingRole; member: string; level: "text" | "note" | null }): Promise<"text" | "note" | null>;
  /**
   * Usage rows that count against a cap without ever reaching Stripe: they are
   * written as already reported. The undo is `app.clear-seeded-usage` with the marker.
   */
  seedUsage(args: { tenant: string; type: string; quantity: number; channel?: string; unit?: string }): Promise<{ marker: string }>;
  /**
   * What the tenant's voice gates read this period: the plan and its cap
   * multiplier, forwarded seconds (the minute cap) and forwarded calls (the
   * dial ceiling).
   */
  voiceCapState(args: { tenant: string }): Promise<VoiceCapState>;
  /**
   * `call_records` rows both voice gates count, written already reported so
   * the voice meter never sends them to Stripe. The undo is
   * `app.clear-seeded-usage` with the marker.
   */
  seedCallRecords(args: { tenant: string; leg: "out_customer" | "in_browser"; rows: number; billableSeconds: number }): Promise<{ marker: string }>;
  /**
   * One delivered outbound message in the thread with a role, holding that
   * many segments: what the hourly limit and the carrier's day count. The
   * undo is `app.clear-seeded-usage` with the marker.
   */
  seedOutboundSegments(args: { tenant: string; role: StandingRole; segments: number; body: string }): Promise<{ marker: string }>;
  /**
   * Copies the newest voicemail a role left in `from` into `tenant` as a
   * voicemail on its `role` number, under the session id given: the audio
   * into the voicemail bucket and a call row naming it, with the source's
   * transcript, so opening it buys none. False when `from` holds no voicemail
   * from that caller. The undo is `app.clear-seeded-voicemail`, registered
   * first with the same session id.
   */
  copyVoicemail(args: { from: string; tenant: string; role: StandingRole; callerRole: StandingRole; sessionId: string }): Promise<boolean>;
  /** A member's auth user id, which push attempts and call legs name them by. */
  userIdOf(member: string): Promise<string>;
  /** The AI usage rows of a tenant this period, and a seed of one to a count; the undo is `app.ai-usage`. */
  aiUsage(args: { tenant: string }): Promise<{ feature: string; period: string; request_count: number }[]>;
  /** Sets one feature's count this period, or removes the row with null; resolves with the count before. */
  seedAiUsage(args: { tenant: string; feature: string; requestCount: number | null }): Promise<number | null>;
  /**
   * Lou's reply suggestions for the thread with a role's number. With no
   * draft the route still answers 200, with an empty list and a reason;
   * `over_cap` is how it refuses at the cap.
   */
  replySuggestions(args: { member: string; withRole: StandingRole }): Promise<ApiAnswer<{ suggestions?: unknown[]; reason?: string }>>;
  /**
   * `POST /v1/rig/simulate-incoming`: a real ring push to the target's
   * devices for a call that does not exist, showing `caller` as the caller.
   */
  simulateIncoming(args: { member: string; target: string; caller?: string }): Promise<ApiAnswer<{ session_id?: string; reachable?: boolean }>>;
  /** `POST /v1/voicemail-greetings/capture-call`: the API calls the number the owner typed, here a robot line, to record a greeting. */
  startGreetingCapture(args: { member: string; toRole: StandingRole; name: string }): Promise<ApiAnswer>;
  /** The tenant's greetings created since a time, newest last; the audio is in the voicemail-greetings bucket. */
  greetings(args: { tenant: string; since: number }): Promise<{ id: string; created_at: string; storage_path: string; mime_type: string | null; duration_ms: number | null }[]>;
  /** The website widget: start with a Turnstile token or none, then verify with the texted code. */
  widgetStart(args: { tenant: string; phoneRole: StandingRole; turnstileToken?: string }): Promise<ApiAnswer<{ verificationId?: string }>>;
  widgetVerify(args: { verificationId: string; code: string; message: string }): Promise<ApiAnswer>;
  widgetVerifications(args: { tenant: string; since: number }): Promise<number>;
  /** Signs in with password and the member's TOTP factor; `meStatus` is `GET /v1/me` on the second-level session. */
  signInWithTotp(args: { member: string }): Promise<{ aal: string | null; meStatus: number }>;
  /** Asks local auth to mail the member a password reset, which lands in Mailpit (S34's auth mail). */
  sendPasswordReset(args: { member: string }): Promise<number>;
  /** The workspace a public sign-up created, found by its owner's address (S32, S35). */
  workspaceOf(args: { ownerEmail: string }): Promise<{ company_id: string; subscription_status: string; stripe_subscription_id: string | null } | null>;
  /** Invites an address to the member's workspace; the answer is the invite row itself. The undo is `app.revoke-invite`. */
  invite(args: { member: string; email: string }): Promise<ApiAnswer<{ id?: string; email_sent?: boolean }>>;

  /** `POST /v1/numbers/provision` with the company's area code: the app's own search, order and binding. The answer is the number's row. */
  provisionNumber(args: { member: string }): Promise<ApiAnswer<{ id?: string; status?: string }>>;
  numberRows(args: { tenant: string }): Promise<NumberRow[]>;
  /** Marks a number row released, as the app does after Telnyx gave the number back. */
  markNumberReleased(args: { phoneNumberId: string }): Promise<void>;
  /**
   * Cancels the workspace as the cancellation webhook leaves it (numbers
   * suspended) with `canceled_at` that many days ago. Resolves with the state
   * before, for `app.restore-workspace`.
   */
  backdateCancellation(args: { tenant: string; daysAgo: number }): Promise<WorkspaceState>;
  graceState(args: { tenant: string }): Promise<GraceState>;
}

/** What the guard answered a request it must refuse. */
export interface GuardProbeAnswer {
  status: number;
  /** The guard's own refusal header was on the answer: a policy said no, not Telnyx. */
  refused_by_guard: boolean;
  rule: string | null;
}

/**
 * G01's negative probes, each sent as the robot under the run's lease:
 *   foreign-connection  a dial on a connection outside the partition
 *   text-from-outside   a text whose sender is a fictional number
 *   dial-to-unowned     a dial to a fictional number
 */
export const GUARD_PROBES = ["foreign-connection", "text-from-outside", "dial-to-unowned"] as const;
export type GuardProbe = (typeof GUARD_PROBES)[number];

export interface WebhookDelivery {
  id: string;
  status: string;
  event_type: string | null;
  /** The Telnyx event the delivery carried, which the API records once however often it arrives. */
  event_id: string | null;
  /** Each attempt's host and HTTP status, oldest first. Never the URL's path, which carries the edge's secrets. */
  attempts: { host: string | null; http_status: number | null; at: string | null }[];
}

/** The guard, through the edge, as rigd's callers see it. */
export interface GuardApi {
  health(): Promise<GuardHealth>;
  /** Counts of the partition: never a number, never an id. */
  partition(): Promise<{ owned: number; standing: number; messaging_profiles: number }>;
  /** The guard's log of a lease: what reached it while the lease was live. */
  activity(leaseId: string): Promise<LeaseActivity>;
  probe(kind: GuardProbe, leaseId: string): Promise<GuardProbeAnswer>;
  /** A partition number by Telnyx id: 200 while held in the group, 404 once released. */
  numberStatus(telnyxPhoneNumberId: string): Promise<{ status: number; in_group: boolean }>;
  /** DELETE through the guard, which allows it only on an owned number that is not standing. */
  releaseNumber(telnyxPhoneNumberId: string): Promise<{ status: number; rule: string | null }>;
  webhookDeliveries(args: { since: number }): Promise<WebhookDelivery[]>;
}

/** One Android device: the Pixel, or an emulator. */
export interface DeviceApi {
  readonly name: string;
  /** adb sees it and it has finished booting. */
  reachable(): Promise<boolean>;
  state(): Promise<DeviceState>;
  /** Killed the way memory pressure kills it, which is not force-stop. */
  kill(): Promise<void>;
  forceStop(): Promise<void>;
  forceDoze(): Promise<void>;
  exitDoze(): Promise<void>;
  /** Screen off and the battery unplugged in software, so the device can reach deep idle by itself. */
  idleNaturally(): Promise<void>;
  setStandbyBucket(bucket: StandbyBucket): Promise<void>;
  batterySaver(on: boolean): Promise<void>;
  hibernate(on: boolean): Promise<void>;
  notificationsAllowed(on: boolean): Promise<void>;
  lock(): Promise<void>;
  /** Types the PIN from the rig's store. */
  unlock(): Promise<void>;
  /** With `unlock: false`, it stays before first unlock. */
  reboot(options?: { unlock?: boolean }): Promise<void>;
  /** Installs the `.nonprod` build of the deployed ref, or the previous release's. */
  install(build: "current" | "previous"): Promise<string>;
  uninstall(): Promise<void>;
  /** Opens the app, at a path when given. */
  launch(path?: string): Promise<void>;
  /** Waits for Telecom to report a ringing call and the full-screen ring to show; undefined if neither did. */
  waitForRinging(timeoutMs: number): Promise<{ telecom_ms?: number; full_screen_ms?: number } | undefined>;
  /** Telecom's state for the app's calls. */
  callState(): Promise<"ringing" | "active" | "holding" | "disconnected" | "none">;
  /** Taps a call control by its test id (tools/rig/test-ids.json); false when it is not on screen. */
  tap(id: CallTestId): Promise<boolean>;
  /** Whether a control or a piece of text is on screen now. */
  showing(target: { id: CallTestId } | { text: string }): Promise<boolean>;
  /** Taps the first control whose text or description is this, as a person would find it. */
  tapText(text: string): Promise<boolean>;
  /** Types into the focused field. */
  type(text: string): Promise<void>;
  /** Signs the device's member in on the app's sign-in screen, with the seed's credentials; false when no sign-in screen showed. */
  signIn(member: string): Promise<boolean>;
  /** Opens the app's dialer, enters the role's number and presses Call. */
  dial(role: StandingRole): Promise<void>;
  /**
   * The installed build's `com.google.android.gms.version`, which
   * play-services-basement merges into its manifest: the lowest Play services
   * versionCode its Google libraries accept. Null when it declares none.
   */
  playServicesMinimum(): Promise<number | null>;
  /** Hands-free audio over Bluetooth, the Pixel's only; undefined on an emulator. */
  readonly audio?: AudioLinkApi;
}

/** The rig as the Pixel's Bluetooth hands-free unit and media sink. */
export interface AudioLinkApi {
  connected(): Promise<boolean>;
  /** Plays the Pixel's code into the call's uplink while the call lasts. */
  playCode(surface: Surface): Promise<void>;
  stop(): Promise<void>;
  /** Records the call's downlink (`call`) or media playback (`media`) for that long and judges it here. */
  hear(args: { stream: "call" | "media"; ms: number; own?: Surface }): Promise<Detection>;
  /** Records and transcribes locally; no audio is kept. */
  transcribe(args: { stream: "call" | "media"; ms: number }): Promise<string>;
}

export interface DevicesApi {
  pixel(): DeviceApi;
  emulator(api: 34 | 35 | 36): DeviceApi;
  /** Starts the AVD for that API level headless and waits for it to boot. */
  bootEmulator(api: 34 | 35 | 36): Promise<void>;
  shutdownEmulator(api: 34 | 35 | 36): Promise<void>;
  /** Cuts and restores the Pixel's USB hub port. */
  powerCycle(): Promise<void>;
}

/** `rig health`'s report, as `state/health.json` holds it. */
export interface RigHealthReport {
  at: string;
  sha: string | null;
  results: { name: string; pass: boolean; reason?: string }[];
  room?: number | null;
  [published: string]: unknown;
}

/** The rig box itself. */
export interface RigApi {
  /** Runs `rig health` now and reads its report. */
  health(): Promise<RigHealthReport>;
  /** The local API's Sentry events the relay saw since a time. */
  apiEvents(since: number): Promise<SeenEvent[]>;
  /** The next Telnyx call event the edge relays gets this status from the rig instead of the API's. */
  failNextCallEvent(status: 503): Promise<void>;
  /** Drops a fault no call event took, so it cannot answer a later run's event. */
  disarmCallEventFault(): Promise<void>;
  /** Loss and delay on the Pixel's access point, or null to clear them. */
  impairNetwork(impairment: NetworkImpairment | null): Promise<void>;
  /** Takes the Pixel's Wi-Fi away for that long, then gives it back. */
  networkOutage(ms: number): Promise<void>;
  /** Transcribes audio locally (whisper.cpp); no audio is kept. */
  transcribe(audio: Uint8Array): Promise<string>;
}

export interface MailMessage {
  id: string;
  to: string;
  from: string;
  subject: string;
  text: string;
  /** Every http(s) link in the body. */
  links: string[];
  received_at: string;
}

export interface MailApi {
  /** The robot mailbox's `+tag` address, or undefined when the rig's private config names none. */
  robotAddress(tag: string): string | undefined;
  /** Mail the edge stored for the robot's address since a time, with that tag when given. */
  robotMail(args: { since: number; tag?: string }): Promise<MailMessage[]>;
  /** Supabase Auth's mail in the local Mailpit, to an address, since a time. */
  mailpit(args: { to: string; since: number }): Promise<MailMessage[]>;
  /** Follows a link from a mail without a browser: the status and where it sends you. */
  openLink(url: string): Promise<{ status: number; location: string | null }>;
}

/** The `loonext-rig` Stripe sandbox. Test-mode keys only; anything else is refused before a request. */
export interface StripeApi {
  /** One sandbox call, form-encoded, on the paths S29 and S32 use. */
  request<T = Record<string, unknown>>(method: "GET" | "POST" | "DELETE", path: string, params?: Record<string, unknown>): Promise<T>;
  /** The subscription the tenant's company row names, or null when it names none. */
  subscriptionOf(tenant: string): Promise<{ id: string; status: string } | null>;
}

/**
 * S28 leaves its number to S29 in this record, and S29 takes it over.
 * `handed_off` is written only by a passing S28; until then the number is
 * the undo's to release.
 */
export interface NumberHandoff {
  tenant: string;
  run_id: string;
  telnyx_phone_number_id: string;
  phone_number_id: string;
  bought_at: string;
  state: "bought" | "handed_off" | "taken";
}

export interface HandoffApi {
  read(): Promise<NumberHandoff | null>;
  write(record: NumberHandoff): Promise<void>;
  clear(): Promise<void>;
}

/** A scenario's own earlier attempts, from rigd's verdicts: what a judgement over a week reads. */
export interface ScenarioHistoryApi {
  /** This scenario's attempts that finished since a time, newest first, each with the evidence it saved. */
  attempts(args: { since: number }): Promise<
    { run_id: string; attempt: number; outcome: string; finished_at: string; evidence: Record<string, unknown> | null }[]
  >;
}

export interface ScenarioContext {
  scenario: string;
  runId: string;
  attempt: number;
  /** Which of the scenario's registry runs this is: its variant, when the row names one. */
  slot: { index: number; label?: string };
  lease: LeaseHandle;
  robot: RobotApi;
  app: AppApi;
  browser: BrowserApi;
  guard: GuardApi;
  devices: DevicesApi;
  rig: RigApi;
  mail: MailApi;
  stripe: StripeApi;
  handoff: HandoffApi;
  history: ScenarioHistoryApi;
  /** The scenario holding a lane while it prepares (D03's idling Pixel), when that is another run. */
  laneHeldBy(lane: string): string | undefined;
  /** The scenarios the rig times that this room would block, by id, as the runner's admission blocks them. */
  blockedAt(room: number): string[];
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Unique to this attempt; every body a scenario sends carries it. */
  nonce: string;
  /** Ids, timings, RTP statistics and verdict numbers. Never audio, never a phone number. */
  evidence: Record<string, unknown>;
}

/** The parts of a context rigd builds once per attempt from the rig's lanes. */
export type ScenarioLanes = Pick<ScenarioContext, "robot" | "app" | "browser" | "guard" | "devices" | "rig" | "mail" | "stripe" | "handoff">;

export interface ScenarioRunner {
  id: string;
  /**
   * Holds the guard's lease though the scenario dials nothing, because the
   * guard allows what it does only under a live lease named for it: S34's
   * mail to the robot mailbox.
   */
  guardLease?: boolean;
  /**
   * Setup that may take longer than a lease lasts, run before the lease is
   * taken: its context's lease registers no undo. A result here ends the
   * attempt without a lease or a dial.
   */
  prepare?(ctx: ScenarioContext): Promise<ScenarioResult | undefined>;
  /** Puts back what a finished prepare changed, when the run then never starts: no lease, or the window closed. */
  abandon?(ctx: ScenarioContext): Promise<void>;
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
