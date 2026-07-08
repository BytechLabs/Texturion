/**
 * D31 launch-pass harness — orchestration.
 *
 * Boots the three fake vendor servers (Telnyx, Stripe, JWKS), resolves the
 * REAL local Supabase from `supabase status`, and wires the REAL loonext-api
 * Worker (`app.fetch`) at them. Provides:
 *   - buildEnv()      → the Bindings object the Worker validates (env.ts)
 *   - service client  → supabase-js over the sb_secret_ key, for seed/assert
 *   - token(sub)      → a Supabase-shaped ES256 access token
 *   - call(...)       → app.fetch + waitUntil flush → { status, json }
 *   - injectTelnyx()  → sign (Ed25519) + POST /webhooks/telnyx + flush
 *   - injectStripe()  → sign (HMAC) + POST /webhooks/stripe + flush
 *   - sql()/seed      → docker psql fixtures under a unique run prefix
 *   - close()         → shut the fakes down
 *
 * Lives under apps/api/e2e/ ONLY; never imported by src/ (no mocks in product
 * code — the hard rule). The ONLY thing "faked" is the vendor HTTP boundary;
 * fetch is NOT stubbed, so supabase-js talks to the real 54321 PostgREST.
 */
import { execFileSync } from "node:child_process";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";

import { app } from "../src/index";
import { expectedIssuer } from "../src/auth/jwt";
import { startFakeJwks, type JwksAuth } from "./fake-jwks";
import { startFakeStripe, type FakeStripe } from "./fake-stripe";
import { startFakeTelnyx, type FakeTelnyx } from "./fake-telnyx";

// Literal fallbacks (the CLI defaults) if `supabase status` cannot be parsed.
const FALLBACK_SUPABASE_URL = "http://127.0.0.1:54321";
const FALLBACK_SECRET_KEY = "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";
const DB_CONTAINER = "supabase_db_Loonext";
const STRIPE_WEBHOOK_SECRET = "whsec_e2e_launch_pass_secret";

interface SupabaseStatus {
  apiUrl: string;
  secretKey: string;
}

/** Resolve API_URL + SECRET_KEY from `supabase status -o json`, robustly. */
function resolveSupabase(): SupabaseStatus {
  try {
    const out = execFileSync("npx", ["supabase", "status", "-o", "json"], {
      cwd: new URL("../../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const parsed = JSON.parse(out) as Record<string, string>;
    const apiUrl = parsed.API_URL ?? parsed.api_url;
    const secretKey =
      parsed.SECRET_KEY ?? parsed.secret_key ?? parsed.SERVICE_ROLE_KEY;
    if (apiUrl && secretKey) return { apiUrl, secretKey };
  } catch {
    // fall through to literals
  }
  return { apiUrl: FALLBACK_SUPABASE_URL, secretKey: FALLBACK_SECRET_KEY };
}

export interface CallOptions {
  token?: string;
  companyId?: string;
  body?: unknown;
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

export interface CallResult {
  status: number;
  json: unknown;
  text: string;
}

export interface SentEmail {
  to: string[];
  subject: string;
  from: string;
}

export interface Harness {
  env: Record<string, unknown>;
  supabaseUrl: string;
  db: SupabaseClient;
  telnyx: FakeTelnyx;
  stripe: FakeStripe;
  jwks: JwksAuth;
  /**
   * Emails the Worker sent. Resend has NO env base seam (its endpoint is
   * hardcoded), so the harness intercepts ONLY `api.resend.com` at the fetch
   * edge and passes every other host through to the real network — Supabase
   * still hits real 54321, Telnyx/Stripe still hit their fake origins, JWKS
   * still hits the fake server. This is a narrow capture, not a global stub.
   */
  emails: SentEmail[];
  /** Unique per-run prefix for ids/emails so reruns are idempotent. */
  runId: string;
  /** Mint a Supabase-shaped access token for the given auth.users id. */
  token(sub: string): Promise<string>;
  /** app.fetch a /v1 (or any) request, flushing waitUntil before returning. */
  call(
    method: string,
    path: string,
    options?: CallOptions,
  ): Promise<CallResult>;
  /** Sign + POST a Telnyx webhook event, flushing background work. */
  injectTelnyx(event: unknown): Promise<CallResult>;
  /** Sign + POST a Stripe webhook event, flushing background work. */
  injectStripe(event: Record<string, unknown>): Promise<CallResult>;
  /** Run raw SQL against the docker Postgres (seeding + assertions). */
  sql(text: string): string;
  /**
   * SQL that inserts a GoTrue-compatible `auth.users` row. A bare
   * `insert into auth.users(id,email,...)` is NOT enough — GoTrue's admin API
   * (getUserById, used by the notification pipeline) 404s/500s unless `aud`,
   * `role`, `instance_id`, `email_confirmed_at`, and the NOT-scannable token
   * text columns are set (empty strings, not NULL). The `on_auth_user_created`
   * trigger then creates public.profiles from raw_user_meta_data.display_name.
   */
  seedUserSql(id: string, email: string, displayName?: string): string;
  close(): Promise<void>;
}

/** A waitUntil-capturing ExecutionContext (testExecutionContext idiom). */
function makeCtx(): { ctx: ExecutionContext; flush: () => Promise<unknown> } {
  const tasks: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>) {
      tasks.push(p);
    },
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
  // Drain iteratively: a flushed task may itself schedule more waitUntil work.
  return {
    ctx,
    flush: async () => {
      while (tasks.length > 0) {
        const batch = tasks.splice(0, tasks.length);
        await Promise.allSettled(batch);
      }
    },
  };
}

/** Ed25519 signature over `${timestamp}|${body}` (Telnyx webhook contract). */
async function signTelnyx(
  privateKey: CryptoKey,
  body: string,
): Promise<{ signature: string; timestamp: string }> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      privateKey,
      new TextEncoder().encode(`${timestamp}|${body}`),
    ),
  );
  return { signature: Buffer.from(sig).toString("base64"), timestamp };
}

export async function startHarness(): Promise<Harness> {
  const [telnyx, stripe, jwks] = await Promise.all([
    startFakeTelnyx(),
    startFakeStripe(),
    startFakeJwks(),
  ]);

  const { apiUrl, secretKey } = resolveSupabase();
  const runId = `e2e_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  // Narrow Resend capture: intercept ONLY api.resend.com (no env seam exists),
  // pass everything else through to the real fetch. Installed once per harness.
  const emails: SentEmail[] = [];
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.startsWith("https://api.resend.com/")) {
      const req = new Request(input as RequestInfo | URL, init);
      const parsed = (await req
        .clone()
        .json()
        .catch(() => ({}))) as Partial<SentEmail>;
      emails.push({
        to: parsed.to ?? [],
        subject: parsed.subject ?? "",
        from: parsed.from ?? "",
      });
      return Response.json({ id: `email_${emails.length}` });
    }
    return realFetch(input as RequestInfo | URL, init);
  }) as typeof fetch;

  // The full Bindings object the Worker validates (env.ts). Non-vendor secrets
  // are the completeEnv()-style literals; vendor bases point at the fakes.
  const env: Record<string, unknown> = {
    SUPABASE_URL: apiUrl,
    SUPABASE_SECRET_KEY: secretKey,
    SUPABASE_JWKS_URL: jwks.jwksUrl,
    TELNYX_API_KEY: "KEY_E2E_TELNYX",
    TELNYX_PUBLIC_KEY: telnyx.publicKeyB64,
    TELNYX_VOICE_CONNECTION_ID: "2000000000000000001",
    STRIPE_SECRET_KEY: "sk_test_e2e",
    STRIPE_WEBHOOK_SECRET,
    RESEND_API_KEY: "re_e2e",
    SENTRY_DSN: "https://e2e@o000001.ingest.sentry.io/0000001",
    APP_ORIGIN: "https://app.loonext.com",
    API_ORIGIN: "https://api.loonext.com",
    RESEND_FROM: "Loonext <notifications@loonext.com>",
    VAPID_PUBLIC_KEY:
      "BD_hP_N07omlLXk14YXRFvsSICDKoywjGtx-T1_5PdLX155D623P5Ci-5sRhh5g2Qj5j0aQPiDWSgT2DlOefImw",
    VAPID_PRIVATE_KEY: "L9lOg9x05mb1bG5kwUIpxSSf8YiMrm6KZn-c_GIyqAM",
    STRIPE_STARTER_PRICE_ID: "price_starter_licensed_0001",
    STRIPE_PRO_PRICE_ID: "price_pro_licensed_0001",
    STRIPE_STARTER_OVERAGE_PRICE_ID: "price_starter_overage_0001",
    STRIPE_PRO_OVERAGE_PRICE_ID: "price_pro_overage_0001",
    STRIPE_US_FEE_PRICE_ID: "price_us_registration_0001",
    STRIPE_SMS_METER_EVENT_NAME: "sms_segments",
    TELNYX_API_BASE: telnyx.origin,
    STRIPE_API_BASE: stripe.origin,
  };

  const db = createClient(apiUrl, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const issuer = expectedIssuer(apiUrl);
  const stripeSigner = new Stripe("sk_test_e2e_signer");

  async function call(
    method: string,
    path: string,
    options: CallOptions = {},
  ): Promise<CallResult> {
    const { ctx, flush } = makeCtx();
    const headers: Record<string, string> = { ...options.headers };
    if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
    if (options.companyId) headers["X-Company-Id"] = options.companyId;
    if (options.idempotencyKey)
      headers["Idempotency-Key"] = options.idempotencyKey;
    let body: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    const request = new Request(`https://api.loonext.com${path}`, {
      method,
      headers,
      body,
    });
    const response = await app.fetch(request, env, ctx);
    const text = await response.text();
    await flush();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json, text };
  }

  async function injectTelnyx(event: unknown): Promise<CallResult> {
    const { ctx, flush } = makeCtx();
    const bodyText = JSON.stringify(event);
    const { signature, timestamp } = await signTelnyx(
      telnyx.privateKey,
      bodyText,
    );
    const request = new Request("https://api.loonext.com/webhooks/telnyx", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "telnyx-signature-ed25519": signature,
        "telnyx-timestamp": timestamp,
      },
      body: bodyText,
    });
    const response = await app.fetch(request, env, ctx);
    const text = await response.text();
    await flush();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json, text };
  }

  async function injectStripe(
    event: Record<string, unknown>,
  ): Promise<CallResult> {
    const { ctx, flush } = makeCtx();
    const bodyText = JSON.stringify(event);
    const header = stripeSigner.webhooks.generateTestHeaderString({
      payload: bodyText,
      secret: STRIPE_WEBHOOK_SECRET,
    });
    const request = new Request("https://api.loonext.com/webhooks/stripe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": header,
      },
      body: bodyText,
    });
    const response = await app.fetch(request, env, ctx);
    const text = await response.text();
    await flush();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json, text };
  }

  function sql(text: string): string {
    return execFileSync(
      "docker",
      [
        "exec",
        "-i",
        DB_CONTAINER,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-t",
        "-A",
      ],
      { input: text, encoding: "utf8" },
    );
  }

  return {
    env,
    supabaseUrl: apiUrl,
    db,
    telnyx,
    stripe,
    jwks,
    emails,
    runId,
    token: (sub: string) => jwks.token({ sub, issuer }),
    seedUserSql: (id, email, displayName = "E2E User") =>
      `insert into auth.users
         (instance_id, id, aud, role, email,
          raw_user_meta_data, raw_app_meta_data,
          created_at, updated_at, email_confirmed_at,
          confirmation_token, recovery_token, email_change_token_new,
          email_change, email_change_token_current, phone_change,
          phone_change_token, reauthentication_token)
       values
         ('00000000-0000-0000-0000-000000000000', '${id}',
          'authenticated', 'authenticated', '${email}',
          '{"display_name":${JSON.stringify(displayName)}}'::jsonb,
          '{"provider":"email","providers":["email"]}'::jsonb,
          now(), now(), now(),
          '', '', '', '', '', '', '', '');`,
    call,
    injectTelnyx,
    injectStripe,
    sql,
    close: async () => {
      globalThis.fetch = realFetch;
      await Promise.allSettled([telnyx.close(), stripe.close(), jwks.close()]);
    },
  };
}
