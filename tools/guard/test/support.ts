import { HEADER } from "@loonext/rig-protocol";

import type { AiRunner, Ctx } from "../src/context";
import type { MailStatus } from "../src/edge-contract";
import { readConfig, type Env } from "../src/env";
import { Guard } from "../src/guard";
import { runSafetyChecks } from "../src/setup/safety";
import { ADMISSION_KEYS } from "../src/state/admission";
import { MemoryStore } from "../src/store";
import { telnyxApi } from "../src/telnyx/client";
import { KEYS } from "../src/telnyx/partition";
import { FakeTelnyx, reply } from "./fake-telnyx";

/** Fictional numbers only (555-0100..0199): scripts/check-rig-no-e164.mjs reads this tree. */
export const N = {
  robot1: "+14165550101",
  robot2: "+14165550102",
  stranger1: "+14165550103",
  devW1: "+14165550111",
  devW2: "+14165550112",
  devA1: "+14165550113",
  scratch: "+14165550120",
  notOwned: "+14165550140",
  production: "+14165550160",
} as const;

export const EDGE = "https://loonext-rig-edge.example.workers.dev";
export const ROBOT_MAILBOX = "rig-robot@loonext.com";
export const PROD_WEBHOOK = "https://api.loonext.com/webhooks/telnyx";

/** Monday 2026-11-02, 05:00 UTC: inside the default 04:00-10:00 window. */
export const MONDAY_0500 = Date.parse("2026-11-02T05:00:00Z");

export interface SentRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

export interface Harness {
  ctx: Ctx;
  guard: Guard;
  store: MemoryStore;
  telnyx: FakeTelnyx;
  /** Everything sent anywhere other than Telnyx. */
  outbound: SentRequest[];
  aiCalls: { model: string; inputs: Record<string, unknown> }[];
  alarms: number[];
  clock: { now: number };
  /** Production's /health capabilities. */
  production: { capabilities: string[] };
  /** What the edge's mailStatus() answers; null makes the call throw. */
  mail: { status: MailStatus | null };
  call(path: string, options?: CallOptions): Promise<Response>;
  advance(ms: number): void;
}

export interface CallOptions {
  caller?: string | null;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface HarnessOptions {
  env?: Partial<Env>;
  ai?: AiRunner | null;
  aiResult?: unknown;
  now?: number;
  version?: string;
}

export const FULL_ENV: Partial<Env> = {
  TELNYX_API_KEY: "test-guard-key",
  RESEND_API_KEY: "test-resend-key",
  SENTRY_PROD_DSN: "https://publickey@o1.ingest.sentry.example/12345",
  EDGE_ORIGIN: EDGE,
  ROBOT_MAILBOX,
  NOTIFICATION_PATH_SECRET: "notice-path",
  TELNYX_CONCURRENT_LIMIT: "6",
  SIGNAL_LATCH_RESET: "first",
};

export function harness(options: HarnessOptions = {}): Harness {
  const store = new MemoryStore();
  const telnyx = new FakeTelnyx();
  const outbound: SentRequest[] = [];
  const aiCalls: Harness["aiCalls"] = [];
  const alarms: number[] = [];
  const clock = { now: options.now ?? MONDAY_0500 };
  const production = { capabilities: ["telnyx-partition-v1"] };
  const mail: Harness["mail"] = { status: null };

  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === "https://api.telnyx.com") return telnyx.handle(request);
    outbound.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: request.method === "GET" ? "" : await request.text(),
    });
    if (url.origin === "https://api.loonext.com" && url.pathname === "/health") {
      return reply({ ok: true, capabilities: production.capabilities });
    }
    if (url.origin === "https://oauth2.googleapis.com") return reply({ access_token: "google-access", expires_in: 3600 });
    if (url.origin === "https://fcm.googleapis.com") return reply({ name: "projects/p/messages/1" });
    if (url.origin === "https://api.resend.com") return reply({ id: "email-1" });
    return reply({ id: "sentry-event" });
  }) as typeof fetch;

  const config = readConfig({ ...FULL_ENV, ...options.env } as Env);
  const ai: AiRunner | null =
    options.ai === null
      ? null
      : (options.ai ?? {
          async run(model, inputs) {
            aiCalls.push({ model, inputs });
            return options.aiResult ?? { response: "ok", usage: { prompt_tokens: 10, completion_tokens: 20 } };
          },
        });

  const ctx: Ctx = {
    config,
    store,
    now: () => clock.now,
    fetch: fetcher,
    telnyx: config.telnyxKey ? telnyxApi(config.telnyxKey, fetcher) : null,
    ai,
    edge: {
      async mailStatus() {
        if (!mail.status) throw new Error("edge unreachable");
        return structuredClone(mail.status);
      },
    },
    versionId: options.version ?? "version-1",
    setAlarm: async (at) => {
      alarms.push(at);
    },
    memory: {},
  };
  const guard = new Guard(ctx);

  return {
    ctx,
    guard,
    store,
    telnyx,
    outbound,
    aiCalls,
    alarms,
    clock,
    production,
    mail,
    advance(ms) {
      clock.now += ms;
    },
    call(path, call = {}) {
      const headers = new Headers(call.headers);
      const caller = call.caller === undefined ? "rig-api" : call.caller;
      if (caller !== null) headers.set(HEADER.callerClass, caller);
      const method = call.method ?? (call.body === undefined ? "GET" : "POST");
      if (call.body !== undefined) headers.set("content-type", "application/json");
      return guard.handle(
        new Request(`https://guard.internal${path}`, {
          method,
          headers,
          body: call.body === undefined ? undefined : typeof call.body === "string" ? call.body : JSON.stringify(call.body),
        }),
      );
    },
  };
}

/**
 * The partition as the setup routine leaves it, plus production's own
 * resources beside it, so every test runs with production in the account.
 */
export function seedAccount(telnyx: FakeTelnyx): void {
  const edge = (path: string) => `${EDGE}${path}`;
  telnyx.lists.billing_groups.push({ id: "bg-nonprod", name: "loonext-nonprod" });
  telnyx.lists.outbound_voice_profiles.push(
    { id: "ovp-voice", name: "nonprod-voice-ovp", billing_group_id: "bg-nonprod" },
    { id: "ovp-robot", name: "nonprod-robot-ovp", billing_group_id: "bg-nonprod" },
    { id: "ovp-prod", name: "production-ovp" },
  );
  telnyx.lists.call_control_applications.push(
    {
      id: "conn-voice",
      application_name: "nonprod-voice",
      webhook_event_url: edge("/t/v"),
      webhook_event_failover_url: edge("/t/v2"),
      outbound: { outbound_voice_profile_id: "ovp-voice" },
    },
    {
      id: "conn-robot",
      application_name: "nonprod-robot",
      webhook_event_url: edge("/t/r"),
      outbound: { outbound_voice_profile_id: "ovp-robot" },
    },
    {
      id: "conn-prod-voice",
      application_name: "loonext-production",
      webhook_event_url: PROD_WEBHOOK,
      outbound: { outbound_voice_profile_id: "ovp-prod" },
    },
  );
  telnyx.lists.credential_connections.push(
    { id: "conn-webrtc", connection_name: "nonprod-webrtc", webhook_event_url: edge("/t/w"), outbound: {} },
    { id: "conn-sentinel", connection_name: "nonprod-sentinel", webhook_event_url: edge("/t/w"), outbound: {} },
    { id: "conn-prod-webrtc", connection_name: "loonext-webrtc", webhook_event_url: PROD_WEBHOOK, outbound: {} },
  );
  telnyx.lists.messaging_profiles.push(
    { id: "prof-robot", name: "nonprod-robot", webhook_url: edge("/t/m"), webhook_failover_url: edge("/t/m") },
    { id: "prof-qa-w", name: "nonprod-qa-w", webhook_url: edge("/t/m"), webhook_failover_url: edge("/t/m") },
    { id: "prof-qa-a", name: "nonprod-qa-a", webhook_url: edge("/t/m") },
    { id: "prof-qa-c", name: "nonprod-qa-c", webhook_url: edge("/t/m") },
    { id: "prof-qa-e", name: "nonprod-qa-e", webhook_url: edge("/t/m") },
    { id: "prof-prod", name: "production-company", webhook_url: PROD_WEBHOOK },
  );
  telnyx.lists.telephony_credentials.push(
    { id: "cred-owner", resource_id: "connection:conn-webrtc", sip_username: "gencredowner" },
    { id: "cred-sentinel", resource_id: "connection:conn-sentinel", sip_username: "gencredsentinel" },
    { id: "cred-prod", resource_id: "connection:conn-prod-webrtc", sip_username: "gencredprod" },
  );
  const owned = (
    id: string,
    phone: string,
    connection: string,
    profile: string,
    role: string | null,
    tags: string[] = ["rig-standing"],
  ) => ({
    customer_reference: role ? `rig-standing-${role}` : "company-qa-w",
    id,
    phone_number: phone,
    billing_group_id: "bg-nonprod",
    connection_id: connection,
    messaging_profile_id: profile,
    tags,
  });
  telnyx.numbers.push(
    owned("num-robot1", N.robot1, "conn-robot", "prof-robot", "robot-1"),
    owned("num-robot2", N.robot2, "conn-robot", "prof-robot", "robot-2"),
    owned("num-stranger1", N.stranger1, "conn-robot", "prof-robot", "stranger-1"),
    owned("num-devw1", N.devW1, "conn-voice", "prof-qa-w", "dev-w1"),
    owned("num-devw2", N.devW2, "conn-voice", "prof-qa-w", "dev-w2"),
    owned("num-deva1", N.devA1, "conn-voice", "prof-qa-a", null),
    owned("num-scratch", N.scratch, "conn-voice", "prof-qa-w", null, []),
    {
      id: "num-prod",
      phone_number: N.production,
      billing_group_id: null,
      connection_id: "conn-prod-voice",
      messaging_profile_id: "prof-prod",
      tags: [],
    },
  );
}

/** Production's own measurements, filed fresh, so admission has what it needs. */
export async function fileMeasurements(h: Harness, reserve = 2): Promise<void> {
  await h.store.put(ADMISSION_KEYS.reserve, { legs: reserve, measured_at: h.clock.now });
  await h.store.put(ADMISSION_KEYS.ratios, { calls: 100, abandoned: 5, short: 3, measured_at: h.clock.now });
}

/** A harness with the account seeded, the start-up checks passed and measurements filed. */
export async function ready(options: HarnessOptions = {}): Promise<Harness> {
  const h = harness(options);
  seedAccount(h.telnyx);
  const safety = await runSafetyChecks(h.ctx);
  if (safety.state !== "ok") throw new Error(`seed is unsafe: ${safety.reasons.join(", ")}`);
  await fileMeasurements(h);
  h.telnyx.log.length = 0;
  return h;
}

export async function lease(h: Harness, scenario = "S02", caller = "robot"): Promise<string> {
  const response = await h.call("/lease", { caller, body: { scenario } });
  if (response.status !== 201) throw new Error(`lease refused: ${await response.text()}`);
  return ((await response.json()) as { lease_id: string }).lease_id;
}

/** A mailbox the edge reports alive just now, with these `+tag` arrivals. */
export function liveMailbox(h: Harness, recent: { tag: string | null; at: number }[] = []): void {
  h.mail.status = {
    heartbeat_at: new Date(h.clock.now).toISOString(),
    last_received_at: recent.length ? new Date(recent[0].at).toISOString() : null,
    received: recent.length,
    stored: recent.length,
    store_failed: 0,
    recent: recent.map((item) => ({ tag: item.tag, received_at: new Date(item.at).toISOString() })),
  };
}

export async function registerViaEdge(h: Harness, ccid: string, connection = "conn-voice", via = "voice"): Promise<Response> {
  return h.call("/legs", { caller: "edge", body: { call_control_id: ccid, connection_id: connection, via } });
}

/** The refusal's rule, after checking its shape: status, body and header agree. */
export async function ruleOf(response: Response): Promise<string | null> {
  if (response.status !== 403 && response.status !== 429) return null;
  const body = (await response.clone().json()) as { error?: string; rule?: string };
  if (body.error !== "guard_refused" || !body.rule) return null;
  if (response.headers.get(HEADER.refusedBy) !== body.rule) throw new Error("refused-by header disagrees with body");
  return body.rule;
}

export { KEYS, reply };
