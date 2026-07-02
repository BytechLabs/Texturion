import { INTERNAL_ERROR_CODE, INTERNAL_ERROR_STATUS } from "@jobtext/shared";
import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { companyContext } from "./auth/company";
import { jwtAuth } from "./auth/jwt";
import type { AppEnv } from "./context";
import { getEnv, type Bindings } from "./env";
import { ApiError, errorResponse } from "./http/errors";
import { sentryOptions } from "./observability/sentry";

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
 * deliberately not mounted at all yet: webhook routes authenticate by provider
 * signature — not JWT — and land in later build steps; until then they must
 * 404, and they must never carry CORS headers (SPEC §7).
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

app.notFound((c) => errorResponse(c, "not_found", "No such route."));

app.onError((error, c) => {
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

const handler = {
  fetch: app.fetch,

  /**
   * Cron entry point (SPEC §11). The scheduled jobs land in later build steps;
   * until then this handler's real job is to validate the environment on every
   * trigger — so a misconfigured Worker fails loudly on its first cron — and to
   * record which schedule fired.
   */
  async scheduled(controller, env) {
    getEnv(env);
    console.log(
      `cron fired: "${controller.cron}" at ${new Date(controller.scheduledTime).toISOString()}`,
    );
  },
} satisfies ExportedHandler<Bindings>;

/**
 * Sentry wraps the whole Worker (fetch + scheduled) with the SPEC §10
 * beforeSend/beforeBreadcrumb PII scrubbing configured in
 * observability/sentry.ts.
 */
export default Sentry.withSentry(sentryOptions, handler);
