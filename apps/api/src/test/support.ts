/**
 * Test-only helpers (D13): the ONLY thing stubbed anywhere is the network
 * edge — global fetch — so every test exercises the real product code paths
 * (jose JWKS resolution, supabase-js PostgREST requests, Hono middleware).
 */
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { vi } from "vitest";

import type { Env } from "../env";
import { generateVapidPair } from "./vapid-keys";
import type { SendClearance } from "../messaging/send";

/**
 * One VAPID pair per test process — stable across every `completeEnv()` call
 * (as the old committed constant was), but generated at runtime rather than
 * shipped as a private-key literal. See `vapid-keys.ts`.
 */
const VAPID_TEST_PAIR = generateVapidPair();

/** A complete set of bindings, as `wrangler dev` would supply from .dev.vars. */
export function completeEnv(): Env {
  return {
    SUPABASE_URL: "https://abcdefghijkl.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_0123456789abcdef",
    SUPABASE_JWKS_URL:
      "https://abcdefghijkl.supabase.co/auth/v1/.well-known/jwks.json",
    TELNYX_API_KEY: "KEY0123456789ABCDEF",
    TELNYX_PUBLIC_KEY: "3fJ8mQz1xW9yK2vL5nB7cD4eF6gH8iJ0kL2mN4oP6qR=",
    TELNYX_VOICE_CONNECTION_ID: "2000000000000000001",
    // The shared WebRTC credential connection — the inbound ring dials FROM it
    // (that's where member browsers register); without it, ringing degrades to
    // voicemail (#135).
    TELNYX_WEBRTC_CONNECTION_ID: "3000000000000000002",
    STRIPE_SECRET_KEY: "rk_test_0123456789abcdef",
    STRIPE_WEBHOOK_SECRET: "whsec_0123456789abcdef",
    RESEND_API_KEY: "re_0123456789abcdef",
    SENTRY_DSN: "https://0123456789abcdef@o000001.ingest.sentry.io/0000001",
    APP_ORIGIN: "https://app.loonext.com",
    API_ORIGIN: "https://api.loonext.com",
    RESEND_FROM: "Loonext <notifications@loonext.com>",
    // A per-process test-only P-256 pair (vapid-keys.ts) in the standard VAPID
    // encoding, so the §8 Web Push crypto paths run for real in tests.
    VAPID_PUBLIC_KEY: VAPID_TEST_PAIR.publicKey,
    VAPID_PRIVATE_KEY: VAPID_TEST_PAIR.privateKey,
    STRIPE_STARTER_PRICE_ID: "price_starter_licensed_0001",
    STRIPE_PRO_PRICE_ID: "price_pro_licensed_0001",
    STRIPE_STARTER_OVERAGE_PRICE_ID: "price_starter_overage_0001",
    STRIPE_PRO_OVERAGE_PRICE_ID: "price_pro_overage_0001",
    STRIPE_US_FEE_PRICE_ID: "price_us_registration_0001",
    STRIPE_STARTER_YEAR_PRICE_ID: "price_starter_year_0001",
    STRIPE_PRO_YEAR_PRICE_ID: "price_pro_year_0001",
    STRIPE_PREPAID_YEAR_COUPON_ID: "loonext_prepaid_year",
    // #277: the seasonal pause price. Configured here exactly as production
    // will be — suites that need the UNPROVISIONED behaviour (the offer must
    // not exist, and must never be free) delete it explicitly, which is the
    // way round that keeps the fail-closed path a deliberate assertion rather
    // than the accidental default.
    STRIPE_PAUSE_PRICE_ID: "price_pause_0001",
    STRIPE_REFERRAL_MONTH_COUPON_ID: "loonext_referral_month",
    STRIPE_MODULE_MMS_PRICE_ID: "price_module_mms_0001",
    STRIPE_MODULE_VOICE_PRICE_ID: "price_module_voice_0001",
    STRIPE_MODULE_EXTRA_STORAGE_PRICE_ID: "price_module_extra_storage_0001",
    STRIPE_MODULE_REGIONS_CA_PRICE_ID: "price_module_regions_ca_0001",
    STRIPE_EXTRA_NUMBER_STARTER_PRICE_ID: "price_extra_number_starter_0001",
    STRIPE_EXTRA_NUMBER_PRO_PRICE_ID: "price_extra_number_pro_0001",
    STRIPE_SMS_METER_EVENT_NAME: "sms_segments",
    // D36 voice fair-use overage: configured in tests exactly like production
    // (the vars are env-optional, but prod always carries them).
    STRIPE_VOICE_METER_EVENT_NAME: "voice_seconds",
    STRIPE_STARTER_VOICE_OVERAGE_PRICE_ID: "price_starter_voice_overage_0001",
    STRIPE_PRO_VOICE_OVERAGE_PRICE_ID: "price_pro_voice_overage_0001",
  };
}

export interface TokenOptions {
  issuer?: string;
  audience?: string;
  subject?: string;
  /** Seconds from now; negative mints an already-expired token. */
  expiresIn?: number;
  key?: CryptoKey;
  kid?: string;
  /**
   * #236: the GoTrue session this token was minted for. Real Supabase access
   * tokens always carry one; `null` mints the pre-#236 shape (a token from
   * before GoTrue emitted the claim), which the middleware must still admit.
   */
  sessionId?: string | null;
  /**
   * #314/#496: the assurance level GoTrue put in the token. Absent mints the
   * `aal1` shape, which is what a password login actually produces — the
   * default a step-up test has to be able to express.
   */
  aal?: "aal1" | "aal2";
  /**
   * #581/#7: how many seconds ago a second factor was proved, written into the
   * `amr` claim GoTrue emits.
   *
   * `aal` says a factor was verified for this session at SOME point;
   * `companyContext` has already forced that to `aal2` for anybody enrolled by
   * the time a route runs, which is why gating a destructive act on it asked such
   * a caller for nothing. This is the claim that answers "how long ago", and a
   * test cannot express the confirmable-action gate without it.
   *
   * Omitted mints no `amr` at all — freshness cannot be established, which is the
   * conservative reading and the shape of a token from before this mattered.
   */
  factorProvedSecondsAgo?: number;
}

export interface TestAuth {
  jwk: JWK;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  issuer: string;
  jwksUrl: string;
  /** The user id (`sub`) that `token()` mints by default. */
  subject: string;
  /** The `session_id` claim (#236) that `token()` mints by default. */
  sessionId: string;
  token(options?: TokenOptions): Promise<string>;
}

/**
 * Generates a REAL ES256 keypair and returns a signer that mints real JWTs
 * shaped like Supabase access tokens for the given env.
 */
export async function createTestAuth(
  env: Env = completeEnv(),
): Promise<TestAuth> {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const kid = "test-es256-key";
  const jwk: JWK = {
    ...(await exportJWK(publicKey)),
    kid,
    alg: "ES256",
    use: "sig",
  };
  const issuer = `${env.SUPABASE_URL}/auth/v1`;
  const subject = "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01";
  const sessionId = "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

  return {
    jwk,
    publicKey,
    privateKey,
    issuer,
    jwksUrl: env.SUPABASE_JWKS_URL,
    subject,
    sessionId,
    async token(options: TokenOptions = {}): Promise<string> {
      const now = Math.floor(Date.now() / 1000);
      const expiresIn = options.expiresIn ?? 300;
      const session =
        options.sessionId === undefined ? sessionId : options.sessionId;
      const claims: Record<string, unknown> =
        session === null ? {} : { session_id: session };
      if (options.aal) claims.aal = options.aal;
      if (options.factorProvedSecondsAgo !== undefined) {
        // The real claim shape, verified against @supabase/auth-js: an array of
        // { method, timestamp }, the timestamp in SECONDS. `password` is included
        // because a real token carries the first factor too, and the parser has
        // to pick the second-factor entry out rather than taking the first.
        claims.amr = [
          { method: "password", timestamp: now - 3600 },
          { method: "totp", timestamp: now - options.factorProvedSecondsAgo },
        ];
      }
      return new SignJWT(claims)
        .setProtectedHeader({ alg: "ES256", kid: options.kid ?? kid })
        .setIssuer(options.issuer ?? issuer)
        .setAudience(options.audience ?? "authenticated")
        .setSubject(options.subject ?? subject)
        .setIssuedAt(now - 60)
        .setExpirationTime(now + expiresIn)
        .sign(options.key ?? privateKey);
    },
  };
}

export type FetchRoute = (
  url: URL,
  request: Request,
) => Response | undefined | Promise<Response | undefined>;

/**
 * Replace global fetch (the test-only network edge) with a dispatcher over the
 * given routes. Any request no route claims fails the test loudly. Restore
 * with `vi.unstubAllGlobals()`.
 */
/**
 * Endpoints that hang off EVERY email send and assert nothing about the test
 * that triggered them.
 *
 * `sendEmail` reads the #386 suppression list before sending and records the
 * #387 delivery-channel heartbeat after. Neither is what any of the hundred
 * tests that happen to send an email are about, and requiring each of them to
 * stub both would be boilerplate that tests nothing — and that the next person
 * to add an email would have to rediscover from a five-second timeout.
 *
 * They come LAST, so a suite that wants to assert on either one still can by
 * registering its own route: the explicit stub matches first.
 *
 * Empty suppression list = nothing is blocked, which is the state every
 * existing test was written against.
 */
const ambientEmailRoutes: FetchRoute[] = [
  (url) =>
    url.pathname === "/rest/v1/email_suppressions" ? Response.json([]) : undefined,
  (url) =>
    url.pathname === "/rest/v1/rpc/record_heartbeat"
      ? Response.json({ recovered: false })
      : undefined,
  // #283: flags hang off the send, calls and AI paths, so they are ambient for
  // the same reason the heartbeat is. `{}` means "nothing has been said",
  // which resolves every key to its code default — kill switches ON. A test
  // that wants a switch OFF stubs the RPC itself and shadows this.
  (url) =>
    url.pathname === "/rest/v1/rpc/api_evaluate_flags"
      ? Response.json({})
      : undefined,
  // #430: every push carrying a person's words reads the workspace's answer
  // first, so it hangs off the notification paths the way the flags do. The
  // ambient answer is the default — content INCLUDED — which is the state
  // every test written before #430 was asserting against. A suite that wants
  // it off stubs this path itself and shadows this.
  (url) =>
    url.pathname === "/rest/v1/companies"
    && url.searchParams.get("select") === "push_include_content"
      ? Response.json([{ push_include_content: true }])
      : undefined,
];

export function stubFetch(...routes: FetchRoute[]): void {
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = new Request(
        input instanceof Request ? input : String(input),
        init,
      );
      const url = new URL(request.url);
      for (const route of [...routes, ...ambientEmailRoutes]) {
        const response = await route(url, request);
        if (response) return response;
      }
      throw new Error(`Unstubbed fetch in test: ${request.method} ${url.href}`);
    },
  );
}

/** Serves the test JWKS document at the env's SUPABASE_JWKS_URL. */
export function jwksRoute(auth: TestAuth): FetchRoute {
  return (url) =>
    url.href === auth.jwksUrl
      ? Response.json({ keys: [auth.jwk] })
      : undefined;
}

/** Captured request details for asserting what the product code sent. */
export interface CapturedRequest {
  url?: URL;
  request?: Request;
}

/**
 * Serves the /v1 authorization probe (`api_authorize_request`) — the single
 * round trip auth/company.ts makes per request since #236, settling both the
 * caller's membership and whether their session has been signed out.
 *
 * `member: null` is "not an active member of this company" (403);
 * `revoked: true` is "this device was signed out" (401).
 */
export function authorizeRoute(
  env: Env,
  member: { id: string; role: string } | null,
  options: {
    revoked?: boolean;
    captured?: CapturedRequest;
    /**
     * #314: the workspace's MFA posture. Omitted entirely by default, which is
     * also what a Worker deployed ahead of the migration sees — so the default
     * exercises the tolerant path rather than papering over it.
     */
    mfa?: {
      required: boolean;
      grace_until: string | null;
      enforcing: boolean;
      /** #496: whether the USER holds a verified factor, independent of any
       *  workspace policy. Omitted reads as false, which is what a Worker
       *  ahead of the migration sees. */
      enrolled?: boolean;
    };
  } = {},
): FetchRoute {
  const href = `${env.SUPABASE_URL}/rest/v1/rpc/api_authorize_request`;
  return (url, request) => {
    if (!url.href.startsWith(href)) return undefined;
    if (options.captured) {
      options.captured.url = url;
      options.captured.request = request;
    }
    return Response.json({
      session_revoked: options.revoked ?? false,
      session_new: false,
      member,
      ...(options.mfa ? { mfa: options.mfa } : {}),
    });
  };
}

/**
 * Serves the PostgREST `company_members` endpoint, returning `rows` and
 * capturing the query for assertions.
 */
export function companyMembersRoute(
  env: Env,
  rows: unknown[],
  captured?: CapturedRequest,
): FetchRoute {
  const prefix = `${env.SUPABASE_URL}/rest/v1/company_members`;
  return (url, request) => {
    if (!url.href.startsWith(prefix)) return undefined;
    if (captured) {
      captured.url = url;
      captured.request = request;
    }
    return Response.json(rows);
  };
}

/**
 * #331: a {@link SendClearance} for a test that calls `dispatchOutbound`
 * directly instead of coming in through a route.
 *
 * This is the ONLY place outside `messaging/send.ts` allowed to mint one, and
 * `messaging/send-paths.test.ts` proves it — the whole point of the brand is
 * that product code cannot fabricate the proof that the opt-out gate ran. A
 * test asserting the dispatch tail is not a send path, so it gets a door;
 * anything under `src/` that is not a test does not.
 */
export function clearedFor(destinationE164: string): SendClearance {
  return { destinationE164 } as SendClearance;
}

/**
 * An export part as text, whatever shape it was written in. #587.
 *
 * Since the byte-order mark shipped, a CSV part is a `Uint8Array` while the
 * HTML and JSON parts are still strings. Every existing assertion in the export
 * suites is about CONTENT, so they go through here and read the same as before;
 * the mark itself is asserted on the raw bytes, which is the only place it is
 * visible at all.
 */
export function exportPartText(body: string | Uint8Array): string {
  return typeof body === "string" ? body : new TextDecoder().decode(body);
}
