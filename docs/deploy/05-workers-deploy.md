# 05 — Deploy the two Workers

Set the API Worker's secrets, configure GitHub Actions, deploy both Workers, bind
custom domains, and register the now-live webhook URLs back into Stripe and Telnyx.

Both Workers pin `compatibility_date = "2026-06-01"` and
`compatibility_flags = ["nodejs_compat"]`
(`apps/api/wrangler.jsonc:5-6`, `apps/web/wrangler.jsonc:5-6`).

---

## 1. Prerequisites before deploying

You should already have (from [02](./02-supabase.md)–[04](./04-telnyx.md)):

- Supabase URL, `sb_secret_` key, JWKS URL, publishable key; migrations applied.
- 6 `STRIPE_*` IDs, `STRIPE_WEBHOOK_SECRET` (can be set after the webhook endpoint
  exists in §4), restricted `STRIPE_SECRET_KEY`.
- `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, `TELNYX_VOICE_CONNECTION_ID` (the
  Call-Control application id from [04](./04-telnyx.md) §1).
- Resend key + verified `RESEND_FROM`; Sentry DSN.
- The two chosen origins: `APP_ORIGIN=https://app.jobtext.app`,
  `API_ORIGIN=https://api.jobtext.app` (PLACEHOLDERS).
- Optionally a PostHog project API key (`POSTHOG_API_KEY`) — analytics are a
  silent no-op without it ([06](./06-env-reference.md) §E).

### Generate the VAPID pair (once, keep forever)

Web Push keys are Worker secrets, generated once and **never rotated** (rotation
invalidates all push subscriptions — `apps/api/src/env.ts:44-50`,
`apps/api/.dev.vars.example:19`):

```bash
npx web-push generate-vapid-keys
```

Take the printed **Public Key** → `VAPID_PUBLIC_KEY` (base64url uncompressed P-256
point, 65 bytes) and **Private Key** → `VAPID_PRIVATE_KEY` (base64url scalar, 32
bytes).

---

## 2. Set the 21 API Worker secrets (before the first deploy)

CI does **not** set these — `deploy.yml` only runs `wrangler deploy`
(`.github/workflows/deploy.yml:58-62`). The Worker validates all 21 at startup and
`/health` re-validates, naming any missing key (`apps/api/src/env.ts:22-74,89-105`,
`apps/api/src/index.ts:88-92`). Set every one on `jobtext-api`. A 22nd,
`POSTHOG_API_KEY`, is **optional** — set it only if you want product analytics
(`apps/api/src/env.ts:65`).

### Option A — bulk (recommended)

Create a local, **uncommitted** JSON of `KEY: value` pairs (e.g.
`secrets.prod.json`), then:

```bash
# from the repo root; do NOT commit secrets.prod.json
pnpm --filter @jobtext/api exec wrangler secret bulk ./secrets.prod.json
```

### Option B — one at a time

Each command prompts for the value (paste, Enter):

```bash
cd apps/api   # or prefix each with: pnpm --filter @jobtext/api exec

pnpm exec wrangler secret put SUPABASE_URL
pnpm exec wrangler secret put SUPABASE_SECRET_KEY
pnpm exec wrangler secret put SUPABASE_JWKS_URL
pnpm exec wrangler secret put TELNYX_API_KEY
pnpm exec wrangler secret put TELNYX_PUBLIC_KEY
pnpm exec wrangler secret put TELNYX_VOICE_CONNECTION_ID
pnpm exec wrangler secret put STRIPE_SECRET_KEY
pnpm exec wrangler secret put STRIPE_WEBHOOK_SECRET
pnpm exec wrangler secret put RESEND_API_KEY
pnpm exec wrangler secret put RESEND_FROM
pnpm exec wrangler secret put SENTRY_DSN
pnpm exec wrangler secret put APP_ORIGIN
pnpm exec wrangler secret put API_ORIGIN
pnpm exec wrangler secret put VAPID_PUBLIC_KEY
pnpm exec wrangler secret put VAPID_PRIVATE_KEY
pnpm exec wrangler secret put STRIPE_STARTER_PRICE_ID
pnpm exec wrangler secret put STRIPE_PRO_PRICE_ID
pnpm exec wrangler secret put STRIPE_STARTER_OVERAGE_PRICE_ID
pnpm exec wrangler secret put STRIPE_PRO_OVERAGE_PRICE_ID
pnpm exec wrangler secret put STRIPE_US_FEE_PRICE_ID
pnpm exec wrangler secret put STRIPE_SMS_METER_EVENT_NAME

# OPTIONAL — only if you use PostHog product analytics:
pnpm exec wrangler secret put POSTHOG_API_KEY
```

That's the **complete set of 21 required** (`apps/api/src/env.ts:22-74`). Full
descriptions and formats are in [06 — env reference](./06-env-reference.md).
`wrangler.jsonc`'s `vars` is intentionally empty — every credential is a secret
(`apps/api/wrangler.jsonc:50`).

> **Not a secret:** the `SEND_RATE_LIMITER` per-company outbound rate limiter is
> a Workers rate-limiting binding declared in `apps/api/wrangler.jsonc:23-40`
> (limit 10 per 10 s per company ≈ 1 msg/s) and ships with `wrangler deploy` —
> nothing to `secret put`. Its `namespace_id` must be unique within your
> Cloudflare account ([06](./06-env-reference.md) §A.1).

> **Chicken-and-egg with `STRIPE_WEBHOOK_SECRET`:** you only get the `whsec_` after
> creating the Stripe endpoint in §4 (which needs the live API domain). It's fine to
> deploy first with a placeholder, then set the real secret and re-verify `/health`.
> `SUPABASE_URL`, `SUPABASE_JWKS_URL`, `SENTRY_DSN`, `APP_ORIGIN`, `API_ORIGIN` must
> all be valid **URLs** (zod `z.url()`, `apps/api/src/env.ts:23,25,38,39,41`) or
> startup fails.

---

## 3. Deploy the Workers

CI/Deploy does this automatically on merge to `main` (§5). To deploy **manually**:

### API Worker (`jobtext-api`)

```bash
pnpm --filter @jobtext/api exec wrangler deploy
```

This runs `wrangler deploy` (`apps/api/package.json:8`), which also **registers the
cron triggers** (§6) — no dashboard action needed.

### Web Worker (`jobtext-web`) — MUST build on Linux/WSL

```bash
# The NEXT_PUBLIC_* vars are inlined at build time and MUST be in the shell env.
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
NEXT_PUBLIC_API_URL=https://api.jobtext.app \
  pnpm --filter @jobtext/web run deploy
```

`run deploy` = `opennextjs-cloudflare build && opennextjs-cloudflare deploy`
(`apps/web/package.json:10`). **The OpenNext Cloudflare build must run on Linux or
WSL** (`SPEC.md:88,96`) — run it from CI or a WSL shell, not native Windows. If any
of the three required `NEXT_PUBLIC_*` are missing, the build throws
(`apps/web/src/env.ts:3-17,22-38`). If Supabase Auth captcha is enabled, also set
the optional `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in the build env; for the D27
marketing/app host split in production, also set `NEXT_PUBLIC_APP_ORIGIN`
([06](./06-env-reference.md) §B).

---

## 4. Custom domains / routes

Bind each Worker to its hostname (Cloudflare dashboard → Workers & Pages → the
Worker → **Settings → Domains & Routes → Add Custom Domain**, or `wrangler`):

| Worker | Custom domain(s) |
|--------|------------------|
| `jobtext-api` | `api.jobtext.app` |
| `jobtext-web` | `app.jobtext.app` **and** `jobtext.app` **and** `www.jobtext.app` — all three on the one Worker (D27) |

Adding a custom domain creates the proxied DNS record automatically (see
[01](./01-accounts-and-domain.md) §3). With the optional `NEXT_PUBLIC_APP_ORIGIN`
build var set (§5), the middleware enforces the D27 host split across those three
hostnames: marketing only on the apex (`www` → apex), the product only on `app.`
(`apps/web/src/lib/hosts.ts`). After this, confirm:

- `https://api.jobtext.app/health` returns `{"ok":true}` (`apps/api/src/index.ts:88-92`).
- `https://app.jobtext.app` loads the app.

The origins must match the secrets exactly: CORS is `APP_ORIGIN` with **no wildcard**
(`apps/api/src/index.ts:75`); the Telnyx/Stripe webhook URLs derive from `API_ORIGIN`.

---

## 5. GitHub Actions secrets + the CI/Deploy pipeline

### Set these repo/environment secrets

| Secret | Used by |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | `.github/workflows/deploy.yml:18` |
| `CLOUDFLARE_ACCOUNT_ID` | `.github/workflows/deploy.yml:19` |
| `NEXT_PUBLIC_SUPABASE_URL` | web build — `ci.yml:42`, `deploy.yml:20` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | web build — `ci.yml:43`, `deploy.yml:21` |
| `NEXT_PUBLIC_API_URL` | web build — `deploy.yml:22` (set to your API origin) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` *(optional)* | web build — `deploy.yml:23-26` (only if Supabase captcha is enabled; see below) |
| `NEXT_PUBLIC_APP_ORIGIN` *(optional)* | web build — `deploy.yml:27-30` (the D27 host split; production value `https://app.jobtext.app`, blank = no split) |
| `SUPABASE_ACCESS_TOKEN` | migrations — `deploy.yml:52` |
| `SUPABASE_DB_PASSWORD` | migrations — `deploy.yml:53` |
| `SUPABASE_PROJECT_REF` | migrations — `deploy.yml:55` |

### RESOLVED — `NEXT_PUBLIC_API_URL` is now wired into CI/Deploy

The previously documented gap is closed. `ci.yml` builds with a **fixed
placeholder** (`https://api.jobtext.app`, `.github/workflows/ci.yml:44-47`) — safe
because `apps/web/src/env.ts` only requires a syntactically valid URL and the CI
build artifact is never deployed. `deploy.yml` rebuilds with the real value from
the `NEXT_PUBLIC_API_URL` GitHub secret (`.github/workflows/deploy.yml:22`) — set
that secret (table above) or the automated web deploy builds against a missing
var and fails.

> **Captcha ordering:** the deploy job passes the optional
> `NEXT_PUBLIC_TURNSTILE_SITE_KEY` secret into the web build
> (`.github/workflows/deploy.yml:23-26`). If you plan to enable Supabase Auth
> captcha, **set this secret and redeploy web first** — enabling the dashboard
> setting against a build with no site key breaks every email/password signup,
> login, and password reset ([06](./06-env-reference.md) §B).

### What the pipeline does on merge to `main`

- **CI** (`ci.yml`) runs on PRs and pushes to `main`: **all SQL suites** against a
  from-zero `supabase db reset` via the root `db:test:ci` script (which delegates
  to `db:test:all`, `.github/workflows/ci.yml:28-32`, `package.json:28-29`), then
  typecheck/lint/test, `next build`, OpenNext build, and `wrangler deploy
  --dry-run` for the API (`.github/workflows/ci.yml:9-77`).
- **Deploy** (`deploy.yml`) runs on `workflow_run` of a **successful CI on `main`**,
  concurrency group `deploy-production` with no cancel-in-progress
  (`.github/workflows/deploy.yml:3-15`). Steps, in order
  (`.github/workflows/deploy.yml:31-62`):
  1. Checkout the exact `head_sha` that passed CI.
  2. `pnpm install --frozen-lockfile`.
  3. `supabase link --project-ref <ref>` → `supabase db push` (**migrations first**).
  4. `pnpm --filter @jobtext/api exec wrangler deploy` (API Worker).
  5. `pnpm --filter @jobtext/web run deploy` (OpenNext build + deploy).

---

## 6. Cron triggers (registered on API deploy)

Declared in `apps/api/wrangler.jsonc:11-21` (9 expressions), mapped to jobs in
`apps/api/src/index.ts:157-198`. Cloudflare registers them automatically on
`wrangler deploy` — no dashboard step. `scheduled()` throws on any unmapped cron
(`apps/api/src/index.ts:213-217`).

| Cron (UTC) | Jobs |
|------------|------|
| `*/5 * * * *` | Webhook sweeper — replay unprocessed `webhook_events` (both providers) |
| `*/15 * * * *` | `reconcileNumbers` + `retryCampaignAssignments` + `sweepDeletedAttachments` + `reconcileTextEnablement` + `reconcileVoiceEnablement` (provisioning retry/reconcile, attachment sweep, hosted-SMS order polling, voice binding) |
| `0 * * * *` | `reportUnreportedUsage` + `runUsageAlertsJob` (hourly usage re-report + 80%/100% alerts) |
| `30 * * * *` | `nudgeSoleProprietorOtp` (hourly) |
| `20 * * * *` | `geocodeContactsJob` (hourly contact-geocoding backfill, rate-limited Nominatim) |
| `0 13 * * *` | `pollRegistrations` (daily 10DLC registration poller + approved-campaign content migration) |
| `10 13 * * *` | `pollPortRequests` (daily port reconcile & resume) |
| `0 14 * * *` | `runGraceJob` (daily grace warnings + day-30 release) |
| `0 15 * * *` | `runSubscriptionReconcileJob` (daily subscription reconcile) |

Operational details in [08 — operations](./08-operations.md).

---

## 7. Sentry / PostHog wiring

- **Sentry:** DSN only. The whole Worker (fetch + scheduled) is wrapped by
  `Sentry.withSentry` with `sendDefaultPii: false`, `tracesSampleRate: 0`, and
  PII-scrubbing `beforeSend`/`beforeBreadcrumb`
  (`apps/api/src/index.ts:242`, `apps/api/src/observability/sentry.ts:117-125`).
  Setting `SENTRY_DSN` (§2) is the entire integration. **No web-side Sentry exists.**
- **PostHog:** optional. Setting `POSTHOG_API_KEY` (§2) is the entire
  integration — the API Worker captures the north-star funnel events with
  `distinct_id = company_id` only (no PII); unset, captures are silent no-ops
  (`apps/api/src/analytics/posthog.ts:31,40`). **No web-side PostHog exists.**

---

## 8. Register the live webhook URLs back into the vendors

Now that `api.jobtext.app` is live:

- **Stripe:** create/confirm the webhook endpoint at
  `https://api.jobtext.app/webhooks/stripe` with the 7 events, and set its `whsec_`
  as `STRIPE_WEBHOOK_SECRET` (re-run the relevant `wrangler secret put`). See
  [03](./03-stripe.md) §3.
- **Telnyx:** messaging needs nothing registered — the webhook URL is set
  **programmatically** per messaging profile from `API_ORIGIN`
  (`apps/api/src/telnyx/wizard.ts:140-142`). Just confirm `API_ORIGIN` on the
  Worker is `https://api.jobtext.app`, and that the **Call-Control application's**
  webhook + failover URL (entered once in the portal, [04](./04-telnyx.md) §1)
  point at the same live `https://api.jobtext.app/webhooks/telnyx`. See
  [04](./04-telnyx.md) §3.

After changing any secret, redeploy is **not** required for secret pickup, but
re-hit `GET https://api.jobtext.app/health` to confirm validation passes.

Next: [06 — env reference](./06-env-reference.md).
