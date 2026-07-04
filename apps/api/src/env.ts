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
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  SENTRY_DSN: z.url(),
  APP_ORIGIN: z.url(),
  /** Public origin of THIS Worker (webhook callback URLs, e.g. Telnyx profiles). */
  API_ORIGIN: z.url(),
  /** Resend sender, e.g. `JobText <notifications@jobtext.app>` (SPEC §3). */
  RESEND_FROM: z.string().min(1),
  /**
   * Web Push VAPID key pair as Worker secrets (SPEC §8). Standard encoding
   * (`npx web-push generate-vapid-keys`): base64url uncompressed P-256 point
   * (65 bytes) and base64url private scalar (32 bytes).
   */
  VAPID_PUBLIC_KEY: z.string().min(1),
  VAPID_PRIVATE_KEY: z.string().min(1),
  // Stripe catalog ids printed by `pnpm stripe:setup` (SPEC §9: the catalog is
  // created by a checked-in setup script, ids stored as env config).
  STRIPE_STARTER_PRICE_ID: z.string().min(1),
  STRIPE_PRO_PRICE_ID: z.string().min(1),
  STRIPE_STARTER_OVERAGE_PRICE_ID: z.string().min(1),
  STRIPE_PRO_OVERAGE_PRICE_ID: z.string().min(1),
  STRIPE_US_FEE_PRICE_ID: z.string().min(1),
  /** Billing Meter `event_name` (SPEC §9: 'sms_segments'). */
  STRIPE_SMS_METER_EVENT_NAME: z.string().min(1),
  /**
   * PostHog Cloud project API key (SPEC §12 step 18 product analytics).
   * OPTIONAL: when unset (local dev, tests) every analytics capture is a
   * silent no-op — see src/analytics/posthog.ts.
   */
  POSTHOG_API_KEY: z.string().min(1).optional(),
  /**
   * The per-company outbound rate limiter (SPEC §10 layer 3: ~1 msg/s),
   * declared in wrangler.jsonc as a "ratelimit" unsafe binding. Workers rate
   * limiting only supports 10s/60s periods, so 1 msg/s is configured as
   * limit=10 per period=10s — the same average rate with small bursts.
   * OPTIONAL: absent in local dev/tests → the dispatch-time gate is skipped.
   */
  SEND_RATE_LIMITER: rateLimiterSchema.optional(),
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
