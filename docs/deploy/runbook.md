# JobText — Production Deploy Runbook

Operator runbook to stand up and deploy JobText. Two Cloudflare Workers: **`jobtext-api`** (Hono API + crons) and **`jobtext-web`** (Next.js via OpenNext). Backing services: Supabase, Telnyx, Stripe, Resend, Sentry.

Read `env-and-secrets.md` alongside this — it is the authoritative variable inventory. Every command/setting below is traceable to code (`file:line`).

---

## 0. Prerequisites / toolchain

- **Node ≥ 22**, **pnpm ≥ 9** (`package.json:6-8`; CI uses node 22, `.github/workflows/ci.yml:55`).
- **wrangler ^4.106.0** (`apps/api/package.json:31`, `apps/web/package.json:55`).
- **Supabase CLI** (`supabase/setup-cli@v1`, `deploy.yml:46-48`).
- Cloudflare account + API token with Workers deploy permission.
- `pnpm install --frozen-lockfile` (`deploy.yml:43-44`).

Both Workers pin:
- `compatibility_date` = **`2026-06-01`** (`apps/api/wrangler.jsonc:5`, `apps/web/wrangler.jsonc:6`).
- `compatibility_flags` = **`["nodejs_compat"]`** (`apps/api/wrangler.jsonc:6`, `apps/web/wrangler.jsonc:7`). Required — stripe-node and supabase-js need Node compat on Workers.

---

## 1. Provision backing services (one-time)

### 1a. Supabase
1. Create the project. Note the **Project URL** and **Project ref**.
2. Copy keys from Project Settings → API:
   - **Secret key** `sb_secret_...` → api `SUPABASE_SECRET_KEY`.
   - **Publishable key** `sb_publishable_...` → web `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. **Enable an asymmetric (ES256) JWT signing key** in Authentication → JWT/Signing Keys, so a JWKS is published. The API verifies access tokens **ES256-only** against `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` (`apps/api/src/auth/jwt.ts:40-44`, `apps/api/src/test/support.ts:16-17`). With only the legacy HS256 secret, all `/v1/*` requests 401.
4. Record `SUPABASE_ACCESS_TOKEN` (personal access token), `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` for the CI migration step (`deploy.yml:52-55`).
5. **(Optional) signup captcha = Cloudflare Turnstile.** Create a Turnstile widget in the Cloudflare dashboard. The **secret** key goes into Supabase (Authentication → Attack Protection → CAPTCHA, provider Turnstile); the **site** key becomes the optional `NEXT_PUBLIC_TURNSTILE_SITE_KEY` web build var (`apps/web/src/env.ts:10`) — when set, signup/login/reset render Turnstile and pass the `captchaToken` to Supabase Auth. **Ordering matters:** get the site key into the deployed web build (the `NEXT_PUBLIC_TURNSTILE_SITE_KEY` GitHub secret, §3) **before** enabling captcha in the Supabase dashboard — with captcha enforced and no site key in the build, every email/password signup/login/reset fails (no token is ever sent).

### 1b. Stripe — create the catalog
Run the **checked-in idempotent setup script** once per Stripe mode (test, then live). It finds-or-creates the Meter, Products, and Prices and prints the exact env lines (`apps/api/scripts/stripe-setup.ts:1-20,165-171`):

```
STRIPE_SECRET_KEY=sk_live_... pnpm --filter @jobtext/api stripe:setup
```

It creates (`stripe-setup.ts:39-163`):
- **Billing Meter** `sms_segments` — sum aggregation, customer mapping by `stripe_customer_id`, value from `value` (`:49-55`).
- **Products** (SaaS tax code `txcd_10103000`): `JobText Starter`, `JobText Pro`, `US texting registration` (`:25,73-77,102-107`).
- **Prices**: Starter licensed $29/mo (`:110-116`); Starter overage graduated 0–500 @ $0 then $0.03 (`:119-130`); Pro licensed $79/mo (`:133-139`); Pro overage graduated 0–2,500 @ $0 then $0.025 (`:144-155`); US registration $29 one-time (`:158-163`). All `tax_behavior: exclusive`.

Copy the 6 printed lines (`STRIPE_STARTER_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_STARTER_OVERAGE_PRICE_ID`, `STRIPE_PRO_OVERAGE_PRICE_ID`, `STRIPE_US_FEE_PRICE_ID`, `STRIPE_SMS_METER_EVENT_NAME`) into the api secrets. Re-running is safe (idempotent by `event_name` / `metadata.jobtext_catalog` / `lookup_key`, `:39-98`).

### 1c. Stripe — webhook endpoint
Create a webhook endpoint pointing at **`${API_ORIGIN}/webhooks/stripe`** (route mounted at `apps/api/src/index.ts:129`). Copy its **signing secret** `whsec_...` → `STRIPE_WEBHOOK_SECRET`. Also create a **restricted key** `rk_live_...` for the runtime (scope in `env-and-secrets.md` §Stripe).

### 1d. Telnyx
1. Create a **V2 API Key** (Account → API Keys) → `TELNYX_API_KEY`.
2. Copy the **webhook-signing public key** (Ed25519, base64) → `TELNYX_PUBLIC_KEY` (`apps/api/src/telnyx/verify.ts:5-11`).
3. Create **one Call-Control application** (Voice → Call Control / Programmable Voice) with webhook URL **and** failover URL both **`${API_ORIGIN}/webhooks/telnyx`** — the same endpoint as messaging; `call.*` events carry the same Ed25519 signature. Copy the application id → `TELNYX_VOICE_CONNECTION_ID` (`apps/api/src/env.ts:28-34`). The Worker binds numbers' voice settings to it for the missed-call text-back (`apps/api/src/telnyx/voice.ts:73,88-101`).
4. The API auto-creates a per-company **messaging profile** during number provisioning and sets its webhook URL + failover URL to **`${API_ORIGIN}/webhooks/telnyx`** (`apps/api/src/telnyx/provisioning.ts:22-23`, `apps/api/src/telnyx/wizard.ts:141`). No manual profile is required, but the account must permit US/CA geo and 10DLC.

### 1e. Resend
1. Verify the sending domain (e.g. `jobtext.app`).
2. Create an API key `re_...` → `RESEND_API_KEY`.
3. Set `RESEND_FROM` to `JobText <notifications@jobtext.app>` (the domain must be verified) (`apps/api/src/email/resend.ts:35`).

### 1f. Sentry
Create a project, copy the **DSN** → `SENTRY_DSN` (`apps/api/src/observability/sentry.ts:117-125`). No web-side Sentry exists.

### 1g. VAPID pair (Web Push)
Generate **once** and keep forever:

```
npx web-push generate-vapid-keys
```

→ `VAPID_PUBLIC_KEY` (65-byte P-256 point, base64url) and `VAPID_PRIVATE_KEY` (32-byte scalar) (`apps/api/src/env.ts:44-50`, `.dev.vars.example:19`). Rotating invalidates all push subscriptions.

### 1h. PostHog (optional)
Product analytics is one optional secret: a PostHog Cloud US **Project API key** → `POSTHOG_API_KEY` (`apps/api/src/env.ts:65`). Unset, every capture is a silent no-op (`apps/api/src/analytics/posthog.ts:31`); `distinct_id` is always the company_id, never PII.

---

## 2. Set API Worker secrets (before first deploy)

CI does **NOT** set these — `deploy.yml` only runs `wrangler deploy` (`deploy.yml:58-62`). Set all 21 required manually, once, on `jobtext-api` (plus `POSTHOG_API_KEY` if you use analytics). Fastest path is a bulk put:

```
# from apps/api, with a filled .dev.vars-style file of KEY=VALUE lines (do NOT commit it)
pnpm --filter @jobtext/api exec wrangler secret bulk ./secrets.prod.json
```

Or one at a time: `pnpm --filter @jobtext/api exec wrangler secret put SUPABASE_URL` (repeat). The full required set (all from `apps/api/src/env.ts:22-74`):

```
SUPABASE_URL SUPABASE_SECRET_KEY SUPABASE_JWKS_URL
TELNYX_API_KEY TELNYX_PUBLIC_KEY TELNYX_VOICE_CONNECTION_ID
STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET
RESEND_API_KEY RESEND_FROM
SENTRY_DSN
APP_ORIGIN API_ORIGIN
VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY
STRIPE_STARTER_PRICE_ID STRIPE_PRO_PRICE_ID
STRIPE_STARTER_OVERAGE_PRICE_ID STRIPE_PRO_OVERAGE_PRICE_ID
STRIPE_US_FEE_PRICE_ID STRIPE_SMS_METER_EVENT_NAME
```

Optional 22nd: `POSTHOG_API_KEY` (§1h). **Not a secret:** the `SEND_RATE_LIMITER` per-company outbound rate limiter is a Workers `ratelimit` binding declared in `apps/api/wrangler.jsonc:23-40` (limit 10 per 10 s ≈ 1 msg/s; `namespace_id` must be account-unique) and ships with `wrangler deploy` — nothing to put.

Verify: after deploy, `GET ${API_ORIGIN}/health` re-runs env validation and 500s (naming missing keys) if any secret is absent (`apps/api/src/index.ts:88-92`, `env.ts:94-100`).

---

## 3. Configure GitHub Actions secrets

Set these **8 required** repo/environment secrets so CI + Deploy work (`.github/workflows/`):

`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_API_URL`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`.

`NEXT_PUBLIC_API_URL` is wired in: the deploy job builds the web Worker with it (`deploy.yml:22`), while CI builds with a fixed placeholder (`ci.yml:44-47` — the CI artifact is never deployed), so only the Deploy-side secret is needed.

> **Optional secrets (the deploy job passes both into the web build):**
> - `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (`deploy.yml:23-26`) — only needed if you enable Supabase Auth captcha (§1a step 5), but then it is **required first**: enable captcha in the Supabase dashboard only **after** this secret is set and the web Worker redeployed, or every email/password signup/login/reset breaks (the built pages send no `captchaToken`).
> - `NEXT_PUBLIC_APP_ORIGIN` (`deploy.yml:27-30`) — the D27 marketing/app host split (`apps/web/src/env.ts:11-16`, `apps/web/src/lib/hosts.ts`). Production value `https://app.jobtext.app` (must equal the api `APP_ORIGIN` secret). When set, the middleware serves only marketing on `jobtext.app` (+ `www` → apex canonicalization) and only the product on the app origin; blank = no gating (dev/CI). Requires `jobtext.app`, `www.jobtext.app`, and `app.jobtext.app` all attached as custom domains on the one web Worker (§6). Supabase/Stripe return URLs stay on `APP_ORIGIN` unchanged.

---

## 4. Deploy pipeline (what happens on merge to main)

Trigger: `Deploy` runs on `workflow_run` of `CI` completing successfully on `main` (`deploy.yml:3-15`). Concurrency group `deploy-production`, no cancel-in-progress (`deploy.yml:9-11`). Steps (`deploy.yml:31-62`), in order:

1. **Checkout** the exact `head_sha` that passed CI (`:32-34`).
2. **Install** `pnpm install --frozen-lockfile` (`:43-44`).
3. **Push DB migrations**: `supabase link --project-ref <ref>` then `supabase db push` (`:50-56`).
4. **Deploy api**: `pnpm --filter @jobtext/api exec wrangler deploy` (`:58-59`) → `wrangler deploy` (`apps/api/package.json:8`).
5. **Deploy web**: `pnpm --filter @jobtext/web run deploy` (`:61-62`) → `opennextjs-cloudflare build && opennextjs-cloudflare deploy` (`apps/web/package.json:10`).

CI gates first (`ci.yml`): **all SQL suites** on a from-zero `supabase db reset` via the root `db:test:ci` script (delegates to `db:test:all` — `ci.yml:22-32`, `package.json:28-29`), then typecheck/lint/test, `next build`, OpenNext build, and `wrangler deploy --dry-run` for api (`ci.yml:58-77`).

### Manual deploy (equivalent)
```
# migrations
supabase link --project-ref <SUPABASE_PROJECT_REF>
supabase db push
# api
pnpm --filter @jobtext/api exec wrangler deploy
# web (build inlines NEXT_PUBLIC_* — must be in the shell env;
# add NEXT_PUBLIC_TURNSTILE_SITE_KEY=... only if Supabase captcha is enabled,
# and NEXT_PUBLIC_APP_ORIGIN=... for the D27 host split in production)
NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... NEXT_PUBLIC_API_URL=... \
  pnpm --filter @jobtext/web run deploy
```

---

## 5. Cron schedule (api Worker)

Declared in `apps/api/wrangler.jsonc:11-21` (9 expressions); mapped to jobs in `apps/api/src/index.ts:157-198`. `scheduled()` fails loudly on any unmapped cron (`index.ts:213-217`). Cloudflare registers these automatically on `wrangler deploy` — no dashboard action.

| Cron (UTC) | Jobs |
| --- | --- |
| `*/5 * * * *` | Webhook sweeper — replay unprocessed `webhook_events` (both providers) (`index.ts:159`). |
| `*/15 * * * *` | `reconcileNumbers` + `retryCampaignAssignments` + `sweepDeletedAttachments` + `reconcileTextEnablement` + `reconcileVoiceEnablement` — provisioning retry/reconcile, §4.4 R3 assignment retry, deleted-attachment sweep, keep-your-number hosted-SMS order polling, missed-call voice binding (`index.ts:165-176`). |
| `0 * * * *` | `reportUnreportedUsage` + `runUsageAlertsJob` — usage re-report then 80%/100% alerts (`index.ts:179`). |
| `30 * * * *` | `nudgeSoleProprietorOtp` (`index.ts:181`). |
| `20 * * * *` | `geocodeContactsJob` — contact geocoding backfill, rate-limited Nominatim (`index.ts:185`). |
| `0 13 * * *` | `pollRegistrations` — 10DLC registration poller (daily fallback) + approved-campaign declared-content migration (`index.ts:187`, `telnyx/registration.ts:790-823`). |
| `10 13 * * *` | `pollPortRequests` — port reconcile & resume, PORTING.md §5.2 (`index.ts:191`). |
| `0 14 * * *` | `runGraceJob` — grace warnings + day-30 release (`index.ts:194`). |
| `0 15 * * *` | `runSubscriptionReconcileJob` — re-mirror non-active companies from Stripe (`index.ts:197`). |

`apps/api/src/mount.test.ts` asserts this list stays in lockstep with `wrangler.jsonc`.

---

## 6. Vendor dashboard callback URLs (must match origins)

| Setting | Value | Source |
| --- | --- | --- |
| Stripe webhook endpoint | `${API_ORIGIN}/webhooks/stripe` | `index.ts:129` |
| Telnyx webhook URL + failover (per messaging profile, auto-set) | `${API_ORIGIN}/webhooks/telnyx` | `telnyx/wizard.ts:141`, `telnyx/provisioning.ts:22-23` |
| Telnyx Call-Control app webhook + failover (manual, once — §1d) | `${API_ORIGIN}/webhooks/telnyx` | `apps/api/src/env.ts:28-34` |
| CORS allow-origin (API) | exactly `APP_ORIGIN` (no wildcard) | `index.ts:75` |
| Stripe checkout return URLs | `${APP_ORIGIN}/dashboard?...`, `${APP_ORIGIN}/settings/billing` | `routes/billing.ts:171-172,199` |

`API_ORIGIN`, `APP_ORIGIN` (api secrets) and `NEXT_PUBLIC_API_URL` (web) must all agree with the actual deployed Worker URLs, or webhooks/CORS/links break.

**Custom domains (D27):** the ONE `jobtext-web` Worker carries **three** custom domains — `jobtext.app`, `www.jobtext.app`, and `app.jobtext.app`; `jobtext-api` carries `api.jobtext.app`. With the optional `NEXT_PUBLIC_APP_ORIGIN` secret set (§3), the middleware serves only marketing on the apex (+ `www` → apex) and only the product on `app.` (`apps/web/src/lib/hosts.ts`). Supabase/Stripe return URLs stay on `APP_ORIGIN` unchanged.

---

## 7. Post-deploy verification

1. `GET ${API_ORIGIN}/health` → `{"ok":true}` (env fully valid) (`index.ts:88-92`).
2. Load `${APP_ORIGIN}` and confirm the SPA renders and calls `${NEXT_PUBLIC_API_URL}`.
3. Trigger a Stripe test event → confirm 2xx at `/webhooks/stripe`.
4. Confirm the `*/5` sweeper cron fires (Cloudflare → Worker → Cron/Triggers, or `wrangler tail`).
5. Confirm migrations landed (`supabase db push` output; CI schema suite already gates them).
