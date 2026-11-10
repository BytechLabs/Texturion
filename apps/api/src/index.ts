import { INTERNAL_ERROR_CODE, INTERNAL_ERROR_STATUS } from "@loonext/shared";
import { Hono, type Context, type ErrorHandler } from "hono";
import { cors } from "hono/cors";

import { securityHeaders } from "./http/security-headers";
import { sweepDeletedAttachments } from "./attachments/sweep";
import { companyContext } from "./auth/company";
import { jwtAuth } from "./auth/jwt";
import { runGraceJob } from "./billing/grace";
import { sweepUncreditedConversions } from "./billing/prepay";
import { runSubscriptionReconcileJob } from "./billing/reconcile";
import {
  captureException,
  type ExceptionContext,
  type WaitUntil,
} from "./observability/capture";
import { isCronSchedule, type CronSchedule } from "./crons/schedules";
import { runResponseTimeRecapJob } from "./reports/monthly-recap";
import {
  runOverageWarningJob,
} from "./billing/overage-warning";
import { runUsageAlertsJob } from "./billing/usage-alerts";
import type { AppEnv } from "./context";
import { getEnv, type Bindings, type Env } from "./env";
import { databasePressure, databaseTrouble } from "./db-pressure";
import { rigDatabaseRefusal } from "./environments/database";
import { servesRigRoutes } from "./environments/policy";
import { geocodeContactsJob } from "./geocode/geocode-contacts";
import { geocodeTasksJob } from "./geocode/geocode-tasks";
import { runLeadChaseJob } from "./notifications/lead-chase";
import { runScheduledSendJob } from "./messaging/scheduled-send";
import { runBatchFlush } from "./notifications/batch-flush";
import { runDailySummary } from "./notifications/daily-summary";
import { runEscalationSweep } from "./notifications/escalation-sweep";
import { runNumberHealthJob } from "./messaging/number-health";
import { runIdentityRetentionJob } from "./telnyx/identity-retention";
import {
  runContactRetentionJob,
  runMarketingContactRetentionJob,
} from "./marketing/contact-retention";
import { runCarrierCeilingJob } from "./billing/carrier-ceiling";
import { retryInterruptedSends } from "./messaging/retry-interrupted";
import { runAupSignalsJob } from "./messaging/aup-watch";
import { runRetentionEnforceJob } from "./workspace/retention-enforce";
import { runRetentionNoticeJob } from "./workspace/retention-notice";
import { notifyDueTasksJob } from "./tasks/due-notice";
import { runTaskRepeatsJob } from "./tasks/repeat-job";
import { notifyOverdueTasksJob } from "./tasks/overdue-notice";
import {
  ApiError,
  errorResponse,
  internalErrorResponse,
  overloadedResponse,
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
import { attachmentsRoutes } from "./routes/attachments";
import { availableNumbersRoutes } from "./routes/available-numbers";
import { billingRoutes } from "./routes/billing";
import { callsRoutes } from "./routes/calls";
import { liveCallsRoutes } from "./routes/live-calls";
import { webrtcRoutes } from "./routes/webrtc";
import { ringBeaconsRoutes } from "./routes/ring-beacons";
import { companiesRoutes } from "./routes/companies";
import { composeRoutes } from "./routes/compose";
import { contactRoutes } from "./routes/contact";
import { marketingRoutes } from "./routes/marketing";
import { widgetRoutes } from "./routes/widget";
import { contactsRoutes } from "./routes/contacts";
import { conversationsRoutes } from "./routes/conversations";
import { trashRoutes } from "./routes/trash";
import { purgeTrash } from "./trash/purge";
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
import { prunePublicLinkAccess } from "./crons/retention-prunes";
import { buildDataExports, pruneExpiredExports } from "./workspace/export";
import { purgeClosedWorkspaces } from "./workspace/purge";
import { accountRoutes } from "./routes/account";
import { appReleaseRoutes } from "./routes/app-release";
import { exportsRoutes } from "./routes/exports";
import { auditLogRoutes } from "./routes/audit-log";
import { workspaceClosureRoutes } from "./routes/workspace-closure";
import { calendarFeedRoutes } from "./routes/calendar-feed";
import { calendarRoutes } from "./routes/calendar";
import { calendarConnectionRoutes } from "./routes/calendar-connections";
import { calendarPublicRoutes } from "./routes/calendar-oauth";
import { runCalendarSyncJob } from "./calendar/worker";
import { publicQuoteRoutes } from "./routes/quotes-public";
import { quotesRoutes } from "./routes/quotes";
import { tagsRoutes } from "./routes/tags";
import { tasksRoutes } from "./routes/tasks";
import { taskActivityRoutes } from "./routes/task-activity";
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
import { rigRoutes } from "./routes/rig";
import { usageRoutes } from "./routes/usage";
import { expirePaymentRequests } from "./crons/payment-requests";
import { pollPortRequests } from "./telnyx/porting";
import { reconcileNumbers, sweepStuckProvisioning } from "./telnyx/provisioning";
import { reconcileTextEnablement } from "./telnyx/text-enablement";
import { TelnyxApiError } from "./telnyx/client";
import { TELNYX_PARTITION_CAPABILITY } from "./telnyx/ownership";
import { reconcileVoiceEnablement } from "./telnyx/voice";
import {
  nudgeSoleProprietorOtp,
  pollRegistrations,
  retryCampaignAssignments,
} from "./telnyx/registration";
import { resendWebhookRoute } from "./webhooks/resend";
import { stripeWebhookRoute } from "./webhooks/stripe";
import { telnyxWebhookRoute } from "./webhooks/telnyx";

export const app = new Hono<AppEnv>();

/**
 * The origins an error response may re-echo (CORS), read defensively: an error
 * path must never be the thing that throws.
 */
function allowedOriginsOf(c: Context): (string | undefined)[] {
  try {
    const env = getEnv(c.env as Bindings);
    return [env.APP_ORIGIN, env.SITE_ORIGIN];
  } catch {
    return [];
  }
}

/** `c.executionCtx` throws when no execution context is bound. */
function waitUntilOf(c: Context): WaitUntil | undefined {
  try {
    const ctx = c.executionCtx;
    return (promise) => ctx.waitUntil(promise);
  } catch {
    return undefined;
  }
}

/**
 * The bindings as capture reads them. A failure of the environment check is
 * itself worth reporting, and the unvalidated bindings still hold the PostHog
 * key and the deploy environment.
 */
function reportingEnv(bindings: Bindings): Env {
  try {
    return getEnv(bindings);
  } catch {
    return bindings as unknown as Env;
  }
}

/** Reporting must never be what turns an error response into a crash. */
function reportUnexpected(
  bindings: Bindings,
  error: unknown,
  context: ExceptionContext,
  waitUntil?: WaitUntil,
): void {
  try {
    void captureException(reportingEnv(bindings), error, context, waitUntil);
  } catch (cause) {
    console.error("exception not reported:", cause instanceof Error ? cause.message : String(cause));
  }
}

/** Outermost, so every request runs in its own database-pressure scope. */
app.use("*", databasePressure(allowedOriginsOf));

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
const v1Cors = cors({
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
});
app.use("/v1/*", v1Cors);
app.use("/v1/*", jwtAuth());
app.use("/v1/*", companyContext());

app.get("/health", (c) => {
  // A misconfigured Worker must fail loudly, not serve a healthy-looking 200.
  getEnv(c.env);
  // D142: the rig's guard orders no Telnyx number until production lists the
  // partition rule here, so a deploy that predates it can never be mistaken
  // for one that has it.
  return c.json({ ok: true, capabilities: [TELNYX_PARTITION_CAPABILITY] });
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
app.route("/v1", calendarConnectionRoutes);
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
// #691: deletes and the Trash. Before conversationsRoutes so POST
// /conversations/delete is never read as a conversation id.
app.route("/v1", trashRoutes);
app.route("/v1", conversationsRoutes);
app.route("/v1", tasksRoutes); // D17 tasks + GET /v1/conversations/:id/tasks
app.route("/v1", taskActivityRoutes); // #689 E task history + comments
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
// OAuth callbacks and authenticated provider notifications have no Loonext
// session. Hashed state/client-state credentials are their authentication.
app.route("/", calendarPublicRoutes);
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
app.route("/v1", ringBeaconsRoutes); // D142 ring beacons: device-side ring stages

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

const handleAppError: ErrorHandler<AppEnv> = (error, c) => {
  // A thrown error unwinds past the CORS middleware before its post-`next()`
  // header pass runs, so this response would otherwise ship WITHOUT
  // Access-Control-Allow-Origin — which the browser reports as a "CORS error",
  // masking the real 4xx/5xx (e.g. a transient failure looks like a CORS bug).
  // Re-echo the request origin here, only when it is an allowed one, so the
  // client can read the SPEC §7 envelope and show the actual message. Wrapped
  // defensively: onError must never itself throw.
  if (error instanceof ApiError) {
    return errorResponse(c, error.code, error.message, error.reference);
  }
  /*
   * #251 — a vendor throttling US must not read as our software breaking.
   *
   * Telnyx buckets per endpoint, and the tightest one we touch is 5 requests
   * per second on number management — the search a customer runs while they
   * are choosing a number to buy. Our own per-caller limiter bounds abuse; it
   * does nothing about the ACCOUNT aggregate, because two customers shopping
   * at the same moment are not one caller.
   *
   * A TelnyxApiError is not an ApiError, so before this it fell all the way to
   * the generic 500 and told somebody mid-purchase that something had gone
   * wrong on our end. It had not: the phone network declined to answer that
   * fast, and waiting a moment fixes it. #251's third acceptance criterion is
   * that a ceiling produces a truthful failure, and "internal error" is the
   * least truthful thing we could have said.
   *
   * 503 rather than 429 deliberately. A 429 tells the caller THEY are going
   * too fast, and they are not — the limit is ours, spent on their behalf.
   *
   * Only 429 and 503. Every other vendor status is a real fault and keeps its
   * 500, its exception and its log line: this narrows what we call
   * transient, it does not widen it. The message is OURS, not the vendor's —
   * a vendor string can carry request context we should not hand back.
   */
  if (
    error instanceof TelnyxApiError &&
    (error.status === 429 || error.status === 503)
  ) {
    return errorResponse(
      c,
      "service_unavailable",
      "The phone network is busy right now. Try that again in a moment.",
    );
  }
  // Overload is not a bug: an exception per shed request would be a storm of
  // them. The ray stays in the log.
  if (databaseTrouble()) {
    console.warn(
      `[503] database trouble: ${c.req.method} ${new URL(c.req.url).pathname} ray=${c.req.header("cf-ray") ?? "-"}`,
    );
    return overloadedResponse(c, allowedOriginsOf(c));
  }
  // A real, unexpected 500. Make it observable three ways without leaking
  // internals to the client (SPEC §10):
  //   1. a rich server log with the failing route + Cloudflare ray id — shows
  //      up in `wrangler tail` and the Worker's Logs (observability is on);
  //   2. a PostHog exception carrying that route + ray, scrubbed (SPEC §10),
  //      so it is searchable;
  //   3. a `request_id` (the ray) returned to the client, so a founder can jump
  //      straight from a failed request to the exact log line and exception.
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;
  const rayId = c.req.header("cf-ray") ?? undefined;
  reportUnexpected(
    c.env,
    error,
    {
      source: "api",
      route: `${method} ${path}`,
      ...(rayId ? { extra: { cf_ray: rayId } } : {}),
    },
    waitUntilOf(c),
  );
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
};
app.onError(handleAppError);

/**
 * D142: the rig-only routes, behind the same chain and error handling as
 * every other /v1 route. A separate app rather than routes on `app`, so the
 * production route table never contains them, and built on the first rig
 * request, so a production isolate never constructs it at all.
 */
let rigApp: Hono<AppEnv> | null = null;

function rigRoutesApp(): Hono<AppEnv> {
  if (rigApp !== null) return rigApp;
  const built = new Hono<AppEnv>();
  built.use("*", databasePressure(allowedOriginsOf));
  built.use("*", securityHeaders());
  built.use("/v1/*", v1Cors);
  built.use("/v1/*", jwtAuth());
  built.use("/v1/*", companyContext());
  built.route("/v1", rigRoutes);
  built.notFound((c) => errorResponse(c, "not_found", "No such route."));
  built.onError(handleAppError);
  rigApp = built;
  return built;
}

/**
 * The path is checked first, so only a rig-shaped path pays for reading the
 * environment.
 */
function appFor(request: Request, env: Bindings): Hono<AppEnv> {
  const path = new URL(request.url).pathname;
  if (path.startsWith("/v1/rig/") && servesRigRoutes(getEnv(env))) {
    return rigRoutesApp();
  }
  return app;
}

/**
 * D142: on the rig, the answer while its database's destination gate is off.
 * A configuration that does not parse is left to the app to report, and
 * outside the rig nothing is asked.
 */
async function rigUnreadyResponse(env: Bindings): Promise<Response | null> {
  let validated: Env;
  try {
    validated = getEnv(env);
  } catch {
    return null;
  }
  const refusal = await rigDatabaseRefusal(validated);
  if (refusal === null) return null;
  console.error(`[rig] not serving: ${refusal}`);
  return Response.json(
    { error: { code: "service_unavailable", message: refusal } },
    { status: 503 },
  );
}

type ScheduledJob = (env: Env, now: Date) => Promise<unknown>;

/** A scheduled job and the name its failures are reported under. */
interface CronEntry {
  key: `job:${string}`;
  run: ScheduledJob;
}

const job = (key: `job:${string}`, run: ScheduledJob): CronEntry => ({ key, run });

/**
 * SPEC §11 cron table — one entry per wrangler.jsonc trigger, in §11 order.
 * Every job is idempotent and clock-injected where it needs a clock, so the
 * trigger's own scheduledTime is passed through. Exported so tests can assert
 * this map stays in lockstep with wrangler.jsonc and the §11 schedule set.
 * Keyed by `CronSchedule` (crons/schedules.ts), so a schedule without jobs
 * does not compile.
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
    // #245: provider notifications only accelerate this durable drain. The
    // five-minute poll remains the proof when a watch expires or goes silent.
    job("job:calendar-sync", runCalendarSyncJob),
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
    // Task due-date reminders: one push to the assignee as a task comes due,
    // at most once per due date. A quarter hour is close enough to "now" for
    // a day of trade work and keeps the scan cheap.
    job("job:notify-due-tasks", notifyDueTasksJob),
    // #689 D: the same assignee, once, a grace period after the due time.
    job("job:notify-overdue-tasks", notifyOverdueTasksJob),
    // #693: keep the next occurrences of schedule repeats created ahead of time,
    // so they show on the calendar and the board before they are due. Every
    // quarter hour is plenty: the unit is a day.
    job("job:task-repeats", runTaskRepeatsJob),
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
  "0 13 * * *": [
    job("job:poll-registrations", pollRegistrations),
    // #235: per-number reputation. Rides the same daily trigger as the other
    // slow reconciles — the windows it compares are 7 and 28 days, so running
    // it more often would cost queries to learn the same answer.
    job("job:number-health", runNumberHealthJob),
    // #303: each workspace's day of sending, as an `aup_signals` event. Daily
    // because the signals are day-scale by construction.
    job("job:aup-signals", runAupSignalsJob),
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
  // somebody notices. Recorded here, and a notice sent, because a run of them
  // is a webhook-delivery failure rather than a change in behaviour.
  "45 15 * * *": [job("job:opt-out-reconcile", reconcileOptOuts)],
  // Ledger retention: drop PROCESSED webhook_events past the 30-day dedupe
  // window. The */5 sweeper only replays the unprocessed tail, so without this
  // the ledger grows without bound for the life of the install.
  // Ledger retention, both daily: the webhook ledger's dedupe window and the
  // #231 audit log's 12 months. Neither can grow without bound.
  // #482/#239: the monthly response-time recap. Monthly because the arc it
  // reports moves on that scale — a weekly one would mostly report noise, and
  // an email that mostly says nothing is one people stop opening.
  "35 14 1 * *": [job("job:response-time-recap", runResponseTimeRecapJob)],
  // #457: the carrier's own daily ceiling, warned about hourly. Hourly rather
  // than daily because the only useful advice ("spread the rest over
  // tomorrow") expires the moment the ceiling is hit, and a nightly sweep
  // would always arrive after that. The usage_alerts ledger, keyed on the UTC
  // day, keeps it to one warning per crew per day.
  "25 * * * *": [job("job:carrier-ceiling", runCarrierCeilingJob)],
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
    // #691: what has sat in the Trash 30 days, with its storage objects. Beside
    // the workspace purge because it is the same kind of promise, narrower.
    job("job:purge-trash", purgeTrash),
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

export const handler = {
  /**
   * Outermost safety net (D13/§10). Hono's `onError` only routes `Error`
   * instances to the handler — a non-Error throw (or a throw inside onError
   * itself) unwinds past it and out of `app.fetch`, which Cloudflare turns
   * into a bare 1101 page carrying NO Access-Control-Allow-Origin. The browser
   * then reports a spurious "CORS error" and the real failure is never
   * reported. Catch everything the app can throw: capture it (so it is finally
   * observable), re-echo the allowed CORS origin, and return the readable §7
   * envelope with the ray as `request_id` — never a header-less 1101.
   */
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    try {
      const unready = await rigUnreadyResponse(env);
      if (unready !== null) return unready;
      return await appFor(request, env).fetch(request, env, ctx);
    } catch (error) {
      const rayId = request.headers.get("cf-ray") ?? undefined;
      reportUnexpected(
        env,
        error,
        {
          source: "api",
          route: `${request.method} ${new URL(request.url).pathname}`,
          extra: { escaped_onerror: true, ...(rayId ? { cf_ray: rayId } : {}) },
        },
        (promise) => ctx.waitUntil(promise),
      );
      // The PATH, never the full URL, the same cut the `route` above makes.
      // This line goes to Cloudflare Workers Logs in full, where a query string
      // carrying `?q=<a customer's street address>` would be retained; SPEC §10
      // is about where a customer's data ends up, on every destination.
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
   * the schedule that fired.
   */
  async scheduled(controller, env, ctx) {
    const cron = controller.cron;
    const waitUntil: WaitUntil = (promise) => ctx.waitUntil(promise);
    // These two refusals happen before any job runs, so they are reported here
    // or nowhere.
    const refuseRun = (error: Error): never => {
      reportUnexpected(env, error, { source: "cron", cron }, waitUntil);
      throw error;
    };
    let validated: Env;
    try {
      validated = getEnv(env);
    } catch (error) {
      return refuseRun(error instanceof Error ? error : new Error(String(error)));
    }
    if (!isCronSchedule(cron)) {
      return refuseRun(
        new Error(
          `No scheduled jobs are mapped to cron "${cron}": wrangler.jsonc and CRON_JOBS are out of sync.`,
        ),
      );
    }
    const now = new Date(controller.scheduledTime);

    const rigRefusal = await rigDatabaseRefusal(validated);
    if (rigRefusal !== null) throw new Error(`rig cron not run: ${rigRefusal}`);

    await runScheduledJobs(validated, cron, CRON_JOBS[cron], now, waitUntil);
  },
} satisfies ExportedHandler<Bindings>;

/**
 * A job that collects its failures throws them as one AggregateError, and
 * PostHog reads an error's `cause` chain, never `errors`, so each failure in
 * it is reported on its own.
 */
function failuresIn(cause: unknown): unknown[] {
  if (!(cause instanceof AggregateError) || cause.errors.length === 0) return [cause];
  return cause.errors.flatMap(failuresIn);
}

/**
 * Run one schedule's jobs. Jobs on a shared trigger run sequentially but fail
 * independently: one job's failure never starves its siblings, each failure is
 * reported as an exception naming its job, and the run still rejects so the
 * Workers dashboard shows it failed.
 */
export async function runScheduledJobs(
  env: Env,
  cron: CronSchedule,
  jobs: readonly CronEntry[],
  now: Date,
  waitUntil?: WaitUntil,
): Promise<void> {
  const failures: unknown[] = [];
  for (const entry of jobs) {
    try {
      await entry.run(env, now);
    } catch (cause) {
      // Name the culprit in the run's own logs: the platform serializes only
      // the AggregateError's top-level message (child errors vanish), which
      // made "1 of 5 job(s) failed" undiagnosable from the dashboard.
      const detail =
        cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
      console.error(`cron job ${entry.key} failed: ${detail}`);
      for (const failure of failuresIn(cause)) {
        void captureException(env, failure, { source: "cron", cron, job: entry.key }, waitUntil);
      }
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

export default handler;

/**
 * Calls v3 (#170 §2.1): the CallSessionDO, re-exported as a NAMED export so
 * wrangler resolves the DO class from `main`. It reports its own errors
 * through observability/capture.ts with the object's env, so it needs no
 * wrapper (D146).
 */
export { CallSessionDO } from "./calls/session-do";
