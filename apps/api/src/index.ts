import { INTERNAL_ERROR_CODE, INTERNAL_ERROR_STATUS } from "@loonext/shared";
import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { sweepDeletedAttachments } from "./attachments/sweep";
import { companyContext } from "./auth/company";
import { jwtAuth } from "./auth/jwt";
import { runGraceJob } from "./billing/grace";
import { runSubscriptionReconcileJob } from "./billing/reconcile";
import { runUsageAlertsJob } from "./billing/usage-alerts";
import type { AppEnv } from "./context";
import { getEnv, type Bindings, type Env } from "./env";
import { geocodeContactsJob } from "./geocode/geocode-contacts";
import { ApiError, errorResponse } from "./http/errors";
import {
  failStuckOutboundSends,
  reportUnreportedUsage,
  sweepWebhookEvents,
} from "./messaging/crons";
import { sentryOptions } from "./observability/sentry";
import { attachmentsRoutes } from "./routes/attachments";
import { billingRoutes } from "./routes/billing";
import { companiesRoutes } from "./routes/companies";
import { composeRoutes } from "./routes/compose";
import { contactRoutes } from "./routes/contact";
import { contactsRoutes } from "./routes/contacts";
import { conversationsRoutes } from "./routes/conversations";
import { forYouRoutes } from "./routes/for-you";
import { meRoutes } from "./routes/me";
import { messageRoutes } from "./routes/messages";
import { notificationsRoutes } from "./routes/notifications";
import { numbersRoutes } from "./routes/numbers";
import { portingRoutes } from "./routes/porting";
import { registrationRoutes } from "./routes/registration";
import { searchRoutes } from "./routes/search";
import { tagsRoutes } from "./routes/tags";
import { tasksRoutes } from "./routes/tasks";
import { teamRoutes } from "./routes/team";
import { templatesRoutes } from "./routes/templates";
import { textEnablementRoutes } from "./routes/text-enablement";
import { usageRoutes } from "./routes/usage";
import { pollPortRequests } from "./telnyx/porting";
import { reconcileNumbers } from "./telnyx/provisioning";
import { reconcileTextEnablement } from "./telnyx/text-enablement";
import { reconcileVoiceEnablement } from "./telnyx/voice";
import {
  nudgeSoleProprietorOtp,
  pollRegistrations,
  retryCampaignAssignments,
} from "./telnyx/registration";
import { stripeWebhookRoute } from "./webhooks/stripe";
import { telnyxWebhookRoute } from "./webhooks/telnyx";

export const app = new Hono<AppEnv>();

/**
 * /v1 middleware chain (SPEC §7, §10), in exactly this order:
 *
 *   1. CORS      — exact origin from APP_ORIGIN only, enumerated methods and
 *                  headers, no wildcard. First so preflights (which carry no
 *                  Authorization header) are answered before auth.
 *   2. JWT       — local ES256 verification against the Supabase JWKS.
 *   3. company   — X-Company-Id validated against company_members for the
 *                  verified sub (exempt: GET /v1/me, POST /v1/companies,
 *                  POST /v1/invites/accept).
 *
 * /health stays outside the chain (unauthenticated liveness). /webhooks/* is
 * mounted OUTSIDE the chain: webhook routes authenticate by provider
 * signature — Telnyx Ed25519 / Stripe HMAC — not JWT, and they must never
 * carry CORS headers (SPEC §7).
 */
app.use(
  "/v1/*",
  cors({
    origin: (origin, c) => (origin === getEnv(c.env).APP_ORIGIN ? origin : null),
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    allowHeaders: [
      "Authorization",
      "X-Company-Id",
      "Idempotency-Key",
      "Content-Type",
    ],
  }),
);
app.use("/v1/*", jwtAuth());
app.use("/v1/*", companyContext());

app.get("/health", (c) => {
  // A misconfigured Worker must fail loudly, not serve a healthy-looking 200.
  getEnv(c.env);
  return c.json({ ok: true });
});

/**
 * The /v1 surface (SPEC §7). Every sub-app sits behind the CORS → JWT →
 * company-context chain above. Mount order matters in ONE place: compose
 * (POST /v1/conversations, the outbound-first creation flow) registers before
 * the general conversations router, so the POST resolves to compose while
 * every other /v1/conversations/* route falls through to the general router.
 */
app.route("/v1", meRoutes);
app.route("/v1", companiesRoutes);
app.route("/v1/billing", billingRoutes);
app.route("/v1", usageRoutes);
app.route("/v1/numbers", numbersRoutes);
app.route("/v1/port-requests", portingRoutes);
app.route("/v1/text-enablements", textEnablementRoutes);
app.route("/v1/registration", registrationRoutes);
app.route("/v1", composeRoutes); // POST /v1/conversations — before conversationsRoutes
app.route("/v1", conversationsRoutes);
app.route("/v1", tasksRoutes); // D17 tasks + GET /v1/conversations/:id/tasks
app.route("/v1", messageRoutes);
app.route("/v1", attachmentsRoutes);
app.route("/v1", contactsRoutes);
app.route("/v1", tagsRoutes);
app.route("/v1", templatesRoutes);
app.route("/v1", searchRoutes);
app.route("/v1", teamRoutes);
app.route("/v1", notificationsRoutes);
app.route("/v1", forYouRoutes); // D23 GET /v1/for-you home read-model

/**
 * Webhooks (SPEC §7): unversioned, outside the JWT/CORS chain — the provider
 * signature IS the authentication, and no CORS headers are ever emitted here
 * (the CORS middleware above is scoped to /v1/*).
 */
app.route("/webhooks/telnyx", telnyxWebhookRoute);
app.route("/webhooks/stripe", stripeWebhookRoute);

/**
 * PUBLIC POST /contact (marketing contact form): unversioned and outside the
 * JWT/company chain — there is no user session on the marketing site. Its
 * abuse posture (honeypot, per-IP rate limit, optional Turnstile, global
 * daily cap) and its own APP_ORIGIN-exact CORS live in routes/contact.ts.
 */
app.route("/", contactRoutes);

app.notFound((c) => errorResponse(c, "not_found", "No such route."));

app.onError((error, c) => {
  // A thrown error unwinds past the CORS middleware before its post-`next()`
  // header pass runs, so this response would otherwise ship WITHOUT
  // Access-Control-Allow-Origin — which the browser reports as a "CORS error",
  // masking the real 4xx/5xx (e.g. a transient failure looks like a CORS bug).
  // Re-echo the request origin here, only when it is an allowed one, so the
  // client can read the SPEC §7 envelope and show the actual message. Wrapped
  // defensively: onError must never itself throw.
  try {
    const origin = c.req.header("origin");
    if (origin) {
      const env = getEnv(c.env);
      if (origin === env.APP_ORIGIN || origin === env.SITE_ORIGIN) {
        c.header("Access-Control-Allow-Origin", origin);
        c.header("Vary", "Origin");
      }
    }
  } catch {
    // Env unavailable (should not happen after a healthy boot) — still return
    // the envelope below; the client just cannot read it cross-origin.
  }

  if (error instanceof ApiError) {
    return errorResponse(c, error.code, error.message);
  }
  // Log + report the real error server-side (IDs only, never message bodies —
  // SPEC §10; the Sentry event passes through the §10 beforeSend scrubber);
  // clients get the stable envelope shape without internals. SPEC §7 defines
  // no 500 code, so the shared INTERNAL_ERROR_CODE fallback is used here.
  console.error("unhandled error:", error);
  Sentry.captureException(error);
  return c.json(
    { error: { code: INTERNAL_ERROR_CODE, message: "Something went wrong." } },
    INTERNAL_ERROR_STATUS,
  );
});

type ScheduledJob = (env: Env, now: Date) => Promise<unknown>;

/**
 * SPEC §11 cron table — one entry per wrangler.jsonc trigger, in §11 order.
 * Every job is idempotent and clock-injected where it needs a clock, so the
 * trigger's own scheduledTime is passed through. Exported so tests can assert
 * this map stays in lockstep with wrangler.jsonc and the §11 schedule set.
 */
export const CRON_JOBS: Record<string, readonly ScheduledJob[]> = {
  // Webhook sweeper: replay unprocessed webhook_events (both providers).
  // Piggybacked on the same cadence (#20): fail out outbound rows stuck
  // 'queued' with no telnyx_message_id (a send that crashed before the
  // Telnyx call) so they surface as retryable failures.
  "*/5 * * * *": [sweepWebhookEvents, failStuckOutboundSends],
  // Provisioning retry & reconcile: resume provisioning/provision_failed
  // numbers, adopt crash-after-buy orphans, re-run failed §4.4 R3 campaign
  // number-assignments. Also reclaims soft-deleted attachment objects/rows past
  // the signed-URL grace window (D19 §2 sweep) — piggybacks this 15-min cadence,
  // comfortably longer than the 300s signed-URL TTL.
  "*/15 * * * *": [
    reconcileNumbers,
    retryCampaignAssignments,
    sweepDeletedAttachments,
    // Keep-your-number hosted text-enablement: poll in-flight orders and flip
    // the number active once the carrier finishes (webhooks primary; fallback).
    reconcileTextEnablement,
    // Missed-call voice binding: enable voice on any active, un-bound number
    // whose company has MCTB/forwarding on (covers enable-before-active,
    // later-added numbers, and settings-time enables that failed transiently).
    reconcileVoiceEnablement,
  ],
  // Usage re-reporter, then the 80%/100% usage-alert check (§9 metering
  // pipeline tail) over the freshly-reported state.
  "0 * * * *": [reportUnreportedUsage, runUsageAlertsJob],
  // Sole-prop OTP nudge (≥12h outstanding, once per submission).
  "30 * * * *": [nudgeSoleProprietorOtp],
  // Contact geocoding backfill (D25): geocode addressed contacts via Nominatim,
  // rate-limited (1 req/s) and cached to contacts.lat/lng; skips already-
  // geocoded and not-found rows. Off-peak from the other hourly jobs.
  "20 * * * *": [geocodeContactsJob],
  // Registration poller (webhooks are primary; this is the D2 fallback).
  "0 13 * * *": [pollRegistrations],
  // Port reconcile & resume (PORTING.md §5.2): poll in-flight porting orders,
  // apply missed status/messaging transitions, resume stalled sagas, and
  // recover messaging exceptions (webhooks primary, this is the fallback).
  "10 13 * * *": [pollPortRequests],
  // Grace & release: day-1/15/27 warnings, day-30 release + campaign
  // deactivation.
  "0 14 * * *": [runGraceJob],
  // Subscription reconcile: re-mirror non-active companies from Stripe;
  // report stale invites.
  "0 15 * * *": [runSubscriptionReconcileJob],
};

const handler = {
  fetch: app.fetch,

  /**
   * Cron entry point (SPEC §11): validate the environment (a misconfigured
   * Worker fails loudly on its first trigger), then run every job mapped to
   * the schedule that fired. Jobs on a shared trigger run sequentially but
   * fail independently — one job's failure never starves its siblings, and
   * the run still rejects so Sentry (which wraps scheduled()) records it.
   */
  async scheduled(controller, env) {
    const validated = getEnv(env);
    const jobs = CRON_JOBS[controller.cron];
    if (!jobs) {
      throw new Error(
        `No scheduled jobs are mapped to cron "${controller.cron}" — wrangler.jsonc and CRON_JOBS are out of sync.`,
      );
    }
    const now = new Date(controller.scheduledTime);

    const failures: unknown[] = [];
    for (const job of jobs) {
      try {
        await job(validated, now);
      } catch (cause) {
        failures.push(cause);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `cron "${controller.cron}": ${failures.length} of ${jobs.length} job(s) failed`,
      );
    }
  },
} satisfies ExportedHandler<Bindings>;

/**
 * Sentry wraps the whole Worker (fetch + scheduled) with the SPEC §10
 * beforeSend/beforeBreadcrumb PII scrubbing configured in
 * observability/sentry.ts.
 */
export default Sentry.withSentry(sentryOptions, handler);
