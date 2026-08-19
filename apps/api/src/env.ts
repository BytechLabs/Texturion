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
 * #214: the Cloudflare Workers AI binding surface — the narrow slice the
 * task-enrichment path uses (a single text-generation `run`). Typed locally (not
 * from the strict global `Ai` union) so we depend only on `.run(model, inputs)`
 * and treat every model output as untrusted `unknown` (parsed + schema-validated
 * downstream). The envSchema strips unknown keys, so the z.custom is required.
 */
export interface WorkersAi {
  run(
    model: string,
    inputs: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
}

const workersAiSchema = z.custom<WorkersAi>(
  (value) => typeof (value as WorkersAi | null | undefined)?.run === "function",
);

/**
 * An origin URL with any trailing slash stripped. Browsers send the `Origin`
 * request header WITHOUT a trailing slash, so origin-equality checks (CORS:
 * `origin === APP_ORIGIN`, the contact-form allow-list) silently reject every
 * request if a config value carries one — and `z.url()` happily accepts
 * `https://app.loonext.com/`. Normalizing here, where every origin var flows
 * through, makes a stray slash a non-issue instead of a total outage.
 */
const originUrl = () => z.url().transform((value) => value.replace(/\/+$/, ""));

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
  /**
   * #224/D133: the signing secret for the CONNECT endpoint — events about a
   * customer's own Stripe account rather than about ours.
   *
   * Stripe registers "events on your account" and "events on connected
   * accounts" as separate endpoints with separate secrets, even when both point
   * at the same URL, so text-to-pay needs a second one. Optional, and that is
   * deliberate: unset means the Worker refuses connected-account deliveries
   * exactly as it did before this feature existed, rather than starting up in a
   * state where it would accept them unverified.
   */
  STRIPE_CONNECT_WEBHOOK_SECRET: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1),
  SENTRY_DSN: z.url(),
  /**
   * The git SHA this Worker was built from — stamped by the Deploy workflow
   * (`wrangler deploy --var GIT_SHA:<head_sha>`) and reported to Sentry as the
   * release, so a production error maps to the exact commit that shipped it
   * (and Sentry can flag regressions + suspect commits). Optional: local dev,
   * tests, and a manual `wrangler deploy` boot without it, and Sentry simply
   * falls back to an untagged release rather than the Worker failing to start.
   */
  GIT_SHA: z.string().min(1).optional(),
  /**
   * Set to "1" only in `.dev.vars`, which nothing but `wrangler dev` loads, to
   * mark this Worker as somebody's laptop. It silences crash reporting: a local
   * failure is already on the terminal in front of the person causing it, and a
   * developer mid-migration produces errors that read exactly like a production
   * incident in the issue stream.
   *
   * Deliberately a POSITIVE marker rather than inferring local from a missing
   * GIT_SHA: a manual `wrangler deploy` also has no SHA, and inferring would
   * silently take production's error reporting down with it. Absent means
   * report.
   */
  LOCAL_DEV: z.literal("1").optional(),
  APP_ORIGIN: originUrl(),
  /** Public origin of THIS Worker (webhook callback URLs, e.g. Telnyx profiles). */
  API_ORIGIN: originUrl(),
  /**
   * Canonical MARKETING origin (D27 host split), e.g. `https://loonext.com`.
   * The public /contact form is served from here, a DIFFERENT origin than the
   * app (APP_ORIGIN = app.loonext.com), so the contact CORS must allow it or
   * every real submission is blocked. Optional: unset (single-host dev/deploy,
   * where marketing is same-origin with APP_ORIGIN) falls back to APP_ORIGIN.
   */
  SITE_ORIGIN: originUrl().optional(),
  /** Resend sender, e.g. `Loonext <notifications@loonext.com>` (SPEC §3). */
  RESEND_FROM: z.string().min(1),
  /**
   * #252: the separate sender for mail a customer cannot afford to miss.
   * Optional — unset falls back to RESEND_FROM and nothing changes. Setting it
   * requires a second authenticated subdomain, which is a DNS action.
   */
  RESEND_FROM_CRITICAL: z.string().min(1).optional(),
  /** #121: ops recipient for abuse alerts (storage tiers). Optional — unset
   * falls back to support@loonext.com, which routes to the founder. */
  OPS_ALERT_EMAIL: z.string().min(3).optional(),
  /**
   * #308: the synthetic inbound canary's number pair, in E.164.
   *
   * BOTH OPTIONAL, and the canary is off unless both are set — a from with no
   * to is not half a canary, it is a text to nowhere. The destination must be
   * a number this platform owns; the job checks and refuses otherwise, which
   * is what makes this the one send path that may skip the §5 gates.
   *
   * Cost when enabled: one segment out plus one segment in per hourly run,
   * ~1.7c, capped by MAX_UNANSWERED_PER_DAY once the path is known broken.
   */
  CANARY_FROM_E164: z.string().min(8).optional(),
  CANARY_TO_E164: z.string().min(8).optional(),
  /**
   * Reply-To stamped on EVERY Resend send (email-hardening: alert copy says
   * "just reply to this email", so replies must land in a monitored inbox
   * rather than the unmonitored sender). Production sets it to
   * `support@loonext.com` (docs/deploy/10-email-inbox.md routes that address).
   *
   * OPTIONAL, but unset no longer means NO Reply-To (#252): `resend.ts` falls
   * back to the shared SUPPORT_EMAIL. It used to send none, which quietly made
   * five customer-facing emails false — including the workspace-deletion pair,
   * whose only stated way to undo an irreversible close is to reply. Whether
   * that instruction worked depended on whether somebody had wired a secret,
   * and nothing failed or warned when they had not.
   *
   * So this variable now OVERRIDES a working default rather than enabling the
   * feature. Set it when support is routed somewhere other than support@.
   * Per-send `replyTo` (contact form → submitter) still overrides both.
   */
  RESEND_REPLY_TO: z.string().min(1).optional(),
  /**
   * #386: the Svix signing secret for the Resend webhook. OPTIONAL, but the
   * endpoint refuses every request without it rather than trusting an unsigned
   * body — an unauthenticated bounce feed would let anybody suppress any
   * address in the product.
   */
  RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),
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
   * #400/D107 — the prepaid year. A ONE-TIME price plus a 100%-off coupon
   * applied to the licensed subscription item for twelve months; see D107 for
   * why the three obvious alternatives (an annual interval, a customer-balance
   * credit, two subscriptions) are each wrong for a metered subscription.
   *
   * ALL THREE OPTIONAL, and that is the feature flag: with any of them unset
   * the offer does not exist — eligibility reports not_provisioned and the
   * route 409s. A half-provisioned catalog must not sell a year it cannot
   * deliver, and the coupon is as load-bearing as the price.
   */
  STRIPE_STARTER_YEAR_PRICE_ID: z.string().min(1).optional(),
  STRIPE_PRO_YEAR_PRICE_ID: z.string().min(1).optional(),
  STRIPE_PREPAID_YEAR_COUPON_ID: z.string().min(1).optional(),
  /**
   * #277 — the seasonal pause. A recurring LICENSED price that replaces the
   * plan's licensed price on the same subscription: the workspace keeps its
   * number, its history and its 10DLC registration, stops being able to send,
   * and pays a holding fee instead of a plan.
   *
   * OPTIONAL, and that is the feature flag, exactly as the prepaid year above:
   * with it unset the offer does not exist — eligibility reports
   * not_provisioned and the route 409s. It FAILS CLOSED in the strong sense —
   * no price means no pause, never a free one — because the alternative
   * ("pause them anyway and sort the billing out later") is a workspace holding
   * a number and a campaign we pay FIXED_MONTHLY_COST_CENTS for, every month,
   * against no revenue at all.
   *
   * ONE price, not one per plan. The pause is a hold on the number, and a
   * paused Starter and a paused Pro cost us the same thing to hold; `plan` is
   * untouched throughout and is what they resume onto.
   *
   * The AMOUNT is not ours to pick — the founder provisions the price and this
   * variable names it. Nothing in this codebase hardcodes what a pause costs.
   */
  STRIPE_PAUSE_PRICE_ID: z.string().min(1).optional(),
  /**
   * #399 — the free month a referral earns, for each side. 100% off the
   * LICENSED line once, exactly like the prepaid year but for a single month,
   * so a free month covers the plan fee and never the metered overage the
   * carrier already charged us for.
   *
   * OPTIONAL: unset means referrals still record and still show, but nothing
   * pays out. That is the honest half-state for a feature whose accounting
   * should exist before its money does.
   */
  STRIPE_REFERRAL_MONTH_COUPON_ID: z.string().min(1).optional(),
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
   * #243 item 4: the per-KEY ceiling on the public API.
   *
   * "An integration that polls every second must cost the workspace something
   * or it costs us." Keyed on the api_key id rather than the company, so one
   * runaway connector cannot starve the workspace's other integrations — the
   * blast radius of a bad script is the script.
   *
   * OPTIONAL, like its neighbours: absent in local dev and tests, where the
   * gate is skipped. That is safe here because the limiter bounds COST rather
   * than authority; nothing about who may reach what depends on it.
   */
  PUBLIC_API_RATE_LIMITER: rateLimiterSchema.optional(),
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
   * #513: the number picker's own limiter, separate from VERIFY's 3/minute.
   *
   * Browsing for a number is a read; an OTP send is money. Sharing one budget
   * meant three refreshes locked somebody out mid-purchase.
   */
  NUMBER_SEARCH_RATE_LIMITER: rateLimiterSchema.optional(),
  /**
   * #251: the same searches, bounded across the whole ACCOUNT.
   *
   * The limiter above bounds one caller and does nothing about the aggregate,
   * because two customers shopping in the same second are not one caller —
   * while Telnyx's number-management bucket is shared by all of them. Measured
   * at 5 requests per second, the tightest bucket we touch anywhere.
   *
   * Optional like every other limiter: absent in dev and tests, where there is
   * no fleet to bound.
   */
  NUMBER_SEARCH_FLEET_LIMITER: rateLimiterSchema.optional(),
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
   * #214 task enrichment: the Cloudflare Workers AI binding (wrangler.jsonc
   * `"ai": { "binding": "AI" }`). OPTIONAL so every existing test fixture and
   * local dev boot without it — the enrichment endpoint degrades to "no
   * enrichment" when absent and NEVER blocks task creation.
   */
  AI: workersAiSchema.optional(),
  /**
   * #214: per-company burst limiter on the AI enrichment endpoint (a
   * "ratelimit" unsafe binding like SEND_RATE_LIMITER). Enrichment also has a
   * hard monthly cap in the DB (company_ai_usage); this bounds bursts. OPTIONAL:
   * absent in local dev/tests → the burst gate is skipped (the monthly cap still
   * applies).
   */
  AI_ENRICH_RATE_LIMITER: rateLimiterSchema.optional(),
  /**
   * Per-company burst limiter on the reply-suggestion endpoint (POST
   * /v1/conversations/:id/reply-suggestions). Suggestions also have a hard
   * monthly cap in the DB (company_ai_usage); this bounds bursts. OPTIONAL:
   * absent in local dev/tests → the burst gate is skipped (the cap still
   * applies).
   */
  AI_REPLY_RATE_LIMITER: rateLimiterSchema.optional(),
  /**
   * The same AI spend bounded per MEMBER, keyed on company + user.
   *
   * The monthly caps are a COMPANY ceiling, which is right, but they let one
   * member spend the whole crew's month: a runaway client, a stuck retry, or a
   * stolen token could exhaust every draft and enrichment for everyone else,
   * and the cap alert was the first anyone heard of it. OPTIONAL, like the
   * others.
   */
  AI_MEMBER_RATE_LIMITER: rateLimiterSchema.optional(),
  /**
   * Burst limiter for voicemail transcription, keyed on company + user. It is
   * the most expensive AI call in the product (a whole recording, a 20s
   * timeout) and had no burst gate at all: only the monthly cap and the
   * once-per-recording guard stood between opening voicemails in a row and the
   * cap. OPTIONAL, like the others.
   */
  AI_TRANSCRIBE_RATE_LIMITER: rateLimiterSchema.optional(),
  /**
   * #261: burst limiter on the signed-URL mint routes, keyed on company + user.
   * The egress ledger is now per object rather than per request, so looping one
   * attachment no longer spends the workspace's allowance — but a mint is still
   * a lookup, an access check and a claim RPC per call, and nothing bounded how
   * fast one member could ask. This bounds the request rate; the per-object
   * claim bounds the cost. OPTIONAL, like the others.
   */
  ATTACHMENT_URL_RATE_LIMITER: rateLimiterSchema.optional(),

  /**
   * #581/#586 — the checkout burst limit, keyed on IP, brought into the repo.
   *
   * `SPEC.md` §"Front door" has documented "Cloudflare WAF rate-limiting rule on
   * `/v1/billing/checkout` (10 req/min/IP)" for months. On 2026-08-09 I sent 40
   * back-to-back unauthenticated POSTs to that path from one IP: 39 answered 401
   * and one connection reset. No 429, ever. The rule is not in effect.
   *
   * The point is not the missing rule; it is that nobody could tell. A control that
   * lives only in a dashboard cannot be read from a clone, cannot be reviewed in a
   * diff, and cannot be tested — so a documented protection and an absent one look
   * identical from here, which is how this went unnoticed. The Worker's own limiter
   * bindings are the opposite of that in every respect, so the limit lives here now
   * and the doc says what the code does.
   *
   * 10/60s matches the number the spec already promised. Keyed on IP rather than on
   * the company, because a checkout attempt is how somebody who has no subscription
   * yet gets one — the account exists but there is nothing per-tenant to bound.
   *
   * OPTIONAL, like every other limiter here: absent binding → gate skipped, so dev
   * and tests behave as they always have.
   */
  CHECKOUT_RATE_LIMITER: rateLimiterSchema.optional(),

  /**
   * #335: the public-link surface (D75). Unauthenticated by design, so keyed
   * on IP — there is no account to key on. Optional in src/env.ts → dev/tests
   * skip it, like every other limiter here.
   */
  PUBLIC_LINK_RATE_LIMITER: rateLimiterSchema.optional(),

  /**
   * #248: the contact importers (CSV and vCard), keyed on company.
   *
   * Import is the one route where a customer hands us unbounded input. Rows
   * and bytes were capped per request and the REQUESTS were not, so two
   * thousand rows of reads-plus-upserts could be replayed as fast as the
   * network allowed. Optional, like every other limiter here.
   */
  CONTACT_IMPORT_RATE_LIMITER: rateLimiterSchema.optional(),
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
