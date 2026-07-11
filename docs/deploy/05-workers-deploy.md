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
- 10 `STRIPE_*` catalog IDs (6 plan/meter + the 4 `STRIPE_MODULE_*_PRICE_ID`
  add-on prices), `STRIPE_WEBHOOK_SECRET` (can be set after the webhook endpoint
  exists in §4), restricted `STRIPE_SECRET_KEY`.
- `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, `TELNYX_VOICE_CONNECTION_ID` (the
  Call-Control application id from [04](./04-telnyx.md) §1).
- Resend key + verified `RESEND_FROM`; Sentry DSN.
- The two chosen origins: `APP_ORIGIN=https://app.loonext.com`,
  `API_ORIGIN=https://api.loonext.com` (PLACEHOLDERS).
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

## 2. Set the 25 API Worker secrets (before the first deploy)

CI does **not** set these — `deploy.yml` only runs `wrangler deploy`
(`.github/workflows/deploy.yml:58-62`). The Worker validates the schema at startup
and `/health` re-validates, naming any missing key
(`apps/api/src/env.ts:22-104,119-135`, `apps/api/src/index.ts:88-92`). Set every
one on `loonext-api`. A 26th, `POSTHOG_API_KEY`, is **optional** — set it only if
you want product analytics (`apps/api/src/env.ts:75`).

> **The four `STRIPE_MODULE_*_PRICE_ID` secrets are launch-required even though
> the schema marks them optional** (`apps/api/src/env.ts:64-67` — optional only
> so the Worker can boot before the Stripe catalog exists). With any of them
> unset, that opt-in add-on (Picture messages $5/mo, Calling $8/mo,
> Extra storage $5/mo) is refused at checkout and in the module toggle as
> "isn't available yet" (`apps/api/src/routes/billing.ts:190-200,553-559`) —
> skipping them silently disables sellable revenue. Set all four; `regions_ca`
> additionally stays coming-soon in the product regardless of its price id
> (`apps/api/src/billing/company-modules.ts:26-33`).

### Option A — bulk (recommended)

Create a local, **uncommitted** JSON of `KEY: value` pairs (e.g.
`secrets.prod.json`), then:

```bash
# from the repo root; do NOT commit secrets.prod.json
pnpm --filter @loonext/api exec wrangler secret bulk ./secrets.prod.json
```

### Option B — one at a time

Each command prompts for the value (paste, Enter):

```bash
cd apps/api   # or prefix each with: pnpm --filter @loonext/api exec

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

# Module add-on prices (launch-required — modules are unsellable without them):
pnpm exec wrangler secret put STRIPE_MODULE_MMS_PRICE_ID
pnpm exec wrangler secret put STRIPE_MODULE_VOICE_PRICE_ID
pnpm exec wrangler secret put STRIPE_MODULE_EXTRA_STORAGE_PRICE_ID
pnpm exec wrangler secret put STRIPE_MODULE_REGIONS_CA_PRICE_ID

# OPTIONAL — only if you use PostHog product analytics:
pnpm exec wrangler secret put POSTHOG_API_KEY
```

That's the **complete set of 25 required for launch** (`apps/api/src/env.ts:22-104`).
Full descriptions and formats are in [06 — env reference](./06-env-reference.md).
`wrangler.jsonc`'s `vars` is intentionally empty — every credential is a secret
(`apps/api/wrangler.jsonc:64`).

> **Not secrets:** the **two** rate-limiter bindings — `SEND_RATE_LIMITER` (the
> per-company outbound limiter, limit 10 per 10 s ≈ 1 msg/s) and
> `VERIFY_RATE_LIMITER` (the keep-your-number verification limiter, limit 3 per
> 60 s per target number) — are Workers rate-limiting bindings declared in
> `apps/api/wrangler.jsonc:23-54` and ship with `wrangler deploy`, nothing to
> `secret put`. Each `namespace_id` (`"1001"` / `"1002"`) must be unique within
> your Cloudflare account ([06](./06-env-reference.md) §A.1).

> **Chicken-and-egg with `STRIPE_WEBHOOK_SECRET`:** you only get the `whsec_` after
> creating the Stripe endpoint in §4 (which needs the live API domain). It's fine to
> deploy first with a placeholder, then set the real secret and re-verify `/health`.
> `SUPABASE_URL`, `SUPABASE_JWKS_URL`, `SENTRY_DSN`, `APP_ORIGIN`, `API_ORIGIN` must
> all be valid **URLs** (zod `z.url()`, `apps/api/src/env.ts:23,25,38,39,41`) or
> startup fails.

---

## 3. Deploy the Workers

CI/Deploy does this automatically on merge to `main` (§5). To deploy **manually**:

### API Worker (`loonext-api`)

```bash
pnpm --filter @loonext/api exec wrangler deploy
```

This runs `wrangler deploy` (`apps/api/package.json:8`), which also **registers the
cron triggers** (§6) — no dashboard action needed.

### Web Worker (`loonext-web`) — MUST build on Linux/WSL

```bash
# The NEXT_PUBLIC_* vars are inlined at build time and MUST be in the shell env.
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
NEXT_PUBLIC_API_URL=https://api.loonext.com \
  pnpm --filter @loonext/web run deploy
```

`run deploy` = `opennextjs-cloudflare build && opennextjs-cloudflare deploy`
(`apps/web/package.json:11`). **The OpenNext Cloudflare build must run on Linux or
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
| `loonext-api` | `api.loonext.com` |
| `loonext-web` | `app.loonext.com` **and** `loonext.com` **and** `www.loonext.com` — all three on the one Worker (D27) |

Adding a custom domain creates the proxied DNS record automatically (see
[01](./01-accounts-and-domain.md) §3). With the optional `NEXT_PUBLIC_APP_ORIGIN`
build var set (§5), the middleware enforces the D27 host split across those three
hostnames: marketing only on the apex (`www` → apex), the product only on `app.`
(`apps/web/src/lib/hosts.ts`). After this, confirm:

- `https://api.loonext.com/health` returns `{"ok":true}` (`apps/api/src/index.ts:88-92`).
- `https://app.loonext.com` loads the app.

The origins must match the secrets exactly: CORS is `APP_ORIGIN` with **no wildcard**
(`apps/api/src/index.ts:75`); the Telnyx/Stripe webhook URLs derive from `API_ORIGIN`.

---

## 5. GitHub Actions secrets + the CI/Deploy pipeline

### Set these repo/environment secrets

| Secret | Used by |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | `.github/workflows/deploy.yml:18` |
| `CLOUDFLARE_ACCOUNT_ID` | `.github/workflows/deploy.yml:19` |
| `NEXT_PUBLIC_SUPABASE_URL` | web build — `deploy.yml:20` (CI uses a fixed placeholder — `ci.yml:90`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | web build — `deploy.yml:21` (CI uses a fixed placeholder — `ci.yml:91`) |
| `NEXT_PUBLIC_API_URL` | web build — `deploy.yml:22` (set to your API origin) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` *(optional)* | web build — `deploy.yml:23-26` (only if Supabase captcha is enabled; see below) |
| `NEXT_PUBLIC_APP_ORIGIN` *(optional)* | web build — `deploy.yml:27-30` (the D27 host split; production value `https://app.loonext.com`, blank = no split) |
| `SUPABASE_ACCESS_TOKEN` | migrations — `deploy.yml:52` |
| `SUPABASE_DB_PASSWORD` | migrations — `deploy.yml:53` |
| `SUPABASE_PROJECT_REF` | migrations — `deploy.yml:55` |

### RESOLVED — `NEXT_PUBLIC_API_URL` is now wired into CI/Deploy

The previously documented gap is closed. `ci.yml` builds with **fixed
placeholders for all three required `NEXT_PUBLIC_*` vars**
(`.github/workflows/ci.yml:81-92`) — safe because `apps/web/src/env.ts` only
validates shape and the CI build artifact is never deployed; CI reads no repo
secrets at all. `deploy.yml` rebuilds with the real values from the GitHub
secrets (`.github/workflows/deploy.yml:20-22`) — set them (table above) or the
automated web deploy builds against a missing var and fails.

> **Captcha ordering:** the deploy job passes the optional
> `NEXT_PUBLIC_TURNSTILE_SITE_KEY` secret into the web build
> (`.github/workflows/deploy.yml:23-26`). If you plan to enable Supabase Auth
> captcha, **set this secret and redeploy web first** — enabling the dashboard
> setting against a build with no site key breaks every email/password signup,
> login, and password reset ([06](./06-env-reference.md) §B).

### What the pipeline does on merge to `main`

- **CI** (`ci.yml`) runs on PRs and pushes to `main`: **all SQL suites** against a
  from-zero `supabase db reset` via the root `db:test:ci` script (which delegates
  to `db:test:all`, `.github/workflows/ci.yml:31-32`, `package.json:35-36`), the
  hermetic launch-pass E2E job (`.github/workflows/ci.yml:38-77`), then
  typecheck/lint/test, `next build`, OpenNext build, and `wrangler deploy
  --dry-run` for the API (`.github/workflows/ci.yml:79-122`).
- **Deploy** (`deploy.yml`) runs on `workflow_run` of a **successful CI on `main`**,
  concurrency group `deploy-production` with no cancel-in-progress
  (`.github/workflows/deploy.yml:3-15`). Steps, in order
  (`.github/workflows/deploy.yml:31-62`):
  1. Checkout the exact `head_sha` that passed CI.
  2. `pnpm install --frozen-lockfile`.
  3. `supabase link --project-ref <ref>` → `supabase db push` (**migrations first**).
  4. `pnpm --filter @loonext/api exec wrangler deploy` (API Worker).
  5. `pnpm --filter @loonext/web run deploy` (OpenNext build + deploy).

---

## 6. Cron triggers (registered on API deploy)

Declared in `apps/api/wrangler.jsonc:11-21` (9 expressions), mapped to jobs in
`apps/api/src/index.ts:156-200`. Cloudflare registers them automatically on
`wrangler deploy` — no dashboard step. `scheduled()` throws on any unmapped cron
(`apps/api/src/index.ts:215-219`).

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
  (`apps/api/src/index.ts:244`, `apps/api/src/observability/sentry.ts:117-125`).
  Setting `SENTRY_DSN` (§2) is the entire integration. **No web-side Sentry exists.**
- **PostHog:** optional. Setting `POSTHOG_API_KEY` (§2) is the entire
  integration — the API Worker captures the north-star funnel events with
  `distinct_id = company_id` only (no PII); unset, captures are silent no-ops
  (`apps/api/src/analytics/posthog.ts:31,40`). **No web-side PostHog exists.**

---

## 8. Register the live webhook URLs back into the vendors

Now that `api.loonext.com` is live:

- **Stripe:** create/confirm the webhook endpoint at
  `https://api.loonext.com/webhooks/stripe` with the 7 events, and set its `whsec_`
  as `STRIPE_WEBHOOK_SECRET` (re-run the relevant `wrangler secret put`). See
  [03](./03-stripe.md) §3.
- **Telnyx:** messaging needs nothing registered — the webhook URL is set
  **programmatically** per messaging profile from `API_ORIGIN`
  (`apps/api/src/telnyx/wizard.ts:140-142`). Just confirm `API_ORIGIN` on the
  Worker is `https://api.loonext.com`, and that the **Call-Control application's**
  webhook + failover URL (entered once in the portal, [04](./04-telnyx.md) §1)
  point at the same live `https://api.loonext.com/webhooks/telnyx`. See
  [04](./04-telnyx.md) §3.

After changing any secret, redeploy is **not** required for secret pickup, but
re-hit `GET https://api.loonext.com/health` to confirm validation passes.

Next: [06 — env reference](./06-env-reference.md).
