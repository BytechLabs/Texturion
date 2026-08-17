import { INTERNAL_ERROR_CODE, INTERNAL_ERROR_STATUS } from "@loonext/shared";
import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { securityHeaders } from "./http/security-headers";
import { sweepDeletedAttachments } from "./attachments/sweep";
import { runDeliveryByCountryJob } from "./messaging/delivery-by-country";
import { companyContext } from "./auth/company";
import { CallSessionDO as CallSessionDOImpl } from "./calls/session-do";
import { jwtAuth } from "./auth/jwt";
import { runGraceJob } from "./billing/grace";
import { sweepUncreditedConversions } from "./billing/prepay";
import { runSubscriptionReconcileJob } from "./billing/reconcile";
import {
  runOverageDigestJob,
} from "./billing/overage-warning";
import { runProbes } from "./observability/probes";
import { runResponseTimeRecapJob } from "./reports/monthly-recap";
import {
  runOverageWarningJob,
} from "./billing/overage-warning";
import { runUsageAlertsJob } from "./billing/usage-alerts";
import type { AppEnv } from "./context";
import { getEnv, type Bindings, type Env } from "./env";
import { geocodeContactsJob } from "./geocode/geocode-contacts";
import { geocodeTasksJob } from "./geocode/geocode-tasks";
import { runLeadChaseJob } from "./notifications/lead-chase";
import { runScheduledSendJob } from "./messaging/scheduled-send";
import { runBatchFlush } from "./notifications/batch-flush";
import { runDailySummary } from "./notifications/daily-summary";
import { runEscalationSweep } from "./notifications/escalation-sweep";
import { runNumberHealthJob } from "./messaging/number-health";
import { runRegistrationStallJob } from "./telnyx/registration-stalls";
import { runActivationStallJob } from "./analytics/activation-stall";
import { runCallSilenceJob } from "./calls/call-silence";
import { runIdentityRetentionJob } from "./telnyx/identity-retention";
import {
  runContactRetentionJob,
  runMarketingContactRetentionJob,
} from "./marketing/contact-retention";
import { runCarrierCeilingJob } from "./billing/carrier-ceiling";
import { retryInterruptedSends } from "./messaging/retry-interrupted";
import { runAupWatchJob } from "./messaging/aup-watch";
import { runRetentionEnforceJob } from "./workspace/retention-enforce";
import { runRetentionNoticeJob } from "./workspace/retention-notice";
import { runInboundCanaryJob } from "./observability/inbound-canary";
import { runDoSentryCanaryJob } from "./observability/do-sentry-canary";
import { runLivenessCheckJob } from "./observability/liveness-check";
import {
  recordHeartbeatBestEffort,
  type CronSchedule,
  type JobKey,
} from "./observability/liveness";
import { notifyDueTasksJob } from "./tasks/due-notice";
import {
  ApiError,
  errorResponse,
  internalErrorResponse,
} from "./http/errors";
import {
  failStuckOutboundSends,
  pruneWebhookEvents,
  pruneWidgetVerifications,
  reportUnreportedUsage,
  reportUnreportedVoiceUsage,
  sweepStaleCalls,
  sweepWebhookEvents,
} from "./messaging/crons";
import {
  deliverOutboundWebhooks,
  pruneWebhookDeliveries,
} from "./webhooks/outbound-deliver";
import { reconcileOptOuts } from "./messaging/opt-out-reconcile";
import { sentryOptions } from "./observability/sentry";
import { attachmentsRoutes } from "./routes/attachments";
import { availableNumbersRoutes } from "./routes/available-numbers";
import { billingRoutes } from "./routes/billing";
import { callsRoutes } from "./routes/calls";
import { liveCallsRoutes } from "./routes/live-calls";
import { webrtcRoutes } from "./routes/webrtc";
import { companiesRoutes } from "./routes/companies";
import { composeRoutes } from "./routes/compose";
import { contactRoutes } from "./routes/contact";
import { marketingRoutes } from "./routes/marketing";
import { widgetRoutes } from "./routes/widget";
import { contactsRoutes } from "./routes/contacts";
import { conversationsRoutes } from "./routes/conversations";
import { devicePushTokensRoutes } from "./routes/device-push-tokens";
import { forYouRoutes } from "./routes/for-you";
import { blockedSendersRoutes } from "./routes/blocked-senders";
import { spamReviewRoutes } from "./routes/spam-review";
import { meRoutes } from "./routes/me";
import { mfaRoutes } from "./routes/mfa";
import { messageRoutes } from "./routes/messages";
import { notificationsRoutes } from "./routes/notifications";
import { referralRoutes } from "./routes/referrals";
import { savedViewsRoutes } from "./routes/saved-views";
import { webhooksRoutes } from "./routes/webhooks";
import { publicApiRoutes } from "./routes/public-api";
import { apiKeysRoutes } from "./routes/api-keys";
import { appointmentReminderRoutes } from "./routes/appointment-reminders";
import { onCallRoutes } from "./routes/on-call";
import { scheduledMessageRoutes } from "./routes/scheduled-messages";
import { numbersRoutes } from "./routes/numbers";
import { leadSourcesRoutes } from "./routes/lead-sources";
import { voicemailGreetingsRoutes } from "./routes/voicemail-greetings";
import { ownershipRoutes } from "./routes/ownership";
import { portingRoutes } from "./routes/porting";
import { registrationRoutes } from "./routes/registration";
import { searchRoutes } from "./routes/search";
import { sessionsRoutes } from "./routes/sessions";
import { pruneAuditLog } from "./audit/retention";
import { pruneUserSessions } from "./auth/session-retention";
import {
  pruneProbeResults,
  prunePublicLinkAccess,
} from "./crons/retention-prunes";
import { buildDataExports, pruneExpiredExports } from "./workspace/export";
import { purgeClosedWorkspaces } from "./workspace/purge";
import { accountRoutes } from "./routes/account";
import { appReleaseRoutes } from "./routes/app-release";
import { exportsRoutes } from "./routes/exports";
import { auditLogRoutes } from "./routes/audit-log";
import { workspaceClosureRoutes } from "./routes/workspace-closure";
import { calendarFeedRoutes } from "./routes/calendar-feed";
import { calendarRoutes } from "./routes/calendar";
import { publicQuoteRoutes } from "./routes/quotes-public";
import { quotesRoutes } from "./routes/quotes";
import { tagsRoutes } from "./routes/tags";
import { tasksRoutes } from "./routes/tasks";
import {
  jobPhotoShareRoutes,
  publicJobPhotoRoutes,
} from "./routes/job-photos";
import {
  paymentAccountRoutes,
  paymentRequestRoutes,
  publicPaymentRoutes,
} from "./routes/payments";
import { teamRoutes } from "./routes/team";
import { templatesRoutes } from "./routes/templates";
import { textEnablementRoutes } from "./routes/text-enablement";
import { reportsRoutes } from "./routes/reports";
import { usageRoutes } from "./routes/usage";
import { expirePaymentRequests } from "./crons/payment-requests";
import { pollPortRequests } from "./telnyx/porting";
import { reconcileNumbers, sweepStuckProvisioning } from "./telnyx/provisioning";
import { reconcileTextEnablement } from "./telnyx/text-enablement";
import { reconcileVoiceEnablement } from "./telnyx/voice";
import {
  nudgeSoleProprietorOtp,
  pollRegistrations,
  retryCampaignAssignments,
} from "./telnyx/registration";
import { runEmailHealthJob } from "./email/health";
import { resendWebhookRoute } from "./webhooks/resend";
import { stripeWebhookRoute } from "./webhooks/stripe";
import { telnyxWebhookRoute } from "./webhooks/telnyx";

export const app = new Hono<AppEnv>();

/**
 * #586 — security headers on EVERY response, before anything else is mounted.
 *
 * `"*"` rather than `/v1/*` deliberately: the measurement that opened this found a
 * bare `/health` as well as a bare `/v1`, and the webhook routes are mounted outside
 * the /v1 chain entirely. A header set that covers most of a Worker is a header set
 * somebody has to reason about per route.
 *
 * Registered FIRST so it wraps every later handler, and it only fills in headers a
 * route has not set for itself — the two that deliberately differ are named in the
 * module.
 */
app.use("*", securityHeaders());

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
      // #236: which app is calling, so the signed-in-devices list can say
      // "web browser" rather than guess from a user agent string.
      "X-Client",
      // #339: which build. Without it a shipped fix has no adoption curve and
      // "everyone has it" is a hope rather than a number.
      "X-App-Version",
    ],
    // Let the browser cache the preflight for a day so the SPA doesn't re-issue
    // an OPTIONS round-trip before every /v1 call (the allowed methods/headers
    // are static). Purely a latency + request-count win; no header is widened.
    maxAge: 86400,
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
 * #339 — the update policy, and it is PUBLIC on purpose.
 *
 * Deliberately outside /v1, so it never passes through the JWT chain. The
 * reason we would ever demand an update is that something is broken in the old
 * build — and one of the known candidates is #268, which signs the user out on
 * a transient token-refresh failure. An update gate that only clients with a
 * working session can read is a gate that opens for everyone who does not need
 * it and stays shut to everyone who does.
 *
 * Nothing here is sensitive: three version strings and a store URL, which
 * every copy of the app learns on first launch anyway.
 */
app.route("/", appReleaseRoutes);
// #294 — the page a customer opens with no account. Mounted at the ROOT, not
// under /v1, because /v1 is where the auth middleware lives: a public route
// under it would either be refused or would need an exemption, and an
// exemption inside an authed prefix is the kind of thing that gets copied.
app.route("/", publicJobPhotoRoutes);
// #224 — the payment page a customer opens with no account. Same reasoning as
// the photo page above: mounted at the ROOT so it never passes through the /v1
// auth middleware, rather than living under it behind an exemption.
app.route("/", publicPaymentRoutes);

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
// #245: a member manages their OWN schedule feed. The feed itself is public
// and mounted below — these are the session-bound half.
app.route("/v1", calendarRoutes);
app.route("/v1", reportsRoutes); // #239 GET /v1/reports/response-time
app.route("/v1/referrals", referralRoutes);
app.route("/v1/numbers", numbersRoutes);
app.route("/v1/available-numbers", availableNumbersRoutes);
app.route("/v1/port-requests", portingRoutes);
app.route("/v1/text-enablements", textEnablementRoutes);
app.route("/v1/registration", registrationRoutes);
app.route("/v1", composeRoutes); // POST /v1/conversations — before conversationsRoutes
// #280: before conversationsRoutes only for tidiness — the paths do not
// overlap. Saved views are query parameters, never conversation rows.
app.route("/v1", savedViewsRoutes);
app.route("/v1", webhooksRoutes);
app.route("/v1", apiKeysRoutes);
// #243: the public surface. Mounted at the ROOT rather than under /v1 because
// it carries its own version in the path and its own credential — a shared
// prefix is how a key ends up reaching a route nobody scoped.
app.route("/", publicApiRoutes);
app.route("/v1", scheduledMessageRoutes);
app.route("/v1", appointmentReminderRoutes); // #237 reminder rules
app.route("/v1", onCallRoutes); // #244 rota + acknowledge
app.route("/v1", conversationsRoutes);
app.route("/v1", tasksRoutes); // D17 tasks + GET /v1/conversations/:id/tasks
app.route("/v1", jobPhotoShareRoutes); // #294 mint/revoke a job photo link
// #224 text-to-pay. Two routers because they are two capabilities: connecting
// the account is owner-only (it binds a bank account to the workspace), asking
// a customer for money is `conversations.send` like any other outbound text.
app.route("/v1", paymentAccountRoutes);
app.route("/v1", paymentRequestRoutes);
app.route("/v1", messageRoutes);
app.route("/v1", attachmentsRoutes);
// #309: recording lives here; SELECTING a greeting stays on the identity
// route, so one place answers "what does this line do".
app.route("/v1", voicemailGreetingsRoutes);
app.route("/v1", leadSourcesRoutes);
app.route("/v1", contactsRoutes);
app.route("/v1", accountRoutes);
app.route("/v1", exportsRoutes);
app.route("/v1", auditLogRoutes);
app.route("/v1", workspaceClosureRoutes);
app.route("/v1", tagsRoutes);
app.route("/v1", quotesRoutes);
// Outside /v1: the customer has no account and no token of ours.
app.route("/", publicQuoteRoutes);
// #245: the per-member schedule feed. Public by construction — a calendar
// client has no session and the token IS the credential.
app.route("/", calendarFeedRoutes);
app.route("/v1", templatesRoutes);
app.route("/v1", searchRoutes);
app.route("/v1", teamRoutes);
app.route("/v1", sessionsRoutes); // #236 signed-in devices, self + workspace
app.route("/v1", ownershipRoutes); // #332 handing the workspace over
app.route("/v1", mfaRoutes); // #314 second factor + recovery codes
app.route("/v1", notificationsRoutes);
app.route("/v1", devicePushTokensRoutes); // #151 native FCM/APNs token registry
app.route("/v1", forYouRoutes); // D23 GET /v1/for-you home read-model
// #342: spam marks that do not look like spam — a signal, never a notification.
app.route("/v1", spamReviewRoutes);
app.route("/v1", blockedSendersRoutes);
app.route("/v1", callsRoutes); // #129 GET /v1/calls — the call log
app.route("/v1", liveCallsRoutes); // #135 D43 phase 3 — live-call transfers
app.route("/v1", webrtcRoutes); // #135 D43 — browser softphone tokens

/**
 * Webhooks (SPEC §7): unversioned, outside the JWT/CORS chain — the provider
 * signature IS the authentication, and no CORS headers are ever emitted here
 * (the CORS middleware above is scoped to /v1/*).
 */
app.route("/webhooks/telnyx", telnyxWebhookRoute);
app.route("/webhooks/stripe", stripeWebhookRoute);
// #386: delivery outcomes for the eighteen places this product sends email.
app.route("/webhooks/resend", resendWebhookRoute);

/**
 * PUBLIC POST /contact (marketing contact form): unversioned and outside the
 * JWT/company chain — there is no user session on the marketing site. Its
 * abuse posture (honeypot, per-IP rate limit, optional Turnstile, global
 * daily cap) and its own APP_ORIGIN-exact CORS live in routes/contact.ts.
 */
app.route("/", contactRoutes);

/**
 * #312: the same posture again, for the prospects who leave without asking a
 * question. Public, no session, its own daily cap so a capture cannot run down
 * the ceiling that protects the support channel. Unsubscribe is here too and is
 * deliberately unauthenticated — the token in the email is the whole credential.
 */
app.route("/", marketingRoutes);
// #232: the website widget's public intake. Mounted beside the other public
// surfaces rather than under /v1 — there is no session, no member and no
// company context to establish, and its own five layers are what stand in for
// the chain /v1 gets.
app.route("/", widgetRoutes);

app.notFound((c) => errorResponse(c, "not_found", "No such route."));

app.onError((error, c) => {
  // A thrown error unwinds past the CORS middleware before its post-`next()`
  // header pass runs, so this response would otherwise ship WITHOUT
  // Access-Control-Allow-Origin — which the browser reports as a "CORS error",
  // masking the real 4xx/5xx (e.g. a transient failure looks like a CORS bug).
  // Re-echo the request origin here, only when it is an allowed one, so the
  // client can read the SPEC §7 envelope and show the actual message. Wrapped
  // defensively: onError must never itself throw.
  if (error instanceof ApiError) {
    return errorResponse(c, error.code, error.message);
  }
  // A real, unexpected 500. Make it observable three ways without leaking
  // internals to the client (SPEC §10):
  //   1. a rich server log with the failing route + Cloudflare ray id — shows
  //      up in `wrangler tail` and the Worker's Logs (observability is on);
  //   2. a Sentry event tagged with that route + ray (PII-scrubbed by the §10
  //      beforeSend), so it is searchable;
  //   3. a `request_id` (the ray) returned to the client, so a founder can jump
  //      straight from a failed request to the exact log/Sentry event.
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;
  const rayId = c.req.header("cf-ray") ?? undefined;
  Sentry.captureException(error, {
    tags: { route: `${method} ${path}`, ...(rayId ? { cf_ray: rayId } : {}) },
  });
  console.error(`[500] ${method} ${path} ray=${rayId ?? "-"}:`, error);
  // The client-facing half is shared with the test harness (#251), so a route
  // suite cannot pass against an error response production does not send.
  // Reading the env is wrapped because onError must never itself throw.
  let allowed: (string | undefined)[] = [];
  try {
    const env = getEnv(c.env);
    allowed = [env.APP_ORIGIN, env.SITE_ORIGIN];
  } catch {
    // Env unavailable (should not happen after a healthy boot). The envelope
    // still ships; the client just cannot read it cross-origin.
  }
  return internalErrorResponse(c, allowed);
});

type ScheduledJob = (env: Env, now: Date) => Promise<unknown>;

/**
 * A scheduled job and the liveness key that speaks for it (#333/D55).
 *
 * Pairing them here rather than in a side table is the point: there is no way
 * to register a job without declaring what its silence means, because the
 * registration IS the declaration.
 */
interface CronEntry {
  key: JobKey;
  run: ScheduledJob;
}

const job = (key: JobKey, run: ScheduledJob): CronEntry => ({ key, run });

/**
 * SPEC §11 cron table — one entry per wrangler.jsonc trigger, in §11 order.
 * Every job is idempotent and clock-injected where it needs a clock, so the
 * trigger's own scheduledTime is passed through. Exported so tests can assert
 * this map stays in lockstep with wrangler.jsonc and the §11 schedule set.
 */
/**
 * #387: keyed by `CronSchedule`, which is derived from the `cron:` entries of
 * LIVENESS_EXPECTATIONS. Adding a trigger here without first declaring what
 * its ABSENCE means does not compile — the guard lives at the point of
 * definition rather than in a doc somebody has to remember.
 */
export const CRON_JOBS: Record<CronSchedule, readonly CronEntry[]> = {
  // #388: the unanswered-lead ladder. Every minute, because the rungs are at
  // two and five and the finest existing cadence is five — a five-minute scan
  // cannot express a two-minute rung, and rounding the rung UP to fit the
  // schedule would move the reminder to the deadline it exists to beat.
  // The scan is a partial index over live clocks only, so a quiet minute costs
  // one indexed lookup returning nothing.
  "* * * * *": [
    job("job:lead-chase", runLeadChaseJob),
    // #233: send later. Every minute for the same reason as the ladder above —
    // a coarser cadence would make "8:00am" mean "some time between 8:00 and
    // 8:05", and the scan is a partial index over due rows only, so a quiet
    // minute costs one indexed lookup returning nothing.
    // #244: widen an after-hours page nobody acknowledged. Every minute for the
    // same reason as its neighbours — the grace period is the owner's own
    // number and can be as short as one minute, so a coarser cadence would
    // silently lengthen it. The scan is a partial index over rows with a live
    // deadline, so a quiet minute costs one lookup returning nothing.
    //
    // BEFORE the scheduled send, by the rule stated above: this only pushes to
    // the crew's own phones, while a scheduled send fans out to the CARRIER. A
    // Telnyx stall must not eat into somebody's ten-minute grace period.
    job("job:escalation-sweep", runEscalationSweep),
    // #297: flush the grouped notifications whose window has closed. Every
    // minute because the shortest window a member can choose is five, and a
    // coarser scan would make "every 5 minutes" mean "every 5 to 10". The
    // scan is one indexed lookup that returns nothing on almost every tick.
    //
    // AFTER the escalation sweep and BEFORE the scheduled send, by the same
    // rule as its neighbours: this only pushes to the crew's own phones, and
    // a Telnyx stall in the carrier-bound job below must not delay it.
    job("job:batch-flush", runBatchFlush),
    job("job:scheduled-send", runScheduledSendJob),
  ],
  // Webhook sweeper: replay unprocessed webhook_events (both providers).
  // Piggybacked on the same cadence (#20): fail out outbound rows stuck
  // 'queued' with no telnyx_message_id (a send that crashed before the
  // Telnyx call) so they surface as retryable failures.
  // Also flips a genuinely-stuck 'provisioning' number (a Telnyx order pending
  // past the dwell) to provision_failed so the customer reaches remediation in
  // ~10-15 min instead of waiting on the 15-min reconcile (§4.3 honest status).
  "*/5 * * * *": [
    job("job:sweep-webhooks", sweepWebhookEvents),
    // #411: BEFORE the fail-out, deliberately. A send that crashed between the
    // gate insert and the Telnyx call provably never reached the carrier, so
    // re-dispatching it cannot duplicate anything — and whatever this declines
    // gets failed out by the next job in the SAME tick rather than waiting.
    job("job:retry-interrupted-sends", retryInterruptedSends),
    job("job:fail-stuck-sends", failStuckOutboundSends),
    job("job:sweep-stuck-provisioning", sweepStuckProvisioning),
    // #243: the outbound half. Last in the tick deliberately — every job above
    // it either moves a customer's message or unsticks one, and a slow
    // integration endpoint must never be what delays them. This one talks to
    // an address a customer chose, so it is the only job here whose latency is
    // outside our control.
    job("job:deliver-outbound-webhooks", deliverOutboundWebhooks),
  ],
  // Provisioning retry & reconcile: resume provisioning/provision_failed
  // numbers, adopt crash-after-buy orphans, re-run failed §4.4 R3 campaign
  // number-assignments. Also reclaims soft-deleted attachment objects/rows past
  // the signed-URL grace window (D19 §2 sweep) — piggybacks this 15-min cadence,
  // comfortably longer than the 300s signed-URL TTL.
  "*/15 * * * *": [
    // #297: the daily summary. Every fifteen minutes rather than hourly,
    // because a member picks a wall-clock TIME and an hourly scan would
    // make 07:30 mean 08:00. Fifteen is the coarsest cadence that keeps
    // the promise legible, and the scan is a partial index over the few
    // members who opted in at all.
    job("job:daily-summary", runDailySummary),
    // #387: the liveness checker rides an existing trigger rather than taking
    // one of its own. A checker with its own schedule is one more thing that
    // can quietly stop, and the schedule it rides on is watched by the very
    // ledger it reads — so if this stops, its own absence is the alert.
    job("job:liveness-check", runLivenessCheckJob),
    // Task due-date reminders: one push to the assignee as a task comes due,
    // at most once per due date. A quarter hour is close enough to "now" for
    // a day of trade work and keeps the scan cheap.
    job("job:notify-due-tasks", notifyDueTasksJob),
    job("job:reconcile-numbers", reconcileNumbers),
    job("job:retry-campaign-assignments", retryCampaignAssignments),
    job("job:sweep-deleted-attachments", sweepDeletedAttachments),
    // #583: finish a prepaid-year conversion whose credit never reached
    // Stripe. D131 deliberately chose the failure where a customer is at
    // full price and owed a recorded amount, over one where a 100%-off
    // coupon runs on unwatched — and that choice is only defensible
    // because this runs. Fifteen minutes is the coarsest cadence that
    // still gets somebody their money back the same afternoon.
    job("job:credit-converted-prepayments", sweepUncreditedConversions),
    // Keep-your-number hosted text-enablement: poll in-flight orders and flip
    // the number active once the carrier finishes (webhooks primary; fallback).
    job("job:reconcile-text-enablement", reconcileTextEnablement),
    // Missed-call voice binding: enable voice on any active, un-bound number
    // whose company has MCTB/forwarding on (covers enable-before-active,
    // later-added numbers, and settings-time enables that failed transiently).
    job("job:reconcile-voice-enablement", reconcileVoiceEnablement),
  ],
  // Usage re-reporters (segments, then D36 voice minutes), then the static
  // 80%/100% usage-alert check (§9 metering pipeline tail) over the
  // freshly-reported state, then the #85 dynamic overage warning (once per
  // period when a tenant is projected to cost more than they pay — the
  // static alerts stay as the backstop).
  "0 * * * *": [
    job("job:report-usage", reportUnreportedUsage),
    job("job:report-voice-usage", reportUnreportedVoiceUsage),
    job("job:usage-alerts", runUsageAlertsJob),
    job("job:overage-warning", runOverageWarningJob),
    // #133: flip call sessions wedged in-flight >4h to 'missed' so /calls
    // stays honest and the per-conversation dial guard re-opens.
    job("job:sweep-stale-calls", sweepStaleCalls),
    // #386: the domain's bounce and complaint rates. Hourly, over a rolling
    // 24h window — reputation is not a per-message property and cannot be
    // judged from one send.
    job("job:email-health", runEmailHealthJob),
    // #308: the synthetic inbound canary — one text from our number to our
    // number, confirmed by its own webhook coming back. HOURLY because the
    // cadence is the cost: each round trip is ~1.7c, and an hour is the
    // shortest interval whose annual bill is defensible for a signal the
    // traffic probes can only give in half a day. Off entirely until the
    // number pair is configured.
    job("job:inbound-canary", runInboundCanaryJob),
    // #224: retire payment requests past their expiry, so a thread stops
    // showing "Waiting" for a link that no longer opens.
    job("job:expire-payment-requests", expirePaymentRequests),
  ],
  // Sole-prop OTP nudge (≥12h outstanding, once per submission).
  "30 * * * *": [job("job:nudge-sole-prop-otp", nudgeSoleProprietorOtp)],
  // Contact geocoding backfill (D25): geocode addressed contacts via Nominatim,
  // rate-limited (1 req/s) and cached to contacts.lat/lng; skips already-
  // geocoded and not-found rows. Off-peak from the other hourly jobs.
  "20 * * * *": [job("job:geocode-contacts", geocodeContactsJob)],
  // Task geocoding backfill (#214 Map fix): geocode a task's OWN address via
  // Nominatim, cached to tasks.lat/lng, so the Map pins a task at ITS location
  // (not only its contact's). Same 1 req/s pace; off-peak from the contact
  // geocoder (:20) so the two never share a Nominatim second.
  "40 * * * *": [job("job:geocode-tasks", geocodeTasksJob)],
  // Registration poller (webhooks are primary; this is the D2 fallback).
  // #379: and the delivery-rate split by destination country. A carrier
  // filtering unregistered A2P traffic returns no error — the message is
  // accepted, billed, marked sent and never arrives — so an absence is all it
  // leaves behind, and this split is the only place it shows.
  "0 13 * * *": [
    job("job:poll-registrations", pollRegistrations),
    job("job:delivery-by-country", runDeliveryByCountryJob),
    // #235: per-number reputation. Rides the same daily trigger as the other
    // slow reconciles — the windows it compares are 7 and 28 days, so running
    // it more often would cost queries to learn the same answer.
    job("job:number-health", runNumberHealthJob),
    // #310: and the registrations that did NOT move. The poller above advances
    // the ones that changed; a registration that simply sits there produces no
    // event and no error, which is the silent-absence shape #387 exists for.
    job("job:registration-stalls", runRegistrationStallJob),
    // #397 ask 2: one workspace's calls going quiet. The fleet-wide call-event
    // key catches a Telnyx outage; this catches a customer replacing us.
    job("job:call-silence", runCallSilenceJob),
    // #303: the AUP has been accepted by everyone and enforced against nobody.
    // Daily, on the slow trigger, because the signals it reads are day-scale by
    // construction — a workspace's own median day against the last one.
    job("job:aup-watch", runAupWatchJob),
    // #281 item 4: a workspace stalling in the funnel. Daily like its siblings,
    // and for the same reason — the windows it compares are 3, 7 and 10 days,
    // so asking more often would spend queries to learn the same answer.
    job("job:activation-stall", runActivationStallJob),
  ],
  // Port reconcile & resume (PORTING.md §5.2): poll in-flight porting orders,
  // apply missed status/messaging transitions, resume stalled sagas, and
  // recover messaging exceptions (webhooks primary, this is the fallback).
  "10 13 * * *": [job("job:poll-port-requests", pollPortRequests)],
  // Grace & release: day-1/15/27 warnings, day-30 release + campaign
  // deactivation.
  "0 14 * * *": [job("job:grace-and-release", runGraceJob)],
  // Subscription reconcile: re-mirror non-active companies from Stripe;
  // report stale invites.
  "0 15 * * *": [job("job:subscription-reconcile", runSubscriptionReconcileJob)],
  // #331: compare our opt-out list against the carrier's. A number Telnyx is
  // blocking that we have no record for is an inbound STOP whose webhook we
  // missed — the composer stays open and every send comes back 40300 until
  // somebody notices. Recorded here, and reported to ops, because a run of
  // them is a webhook-delivery failure rather than a change in behaviour.
  "45 15 * * *": [job("job:opt-out-reconcile", reconcileOptOuts)],
  // Ledger retention: drop PROCESSED webhook_events past the 30-day dedupe
  // window. The */5 sweeper only replays the unprocessed tail, so without this
  // the ledger grows without bound for the life of the install.
  // Ledger retention, both daily: the webhook ledger's dedupe window and the
  // #231 audit log's 12 months. Neither can grow without bound.
  // #447: the weekly founder digest — how many tenants were projected over
  // revenue in the last 7 days. The per-tenant copies go out hourly with the
  // warning; this is the only place the PATTERN shows up, which is the
  // question #446 asks. Monday morning, off the hour.
  "50 13 * * 1": [job("job:overage-digest", runOverageDigestJob)],
  // #482/#239: the monthly response-time recap. Monthly because the arc it
  // reports moves on that scale — a weekly one would mostly report noise, and
  // an email that mostly says nothing is one people stop opening.
  "35 14 1 * *": [job("job:response-time-recap", runResponseTimeRecapJob)],
  // #477: does the product actually work, checked from outside itself. Sentry
  // catches throws and the liveness ledger catches absences; this catches the
  // third shape — a path that answers 200 and does nothing useful.
  "5 */2 * * *": [job("job:probes", runProbes)],
  // #457: the carrier's own daily ceiling, warned about hourly. Hourly rather
  // than daily because the only useful advice ("spread the rest over
  // tomorrow") expires the moment the ceiling is hit, and a nightly sweep
  // would always arrive after that. The usage_alerts ledger, keyed on the UTC
  // day, keeps it to one warning per crew per day.
  "25 * * * *": [job("job:carrier-ceiling", runCarrierCeilingJob)],
  // #375: prove, from inside the Durable Object, that the alarms guarding the
  // calls system can still reach a human. Its own schedule rather than a
  // piggyback, because the six-hour cadence is a cost decision (one billable
  // Sentry event per probe) and hiding it inside an hourly trigger would make
  // that decision unreadable at the point where it is made.
  "15 */6 * * *": [job("job:do-sentry-canary", runDoSentryCanaryJob)],
  "30 15 * * *": [
    job("job:prune-webhook-events", pruneWebhookEvents),
    // #581: the widget's proof-of-number rows. Beside the others because it is
    // the same kind of obligation — except these are strangers' numbers and
    // IPs rather than a customer's, which is the half nobody had a caller for.
    job("job:prune-widget-verifications", pruneWidgetVerifications),
    // #243: the outbound ledger, whose payloads are copies of the workspace's
    // own message and contact content. Beside the inbound one because it is
    // the same table facing the other way and carries the same data.
    job("job:prune-webhook-deliveries", pruneWebhookDeliveries),
    job("job:prune-audit-log", pruneAuditLog),
    // #236: dead and revoked device rows past the 90-day window. Live
    // sessions are never touched, at any age.
    job("job:prune-user-sessions", pruneUserSessions),
    // #581: the two prunes whose SQL shipped without a caller. Here beside the
    // other bounded-by-age sweeps rather than at the end of the list, because
    // the tail of this trigger is the notice→enforce pair whose order is
    // load-bearing and must not be pushed around by unrelated arrivals.
    job("job:prune-public-link-access", prunePublicLinkAccess),
    job("job:prune-probe-results", pruneProbeResults),
    job("job:purge-closed-workspaces", purgeClosedWorkspaces),
    // #227: exports build here for the same reason the purge does — a busy
    // workspace cannot be processed inside a request.
    job("job:build-data-exports", buildDataExports),
    // #378: and reclaim the expired ones, so the seven-day promise in the
    // completion email means deleted rather than merely unreachable.
    job("job:prune-expired-exports", pruneExpiredExports),
    // #381: SSN/SIN fragments from signups that never paid. Same trigger as
    // the other retention sweeps — it is the same kind of promise.
    job("job:prune-abandoned-identity", runIdentityRetentionJob),
    // #340: names, emails and IPs of non-customers from the marketing contact
    // form. Two windows — the IP goes at 30 days, the message at a year.
    job("job:prune-contact-messages", runContactRetentionJob),
    // #312: the other prospect table. Unsubscribed rows at 30 days (safe — a
    // send needs a LIVE row, so no row is the same answer), and a consent that
    // never produced a send at a year. A live consent is never pruned by age:
    // it is the lawful basis for the sends we are still making.
    job("job:prune-marketing-contacts", runMarketingContactRetentionJob),
    // #284: warn BEFORE anything ages out. Deliberately shipped ahead of the
    // enforcement job — nobody should discover retention by losing something.
    job("job:retention-notice", runRetentionNoticeJob),
    // #284: and the half that actually destroys something. AFTER the notice on
    // purpose — the notice is a precondition the SQL enforces, so on the very
    // first day a window applies the warning is claimed before anything is
    // eligible, rather than a run order deciding whether somebody was told.
    job("job:retention-enforce", runRetentionEnforceJob),
  ],
};

// Exported (not just the Sentry-wrapped default) so the outermost fetch guard
// below can be unit-tested directly, without standing up the Sentry wrapper.
export const handler = {
  /**
   * Outermost safety net (D13/§10). Hono's `onError` only routes `Error`
   * instances to the handler — a non-Error throw (or a throw inside onError
   * itself) unwinds past it and out of `app.fetch`, which Cloudflare turns
   * into a bare 1101 page carrying NO Access-Control-Allow-Origin. The browser
   * then reports a spurious "CORS error" and the real failure never reaches
   * Sentry. Catch everything the app can throw: capture it (so it is finally
   * observable), re-echo the allowed CORS origin, and return the readable §7
   * envelope with the ray as `request_id` — never a header-less 1101.
   */
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    try {
      return await app.fetch(request, env, ctx);
    } catch (error) {
      const rayId = request.headers.get("cf-ray") ?? undefined;
      try {
        Sentry.captureException(error, {
          tags: {
            route: `${request.method} ${new URL(request.url).pathname}`,
            escaped_onerror: "true",
            ...(rayId ? { cf_ray: rayId } : {}),
          },
        });
      } catch {
        // Reporting must never mask the response.
      }
      // The PATH, never the full URL — the same cut the `route` tag above makes,
      // and still the caller's job even though the breadcrumb no longer leaves.
      //
      // This comment used to say the reason was that `scrubBreadcrumb` keys off
      // FIELD NAMES and free text has none, so a query string here would reach
      // Sentry untouched. That stopped being true when #585 made the scrubber
      // drop console crumbs outright, and the comment was not updated with it —
      // so it described a mechanism that no longer existed.
      //
      // The rule survives its old justification. This line still goes to
      // Cloudflare Workers Logs in full, where a query string carrying
      // `?q=<a customer's street address>` is retained under our own retention
      // rather than a third party's; SPEC §10 is about where a customer's data
      // ends up, not only about Sentry. Cutting at the path is cheap and keeps
      // the promise on both destinations.
      console.error(
        `[fetch-guard] uncaught ${request.method} ${new URL(request.url).pathname} ` +
          `ray=${rayId ?? "-"}:`,
        error,
      );
      const res = Response.json(
        {
          error: {
            code: INTERNAL_ERROR_CODE,
            message: "Something went wrong.",
            ...(rayId ? { request_id: rayId } : {}),
          },
        },
        { status: INTERNAL_ERROR_STATUS },
      );
      try {
        const origin = request.headers.get("origin");
        if (origin) {
          const validated = getEnv(env);
          if (
            origin === validated.APP_ORIGIN ||
            origin === validated.SITE_ORIGIN
          ) {
            res.headers.set("Access-Control-Allow-Origin", origin);
            res.headers.set("Vary", "Origin");
          }
        }
      } catch {
        // Env unavailable (persistent misconfig, not this transient) — return
        // the envelope without ACAO; still far better than a bare 1101.
      }
      return res;
    }
  },

  /**
   * Cron entry point (SPEC §11): validate the environment (a misconfigured
   * Worker fails loudly on its first trigger), then run every job mapped to
   * the schedule that fired. Jobs on a shared trigger run sequentially but
   * fail independently — one job's failure never starves its siblings, and
   * the run still rejects so Sentry (which wraps scheduled()) records it.
   */
  async scheduled(controller, env) {
    const validated = getEnv(env);
    const jobs = CRON_JOBS[controller.cron as CronSchedule];
    if (!jobs) {
      throw new Error(
        `No scheduled jobs are mapped to cron "${controller.cron}" — wrangler.jsonc and CRON_JOBS are out of sync.`,
      );
    }
    const now = new Date(controller.scheduledTime);

    // #387: the trigger FIRED, and that is what the heartbeat records — before
    // the jobs run and regardless of whether any of them throws. The two
    // signals are deliberately orthogonal: a job that throws is Sentry's, a
    // schedule that stops firing leaves no exception at all and is this
    // ledger's. Recording it only on success would conflate them and leave the
    // absence undetectable behind a job that is merely broken.
    await recordHeartbeatBestEffort(
      validated,
      `cron:${controller.cron}` as `cron:${CronSchedule}`,
      now,
    );

    await runScheduledJobs(validated, controller.cron, jobs, now);
  },
} satisfies ExportedHandler<Bindings>;

/**
 * Run one schedule's jobs, recording each one's liveness heartbeat.
 *
 * Extracted from `scheduled()` so the rule that actually matters — a job's
 * heartbeat is recorded ONLY when it succeeds (#333) — is testable without
 * standing up every real cron job in the product.
 *
 * Jobs on a shared trigger run sequentially but fail independently: one job's
 * failure never starves its siblings, and the run still rejects so Sentry
 * (which wraps `scheduled()`) records it.
 */
export async function runScheduledJobs(
  env: Env,
  cron: string,
  jobs: readonly CronEntry[],
  now: Date,
): Promise<void> {
  const failures: unknown[] = [];
  for (const entry of jobs) {
    try {
      await entry.run(env, now);
      // ONLY on success. A job that throws on its first statement every run
      // would otherwise keep beating while doing nothing, and the
      // schedule-level heartbeat cannot tell the difference — the trigger
      // fired either way. Withholding the beat makes "broken every run since
      // Tuesday" and "has not run at all" the same alert on the same path,
      // which is what #333 asks for. A transient failure that recovers on the
      // next run never reaches its grace window, so this costs no noise.
      await recordHeartbeatBestEffort(env, entry.key, now);
    } catch (cause) {
      // Name the culprit in the run's own logs: the platform serializes only
      // the AggregateError's top-level message (child errors vanish), which
      // made "1 of 5 job(s) failed" undiagnosable from the dashboard.
      const detail =
        cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
      console.error(`cron job ${entry.key} failed: ${detail}`);
      failures.push(cause);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `cron "${cron}": ${failures.length} of ${jobs.length} job(s) failed`,
    );
  }
}


/**
 * Sentry wraps the whole Worker (fetch + scheduled) with the SPEC §10
 * beforeSend/beforeBreadcrumb PII scrubbing configured in
 * observability/sentry.ts.
 */
export default Sentry.withSentry(sentryOptions, handler);

/**
 * Calls v3 (#170 §2.1): the CallSessionDO, re-exported as a NAMED export so
 * wrangler resolves the DO class from `main` (it does NOT read the
 * Sentry-wrapped default export). Instrumented with
 * `instrumentDurableObjectWithSentry` so alarm()/RPC errors are captured — the
 * Worker-level withSentry wraps only fetch/scheduled, so an uninstrumented DO
 * would make every §2.2 mirror-failure alert and §13 cost-cap warning (and the
 * high-value alarm() crash) a silent no-op.
 */
export const CallSessionDO = Sentry.instrumentDurableObjectWithSentry(
  (env: Env) => sentryOptions(env),
  CallSessionDOImpl,
);
