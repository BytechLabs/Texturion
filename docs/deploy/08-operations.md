# 08 — Operations

Ongoing operation of the live system: how the crons work and how to verify them,
dunning/grace behavior, monitoring, key rotation, backups/restore, and incident
basics.

---

## 1. Cron jobs — what runs and how to verify

Seven cron triggers on `jobtext-api`, registered automatically on `wrangler deploy`
(`apps/api/wrangler.jsonc:11-19`), mapped to jobs at `apps/api/src/index.ts:142-162`.
Jobs sharing a trigger run **sequentially but fail independently**; if any fails the
whole run rejects (as an `AggregateError`) so Sentry records it
(`apps/api/src/index.ts:184-197`).

| Cron (UTC) | Jobs | What it does |
|------------|------|--------------|
| `*/5 * * * *` | `sweepWebhookEvents` | Replays `webhook_events` rows still unprocessed after 2 min, up to 5 attempts; the 5th failure raises a Sentry alert (`apps/api/src/messaging/crons.ts:24-25,37`). Both providers, through the same dispatch as the live routes. |
| `*/15 * * * *` | `reconcileNumbers`, `retryCampaignAssignments` | Resumes stuck provisioning, adopts crash-after-buy orphans, retries §4.4 campaign number-assignments (`apps/api/src/index.ts:145-148`). |
| `0 * * * *` | `reportUnreportedUsage`, `runUsageAlertsJob` | Re-POSTs Stripe meter events for `usage_events` where `stripe_reported_at IS NULL`, then checks 80%/100% usage alerts (`apps/api/src/index.ts:149-151`, `apps/api/src/messaging/crons.ts:11-13`). |
| `30 * * * *` | `nudgeSoleProprietorOtp` | Nudges sole-prop OTP outstanding ≥12h, once per submission (`apps/api/src/index.ts:152-153`). |
| `0 13 * * *` | `pollRegistrations` | Daily 10DLC registration poller (fallback; webhooks are primary) (`apps/api/src/index.ts:154-155`). |
| `0 14 * * *` | `runGraceJob` | Grace warnings (day 1/15/27) + day-30 number release + campaign deactivation (`apps/api/src/index.ts:156-158`). |
| `0 15 * * *` | `runSubscriptionReconcileJob` | Re-mirrors non-active companies from Stripe; reports stale invites (`apps/api/src/index.ts:159-161`). |

### Verify the crons

- **Cloudflare dashboard** → `jobtext-api` → **Triggers → Cron Triggers**: all 7
  expressions listed with last-run status.
- **Live logs:** `pnpm --filter @jobtext/api exec wrangler tail` and watch a
  `*/5` window, or Cloudflare → Worker → Logs.
- **Sanity checks in data:** after an hour, `usage_events.stripe_reported_at` should
  be non-null for reported rows; `webhook_events` should have no rows with
  `processed_at IS NULL` older than ~10 minutes (the sweeper clears them).

> The `apps/api/src/mount.test.ts` suite asserts `wrangler.jsonc` and the
> `CRON_JOBS` map stay in lockstep — if you add/remove a cron, update both or CI
> fails.

---

## 2. Billing lifecycle: dunning & grace

- **Payment fails** → `invoice.payment_failed` → company `past_due`, outbound
  texting blocked, owner+admins emailed; Stripe Smart Retries run ~8 attempts over
  ~2 weeks (`apps/api/src/webhooks/stripe.ts:400-429`).
- **Retries exhausted** → (dashboard action = **cancel**, [03](./03-stripe.md) §5) →
  `customer.subscription.deleted` → company `canceled`, `canceled_at` stamped,
  numbers **suspended** (inbound still received), grace clock starts, day-1 warning
  sent (`apps/api/src/webhooks/stripe.ts:321-349`).
- **Grace period = 30 days** (`apps/api/src/billing/grace.ts:13`). The `0 14 * * *`
  cron sends warnings on **day 1 / 15 / 27** and on **day 30 releases** the numbers +
  deactivates the campaign (`apps/api/src/billing/grace.ts:8-13`). All notices go
  through the `grace_notices` ledger so the cron and the webhook can never
  double-send.
- **Resubscribe within grace** → checkout un-suspends the existing number instead of
  provisioning a new one (`apps/api/src/webhooks/stripe.ts:252-262`).

Invoices requiring bank confirmation (`invoice.payment_action_required`) trigger an
email with the hosted invoice link; no state change
(`apps/api/src/webhooks/stripe.ts:435-468`).

---

## 3. Monitoring

- **Sentry** — the whole Worker (fetch + scheduled) is wrapped by
  `Sentry.withSentry` (`apps/api/src/index.ts:206`). Unhandled `/v1` errors and cron
  failures are captured. PII is scrubbed: `sendDefaultPii:false`,
  `tracesSampleRate:0`, and `beforeSend`/`beforeBreadcrumb` scrubbers
  (`apps/api/src/observability/sentry.ts:117-125`) — message bodies never reach
  Sentry. Watch for: the `*/5` sweeper's 5th-attempt alerts, cron `AggregateError`s,
  and Resend/Telnyx/Stripe call failures.
- **`/health`** — `GET https://api.jobtext.app/health` re-runs env validation; a 500
  naming a key means a secret is missing/invalid (`apps/api/src/index.ts:78-82`). Good
  target for an uptime monitor / the status page.
- **PostHog** — not integrated; there is no product analytics pipeline to monitor.
- **Cloudflare Workers metrics/logs** — request volume, error rate, cron invocations.

---

## 4. Rotating a leaked key

Set the new value, then invalidate the old at the vendor. No redeploy is needed for
the Worker to pick up a new secret; re-hit `/health` after.

| Key | Rotate at | Then |
|-----|-----------|------|
| `SUPABASE_SECRET_KEY` | Supabase → API → roll the `sb_secret_` key | `wrangler secret put SUPABASE_SECRET_KEY` |
| `STRIPE_SECRET_KEY` | Stripe → API keys → roll the restricted key | `wrangler secret put STRIPE_SECRET_KEY` |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → roll signing secret | `wrangler secret put STRIPE_WEBHOOK_SECRET` |
| `TELNYX_API_KEY` | Telnyx → API Keys → new V2 key, delete old | `wrangler secret put TELNYX_API_KEY` |
| `TELNYX_PUBLIC_KEY` | Only if Telnyx rotates the signing key | `wrangler secret put TELNYX_PUBLIC_KEY` |
| `RESEND_API_KEY` | Resend → API Keys → new key, revoke old | `wrangler secret put RESEND_API_KEY` |
| `SENTRY_DSN` | Sentry → Client Keys → new DSN | `wrangler secret put SENTRY_DSN` |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → API Tokens | Update the GitHub Actions secret |
| Supabase **ES256 signing key** | Supabase → Auth → Signing Keys → rotate | JWKS auto-updates (~10 min edge cache); no Worker change |

> **Do NOT rotate `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`** except in a real
> compromise — rotation invalidates **every** existing push subscription
> (`apps/api/src/env.ts:23-29`). If you must, users re-subscribe on next visit.

After rotating any secret, run the [07](./07-go-live-checklist.md) §C smoke test's
affected leg (e.g. a Stripe test event after rotating the webhook secret).

---

## 5. Backups & restore (Supabase)

- **Automated backups** ship with Supabase **Pro** — daily backups with
  **Point-in-Time Recovery (PITR)** available. Confirm PITR is enabled in
  Supabase → **Database → Backups**.
- **Restore:** use the dashboard's PITR/restore to a timestamp. For a full
  environment rebuild, migrations are the source of truth — a fresh project +
  `supabase db push` reproduces the schema exactly (CI proves this on every run via
  `supabase db reset`, `.github/workflows/ci.yml:22-26`).
- **Storage (`mms-media`)** is not covered by DB PITR — it's object storage. Treat
  media as reconstructable from Telnyx where possible; for critical retention,
  configure separate object backup if your compliance posture requires it.
- **Do not** manually edit the schema in the dashboard — always add a migration under
  `supabase/migrations/` so `db push` and CI stay authoritative.

---

## 6. Incident basics

1. **Triage with `/health`** — if it 500s, a secret is missing/invalid; the error
   names the key. Fix and re-check.
2. **Webhooks look stuck** — check `webhook_events` for rows with `processed_at IS
   NULL`. The `*/5` sweeper retries up to 5×; a row with `attempts=5` and a
   `last_error` needs manual attention (inspect `last_error`,
   `apps/api/src/webhooks/stripe.ts:104-109`). The signature is the auth — a spike of
   400s at `/webhooks/*` usually means a wrong `STRIPE_WEBHOOK_SECRET` /
   `TELNYX_PUBLIC_KEY` or clock skew (>5 min kills Telnyx verification,
   `apps/api/src/telnyx/verify.ts:17,68`).
3. **All authenticated requests 401** — the ES256 signing key was disabled/rotated
   away or `SUPABASE_JWKS_URL`/`SUPABASE_URL` is wrong. Confirm the JWKS URL serves
   keys and `iss` matches `<SUPABASE_URL>/auth/v1`
   (`apps/api/src/auth/jwt.ts:41-44`).
4. **Outbound texting blocked for one company** — expected when `past_due`/`canceled`
   (§2). Check `subscription_status`.
5. **CORS failures in the browser** — `APP_ORIGIN` on the Worker must exactly equal
   the web origin, no trailing slash mismatch (`apps/api/src/index.ts:65`).
6. **Rollback** — deploys are per-Worker; redeploy the previous commit
   (`pnpm --filter @jobtext/api exec wrangler deploy` / the web deploy) or use
   Cloudflare's version rollback. Migrations are **forward-only** — never `db push` a
   destructive change without a reviewed migration.
7. **Escalation** — Sentry issue → identify the failing call (Supabase / Stripe /
   Telnyx / Resend), check that vendor's status page, and confirm the relevant secret.

---

Back to the [README index](./README.md).
