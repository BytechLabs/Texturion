import { z } from "zod";

/**
 * The Workers rate-limiting binding surface (wrangler's "ratelimit" unsafe
 * binding — not importable from a package, so typed here). `success: false`
 * means the key is over its configured limit for the current period.
 */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

const rateLimiterSchema = z.custom<RateLimiter>(
  (value) =>
    typeof (value as RateLimiter | null | undefined)?.limit === "function",
);

/**
 * Calls v3 (#170, docs/CALLS-V3.md §2.1): the CallSessionDO namespace. Typed
 * via the same z.custom pattern as rateLimiterSchema — the envSchema strips
 * unknown keys, so a binding added to a TS type alone would be silently
 * discarded. Declared .optional() because required would break every existing
 * test env fixture / completeEnv; the webhook router and live-calls routes
 * guard at runtime and fail loudly (Sentry) if it is absent in production.
 */
const callSessionsSchema = z.custom<DurableObjectNamespace>(
  (value) =>
    typeof (value as DurableObjectNamespace | null | undefined)?.idFromName ===
    "function",
);

/**
 * Every binding the api Worker requires (SPEC §10). All of these are Worker
 * encrypted secrets in production (`wrangler secret put`) and `.dev.vars`
 * entries locally — see .dev.vars.example.
 */
const envSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  SUPABASE_JWKS_URL: z.url(),
  TELNYX_API_KEY: z.string().min(1),
  TELNYX_PUBLIC_KEY: z.string().min(1),
  /**
   * The Telnyx Call-Control application id (a.k.a. voice "connection"), created
   * once at account setup, that per-company numbers are bound to for inbound
   * voice — the target of the missed-call text-back's Call-Control webhooks.
   * Enabling voice on an SMS-only number points its voice settings at this app.
   */
  TELNYX_VOICE_CONNECTION_ID: z.string().min(1),
  /**
   * D43 (#135): the shared WebRTC CREDENTIAL connection per-member telephony
   * credentials are minted on (browser softphone identities). Optional so
   * dev/test boot without it — the token endpoint 503s honestly when unset.
   */
  TELNYX_WEBRTC_CONNECTION_ID: z.string().min(1).optional(),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  SENTRY_DSN: z.url(),
  APP_ORIGIN: z.url(),
  /** Public origin of THIS Worker (webhook callback URLs, e.g. Telnyx profiles). */
  API_ORIGIN: z.url(),
  /**
   * Canonical MARKETING origin (D27 host split), e.g. `https://loonext.com`.
   * The public /contact form is served from here, a DIFFERENT origin than the
   * app (APP_ORIGIN = app.loonext.com), so the contact CORS must allow it or
   * every real submission is blocked. Optional: unset (single-host dev/deploy,
   * where marketing is same-origin with APP_ORIGIN) falls back to APP_ORIGIN.
   */
  SITE_ORIGIN: z.url().optional(),
  /** Resend sender, e.g. `Loonext <notifications@loonext.com>` (SPEC §3). */
  RESEND_FROM: z.string().min(1),
  /** #121: ops recipient for abuse alerts (storage tiers). Optional — unset
   * falls back to support@loonext.com, which routes to the founder. */
  OPS_ALERT_EMAIL: z.string().min(3).optional(),
  /**
   * Reply-To stamped on EVERY Resend send (email-hardening: alert copy says
   * "just reply to this email", so replies must land in a monitored inbox
   * rather than the unmonitored sender). Production sets it to
   * `support@loonext.com` (docs/deploy/10-email-inbox.md routes that address).
   * OPTIONAL: unset (local dev, tests) sends carry no Reply-To — exactly the
   * pre-hardening behavior. Per-send `replyTo` (contact form → submitter)
   * overrides it.
   */
  RESEND_REPLY_TO: z.string().min(1).optional(),
  /**
   * Cloudflare Turnstile SECRET key for server-side verification on the
   * public POST /contact endpoint (the sibling of the web app's
   * NEXT_PUBLIC_TURNSTILE_SITE_KEY). OPTIONAL: unset = the endpoint relies on
   * its honeypot + rate limits + daily cap only and requires no token.
   */
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  /**
   * Web Push VAPID key pair as Worker secrets (SPEC §8). Standard encoding
   * (`npx web-push generate-vapid-keys`): base64url uncompressed P-256 point
   * (65 bytes) and base64url private scalar (32 bytes).
   */
  VAPID_PUBLIC_KEY: z.string().min(1),
  VAPID_PRIVATE_KEY: z.string().min(1),
  /**
   * #151 native device push: the Firebase service-account key JSON
   * (project_id + client_email + private_key) used for FCM HTTP v1 sends to
   * registered Android/iOS devices (notifications/fcm.ts). OPTIONAL so deploys
   * stay green until the founder provisions Firebase: unset, every native send
   * is a logged no-op — Web Push is unaffected.
   */
  FCM_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
  // Stripe catalog ids printed by `pnpm stripe:setup` (SPEC §9: the catalog is
  // created by a checked-in setup script, ids stored as env config).
  STRIPE_STARTER_PRICE_ID: z.string().min(1),
  STRIPE_PRO_PRICE_ID: z.string().min(1),
  STRIPE_STARTER_OVERAGE_PRICE_ID: z.string().min(1),
  STRIPE_PRO_OVERAGE_PRICE_ID: z.string().min(1),
  STRIPE_US_FEE_PRICE_ID: z.string().min(1),
  /**
   * #12 plan-builder module add-on prices (created by `pnpm stripe:setup`).
   * OPTIONAL so the Worker boots before the module catalog is provisioned;
   * checkout validates presence only when a customer actually selects the
   * module (billing/modules.ts modulePrice()).
   *
   * MMS is RETIRED (#103) — its price no longer sells or maps to a catalog
   * module. Keep the env var SET where it was ever provisioned: the daily
   * reconcile uses it (billing/modules.ts retiredModulePrices) to strip stale
   * $5 items off live subscriptions with a prorated credit. Unset = never
   * provisioned = the sweep is a no-op. #121: EXTRA_STORAGE is retired the
   * same way — its env var must STAY SET in production so the sweep can
   * identify and strip the price from existing subscribers.
   */
  STRIPE_MODULE_MMS_PRICE_ID: z.string().min(1).optional(),
  STRIPE_MODULE_VOICE_PRICE_ID: z.string().min(1).optional(),
  STRIPE_MODULE_EXTRA_STORAGE_PRICE_ID: z.string().min(1).optional(),
  STRIPE_MODULE_REGIONS_CA_PRICE_ID: z.string().min(1).optional(),
  /**
   * #105 (#80) extra-number prices: one licensed price per plan ($5 Starter /
   * $4 Pro), quantity = paid extras beyond the plan's included numbers.
   * OPTIONAL: unset means extras are not purchasable in this environment
   * (billing/extra-numbers.ts fails CLOSED — never a free extra number).
   */
  STRIPE_EXTRA_NUMBER_STARTER_PRICE_ID: z.string().min(1).optional(),
  STRIPE_EXTRA_NUMBER_PRO_PRICE_ID: z.string().min(1).optional(),
  /** Billing Meter `event_name` (SPEC §9: 'sms_segments'). */
  STRIPE_SMS_METER_EVENT_NAME: z.string().min(1),
  /**
   * D36 (#128) voice fair-use overage: the voice Billing Meter's `event_name`
   * ('voice_seconds') plus the per-plan graduated metered prices bound to it
   * (tier 1 at $0 up to the plan's included minutes, then 1¢/min), all printed
   * by `pnpm stripe:setup`. OPTIONAL so the Worker boots before the catalog is
   * provisioned: with the event name unset, forward legs are stamped
   * non-reportable at insert (no retroactive backlog can ever build up and
   * dump old minutes into a later invoice); with a price unset, checkout and
   * the module toggle simply don't attach the metered item (minutes go
   * unbilled, never over-billed). The fair-use gate in voice-webhook.ts caps
   * forwarding at the spending cap regardless, so cost stays bounded either
   * way.
   */
  STRIPE_VOICE_METER_EVENT_NAME: z.string().min(1).optional(),
  STRIPE_STARTER_VOICE_OVERAGE_PRICE_ID: z.string().min(1).optional(),
  STRIPE_PRO_VOICE_OVERAGE_PRICE_ID: z.string().min(1).optional(),
  /**
   * PostHog Cloud project API key (SPEC §12 step 18 product analytics).
   * OPTIONAL: when unset (local dev, tests) every analytics capture is a
   * silent no-op — see src/analytics/posthog.ts.
   */
  POSTHOG_API_KEY: z.string().min(1).optional(),
  /**
   * #163 store-rules kill-switch: set to "1" (or "true") to flip
   * `billing_writes_enabled` to false on the company views, telling native
   * apps to hide in-app billing WRITES (plan change, module toggles) and fall
   * back to the external-browser Stripe surfaces. OPTIONAL: unset = writes
   * enabled (the default posture). Reads are never gated.
   */
  BILLING_WRITES_DISABLED: z.string().optional(),
  /**
   * The per-company outbound rate limiter (SPEC §10 layer 3: ~1 msg/s),
   * declared in wrangler.jsonc as a "ratelimit" unsafe binding. Workers rate
   * limiting only supports 10s/60s periods, so 1 msg/s is configured as
   * limit=10 per period=10s — the same average rate with small bursts.
   * OPTIONAL: absent in local dev/tests → the dispatch-time gate is skipped.
   */
  SEND_RATE_LIMITER: rateLimiterSchema.optional(),
  /**
   * Per-number limiter for the keep-your-number ownership-verification
   * endpoints (SPEC §10 DoS posture), declared in wrangler.jsonc like
   * SEND_RATE_LIMITER. POST /v1/text-enablements/:id/verification-codes makes
   * Telnyx SMS or CALL the target number — a number the company has NOT yet
   * proven it owns — and .../verify accepts code guesses, so both are bounded
   * per target number (limit=3 per 60s). OPTIONAL: absent in local dev/tests
   * → the gate is skipped.
   */
  VERIFY_RATE_LIMITER: rateLimiterSchema.optional(),
  /**
   * OPTIONAL vendor base-URL overrides — production leaves them UNSET so the
   * clients hit the real vendor hosts (Telnyx `api.telnyx.com`, Stripe
   * `api.stripe.com`). The hermetic E2E launch-pass harness (SPEC §12 step 19,
   * D31) points them at in-process fake servers so both golden paths run with
   * no external network and no live keys. Must be a full origin, e.g.
   * `http://127.0.0.1:8791`.
   */
  TELNYX_API_BASE: z.url().optional(),
  STRIPE_API_BASE: z.url().optional(),
  /**
   * Calls v3 (#170) — the per-call session Durable Object namespace
   * (wrangler.jsonc `CALL_SESSIONS` → class CallSessionDO). Optional so every
   * existing test fixture boots without it; the v3 inbound path guards on its
   * presence and fails loudly in production (§2.1).
   */
  CALL_SESSIONS: callSessionsSchema.optional(),
  /**
   * Calls v3 kill switch (#170 §12.4): "1"/"true" restores the legacy inbound
   * handlers for emergencies — the webhook router routes inbound events to the
   * legacy path and never calls the DO, /state serves row derivation, and the
   * DO alarm no-ops (re-arming a coarse re-check). OPTIONAL: unset = the v3
   * path is live (the default posture once the binding is present).
   */
  CALLS_V3_LEGACY: z.string().optional(),
  /**
   * #211 outbound-sessions flag: set to "1"/"true" to let POST /v1/calls/browser
   * mint the server session id S, store it bound to the nonce, embed it as the
   * 4-part client_state `oc_customer|<customer>|<nonce>|<S>`, and return it — so
   * the outbound leg becomes a first-class CallSessionDO session with transfer/
   * consult parity. OPTIONAL and defaulted OFF (unset = today's exact 3-part
   * legacy outbound flow, no call_session_id in the response), so the whole
   * feature stays DARK until the founder enables it. Gated in tandem with
   * callsV3Active(env): a global v3 kill (CALLS_V3_LEGACY) also suppresses
   * 4-part minting, so a global kill never hands the client a dead affordance.
   */
  CALLS_OUTBOUND_V3: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Raw bindings exactly as the Workers runtime hands them to `fetch`/`scheduled`. */
export type Bindings = Record<string, unknown>;

const validated = new WeakMap<object, Env>();

/**
 * Validate and return the Worker environment. The runtime passes the same
 * bindings object to every invocation within an isolate, so keying the cache
 * on that object makes validation once-per-isolate. Missing or invalid
 * configuration fails loudly, naming every offending key (SPEC §3).
 */
export function getEnv(bindings: Bindings): Env {
  const cached = validated.get(bindings);
  if (cached !== undefined) return cached;

  const result = envSchema.safeParse(bindings);
  if (!result.success) {
    const keys = [
      ...new Set(result.error.issues.map((issue) => issue.path.join("."))),
    ];
    throw new Error(
      `Environment validation failed. Missing or invalid bindings: ${keys.join(", ")}`,
    );
  }

  validated.set(bindings, result.data);
  return result.data;
}
