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
import { createHash, randomUUID } from "node:crypto";
import { EDGE_PATHS, GUARD_ROUTES } from "@loonext/rig-protocol";
import type { NumberBook } from "@loonext/rig-robot";
import type { AppApi, AutomatedText, CallRow, MessageRow, SendResult } from "./scenarios/context.ts";

/** The seed's `tenants.json`: tenant key to company id and members' sign-ins. */
export type TenantsFile = Record<
  string,
  { company_id: string; members: Record<string, { email: string; password: string }> }
>;

/**
 * The seed's deterministic ids (scripts/rig/seed.mjs, stableUuid): a phone
 * number's row id is stableUuid(company_id, role).
 */
export function stableUuid(...parts: string[]): string {
  const hex = createHash("sha256").update(parts.join("\u0000")).digest("hex");
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
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
  fetch?: typeof fetch;
  now?: () => number;
}

export class AppProbe implements AppApi {
  readonly #o: AppProbeOptions;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #sessions = new Map<string, { token: string; expiresAt: number }>();

  constructor(options: AppProbeOptions) {
    this.#o = options;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  async sendText(args: { member: string; fromRole: string; toRole: string; body: string }): Promise<SendResult> {
    const { tenant: tenantKey } = splitMember(args.member);
    const tenant = this.#tenant(tenantKey);
    const phoneNumberId = stableUuid(tenant.company_id, args.fromRole);
    const to = this.#number(args.toRole);
    const response = await this.#fetch(`${this.#o.apiBase.replace(/\/+$/, "")}/v1/conversations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.#session(args.member)}`,
        "x-company-id": tenant.company_id,
        "idempotency-key": randomUUID(),
        "content-type": "application/json",
      },
      body: JSON.stringify({ phone_e164: to, phone_number_id: phoneNumberId, body: args.body }),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await response.json().catch(() => ({}))) as { message?: { id?: string }; error?: { code?: string } };
    if (!response.ok) return { ok: false, status: response.status, code: json.error?.code };
    if (!json.message?.id) throw new Error("app probe: the send returned no message id");
    return { ok: true, messageId: json.message.id };
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
      select: "purpose,platform,response_class,attempted_at",
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
      select: "call_session_id,outcome,forward_seconds,started_at,ended_at,voicemail_path,voicemail_transcript,voicemail_intake",
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
   * S25's automations (away reply, scheduled send, reminder, emergency
   * acknowledgement, help reply) are not seeded by the probe yet, so S25
   * reports an infrastructure fault rather than a pass it did not earn.
   */
  async armAutomations(_args: { tenant: string; toRole: string; nonce: string }): Promise<{ undo: { kind: string; params: Record<string, unknown> } }> {
    throw new Error("the app probe cannot seed S25's automations yet");
  }

  async automatedTexts(_args: { tenant: string; nonce: string }): Promise<AutomatedText[]> {
    return [];
  }

  /** Undo for armAutomations; nothing is armed while arming is refused. */
  async disarmAutomations(_args: { tenant: string; nonce: string }): Promise<void> {}

  async #session(memberKey: string): Promise<string> {
    const cached = this.#sessions.get(memberKey);
    if (cached && cached.expiresAt - 60_000 > this.#now()) return cached.token;
    const member = this.#member(memberKey);
    const response = await this.#fetch(`${this.#o.supabaseUrl.replace(/\/+$/, "")}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: this.#o.anonKey, "content-type": "application/json" },
      body: JSON.stringify({ email: member.email, password: member.password }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`app probe: signing ${memberKey} in returned ${response.status}`);
    const { access_token: token, expires_in: expiresIn } = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!token) throw new Error(`app probe: no session for ${memberKey}`);
    this.#sessions.set(memberKey, { token, expiresAt: this.#now() + (expiresIn ?? 3600) * 1000 });
    return token;
  }

  /** The local API as a member of the member's tenant. */
  async #api<T>(memberKey: string, method: string, path: string, body?: unknown): Promise<T> {
    const tenant = this.#tenant(splitMember(memberKey).tenant);
    const response = await this.#fetch(`${this.#o.apiBase.replace(/\/+$/, "")}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await this.#session(memberKey)}`,
        "x-company-id": tenant.company_id,
        ...(body === undefined ? {} : { "content-type": "application/json", "idempotency-key": randomUUID() }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await response.json().catch(() => ({}))) as T & { error?: { code?: string } };
    if (!response.ok) throw new Error(`${method} ${path.split("/").slice(0, 3).join("/")} returned ${response.status}${json.error?.code ? ` ${json.error.code}` : ""}`);
    return json;
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

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** The user id in a Supabase access token. */
export function subjectOf(token: string): string {
  const payload = token.split(".")[1];
  const sub = payload ? (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown }).sub : undefined;
  if (typeof sub !== "string" || !/^[0-9a-f-]{36}$/.test(sub)) throw new Error("app probe: the session names no user");
  return sub;
}
