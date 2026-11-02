/**
 * #251 -- a second API Worker on the rig, for the load a real one must not take.
 *
 * The rig's own API (api.rig.internal) verifies webhooks against the carrier's
 * real public key and reaches the carrier through the guard, so a burst of
 * synthetic events cannot be signed for it and must not be sent through it.
 * This starts another copy of the SAME Worker code under wrangler on a private
 * loopback port, with:
 *
 *   - its own Ed25519 webhook key, so the driver can sign what it sends;
 *   - the fake Telnyx, Resend and Stripe servers of the launch-pass harness as
 *     its vendors, so nothing it does leaves the machine;
 *   - the rig's local Supabase stack as its database, so the database half of
 *     the path is the rig's own PostgREST, pool and Postgres;
 *   - the real CallSessionDO on workerd, which the in-process harness cannot give.
 *
 * That makes it the workerd counterpart of `harness.ts`: the same fakes and the
 * same seed shapes, but the Worker is reached over HTTP and runs on the real
 * runtime, so a request has an isolate, a subrequest budget and a single-threaded
 * Durable Object in front of it.
 *
 * It exists only on the rig: assertRigVm refuses anywhere else, and the
 * database gate the rig installs (docs/RIG.md) stays on for every row this
 * Worker writes, so a stray outbound text to a real number is refused by
 * Postgres whatever this file does.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

import { generateVapidPair } from "../src/test/vapid-keys";
import { startFakeJwks, type JwksAuth } from "./fake-jwks";
import { startFakeResend, type FakeResend } from "./fake-resend";
import { startFakeStripe, type FakeStripe } from "./fake-stripe";
import { startFakeTelnyx, type FakeTelnyx } from "./fake-telnyx";
import {
  assertRigVm,
  psql,
  psqlSync,
  rigSecretKey,
  RIG_HOME,
} from "./rig-host";

const API_ROOT = new URL("..", import.meta.url).pathname;
/**
 * The local gateway, directly. Not https://db.rig.internal: the Worker refuses
 * any *.rig.internal host unless it runs as DEPLOY_ENV=rig, and rig mode would
 * in turn refuse the fictional numbers a load run is made of. This Worker is the
 * ordinary "local" deployment pointed at the rig's database.
 */
const SUPABASE_ORIGIN = "http://127.0.0.1:54321";
const READY_TIMEOUT_MS = 180_000;

export interface Timed {
  status: number;
  ms: number;
}

/** What an authenticated request returned, enough to judge an error by. */
export interface CallResult extends Timed {
  json: unknown;
  retryAfter: string | null;
}

export interface RigStack {
  /** The load Worker, on loopback. */
  origin: string;
  runId: string;
  telnyx: FakeTelnyx;
  resend: FakeResend;
  stripe: FakeStripe;
  jwks: JwksAuth;
  token(sub: string): Promise<string>;
  /** Sign and POST one Telnyx webhook; resolves with the ack and its latency. */
  injectTelnyx(event: unknown): Promise<Timed>;
  /** An authenticated request to the Worker. */
  call(
    method: string,
    path: string,
    options?: { token?: string; companyId?: string; body?: unknown; stallMs?: number },
  ): Promise<CallResult>;
  /**
   * Requests `call` gave up on after `stallMs`, by how far each had got:
   * `no_response` (no status line came back) or `body_stalled` (the headers
   * came and the body never finished).
   */
  stalls(): Record<string, number>;
  sql(text: string): Promise<string>;
  sqlSync(text: string): string;
  seedUserSql(id: string, email: string, displayName?: string): string;
  /** The last lines the Worker printed, for explaining a failure. */
  logTail(lines?: number): string;
  /**
   * What the Worker printed besides its access log, grouped by sentence with
   * the numbers folded together and counted, most common first. Counts and
   * shapes only: this is what a finding quotes as the cause.
   */
  logCauses(top?: number): [string, number][];
  /** The Worker's own access log, counted by method, path and status. */
  accessCounts(): Record<string, number>;
  /**
   * Every access-log line the Worker has printed since it started, counted by
   * method, path and status. Unlike accessCounts it is not bounded by the log
   * tail, so two readings can be subtracted to say what the Worker finished
   * during one burst.
   */
  servedTotals(): Record<string, number>;
  stop(): Promise<void>;
}

/** wrangler's config is JSONC: comments and trailing commas, inside strings left alone. */
export function parseJsonc(text: string): Record<string, unknown> {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const ch = text[index];
    if (ch === '"') {
      let end = index + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      out += text.slice(index, end + 1);
      index = end + 1;
    } else if (text.startsWith("//", index)) {
      while (index < text.length && text[index] !== "\n") index += 1;
    } else if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
    } else {
      out += ch;
      index += 1;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1")) as Record<string, unknown>;
}

/**
 * The production config, minus everything that would reach beyond this machine:
 * the schedules (the rig fires its own), the Workers AI binding (it is always
 * remote, and wrangler would open a session on the Cloudflare account for it),
 * and the observability sink.
 */
export function loadWorkerConfig(base: string, mainPath: string): Record<string, unknown> {
  const config = parseJsonc(base);
  delete config.triggers;
  delete config.ai;
  delete config.routes;
  delete config.route;
  delete config.observability;
  delete config.env;
  return { ...config, name: "loonext-api-load251", main: mainPath, workers_dev: false };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("no port"));
      });
    });
  });
}

function quote(value: string): string {
  return JSON.stringify(value);
}

/** Ed25519 over `${timestamp}|${body}`, the carrier's webhook contract. */
async function sign(privateKey: CryptoKey, body: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      privateKey,
      new TextEncoder().encode(`${timestamp}|${body}`),
    ),
  );
  return { signature: Buffer.from(signature).toString("base64"), timestamp };
}

export async function startRigStack(): Promise<RigStack> {
  await assertRigVm();

  const [telnyx, stripe, resend, jwks] = await Promise.all([
    startFakeTelnyx(),
    startFakeStripe(),
    startFakeResend(),
    startFakeJwks(),
  ]);
  const runId = `rig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const dir = join(RIG_HOME, "work", "load-251", runId);
  mkdirSync(join(dir, "home"), { recursive: true });

  const vapid = generateVapidPair();
  const vars: Record<string, string> = {
    // The load Worker marks itself as somebody's laptop, which keeps its
    // failures out of the production error stream.
    LOCAL_DEV: "1",
    SUPABASE_URL: SUPABASE_ORIGIN,
    SUPABASE_SECRET_KEY: rigSecretKey(),
    SUPABASE_JWKS_URL: jwks.jwksUrl,
    TELNYX_API_KEY: "KEY_RIG_LOAD",
    TELNYX_PUBLIC_KEY: telnyx.publicKeyB64,
    TELNYX_VOICE_CONNECTION_ID: "2000000000000000001",
    TELNYX_WEBRTC_CONNECTION_ID: "3000000000000000002",
    STRIPE_SECRET_KEY: "sk_test_rig_load",
    STRIPE_WEBHOOK_SECRET: "whsec_rig_load",
    RESEND_API_KEY: "re_rig_load",
    SENTRY_DSN: "https://rigload@o000001.ingest.sentry.io/0000001",
    APP_ORIGIN: "https://app.example.test",
    API_ORIGIN: "https://api.example.test",
    RESEND_FROM: "Loonext <notifications@example.test>",
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    STRIPE_STARTER_PRICE_ID: "price_starter_licensed_0001",
    STRIPE_PRO_PRICE_ID: "price_pro_licensed_0001",
    STRIPE_STARTER_OVERAGE_PRICE_ID: "price_starter_overage_0001",
    STRIPE_PRO_OVERAGE_PRICE_ID: "price_pro_overage_0001",
    STRIPE_US_FEE_PRICE_ID: "price_us_registration_0001",
    STRIPE_SMS_METER_EVENT_NAME: "sms_segments",
    TELNYX_API_BASE: telnyx.origin,
    STRIPE_API_BASE: stripe.origin,
    RESEND_API_BASE: resend.origin,
  };
  writeFileSync(
    join(dir, ".dev.vars"),
    Object.entries(vars)
      .map(([name, value]) => `${name}=${quote(value)}`)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  const config = loadWorkerConfig(
    readFileSync(join(API_ROOT, "wrangler.jsonc"), "utf8"),
    join(API_ROOT, "src", "index.ts"),
  );
  writeFileSync(join(dir, "wrangler.jsonc"), JSON.stringify(config, null, 2));

  const tail: string[] = [];
  const served: Record<string, number> = {};
  const stalled: Record<string, number> = {};
  const remember = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      tail.push(line);
      const match = /\[wrangler:info\] (GET|POST|PUT|PATCH|DELETE) (\S+) (\d{3})/.exec(line);
      if (match) {
        const key = `${match[1]} ${match[2]} ${match[3]}`;
        served[key] = (served[key] ?? 0) + 1;
      }
    }
    if (tail.length > 6000) tail.splice(0, tail.length - 6000);
  };

  const child: ChildProcess = spawn(
    join(API_ROOT, "node_modules", ".bin", "wrangler"),
    [
      "dev",
      "--config",
      join(dir, "wrangler.jsonc"),
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--persist-to",
      join(dir, "state"),
      "--show-interactive-dev-session=false",
    ],
    {
      cwd: API_ROOT,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        // A home of its own, so no `wrangler login` on this machine is found,
        // and no Cloudflare credential is inherited: this Worker must not be
        // able to open a remote session on anybody's account.
        HOME: join(dir, "home"),
        XDG_CONFIG_HOME: join(dir, "home"),
        WRANGLER_SEND_METRICS: "false",
      },
    },
  );
  child.stdout?.on("data", remember);
  child.stderr?.on("data", remember);

  let exited = false;
  child.once("exit", () => {
    exited = true;
  });

  const stop = async (): Promise<void> => {
    if (!exited && child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // already gone
      }
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
    await Promise.allSettled([telnyx.close(), stripe.close(), resend.close(), jwks.close()]);
    rmSync(dir, { recursive: true, force: true });
  };

  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (exited) {
      await stop();
      throw new Error(`the load Worker exited while starting:\n${tail.slice(-20).join("\n")}`);
    }
    try {
      const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`the load Worker was not ready in time:\n${tail.slice(-20).join("\n")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const issuer = `${SUPABASE_ORIGIN}/auth/v1`;

  async function call(
    method: string,
    path: string,
    options: { token?: string; companyId?: string; body?: unknown; stallMs?: number } = {},
  ): Promise<CallResult> {
    const started = performance.now();
    const headers: Record<string, string> = {};
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.companyId) headers["X-Company-Id"] = options.companyId;
    let body: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    const signal =
      options.stallMs === undefined ? undefined : AbortSignal.timeout(options.stallMs);
    let reachedHeaders = false;
    let response: Response;
    let text: string;
    try {
      response = await fetch(`${origin}${path}`, { method, headers, body, signal });
      reachedHeaders = true;
      text = await response.text();
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name === "TimeoutError") {
        const phase = reachedHeaders ? "body_stalled" : "no_response";
        stalled[phase] = (stalled[phase] ?? 0) + 1;
      }
      throw error;
    }
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      status: response.status,
      ms: Math.round(performance.now() - started),
      json,
      retryAfter: response.headers.get("retry-after"),
    };
  }

  async function injectTelnyx(event: unknown): Promise<Timed> {
    const started = performance.now();
    const body = JSON.stringify(event);
    const { signature, timestamp } = await sign(telnyx.privateKey, body);
    const response = await fetch(`${origin}/webhooks/telnyx`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "telnyx-signature-ed25519": signature,
        "telnyx-timestamp": timestamp,
      },
      body,
    });
    await response.arrayBuffer();
    return { status: response.status, ms: Math.round(performance.now() - started) };
  }

  return {
    origin,
    runId,
    telnyx,
    resend,
    stripe,
    jwks,
    token: (sub) => jwks.token({ sub, issuer }),
    injectTelnyx,
    call,
    sql: psql,
    sqlSync: psqlSync,
    seedUserSql: (id, email, displayName = "Rig Load") =>
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
    logTail: (lines = 40) => tail.slice(-lines).join("\n"),
    servedTotals: () => ({ ...served }),
    stalls: () => ({ ...stalled }),
    accessCounts: () => {
      const counts: Record<string, number> = {};
      for (const logged of tail) {
        const match = /\[wrangler:info\] (GET|POST|PUT|PATCH|DELETE) (\S+) (\d{3})/.exec(logged);
        if (!match) continue;
        const key = `${match[1]} ${match[2]} ${match[3]}`;
        counts[key] = (counts[key] ?? 0) + 1;
      }
      return counts;
    },
    logCauses: (top = 10) => {
      const causes = new Map<string, number>();
      for (const logged of tail) {
        // Skip the access log and stack frames; keep what the Worker said.
        if (logged.includes("[wrangler:info]") || /^\s+at /.test(logged)) continue;
        const key = logged
          // eslint-disable-next-line no-control-regex
          .replace(/\u001b\[[0-9;]*m/g, "")
          .replace(/\d{2,}/g, "N")
          .replace(/rig_[a-z0-9_]+/g, "RUN")
          .slice(0, 180);
        causes.set(key, (causes.get(key) ?? 0) + 1);
      }
      return [...causes.entries()].sort((x, y) => y[1] - x[1]).slice(0, top);
    },
    stop,
  };
}
