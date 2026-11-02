/**
 * The app probe: the rig's local Loonext, driven as a member through its API
 * and read through its local database's PostgREST with the local service key.
 * Every read names its columns; the table and column names come from
 * supabase/migrations.
 *
 * Tenants, members and their passwords are the seed's `tenants.json` in the
 * rig's secret store (scripts/rig/seed.mjs), which git never sees. Tenants are
 * keyed `qa-w`, members `owner`; scenarios name a member `qa-w-owner`.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EDGE_PATHS, GUARD_ROUTES } from "@loonext/rig-protocol";
import type { NumberBook } from "@loonext/rig-robot";
import { stableUuid as seedStableUuid } from "../../../../scripts/rig/seed.mjs";
import { totpCode } from "../../../../scripts/rig/seed.mjs";
import { MemberSessions, memberSessionsFile } from "../../src/member-sessions.mjs";
import {
  COMPANY_FIELDS,
  isFictional,
  type ApiAnswer,
  type AppApi,
  type AutomatedText,
  type CallRow,
  type CallStart,
  type CompanyField,
  type Destination,
  type GraceState,
  type MessageRow,
  type NumberRow,
  type CheckoutEvent,
  type SendResult,
  type SignUpNumber,
  type SignUpNumberRow,
  type VoiceCapState,
  type WorkspaceState,
} from "./scenarios/context.ts";

/** The seed's `tenants.json`: tenant key to company id and members' sign-ins. */
export type TenantsFile = Record<
  string,
  { company_id: string; members: Record<string, { email: string; password: string; totp_secret?: string }> }
>;

/**
 * The seed's deterministic ids, from the seed itself: a phone number's row id
 * is stableUuid(company_id, role).
 */
export function stableUuid(...parts: string[]): string {
  return seedStableUuid(...parts);
}

/** `qa-w-owner` is tenant `qa-w`, member `owner`; `qa-c-signout-member` is tenant `qa-c`, member `signout-member`. */
export function splitMember(key: string): { tenant: string; member: string } {
  const match = /^([a-z]+-[a-z0-9]+)-([a-z0-9-]+)$/.exec(key);
  if (!match) throw new Error(`app probe: "${key}" is not a member key like qa-w-owner`);
  return { tenant: match[1]!, member: match[2]! };
}

export interface AppProbeOptions {
  tenants: TenantsFile;
  numbers: NumberBook;
  /** The deployed API on loopback, e.g. http://127.0.0.1:8787. */
  apiBase: string;
  supabaseUrl: string;
  serviceRoleKey: string;
  anonKey: string;
  edgeOrigin: string;
  /** A guard caller token, for the read-class recordings listing. */
  guardToken: string;
  /**
   * The secret path segment of the robot's sink at the edge (`/w/<secret>`),
   * the store's `robot-webhook-secret`; without it no webhook can reach the robot.
   */
  robotWebhookSecret?: () => string | undefined;
  /** The robot mailbox (`local@domain`), the store's `robot-mailbox`; S34's accounts are sub-addresses of it and of nothing else. */
  robotMailbox?: () => string | undefined;
  /** `state/rigd`: S25 keeps what it changed here, so the undo can put it back. */
  stateDir?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export class AppProbe implements AppApi {
  readonly #o: AppProbeOptions;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  /** The members' sign-ins, kept in the state directory so a new process refreshes them and signs no one in again. */
  readonly #signIns: MemberSessions;
  /** Auth user ids by member key, once seen. */
  readonly #userIds = new Map<string, string>();

  constructor(options: AppProbeOptions) {
    this.#o = options;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#signIns = new MemberSessions({
      authUrl: `${options.supabaseUrl.replace(/\/+$/, "")}/auth/v1`,
      apiKey: options.anonKey,
      ...(options.stateDir ? { file: memberSessionsFile(dirname(options.stateDir)) } : {}),
      fetch: this.#fetch,
      now: this.#now,
    });
  }

  sendText(args: { member: string; fromRole: string; toRole: string; body: string }): Promise<SendResult> {
    return this.#compose(args, args.fromRole, this.#number(args.toRole));
  }

  /** The only raw destination the probe sends to is a fictional one. */
  async sendTextToFictional(args: { member: string; fromRole: string; e164: string; body: string }): Promise<SendResult> {
    if (!isFictional(args.e164)) throw new Error("app probe: a raw destination must be in the fictional 555-01xx range");
    return this.#compose(args, args.fromRole, args.e164);
  }

  async #compose(args: { member: string; body: string }, fromRole: string, to: string): Promise<SendResult> {
    const tenant = this.#tenant(splitMember(args.member).tenant);
    const phoneNumberId = stableUuid(tenant.company_id, fromRole);
    const response = await this.#authorized(args.member, (token) =>
      this.#fetch(`${this.#o.apiBase.replace(/\/+$/, "")}/v1/conversations`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "x-company-id": tenant.company_id,
          "idempotency-key": randomUUID(),
          "content-type": "application/json",
        },
        // Every rig number is Ontario's, so from 8 pm to 8 am Toronto the API asks for a
        // confirmation, as it asks a person. The runs are about the send, not that prompt.
        body: JSON.stringify({ phone_e164: to, phone_number_id: phoneNumberId, body: args.body, quiet_hours_confirmed: true }),
        signal: AbortSignal.timeout(20_000),
      }),
    );
    const json = (await response.json().catch(() => ({}))) as { message?: SentMessage; error?: { code?: string } };
    if (!response.ok) return { ok: false, status: response.status, code: json.error?.code };
    return sendResult(response.status, json.message);
  }

  messages(args: { tenant: string; body: string; since: number }): Promise<MessageRow[]> {
    return this.#rest<MessageRow[]>("messages", {
      company_id: `eq.${this.#tenant(args.tenant).company_id}`,
      body: `eq.${args.body}`,
      created_at: `gte.${iso(args.since)}`,
      select: "id,direction,body,status,error_code,conversation_id,created_at",
      order: "created_at.asc",
    });
  }

  usageFor(messageId: string) {
    return this.#rest<{ type: string; quantity: number; stripe_reported_at: string | null }[]>("usage_events", {
      message_id: `eq.${messageId}`,
      select: "type,quantity,stripe_reported_at",
    });
  }

  pushAttempts(args: { tenant: string; since: number; purpose?: "ring" | "call_end" | "alert" }) {
    return this.#rest<{ purpose: string; platform: string; response_class: string; attempted_at: string }[]>("push_attempts", {
      company_id: `eq.${this.#tenant(args.tenant).company_id}`,
      attempted_at: `gte.${iso(args.since)}`,
      ...(args.purpose ? { purpose: `eq.${args.purpose}` } : {}),
      select: "purpose,platform,response_class,attempted_at,priority,call_session_id,user_id",
    });
  }

  async pushTargets(args: { member: string }): Promise<number> {
    const userId = subjectOf(await this.#session(args.member));
    const [subscriptions, tokens] = await Promise.all([
      this.#rest<{ id: string }[]>("push_subscriptions", { user_id: `eq.${userId}`, select: "id" }),
      this.#rest<{ id: string }[]>("device_push_tokens", { user_id: `eq.${userId}`, select: "id" }),
    ]);
    return subscriptions.length + tokens.length;
  }

  async pushTokens(args: { member: string }): Promise<string[]> {
    const rows = await this.#rest<{ token: string }[]>("device_push_tokens", {
      user_id: `eq.${await this.#userIdOf(args.member)}`,
      platform: "eq.android",
      select: "token",
    });
    return rows.map((row) => row.token);
  }

  async optOut(args: { tenant: string; role: string }) {
    const rows = await this.#rest<{ revoked_at: string | null; source: string }[]>("opt_outs", {
      company_id: `eq.${this.#tenant(args.tenant).company_id}`,
      phone_e164: `eq.${this.#number(args.role)}`,
      select: "revoked_at,source",
    });
    const row = rows[0];
    return row ? { active: row.revoked_at === null, source: row.source } : null;
  }

  async optOutHint(args: { tenant: string; role: string }): Promise<string | null> {
    const companyId = this.#tenant(args.tenant).company_id;
    const contacts = await this.#rest<{ id: string }[]>("contacts", {
      company_id: `eq.${companyId}`,
      phone_e164: `eq.${this.#number(args.role)}`,
      select: "id",
    });
    if (contacts.length === 0) return null;
    const conversations = await this.#rest<{ opt_out_hint_at: string | null }[]>("conversations", {
      company_id: `eq.${companyId}`,
      contact_id: `in.(${contacts.map((c) => c.id).join(",")})`,
      opt_out_hint_at: "not.is.null",
      select: "opt_out_hint_at",
    });
    return conversations[0]?.opt_out_hint_at ?? null;
  }

  calls(args: { tenant: string; callerRole: string; since: number }): Promise<CallRow[]> {
    return this.#rest<CallRow[]>("calls", {
      company_id: `eq.${this.#tenant(args.tenant).company_id}`,
      caller_e164: `eq.${this.#number(args.callerRole)}`,
      started_at: `gte.${iso(args.since - 60_000)}`,
      select:
        "call_session_id,outcome,forward_seconds,started_at,ended_at,voicemail_path,voicemail_transcript,voicemail_intake," +
        "direction,state,answered_at,answered_by_user_id,notice_spoken",
      order: "started_at.asc",
    });
  }

  async meteredSeconds(args: { tenant: string; callSessionId: string }): Promise<number> {
    const rows = await this.#rest<{ billable_seconds: number }[]>("call_records", {
      company_id: `eq.${this.#tenant(args.tenant).company_id}`,
      call_session_id: `eq.${args.callSessionId}`,
      leg: "eq.forward",
      select: "billable_seconds",
    });
    return rows.reduce((sum, row) => sum + row.billable_seconds, 0);
  }

  async voiceSecondsSince(args: { tenant: string; since: number }): Promise<number> {
    const rows = await this.#rest<{ billable_seconds: number }[]>("call_records", {
      company_id: `eq.${this.#tenant(args.tenant).company_id}`,
      created_at: `gte.${iso(args.since)}`,
      select: "billable_seconds",
    });
    return rows.reduce((sum, row) => sum + row.billable_seconds, 0);
  }

  async outboundTokenUse(args: { tenant: string; toRole: string; since: number }): Promise<{ calls: number; left: number }> {
    const companyId = this.#tenant(args.tenant).company_id;
    const to = this.#number(args.toRole);
    // api_authorize_outbound_call deletes the token it consumes and inserts the
    // call's row in the same step; nothing else inserts an outbound row.
    const [calls, left] = await Promise.all([
      this.#rest<{ call_session_id: string }[]>("calls", {
        company_id: `eq.${companyId}`,
        direction: "eq.outbound",
        caller_e164: `eq.${to}`,
        created_at: `gte.${iso(args.since)}`,
        select: "call_session_id",
      }),
      this.#rest<{ nonce: string }[]>("outbound_call_authorizations", {
        company_id: `eq.${companyId}`,
        customer_e164: `eq.${to}`,
        created_at: `gte.${iso(args.since)}`,
        select: "nonce",
      }),
    ]);
    return { calls: calls.length, left: left.length };
  }

  /** Creates the endpoint, or turns it back on with every event asked for; never removes one. */
  async ensureRobotWebhook(args: { member: string; events: string[] }): Promise<void> {
    const secret = this.#o.robotWebhookSecret?.();
    if (!secret) throw new Error("the store has no robot-webhook-secret, so the robot's sink at the edge has no address");
    const { tenant: tenantKey } = splitMember(args.member);
    const url = `${this.#o.edgeOrigin.replace(/\/+$/, "")}${EDGE_PATHS.robotWebhookPrefix}${secret}/${tenantKey}`;
    const listed = await this.#api<{ endpoints?: { id: string; url: string; events: string[]; active: boolean }[] }>(
      args.member,
      "GET",
      "/v1/webhooks",
    );
    const existing = (listed.endpoints ?? []).find((endpoint) => endpoint.url === url);
    if (!existing) {
      await this.#api(args.member, "POST", "/v1/webhooks", { url, events: args.events, description: "Loonext rig robot sink" });
      return;
    }
    const events = [...new Set([...existing.events, ...args.events])];
    if (existing.active && events.length === existing.events.length) return;
    await this.#api(args.member, "PATCH", `/v1/webhooks/${encodeURIComponent(existing.id)}`, { events, active: true });
  }

  async telnyxRecordings(callSessionId: string): Promise<number> {
    const base = `${this.#o.edgeOrigin.replace(/\/+$/, "")}${EDGE_PATHS.guardPrefix}${GUARD_ROUTES.telnyx}`;
    const response = await this.#fetch(`${base}/v2/recordings?filter[call_session_id]=${encodeURIComponent(callSessionId)}`, {
      headers: { authorization: `Bearer ${this.#o.guardToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`app probe: the recordings listing returned ${response.status}`);
    const { data } = (await response.json()) as { data?: unknown[] };
    return Array.isArray(data) ? data.length : 0;
  }

  /** wrangler 4.106's scheduled route, as the rig's cron timers call it. */
  async fireCron(cron: string, at = this.#now()): Promise<void> {
    const url = `${this.#o.apiBase.replace(/\/+$/, "")}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent(cron)}&time=${at}`;
    const response = await this.#fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`app probe: firing ${cron} returned ${response.status}`);
  }

  /**
   * S25's automations for one nonce, in the tenant's thread with the role:
   * an away reply and an emergency acknowledgement, which the runner's own
   * inbound text sets off, and a scheduled send and a reminder, due now.
   * Every body carries the nonce. The help reply is not armed: only an AIDE
   * draws it, and S24 sends one already.
   */
  async armAutomations(args: { tenant: string; toRole: string; nonce: string }): Promise<{ undo: { kind: string; params: Record<string, unknown> } }> {
    const companyId = this.#tenant(args.tenant).company_id;
    const conversationId = await this.#conversationWith(args.tenant, args.toRole);
    if (!conversationId) throw new Error(`app probe: ${args.tenant} has no thread with ${args.toRole} to arm automations in`);
    const bodies = automationBodies(args.nonce);
    const previous = await this.patchCompany({
      tenant: args.tenant,
      values: {
        away_enabled: true,
        away_message: bodies.away_reply,
        // Every weekday missing is closed all day (packages/shared business-hours.ts), so the away reply always applies.
        business_hours: {},
        business_hours_exceptions: [],
        emergency_keyword_enabled: true,
        emergency_reply_enabled: true,
        emergency_keywords: [S25_KEYWORD],
        emergency_message: bodies.emergency_ack,
      },
    });
    this.#saveArmed(args.nonce, { tenant: args.tenant, previous, armed_at: this.#now() });
    const owner = await this.#userIdOf(`${args.tenant.toLowerCase()}-owner`);
    const due = iso(this.#now());
    const expires = iso(this.#now() + 24 * 3_600_000);
    for (const [origin, body] of [
      ["human", bodies.scheduled_send],
      ["reminder", bodies.reminder],
    ] as const) {
      await this.#write("POST", "scheduled_messages", {}, {
        company_id: companyId,
        conversation_id: conversationId,
        body,
        send_at: due,
        clock_timezone: "America/Toronto",
        clock_source: "area_code",
        expires_at: expires,
        created_by: owner,
        origin,
        ...(origin === "reminder" ? { reminder_offset_minutes: 60 } : {}),
      });
    }
    return { undo: { kind: "app.disarm-automations", params: { tenant: args.tenant, nonce: args.nonce } } };
  }

  async automatedTexts(args: { tenant: string; nonce: string }): Promise<AutomatedText[]> {
    const armed = this.#readArmed(args.nonce);
    if (!armed) return [];
    const companyId = this.#tenant(args.tenant).company_id;
    const bodies = automationBodies(args.nonce);
    const sent = await this.#rest<{ body: string; status: string | null; direction: string }[]>("messages", {
      company_id: `eq.${companyId}`,
      direction: "eq.outbound",
      body: `like.*${args.nonce}*`,
      created_at: `gte.${iso(armed.armed_at)}`,
      select: "body,status,direction",
    });
    const scheduled = await this.#rest<{ body: string; status: string }[]>("scheduled_messages", {
      company_id: `eq.${companyId}`,
      body: `like.*${args.nonce}*`,
      select: "body,status",
    });
    const stateOf = (body: string): AutomatedText["state"] => {
      const row = scheduled.find((candidate) => candidate.body === body);
      if (row?.status === "held") return "held";
      if (row && row.status !== "sent") return "pending";
      return sent.some((message) => message.body === body && message.status !== "failed") ? "sent" : "pending";
    };
    return (["away_reply", "emergency_ack", "scheduled_send", "reminder"] as const).map((kind) => ({
      kind,
      body: bodies[kind],
      state: stateOf(bodies[kind]),
      reply: kind === "away_reply" || kind === "emergency_ack",
    }));
  }

  /** Undo for armAutomations: the company's settings back, and the scheduled texts cancelled if still unsent. */
  async disarmAutomations(args: { tenant: string; nonce: string }): Promise<void> {
    const armed = this.#readArmed(args.nonce);
    const companyId = this.#tenant(args.tenant).company_id;
    await this.#write("PATCH", "scheduled_messages", {
      company_id: `eq.${companyId}`,
      body: `like.*${args.nonce}*`,
      status: "in.(pending,held)",
    }, { status: "canceled", canceled_at: iso(this.#now()) }, "return=minimal");
    if (armed) await this.patchCompany({ tenant: args.tenant, values: armed.previous });
    if (this.#o.stateDir) rmSync(this.#armedPath(args.nonce), { force: true });
  }

  async sendMms(args: {
    member: string;
    fromRole: string;
    toRole: string;
    body: string;
    media: { bytes: Uint8Array; contentType: string };
  }): Promise<SendResult> {
    const { tenant } = splitMember(args.member);
    const conversationId = await this.#conversationWith(tenant, args.toRole);
    if (!conversationId) throw new Error(`app probe: ${tenant} has no thread with ${args.toRole}`);
    const answer = await this.#answer<{ message?: SentMessage }>(args.member, "POST", "/v1/messages/send", {
      conversation_id: conversationId,
      body: args.body,
      media: [{ content_type: args.media.contentType, base64: Buffer.from(args.media.bytes).toString("base64") }],
    });
    if (answer.status >= 400) return { ok: false, status: answer.status, code: answer.code };
    return sendResult(answer.status, answer.body?.message);
  }

  async messagesWith(args: { tenant: string; role: string; since: number }): Promise<MessageRow[]> {
    const conversationIds = await this.#conversationsWith(args.tenant, args.role);
    if (conversationIds.length === 0) return [];
    return this.#rest<MessageRow[]>("messages", {
      company_id: `eq.${this.#tenant(args.tenant).company_id}`,
      conversation_id: `in.(${conversationIds.join(",")})`,
      created_at: `gte.${iso(args.since)}`,
      select: "id,direction,body,status,error_code,conversation_id,created_at",
      order: "created_at.asc",
    });
  }

  attachments(messageId: string) {
    return this.#rest<{ storage_path: string; content_type: string; size_bytes: number; quarantined_at: string | null }[]>(
      "message_attachments",
      { message_id: `eq.${messageId}`, select: "storage_path,content_type,size_bytes,quarantined_at" },
    );
  }

  async storedObject(args: { bucket: string; path: string }): Promise<Uint8Array> {
    if (!/^[a-z0-9-]+$/.test(args.bucket) || args.path.split("/").some((part) => part === ".." || part === "")) {
      throw new Error("app probe: not a storage object");
    }
    const path = args.path.split("/").map(encodeURIComponent).join("/");
    const response = await this.#fetch(`${this.#o.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/authenticated/${args.bucket}/${path}`, {
      headers: { apikey: this.#o.serviceRoleKey, authorization: `Bearer ${this.#o.serviceRoleKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`app probe: reading ${args.bucket} returned ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async ringBeacons(args: { tenant: string; since: number; member?: string }) {
    return this.#rest<
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
    >("ring_beacons", {
      company_id: `eq.${this.#tenant(args.tenant).company_id}`,
      occurred_at: `gte.${iso(args.since)}`,
      ...(args.member ? { user_id: `eq.${await this.#userIdOf(args.member)}` } : {}),
      select: "stage,platform,occurred_at,call_session_id,app_version,device_idle,screen_locked,standby_bucket",
      order: "occurred_at.asc",
    });
  }

  async callLegs(args: { tenant: string; callSessionId: string }) {
    const rows = await this.#rest<{ user_id: string | null; state: string; kind: string | null }[]>("call_member_legs", {
      company_id: `eq.${this.#tenant(args.tenant).company_id}`,
      call_session_id: `eq.${args.callSessionId}`,
      select: "user_id,state,kind",
      order: "created_at.asc",
    });
    const members = await this.#membersByUser(args.tenant);
    return rows.map((row) => ({ member: row.user_id ? (members.get(row.user_id) ?? null) : null, state: row.state, kind: row.kind }));
  }

  async placeCall(args: { member: string; fromRole: string; to: Destination }): Promise<CallStart> {
    const { tenant } = splitMember(args.member);
    const to = typeof args.to === "string" ? this.#number(args.to) : args.to.fictional;
    if (typeof args.to !== "string" && !isFictional(to)) throw new Error("app probe: a raw destination must be in the fictional 555-01xx range");
    const answer = await this.#answer<{ session_id?: string; call_session_id?: string }>(args.member, "POST", "/v1/calls/browser", {
      to,
      phone_number_id: stableUuid(this.#tenant(tenant).company_id, args.fromRole),
    });
    if (answer.status >= 400) return { ok: false, status: answer.status, code: answer.code };
    const sessionId = answer.body?.session_id ?? answer.body?.call_session_id;
    if (!sessionId) throw new Error("app probe: the call authorisation returned no session id");
    return { ok: true, sessionId };
  }

  async voiceToken(args: { member: string; fresh?: boolean }): Promise<ApiAnswer> {
    if (args.fresh) this.#signIns.forget(args.member);
    // The answer's body is a voice credential's token, which no scenario keeps.
    const answer = await this.#answer(args.member, "POST", "/v1/webrtc/token", {});
    return { status: answer.status, ...(answer.code ? { code: answer.code } : {}) };
  }

  async signOutSession(args: { member: string }): Promise<ApiAnswer> {
    const answer = await this.#answer<Record<string, unknown>>(args.member, "POST", "/v1/sessions/revoke", { self: true });
    // This process keeps the revoked token, so the run can watch the API refuse it;
    // no later process is handed it.
    this.#signIns.forget(args.member, { keepInMemory: true });
    return answer;
  }

  escalations(args: { tenant: string; since: number }) {
    return this.#rest<
      { kind: string; on_call_user_id: string | null; escalate_at: string; escalated_at: string | null; acknowledged_at: string | null }[]
    >("alert_escalations", {
      company_id: `eq.${this.#tenant(args.tenant).company_id}`,
      created_at: `gte.${iso(args.since)}`,
      select: "kind,on_call_user_id,escalate_at,escalated_at,acknowledged_at",
      order: "created_at.asc",
    });
  }

  webhookEvents(args: { since: number; type?: string }) {
    return this.#rest<{ event_id: string; event_type: string; processed_at: string | null; attempts: number }[]>("webhook_events", {
      provider: "eq.telnyx",
      received_at: `gte.${iso(args.since)}`,
      ...(args.type ? { event_type: `eq.${args.type}` } : {}),
      select: "event_id,event_type,processed_at,attempts",
    });
  }

  async flag(key: string): Promise<boolean | null> {
    const rows = await this.#rest<{ enabled: boolean }[]>("feature_flags", { key: `eq.${key}`, select: "enabled" });
    return rows[0]?.enabled ?? null;
  }

  async setFlag(key: string, enabled: boolean | null): Promise<void> {
    if (!/^[a-z0-9:_-]+$/.test(key)) throw new Error("app probe: not a flag key");
    if (enabled === null) {
      await this.#write("DELETE", "feature_flags", { key: `eq.${key}` }, undefined, "return=minimal");
      return;
    }
    await this.#write("POST", "feature_flags", { on_conflict: "key" }, { key, enabled, note: "set by a rig scenario under its lease" }, "resolution=merge-duplicates,return=minimal");
  }

  async companySettings(args: { tenant: string; fields: readonly CompanyField[] }): Promise<Partial<Record<CompanyField, unknown>>> {
    const unknown = args.fields.filter((field) => !(COMPANY_FIELDS as readonly string[]).includes(field));
    if (unknown.length) throw new Error(`app probe: ${unknown.join(", ")} is not a company setting a scenario may change`);
    if (args.fields.length === 0) return {};
    const companyId = this.#tenant(args.tenant).company_id;
    const [row] = await this.#rest<Record<string, unknown>[]>("companies", { id: `eq.${companyId}`, select: args.fields.join(",") });
    if (!row) throw new Error(`app probe: no company row for ${args.tenant}`);
    return Object.fromEntries(args.fields.map((field) => [field, row[field] ?? null]));
  }

  async patchCompany(args: { tenant: string; values: Partial<Record<CompanyField, unknown>> }): Promise<Partial<Record<CompanyField, unknown>>> {
    const fields = Object.keys(args.values) as CompanyField[];
    const before = await this.companySettings({ tenant: args.tenant, fields });
    if (fields.length === 0) return before;
    await this.#write("PATCH", "companies", { id: `eq.${this.#tenant(args.tenant).company_id}` }, args.values, "return=minimal");
    return before;
  }

  async numberStatusOf(args: { tenant: string; role: string }): Promise<string> {
    const id = stableUuid(this.#tenant(args.tenant).company_id, args.role);
    const [row] = await this.#rest<{ status: string }[]>("phone_numbers", { id: `eq.${id}`, select: "status" });
    if (!row) throw new Error(`app probe: no number row for ${args.role}`);
    return row.status;
  }

  async setNumberStatus(args: { tenant: string; role: string; status: "active" | "suspended" | "released" }): Promise<string> {
    const id = stableUuid(this.#tenant(args.tenant).company_id, args.role);
    const before = await this.numberStatusOf(args);
    const now = iso(this.#now());
    await this.#write("PATCH", "phone_numbers", { id: `eq.${id}` }, {
      status: args.status,
      suspended_at: args.status === "suspended" ? now : null,
      released_at: args.status === "released" ? now : null,
    }, "return=minimal");
    return before;
  }

  async addOnCallShift(args: { tenant: string; member: string; role: string; startsAt: number; endsAt: number; id?: string }): Promise<{ id: string }> {
    const companyId = this.#tenant(args.tenant).company_id;
    const [row] = await this.#write<{ id: string }[]>("POST", "on_call_shifts", { select: "id" }, {
      ...(args.id ? { id: args.id } : {}),
      company_id: companyId,
      user_id: await this.#userIdOf(args.member),
      phone_number_id: stableUuid(companyId, args.role),
      starts_at: iso(args.startsAt),
      ends_at: iso(args.endsAt),
      created_by: await this.#userIdOf(`${args.tenant.toLowerCase()}-owner`),
    });
    if (!row?.id) throw new Error("app probe: the on-call shift came back without an id");
    return { id: row.id };
  }

  async removeOnCallShift(id: string): Promise<void> {
    await this.#write("DELETE", "on_call_shifts", { id: `eq.${id}` }, undefined, "return=minimal");
  }

  async ringAudience(args: { tenant: string; role: string; member: string }): Promise<"text" | "note" | null> {
    const [row] = await this.#rest<{ level: "text" | "note" }[]>("number_access", { ...(await this.#accessRow(args)), select: "level" });
    return row?.level ?? null;
  }

  async setRingAudience(args: { tenant: string; role: string; member: string; level: "text" | "note" | null }): Promise<"text" | "note" | null> {
    const companyId = this.#tenant(args.tenant).company_id;
    const numberId = stableUuid(companyId, args.role);
    const userId = await this.#userIdOf(args.member);
    const where = await this.#accessRow(args);
    const before = await this.ringAudience(args);
    await this.#write("DELETE", "number_access", where, undefined, "return=minimal");
    if (args.level) {
      await this.#write("POST", "number_access", {}, {
        company_id: companyId,
        phone_number_id: numberId,
        principal_kind: "user",
        principal: userId,
        level: args.level,
      }, "return=minimal");
    }
    return before;
  }

  async #accessRow(args: { tenant: string; role: string; member: string }): Promise<Record<string, string>> {
    const numberId = stableUuid(this.#tenant(args.tenant).company_id, args.role);
    return { phone_number_id: `eq.${numberId}`, principal_kind: "eq.user", principal: `eq.${await this.#userIdOf(args.member)}` };
  }

  async seedUsage(args: { tenant: string; type: string; quantity: number; channel?: string; unit?: string }): Promise<{ marker: string }> {
    const marker = `rig-seed-${randomUUID()}`;
    await this.#write("POST", "usage_events", {}, {
      company_id: this.#tenant(args.tenant).company_id,
      type: args.type,
      quantity: args.quantity,
      meter_identifier: marker,
      // Already reported, so the hourly report never sends a seeded row to the sandbox.
      stripe_reported_at: iso(this.#now()),
      ...(args.channel ? { channel: args.channel } : {}),
      ...(args.unit ? { unit: args.unit } : {}),
    }, "return=minimal");
    return { marker };
  }

  /** This period's voice usage, read the way apps/api/src/messaging/voice-webhook.ts's gates read it. */
  async voiceCapState(args: { tenant: string }): Promise<VoiceCapState> {
    const companyId = this.#tenant(args.tenant).company_id;
    const [company] = await this.#rest<{ plan: string | null; overage_cap_multiplier: number | string | null; current_period_start: string | null }[]>(
      "companies",
      { id: `eq.${companyId}`, select: "plan,overage_cap_multiplier,current_period_start" },
    );
    if (!company) throw new Error(`app probe: no company row for ${args.tenant}`);
    const plan = company.plan === "starter" || company.plan === "pro" ? company.plan : null;
    const multiplier = company.overage_cap_multiplier === null ? null : Number(company.overage_cap_multiplier);
    if (!company.current_period_start) return { plan, overage_cap_multiplier: multiplier, forward_seconds: 0, forwarded_calls: 0 };
    const period = { p_company_id: companyId, p_since: company.current_period_start };
    const [seconds, calls] = await Promise.all([
      this.#rpc<number | string>("api_period_forward_seconds", period),
      this.#rpc<number | string>("api_period_forwarded_calls", period),
    ]);
    return { plan, overage_cap_multiplier: multiplier, forward_seconds: Number(seconds), forwarded_calls: Number(calls) };
  }

  async seedCallRecords(args: { tenant: string; leg: "out_customer" | "in_browser"; rows: number; billableSeconds: number }): Promise<{ marker: string }> {
    if (!Number.isInteger(args.rows) || args.rows < 1 || args.rows > SEED_CALL_RECORDS_MAX) {
      throw new Error(`app probe: seed 1 to ${SEED_CALL_RECORDS_MAX} call records`);
    }
    const marker = `rig-seed-${randomUUID()}`;
    const companyId = this.#tenant(args.tenant).company_id;
    const reportedAt = iso(this.#now());
    for (let start = 0; start < args.rows; start += SEED_BATCH) {
      const batch = Array.from({ length: Math.min(SEED_BATCH, args.rows - start) }, (_, i) => ({
        company_id: companyId,
        // One session for every seeded leg, so the undo finds them all by the marker.
        call_session_id: marker,
        call_leg_id: `${marker}-${start + i}`,
        leg: args.leg,
        billable_seconds: args.billableSeconds,
        // Already reported, so the voice meter never sends a seeded row to the sandbox.
        stripe_reported_at: reportedAt,
      }));
      await this.#write("POST", "call_records", {}, batch, "return=minimal");
    }
    return { marker };
  }

  async seedOutboundSegments(args: { tenant: string; role: string; segments: number; body: string }): Promise<{ marker: string }> {
    const conversationId = await this.#conversationWith(args.tenant, args.role);
    if (!conversationId) throw new Error(`app probe: ${args.tenant} has no thread with ${args.role} to seed segments in`);
    const marker = `rig-seed-${randomUUID()}`;
    await this.#write("POST", "messages", {}, {
      company_id: this.#tenant(args.tenant).company_id,
      conversation_id: conversationId,
      direction: "outbound",
      body: args.body,
      // Delivered, so the send gates count it as sent rather than pending.
      status: "delivered",
      segments: args.segments,
      sent_by_user_id: await this.#userIdOf(`${args.tenant.toLowerCase()}-owner`),
      idempotency_key: marker,
    }, "return=minimal");
    return { marker };
  }

  async copyVoicemail(args: { from: string; tenant: string; role: string; callerRole: string; sessionId: string }): Promise<boolean> {
    if (!SEEDED_VOICEMAIL.test(args.sessionId)) throw new Error("app probe: a copied voicemail's session id is rig-d14-<nonce>");
    const [source] = await this.#rest<{ voicemail_path: string; voicemail_seconds: number | null; voicemail_transcript: string | null }[]>("calls", {
      company_id: `eq.${this.#tenant(args.from).company_id}`,
      caller_e164: `eq.${this.#number(args.callerRole)}`,
      voicemail_path: "not.is.null",
      select: "voicemail_path,voicemail_seconds,voicemail_transcript",
      order: "started_at.desc",
      limit: "1",
    });
    if (!source) return false;
    const audio = await this.storedObject({ bucket: VOICEMAILS_BUCKET, path: source.voicemail_path });
    const companyId = this.#tenant(args.tenant).company_id;
    const path = seededVoicemailPath(companyId, args.sessionId);
    const response = await this.#fetch(`${this.#o.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${VOICEMAILS_BUCKET}/${path}`, {
      method: "POST",
      headers: { apikey: this.#o.serviceRoleKey, authorization: `Bearer ${this.#o.serviceRoleKey}`, "content-type": "audio/mpeg", "x-upsert": "true" },
      body: new Uint8Array(audio),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`app probe: storing the voicemail's copy returned ${response.status}`);
    const at = iso(this.#now());
    await this.#write("POST", "calls", {}, {
      company_id: companyId,
      phone_number_id: stableUuid(companyId, args.role),
      call_session_id: args.sessionId,
      caller_e164: this.#number(args.callerRole),
      direction: "inbound",
      outcome: "voicemail",
      forward_seconds: 0,
      started_at: at,
      ended_at: at,
      voicemail_path: path,
      voicemail_seconds: source.voicemail_seconds,
      voicemail_transcript: source.voicemail_transcript,
      // Marked attempted, so opening a copy with no transcript buys no transcription.
      voicemail_transcript_attempted_at: at,
    }, "return=minimal");
    return true;
  }

  /** Undo for copyVoicemail: the call row, then its audio. */
  async clearSeededVoicemail(args: { tenant: string; sessionId: string }): Promise<void> {
    if (!SEEDED_VOICEMAIL.test(args.sessionId)) throw new Error("app probe: only a copied voicemail's session id clears one");
    const companyId = this.#tenant(args.tenant).company_id;
    await this.#write("DELETE", "calls", { company_id: `eq.${companyId}`, call_session_id: `eq.${args.sessionId}` }, undefined, "return=minimal");
    const response = await this.#fetch(
      `${this.#o.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${VOICEMAILS_BUCKET}/${seededVoicemailPath(companyId, args.sessionId)}`,
      { method: "DELETE", headers: { apikey: this.#o.serviceRoleKey, authorization: `Bearer ${this.#o.serviceRoleKey}` }, signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok && response.status !== 404) throw new Error(`app probe: deleting the voicemail's copy returned ${response.status}`);
  }

  /** Removes whatever seedUsage, seedCallRecords or seedOutboundSegments wrote under the marker. */
  async clearSeededUsage(marker: string): Promise<void> {
    if (!marker.startsWith("rig-seed-")) throw new Error("app probe: only a seeded row's marker clears usage");
    await this.#write("DELETE", "usage_events", { meter_identifier: `eq.${marker}` }, undefined, "return=minimal");
    await this.#write("DELETE", "call_records", { call_session_id: `eq.${marker}` }, undefined, "return=minimal");
    await this.#write("DELETE", "messages", { idempotency_key: `eq.${marker}`, direction: "eq.outbound" }, undefined, "return=minimal");
  }

  aiUsage(args: { tenant: string }) {
    return this.#rest<{ feature: string; period: string; request_count: number }[]>("company_ai_usage", {
      company_id: `eq.${this.#tenant(args.tenant).company_id}`,
      period: `eq.${aiPeriod(this.#now())}`,
      select: "feature,period,request_count",
    });
  }

  /** Resolves with the count before, or null when there was no row, for `app.ai-usage`. */
  async seedAiUsage(args: { tenant: string; feature: string; requestCount: number | null }): Promise<number | null> {
    const companyId = this.#tenant(args.tenant).company_id;
    const period = aiPeriod(this.#now());
    const where = { company_id: `eq.${companyId}`, period: `eq.${period}`, feature: `eq.${args.feature}` };
    const [before] = await this.#rest<{ request_count: number }[]>("company_ai_usage", { ...where, select: "request_count" });
    if (args.requestCount === null) await this.#write("DELETE", "company_ai_usage", where, undefined, "return=minimal");
    else {
      await this.#write("POST", "company_ai_usage", { on_conflict: "company_id,period,feature" }, {
        company_id: companyId,
        period,
        feature: args.feature,
        request_count: args.requestCount,
      }, "resolution=merge-duplicates,return=minimal");
    }
    return before?.request_count ?? null;
  }

  async replySuggestions(args: { member: string; withRole: string }): Promise<ApiAnswer<{ suggestions?: unknown[]; reason?: string }>> {
    const { tenant } = splitMember(args.member);
    const conversationId = await this.#conversationWith(tenant, args.withRole);
    if (!conversationId) throw new Error(`app probe: ${tenant} has no thread with ${args.withRole}`);
    return this.#answer(args.member, "POST", `/v1/conversations/${encodeURIComponent(conversationId)}/reply-suggestions`, {});
  }

  async simulateIncoming(args: { member: string; target: string; caller?: string }): Promise<ApiAnswer<{ session_id?: string; reachable?: boolean }>> {
    return this.#answer(args.member, "POST", "/v1/rig/simulate-incoming", {
      user_id: await this.#userIdOf(args.target),
      ...(args.caller ? { caller: args.caller } : {}),
    });
  }

  startGreetingCapture(args: { member: string; toRole: string; name: string }): Promise<ApiAnswer> {
    return this.#answer(args.member, "POST", "/v1/voicemail-greetings/capture-call", { name: args.name, to: this.#number(args.toRole) });
  }

  greetings(args: { tenant: string; since: number }) {
    return this.#rest<{ id: string; created_at: string; storage_path: string; mime_type: string | null; duration_ms: number | null }[]>(
      "voicemail_greetings",
      {
        company_id: `eq.${this.#tenant(args.tenant).company_id}`,
        created_at: `gte.${iso(args.since)}`,
        select: "id,created_at,storage_path,mime_type,duration_ms",
        order: "created_at.asc",
      },
    );
  }

  async widgetStart(args: { tenant: string; phoneRole: string; turnstileToken?: string }): Promise<ApiAnswer<{ verificationId?: string }>> {
    const [company] = await this.#rest<{ widget_key: string }[]>("companies", {
      id: `eq.${this.#tenant(args.tenant).company_id}`,
      select: "widget_key",
    });
    if (!company) throw new Error(`app probe: no company row for ${args.tenant}`);
    return this.#public("/widget/start", {
      widgetKey: company.widget_key,
      phone: this.#number(args.phoneRole),
      ...(args.turnstileToken === undefined ? {} : { turnstileToken: args.turnstileToken }),
    });
  }

  widgetVerify(args: { verificationId: string; code: string; message: string }): Promise<ApiAnswer> {
    return this.#public("/widget/verify", args);
  }

  async widgetVerifications(args: { tenant: string; since: number }): Promise<number> {
    const rows = await this.#rest<{ id: string }[]>("widget_verifications", {
      company_id: `eq.${this.#tenant(args.tenant).company_id}`,
      created_at: `gte.${iso(args.since)}`,
      select: "id",
    });
    return rows.length;
  }

  /** Password, then the member's TOTP factor from the seed's secret, as the app's second step does. */
  async signInWithTotp(args: { member: string }): Promise<{ aal: string | null; meStatus: number }> {
    const member = this.#member(args.member);
    if (!member.totp_secret) throw new Error(`app probe: tenants.json holds no TOTP secret for ${args.member}`);
    const auth = (path: string, init: { token?: string; body?: unknown; method?: string }) =>
      this.#fetch(`${this.#o.supabaseUrl.replace(/\/+$/, "")}/auth/v1${path}`, {
        method: init.method ?? "POST",
        headers: {
          apikey: this.#o.anonKey,
          "content-type": "application/json",
          ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(10_000),
      });
    const signedIn = await auth("/token?grant_type=password", { body: { email: member.email, password: member.password } });
    if (!signedIn.ok) throw new Error(`app probe: signing ${args.member} in returned ${signedIn.status}`);
    const first = ((await signedIn.json()) as { access_token?: string }).access_token;
    if (!first) throw new Error(`app probe: no session for ${args.member}`);
    const user = (await (await auth("/user", { token: first, method: "GET" })).json()) as { factors?: { id: string; factor_type: string; status: string }[] };
    const factor = user.factors?.find((candidate) => candidate.factor_type === "totp" && candidate.status === "verified");
    if (!factor) throw new Error(`app probe: ${args.member} has no verified TOTP factor`);
    const challenge = (await (await auth(`/factors/${factor.id}/challenge`, { token: first, body: {} })).json()) as { id?: string };
    const verified = await auth(`/factors/${factor.id}/verify`, {
      token: first,
      body: { challenge_id: challenge.id, code: totpCode(member.totp_secret, this.#now()) },
    });
    if (!verified.ok) return { aal: null, meStatus: verified.status };
    const second = ((await verified.json()) as { access_token?: string }).access_token ?? "";
    const aal = claimsOf(second).aal;
    const me = await this.#fetch(`${this.#o.apiBase.replace(/\/+$/, "")}/v1/me`, {
      headers: { authorization: `Bearer ${second}` },
      signal: AbortSignal.timeout(10_000),
    });
    await me.body?.cancel();
    return { aal: typeof aal === "string" ? aal : null, meStatus: me.status };
  }

  async sendPasswordReset(args: { member: string }): Promise<number> {
    const response = await this.#fetch(`${this.#o.supabaseUrl.replace(/\/+$/, "")}/auth/v1/recover`, {
      method: "POST",
      headers: { apikey: this.#o.anonKey, "content-type": "application/json" },
      body: JSON.stringify({ email: this.#member(args.member).email }),
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    return response.status;
  }

  async workspaceOf(args: { ownerEmail: string }) {
    const company = await this.#signUpCompany(args.ownerEmail);
    return company
      ? {
          company_id: company.id,
          subscription_status: company.subscription_status,
          stripe_subscription_id: company.stripe_subscription_id,
          stripe_customer_id: company.stripe_customer_id,
        }
      : null;
  }

  async #signUpCompany(ownerEmail: string): Promise<SignUpCompany | undefined> {
    const user = await this.#authUserByEmail(ownerEmail);
    if (!user) return undefined;
    const [company] = await this.#rest<SignUpCompany[]>("companies", {
      owner_user_id: `eq.${user}`,
      deleted_at: "is.null",
      select: "id,subscription_status,stripe_subscription_id,stripe_customer_id,country,requested_area_code",
    });
    return company;
  }

  /**
   * Gives a sign-up's unpaid Canadian workspace an active number row before
   * Checkout, so the paid webhook's provisioning finds a number it did not
   * buy and skips the purchase (provisionCompanyNumber). The row is rig test
   * data: a fictional 555-01xx number with no Telnyx id, which every path that
   * reaches Telnyx skips. Its undo is `app.release-signup-number`.
   */
  async assignSignUpNumber(args: { ownerEmail: string; nonce: string }): Promise<SignUpNumber> {
    if (!SIGN_UP_ADDRESS.test(args.ownerEmail)) throw new Error("app probe: only a sign-up scenario's own workspace gets a fixture number");
    const company = await this.#signUpCompany(args.ownerEmail);
    if (!company) throw new Error("app probe: the sign-up has no workspace yet");
    if (PAID_STATUSES.has(company.subscription_status)) throw new Error(`app probe: the sign-up's workspace is already ${company.subscription_status}`);
    if (company.country !== "CA") throw new Error("app probe: the fixture number is for a Canadian workspace only");
    const areaCode = company.requested_area_code;
    if (!areaCode || !/^[2-9]\d{2}$/.test(areaCode)) throw new Error("app probe: the sign-up's workspace has no area code");
    const held = await this.#rest<{ id: string }[]>("phone_numbers", { company_id: `eq.${company.id}`, status: "neq.released", select: "id" });
    if (held.length > 0) throw new Error(`app probe: the sign-up's workspace already holds ${held.length} number(s)`);

    const provisioningKey = signUpNumberKey(args.nonce);
    const start = Number.parseInt(createHash("sha256").update(args.nonce).digest("hex").slice(0, 8), 16) % 100;
    for (let i = 0; i < 100; i++) {
      const numberE164 = `+1${areaCode}55501${String((start + i) % 100).padStart(2, "0")}`;
      try {
        const [row] = await this.#write<{ id: string }[]>("POST", "phone_numbers", { select: "id" }, {
          company_id: company.id,
          status: "active",
          source: "provisioned",
          country: "CA",
          requested_area_code: areaCode,
          provisioning_key: provisioningKey,
          telnyx_phone_number_id: null,
          number_e164: numberE164,
          label: SIGN_UP_NUMBER_LABEL,
        });
        if (!row) throw new Error("app probe: the fixture number's insert returned no row");
        return { row_id: row.id, number_e164: numberE164, provisioning_key: provisioningKey };
      } catch (error) {
        // Another workspace holds this fictional number; try the next one.
        if ((error as WriteError).status === 409) continue;
        throw error;
      }
    }
    throw new Error(`app probe: every 555-01xx number in ${areaCode} is held`);
  }

  /** Undo for assignSignUpNumber, straight in the database: the row never named a Telnyx number, so nothing at Telnyx is released. */
  async releaseSignUpNumber(args: { provisioningKey: string }): Promise<void> {
    if (!SIGN_UP_NUMBER_KEY.test(args.provisioningKey)) throw new Error("app probe: only a sign-up's fixture number can be released this way");
    await this.#write("PATCH", "phone_numbers", { provisioning_key: `eq.${args.provisioningKey}`, status: "neq.released" }, {
      status: "released",
      released_at: iso(this.#now()),
    }, "return=minimal");
  }

  /** The paid webhook's ledger row for the sign-up workspace's Checkout, once Stripe delivered it. */
  async checkoutEvent(args: { ownerEmail: string }): Promise<CheckoutEvent | null> {
    const company = await this.#signUpCompany(args.ownerEmail);
    if (!company) return null;
    const [event] = await this.#rest<{ session_id: string | null; processed_at: string | null; last_error: string | null }[]>("webhook_events", {
      provider: "eq.stripe",
      event_type: "eq.checkout.session.completed",
      "payload->data->object->>client_reference_id": `eq.${company.id}`,
      select: "session_id:payload->data->object->>id,processed_at,last_error",
      order: "received_at.desc",
      limit: "1",
    });
    return event ? { session_id: event.session_id, processed: event.processed_at !== null, last_error: event.last_error } : null;
  }

  /** The sign-up workspace's number rows, released ones included. */
  async signUpNumbers(args: { ownerEmail: string }): Promise<SignUpNumberRow[]> {
    const company = await this.#signUpCompany(args.ownerEmail);
    if (!company) return [];
    return this.#rest<SignUpNumberRow[]>("phone_numbers", { company_id: `eq.${company.id}`, select: "id,status,provisioning_key", order: "created_at.asc" });
  }

  /**
   * Fixture rows any run left unreleased, and the rows a sign-up's workspace
   * holds that are not fixtures: one of those may name a real Telnyx number.
   */
  async signUpNumberLeak(): Promise<{ fixtures: number; foreign: string[] }> {
    const fixtures = await this.#rest<{ id: string }[]>("phone_numbers", {
      provisioning_key: `like.${SIGN_UP_NUMBER_PREFIX}*`,
      status: "neq.released",
      select: "id",
    });
    const owners = await this.#signUpOwners();
    const companies = owners.length
      ? await this.#rest<{ id: string }[]>("companies", { owner_user_id: `in.(${owners.join(",")})`, select: "id" })
      : [];
    const rows = await this.#heldNumbers(companies.map((company) => company.id));
    return { fixtures: fixtures.length, foreign: rows.filter((row) => !row.provisioning_key.startsWith(SIGN_UP_NUMBER_PREFIX)).map((row) => row.id) };
  }

  async #heldNumbers(companyIds: string[]): Promise<{ id: string; provisioning_key: string }[]> {
    if (companyIds.length === 0) return [];
    return this.#rest("phone_numbers", { company_id: `in.(${companyIds.join(",")})`, status: "neq.released", select: "id,provisioning_key" });
  }

  /**
   * Keeps the app's mail to a sign-up's address off the guard's Resend day:
   * the address is suppressed, as a hard bounce leaves one, until deleteSignUp
   * removes the row. S32's new-device notice and its cancellation's day-1
   * grace notice would each spend a send otherwise.
   */
  async muteSignUpMail(args: { email: string }): Promise<void> {
    if (!SIGN_UP_ADDRESS.test(args.email)) throw new Error("app probe: only a sign-up scenario's own address can be muted");
    await this.#write("POST", "email_suppressions", { on_conflict: "email" }, {
      email: args.email.toLowerCase(),
      reason: "hard_bounce",
      cleared_at: null,
    }, "resolution=merge-duplicates,return=minimal");
  }

  /**
   * Undo for a scenario's public sign-up: its workspace closed and its user
   * deleted. Only an address a sign-up scenario makes is accepted, so no
   * seeded member can be removed this way.
   */
  async deleteSignUp(args: { email: string }): Promise<void> {
    if (!SIGN_UP_ADDRESS.test(args.email)) throw new Error("app probe: only a sign-up scenario's own address can be removed");
    await this.#write("DELETE", "email_suppressions", { email: `eq.${args.email.toLowerCase()}` }, undefined, "return=minimal");
    const user = await this.#authUserByEmail(args.email);
    if (!user) return;
    const companies = await this.#rest<{ id: string }[]>("companies", { owner_user_id: `eq.${user}`, select: "id" });
    const held = await this.#heldNumbers(companies.map((company) => company.id));
    const real = held.find((row) => !row.provisioning_key.startsWith(SIGN_UP_NUMBER_PREFIX));
    // A row the app provisioned may name a real Telnyx number, which a person releases before the workspace goes.
    if (real) throw new Error(`app probe: the sign-up's workspace holds number row ${real.id}, which the rig did not assign; release it by hand`);
    await this.#write("PATCH", "companies", { owner_user_id: `eq.${user}`, deleted_at: "is.null" }, { deleted_at: iso(this.#now()) }, "return=minimal");
    // A workspace's rows keep the owner by a restricting foreign key, so an owner is soft-deleted: no sign-in, its address freed.
    const response = await this.#fetch(`${this.#o.supabaseUrl.replace(/\/+$/, "")}/auth/v1/admin/users/${user}`, {
      method: "DELETE",
      headers: { apikey: this.#o.serviceRoleKey, authorization: `Bearer ${this.#o.serviceRoleKey}`, "content-type": "application/json" },
      body: JSON.stringify({ should_soft_delete: companies.length > 0 }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok && response.status !== 404) throw new Error(`app probe: deleting the sign-up returned ${response.status}`);
  }

  /**
   * S34's recipient: a confirmed local-auth account at the robot mailbox's
   * `+s34-acct-` sub-address, with a password made here and kept nowhere. An
   * invite to an address that has an account is the one the app mails over
   * Resend itself (routes/team.ts, sendExistingAccountInvite); an invite to a
   * new address is mailed by local auth into Mailpit. Answers the HTTP status,
   * 200 when the account already existed.
   */
  async createMailAccount(args: { email: string }): Promise<number> {
    if (!this.#isMailAccount(args.email)) throw new Error("app probe: only S34's own sub-address can be given an account");
    if (await this.#authUserByEmail(args.email)) return 200;
    const response = await this.#fetch(`${this.#o.supabaseUrl.replace(/\/+$/, "")}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: this.#o.serviceRoleKey, authorization: `Bearer ${this.#o.serviceRoleKey}`, "content-type": "application/json" },
      body: JSON.stringify({ email: args.email, password: `${randomBytes(18).toString("base64url")}Aa1`, email_confirm: true }),
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    return response.status;
  }

  /** Undo for `createMailAccount`: the user deleted. Only S34's own sub-address is accepted. */
  async deleteMailAccount(args: { email: string }): Promise<void> {
    if (!this.#isMailAccount(args.email)) throw new Error("app probe: only S34's own sub-address can be removed");
    const user = await this.#authUserByEmail(args.email);
    if (!user) return;
    const response = await this.#fetch(`${this.#o.supabaseUrl.replace(/\/+$/, "")}/auth/v1/admin/users/${user}`, {
      method: "DELETE",
      headers: { apikey: this.#o.serviceRoleKey, authorization: `Bearer ${this.#o.serviceRoleKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    if (!response.ok && response.status !== 404) throw new Error(`app probe: deleting the mail account returned ${response.status}`);
  }

  /** A `+s34-acct-` sub-address of the configured robot mailbox. */
  #isMailAccount(email: string): boolean {
    const [local, domain] = (this.#o.robotMailbox?.() ?? "").toLowerCase().split("@");
    if (!local || !domain || !MAIL_ACCOUNT_ADDRESS.test(email)) return false;
    return email.toLowerCase().startsWith(`${local}+s34-acct-`) && email.toLowerCase().endsWith(`@${domain}`);
  }

  async #authUserByEmail(email: string): Promise<string | undefined> {
    return (await this.#authUsers()).find((user) => user.email?.toLowerCase() === email.toLowerCase())?.id;
  }

  /** The users the sign-up scenarios made, found by their addresses. */
  async #signUpOwners(): Promise<string[]> {
    return (await this.#authUsers()).filter((user) => SIGN_UP_ADDRESS.test(user.email?.toLowerCase() ?? "")).map((user) => user.id);
  }

  async #authUsers(): Promise<{ id: string; email?: string }[]> {
    const response = await this.#fetch(`${this.#o.supabaseUrl.replace(/\/+$/, "")}/auth/v1/admin/users?page=1&per_page=1000`, {
      headers: { apikey: this.#o.serviceRoleKey, authorization: `Bearer ${this.#o.serviceRoleKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`app probe: listing users returned ${response.status}`);
    return ((await response.json()) as { users?: { id: string; email?: string }[] }).users ?? [];
  }

  invite(args: { member: string; email: string }): Promise<ApiAnswer<{ id?: string; email_sent?: boolean }>> {
    return this.#answer(args.member, "POST", "/v1/invites", { email: args.email, role: "member" });
  }

  async revokeInvite(args: { member: string; inviteId: string }): Promise<void> {
    await this.#answer(args.member, "DELETE", `/v1/invites/${encodeURIComponent(args.inviteId)}`);
  }

  async provisionNumber(args: { member: string }): Promise<ApiAnswer<{ id?: string; status?: string }>> {
    const { tenant } = splitMember(args.member);
    const [company] = await this.#rest<{ requested_area_code: string | null }[]>("companies", {
      id: `eq.${this.#tenant(tenant).company_id}`,
      select: "requested_area_code",
    });
    if (!company?.requested_area_code) throw new Error(`app probe: ${tenant} has no requested area code to buy in`);
    return this.#answer(args.member, "POST", "/v1/numbers/provision", { requested_area_code: company.requested_area_code });
  }

  numberRows(args: { tenant: string }): Promise<NumberRow[]> {
    return this.#rest<NumberRow[]>("phone_numbers", {
      company_id: `eq.${this.#tenant(args.tenant).company_id}`,
      select: "id,status,telnyx_phone_number_id,voice_connection_id,label,suspended_at,released_at",
      order: "created_at.asc",
    });
  }

  async markNumberReleased(args: { phoneNumberId: string }): Promise<void> {
    await this.#write("PATCH", "phone_numbers", { id: `eq.${args.phoneNumberId}`, status: "neq.released" }, {
      status: "released",
      released_at: iso(this.#now()),
    }, "return=minimal");
  }

  async backdateCancellation(args: { tenant: string; daysAgo: number }): Promise<WorkspaceState> {
    const companyId = this.#tenant(args.tenant).company_id;
    const [before] = await this.#rest<WorkspaceState[]>("companies", { id: `eq.${companyId}`, select: "subscription_status,canceled_at" });
    if (!before) throw new Error(`app probe: no company row for ${args.tenant}`);
    await this.#write("PATCH", "companies", { id: `eq.${companyId}` }, {
      subscription_status: "canceled",
      canceled_at: iso(this.#now() - args.daysAgo * 86_400_000),
    }, "return=minimal");
    // What the cancellation webhook does to the numbers (suspendCompanyNumbers).
    await this.#write("PATCH", "phone_numbers", { company_id: `eq.${companyId}`, status: "eq.active" }, {
      status: "suspended",
      suspended_at: iso(this.#now()),
    }, "return=minimal");
    return before;
  }

  /** Undo for backdateCancellation: the subscription as it was, and its suspended numbers live again. */
  async restoreWorkspace(args: { tenant: string; state: WorkspaceState }): Promise<void> {
    const companyId = this.#tenant(args.tenant).company_id;
    await this.#write("PATCH", "companies", { id: `eq.${companyId}` }, args.state, "return=minimal");
    if (args.state.subscription_status === "active") {
      await this.#write("PATCH", "phone_numbers", { company_id: `eq.${companyId}`, status: "eq.suspended" }, {
        status: "active",
        suspended_at: null,
      }, "return=minimal");
    }
  }

  async graceState(args: { tenant: string }): Promise<GraceState> {
    const companyId = this.#tenant(args.tenant).company_id;
    const [company] = await this.#rest<WorkspaceState[]>("companies", { id: `eq.${companyId}`, select: "subscription_status,canceled_at" });
    if (!company) throw new Error(`app probe: no company row for ${args.tenant}`);
    const notices = company.canceled_at
      ? await this.#rest<{ threshold_day: number }[]>("grace_notices", {
          company_id: `eq.${companyId}`,
          canceled_at: `eq.${company.canceled_at}`,
          select: "threshold_day",
        })
      : [];
    const campaigns = await this.#rest<{ id: string }[]>("messaging_registrations", {
      company_id: `eq.${companyId}`,
      kind: "eq.campaign",
      telnyx_id: "not.is.null",
      deactivated_at: "is.null",
      select: "id",
    });
    return {
      ...company,
      notices: notices.map((notice) => notice.threshold_day).sort((a, b) => a - b),
      numbers: await this.numberRows(args),
      live_campaigns: campaigns.length,
    };
  }

  /** The subscription the tenant's company row names in the sandbox, or null. */
  async stripeSubscriptionId(tenant: string): Promise<string | null> {
    const [company] = await this.#rest<{ stripe_subscription_id: string | null }[]>("companies", {
      id: `eq.${this.#tenant(tenant).company_id}`,
      select: "stripe_subscription_id",
    });
    return company?.stripe_subscription_id ?? null;
  }

  async #conversationsWith(tenant: string, role: string): Promise<string[]> {
    const companyId = this.#tenant(tenant).company_id;
    const contacts = await this.#rest<{ id: string }[]>("contacts", {
      company_id: `eq.${companyId}`,
      phone_e164: `eq.${this.#number(role)}`,
      select: "id",
    });
    if (contacts.length === 0) return [];
    const conversations = await this.#rest<{ id: string }[]>("conversations", {
      company_id: `eq.${companyId}`,
      contact_id: `in.(${contacts.map((c) => c.id).join(",")})`,
      select: "id",
    });
    return conversations.map((conversation) => conversation.id);
  }

  async #conversationWith(tenant: string, role: string): Promise<string | undefined> {
    return (await this.#conversationsWith(tenant, role))[0];
  }

  /** Member keys by auth user id, from the admin listing matched against tenants.json's addresses. */
  async #membersByUser(tenant: string): Promise<Map<string, string>> {
    const members = this.#tenant(tenant).members;
    const byEmail = new Map(Object.entries(members).map(([key, member]) => [member.email.toLowerCase(), `${tenant.toLowerCase()}-${key}`]));
    const response = await this.#fetch(`${this.#o.supabaseUrl.replace(/\/+$/, "")}/auth/v1/admin/users?page=1&per_page=1000`, {
      headers: { apikey: this.#o.serviceRoleKey, authorization: `Bearer ${this.#o.serviceRoleKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`app probe: listing users returned ${response.status}`);
    const { users } = (await response.json()) as { users?: { id: string; email?: string }[] };
    const out = new Map<string, string>();
    for (const user of users ?? []) {
      const key = user.email ? byEmail.get(user.email.toLowerCase()) : undefined;
      if (!key) continue;
      out.set(user.id, key);
      this.#userIds.set(key, user.id);
    }
    return out;
  }

  userIdOf(memberKey: string): Promise<string> {
    return this.#userIdOf(memberKey);
  }

  async #userIdOf(memberKey: string): Promise<string> {
    const cached = this.#userIds.get(memberKey);
    if (cached) return cached;
    const { tenant } = splitMember(memberKey);
    for (const [userId, key] of await this.#membersByUser(tenant)) if (key === memberKey) return userId;
    throw new Error(`app probe: no auth user for ${memberKey}`);
  }

  /** The API's public routes, which no member signs in to. */
  async #public<T>(path: string, body: unknown): Promise<ApiAnswer<T>> {
    const response = await this.#fetch(`${this.#o.apiBase.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await response.json().catch(() => ({}))) as T & { error?: { code?: string } };
    return { status: response.status, ...(json.error?.code ? { code: json.error.code } : {}), body: json };
  }

  #armedPath(nonce: string): string {
    if (!this.#o.stateDir) throw new Error("app probe: no state directory to keep S25's changes in");
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(nonce)) throw new Error("app probe: not a nonce");
    return join(this.#o.stateDir, "armed", `${nonce}.json`);
  }

  #saveArmed(nonce: string, record: ArmedAutomations): void {
    const path = this.#armedPath(nonce);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(record));
  }

  #readArmed(nonce: string): ArmedAutomations | undefined {
    try {
      return JSON.parse(readFileSync(this.#armedPath(nonce), "utf8")) as ArmedAutomations;
    } catch {
      return undefined;
    }
  }

  async #session(memberKey: string): Promise<string> {
    return (await this.#signIns.token({ key: memberKey, ...this.#member(memberKey) })).token;
  }

  /**
   * Sends a request as the member. A session an earlier process stored may have
   * died with a reset database; when its first use here is refused as
   * unauthorised, it is dropped and the request goes again on a fresh sign-in.
   */
  async #authorized(memberKey: string, send: (token: string) => Promise<Response>): Promise<Response> {
    const member = { key: memberKey, ...this.#member(memberKey) };
    const first = await this.#signIns.token(member);
    const response = await send(first.token);
    if (response.status !== 401 || first.source !== "stored") return response;
    this.#signIns.forget(memberKey);
    return send((await this.#signIns.token(member)).token);
  }

  /** A request to the local API as a member of the member's tenant. */
  #request(memberKey: string, method: string, path: string, body?: unknown): Promise<Response> {
    const tenant = this.#tenant(splitMember(memberKey).tenant);
    return this.#authorized(memberKey, (token) =>
      this.#fetch(`${this.#o.apiBase.replace(/\/+$/, "")}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "x-company-id": tenant.company_id,
          ...(body === undefined ? {} : { "content-type": "application/json", "idempotency-key": randomUUID() }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      }),
    );
  }

  /** The local API as a member of the member's tenant. */
  async #api<T>(memberKey: string, method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.#request(memberKey, method, path, body);
    const json = (await response.json().catch(() => ({}))) as T & { error?: { code?: string } };
    if (!response.ok) throw new Error(`${method} ${path.split("/").slice(0, 3).join("/")} returned ${response.status}${json.error?.code ? ` ${json.error.code}` : ""}`);
    return json;
  }

  /** The local API as a member, answering refusals instead of throwing them. */
  async #answer<T>(memberKey: string, method: string, path: string, body?: unknown): Promise<ApiAnswer<T>> {
    const response = await this.#request(memberKey, method, path, body);
    const json = (await response.json().catch(() => ({}))) as T & { error?: { code?: string } };
    return { status: response.status, ...(json.error?.code ? { code: json.error.code } : {}), body: json };
  }

  /** A PostgREST write with the service key; by default it asks for the written rows back. */
  async #write<T>(method: "POST" | "PATCH" | "DELETE", table: string, query: Record<string, string>, body?: unknown, prefer?: string): Promise<T> {
    const search = new URLSearchParams(query);
    const response = await this.#fetch(`${this.#o.supabaseUrl.replace(/\/+$/, "")}/rest/v1/${table}?${search}`, {
      method,
      headers: {
        apikey: this.#o.serviceRoleKey,
        authorization: `Bearer ${this.#o.serviceRoleKey}`,
        "content-type": "application/json",
        prefer: prefer ?? "return=representation",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw Object.assign(new Error(`app probe: writing ${table} returned ${response.status}`), { status: response.status });
    const text = await response.text();
    return (text ? JSON.parse(text) : []) as T;
  }

  async #rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const response = await this.#fetch(`${this.#o.supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: this.#o.serviceRoleKey, authorization: `Bearer ${this.#o.serviceRoleKey}`, "content-type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`app probe: ${fn} returned ${response.status}`);
    return (await response.json()) as T;
  }

  async #rest<T>(table: string, query: Record<string, string>): Promise<T> {
    const search = new URLSearchParams(query);
    const response = await this.#fetch(`${this.#o.supabaseUrl.replace(/\/+$/, "")}/rest/v1/${table}?${search}`, {
      headers: { apikey: this.#o.serviceRoleKey, authorization: `Bearer ${this.#o.serviceRoleKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`app probe: reading ${table} returned ${response.status}`);
    return (await response.json()) as T;
  }

  /** `QA-W` or `qa-w`. */
  #tenant(key: string) {
    const tenant = this.#o.tenants[key.toLowerCase()];
    if (!tenant) throw new Error(`app probe: unknown tenant ${key}`);
    return tenant;
  }

  #member(key: string) {
    const { tenant, member } = splitMember(key);
    const found = this.#tenant(tenant).members[member];
    if (!found) throw new Error(`app probe: unknown member ${key}`);
    return found;
  }

  #number(role: string): string {
    const number = this.#o.numbers.number(role);
    if (!number) throw new Error(`app probe: no number for ${role}`);
    return number;
  }
}

/** Above Pro's dial ceiling at the hard 10x multiplier, the most S12 can ever need. */
const SEED_CALL_RECORDS_MAX = 50_000;
/** Rows per insert, so a large seed stays inside one request's limits. */
const SEED_BATCH = 1_000;
/** VOICEMAILS_BUCKET in apps/api/src/messaging/inbound-ring.ts. */
export const VOICEMAILS_BUCKET = "voicemails";
const SEEDED_VOICEMAIL = /^rig-d14-[A-Za-z0-9_-]{1,40}$/;

/** Where the app stores a session's voicemail (inbound-ring.ts). */
function seededVoicemailPath(companyId: string, sessionId: string): string {
  return `${companyId}/${sessionId}.mp3`;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** The message a send answers with, as routes/messages.ts's messageJson writes it. */
interface SentMessage {
  id?: string;
  status?: string;
  error_code?: string | null;
}

/** A 2xx send's message: sent, or filed and failed, which is the API refusing it after all. */
function sendResult(status: number, message: SentMessage | undefined): SendResult {
  if (!message?.id) throw new Error("app probe: the send returned no message id");
  if (message.status === "failed") return { ok: false, status, ...(message.error_code ? { code: message.error_code } : {}) };
  return { ok: true, messageId: message.id };
}

/** The user id in a Supabase access token. */
export function subjectOf(token: string): string {
  const payload = token.split(".")[1];
  const sub = payload ? (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown }).sub : undefined;
  if (typeof sub !== "string" || !/^[0-9a-f-]{36}$/.test(sub)) throw new Error("app probe: the session names no user");
  return sub;
}

/** What S25 changed, kept under the nonce so the undo can put it back. */
interface ArmedAutomations {
  tenant: string;
  previous: Partial<Record<CompanyField, unknown>>;
  armed_at: number;
}

/** The addresses S32 and S35 sign up with: Resend's test sink, tagged with the scenario. */
export const SIGN_UP_ADDRESS = /^delivered\+rig-s3[25]-[a-z0-9-]+@resend\.dev$/;

/** The addresses S34 gives an account: a `+s34-acct-` sub-address, which no seeded member's address matches. */
export const MAIL_ACCOUNT_ADDRESS = /^[a-z0-9._-]+\+s34-acct-[a-z0-9-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** S32's fixture number rows are keyed by this prefix and the run's nonce. */
export const SIGN_UP_NUMBER_PREFIX = "rig-signup-";
const SIGN_UP_NUMBER_KEY = /^rig-signup-s3[2]-[a-z0-9-]+$/;
const SIGN_UP_NUMBER_LABEL = "Rig S32 fixture";
/** The subscription states the app treats as paid (apps/web/src/app/onboarding/steps.ts). */
const PAID_STATUSES: ReadonlySet<string> = new Set(["active", "past_due", "unpaid"]);

/** The fixture number's provisioning key for a run. */
export function signUpNumberKey(nonce: string): string {
  const slug = nonce.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "run";
  return `${SIGN_UP_NUMBER_PREFIX}s32-${slug}`;
}

type WriteError = Error & { status?: number };

interface SignUpCompany {
  id: string;
  subscription_status: string;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  country: string;
  requested_area_code: string | null;
}

/** The runner's inbound text is `Rig S25 <nonce>`; its first word is the emergency keyword while S25 is armed. */
export const S25_KEYWORD = "RIG";

export function automationBodies(nonce: string): Record<"away_reply" | "emergency_ack" | "scheduled_send" | "reminder", string> {
  return {
    away_reply: `Rig S25 away ${nonce}`,
    emergency_ack: `Rig S25 emergency ${nonce}`,
    scheduled_send: `Rig S25 scheduled ${nonce}`,
    reminder: `Rig S25 reminder ${nonce}`,
  };
}

/** company_ai_usage's period: the UTC month, as the migrations write it. */
export function aiPeriod(at: number): string {
  return new Date(at).toISOString().slice(0, 7);
}

function claimsOf(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  try {
    return payload ? (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
