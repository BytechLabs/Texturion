# JobText — Production Deploy Runbook

Operator runbook to stand up and deploy JobText. Two Cloudflare Workers: **`jobtext-api`** (Hono API + crons) and **`jobtext-web`** (Next.js via OpenNext). Backing services: Supabase, Telnyx, Stripe, Resend, Sentry.

Read `env-and-secrets.md` alongside this — it is the authoritative variable inventory. Every command/setting below is traceable to code (`file:line`).

---

## 0. Prerequisites / toolchain

- **Node ≥ 22**, **pnpm ≥ 9** (`package.json:6-8`; CI uses node 22, `.github/workflows/ci.yml:44`).
- **wrangler ^4.106.0** (`apps/api/package.json:31`, `apps/web/package.json:55`).
- **Supabase CLI** (`supabase/setup-cli@v1`, `deploy.yml:37-39`).
- Cloudflare account + API token with Workers deploy permission.
- `pnpm install --frozen-lockfile` (`deploy.yml:35`).

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
4. Record `SUPABASE_ACCESS_TOKEN` (personal access token), `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` for the CI migration step (`deploy.yml:43-46`).

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
Create a webhook endpoint pointing at **`${API_ORIGIN}/webhooks/stripe`** (route mounted at `apps/api/src/index.ts:114`). Copy its **signing secret** `whsec_...` → `STRIPE_WEBHOOK_SECRET`. Also create a **restricted key** `rk_live_...` for the runtime (scope in `env-and-secrets.md` §Stripe).

### 1d. Telnyx
1. Create a **V2 API Key** (Account → API Keys) → `TELNYX_API_KEY`.
2. Copy the **webhook-signing public key** (Ed25519, base64) → `TELNYX_PUBLIC_KEY` (`apps/api/src/telnyx/verify.ts:5-11`).
3. The API auto-creates a per-company **messaging profile** during number provisioning and sets its webhook URL + failover URL to **`${API_ORIGIN}/webhooks/telnyx`** (`apps/api/src/telnyx/provisioning.ts:22-23`, `apps/api/src/telnyx/wizard.ts:141`). No manual profile is required, but the account must permit US/CA geo and 10DLC.

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

→ `VAPID_PUBLIC_KEY` (65-byte P-256 point, base64url) and `VAPID_PRIVATE_KEY` (32-byte scalar) (`apps/api/src/env.ts:23-29`, `.dev.vars.example:16`). Rotating invalidates all push subscriptions.

---

## 2. Set API Worker secrets (before first deploy)

CI does **NOT** set these — `deploy.yml` only runs `wrangler deploy` (`deploy.yml:49-53`). Set all 20 manually, once, on `jobtext-api`. Fastest path is a bulk put:

```
# from apps/api, with a filled .dev.vars-style file of KEY=VALUE lines (do NOT commit it)
pnpm --filter @jobtext/api exec wrangler secret bulk ./secrets.prod.json
```

Or one at a time: `pnpm --filter @jobtext/api exec wrangler secret put SUPABASE_URL` (repeat). The full required set (all from `apps/api/src/env.ts:8-39`):

```
SUPABASE_URL SUPABASE_SECRET_KEY SUPABASE_JWKS_URL
TELNYX_API_KEY TELNYX_PUBLIC_KEY
STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET
RESEND_API_KEY RESEND_FROM
SENTRY_DSN
APP_ORIGIN API_ORIGIN
VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY
STRIPE_STARTER_PRICE_ID STRIPE_PRO_PRICE_ID
STRIPE_STARTER_OVERAGE_PRICE_ID STRIPE_PRO_OVERAGE_PRICE_ID
STRIPE_US_FEE_PRICE_ID STRIPE_SMS_METER_EVENT_NAME
```

Verify: after deploy, `GET ${API_ORIGIN}/health` re-runs env validation and 500s (naming missing keys) if any secret is absent (`apps/api/src/index.ts:78-82`, `env.ts:59-66`).

---

## 3. Configure GitHub Actions secrets

Set these repo/environment secrets so CI + Deploy work (`.github/workflows/`):

`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`.

> `NEXT_PUBLIC_API_URL` is **not** wired in CI. The web build (`ci.yml:60-64`, `deploy.yml:52-53`) will produce a bundle whose `apps/web/src/env.ts:19-24` throws at runtime unless this is present in the build env. Add `NEXT_PUBLIC_API_URL` to both the `ci` job env (`ci.yml:34-37`) and the deploy job env (`deploy.yml:17-21`) — but that edit is outside this runbook's write scope (it touches `.github/**`); flag it to whoever owns CI.

---

## 4. Deploy pipeline (what happens on merge to main)

Trigger: `Deploy` runs on `workflow_run` of `CI` completing successfully on `main` (`deploy.yml:3-15`). Concurrency group `deploy-production`, no cancel-in-progress (`deploy.yml:9-11`). Steps (`deploy.yml:22-53`), in order:

1. **Checkout** the exact `head_sha` that passed CI (`:23-25`).
2. **Install** `pnpm install --frozen-lockfile` (`:34-35`).
3. **Push DB migrations**: `supabase link --project-ref <ref>` then `supabase db push` (`:41-47`).
4. **Deploy api**: `pnpm --filter @jobtext/api exec wrangler deploy` (`:49-50`) → `wrangler deploy` (`apps/api/package.json:8`).
5. **Deploy web**: `pnpm --filter @jobtext/web run deploy` (`:52-53`) → `opennextjs-cloudflare build && opennextjs-cloudflare deploy` (`apps/web/package.json:10`).

CI gates first (`ci.yml`): schema tests on a from-zero `supabase db reset` (`ci.yml:22-26`), then typecheck/lint/test, `next build`, OpenNext build, and `wrangler deploy --dry-run` for api (`ci.yml:51-67`).

### Manual deploy (equivalent)
```
# migrations
supabase link --project-ref <SUPABASE_PROJECT_REF>
supabase db push
# api
pnpm --filter @jobtext/api exec wrangler deploy
# web (build inlines NEXT_PUBLIC_* — must be in the shell env)
NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... NEXT_PUBLIC_API_URL=... \
  pnpm --filter @jobtext/web run deploy
```

---

## 5. Cron schedule (api Worker)

Declared in `apps/api/wrangler.jsonc:11-19`; mapped to jobs in `apps/api/src/index.ts:142-162`. `scheduled()` fails loudly on any unmapped cron (`index.ts:176-180`). Cloudflare registers these automatically on `wrangler deploy` — no dashboard action.

| Cron (UTC) | Jobs |
| --- | --- |
| `*/5 * * * *` | Webhook sweeper — replay unprocessed `webhook_events` (both providers) (`index.ts:144`). |
| `*/15 * * * *` | `reconcileNumbers` + `retryCampaignAssignments` — provisioning retry/reconcile, §4.4 R3 assignment retry (`index.ts:148`). |
| `0 * * * *` | `reportUnreportedUsage` + `runUsageAlertsJob` — usage re-report then 80%/100% alerts (`index.ts:151`). |
| `30 * * * *` | `nudgeSoleProprietorOtp` (`index.ts:153`). |
| `0 13 * * *` | `pollRegistrations` — 10DLC registration poller (daily fallback) (`index.ts:155`). |
| `0 14 * * *` | `runGraceJob` — grace warnings + day-30 release (`index.ts:158`). |
| `0 15 * * *` | `runSubscriptionReconcileJob` — re-mirror non-active companies from Stripe (`index.ts:161`). |

`apps/api/src/mount.test.ts` asserts this list stays in lockstep with `wrangler.jsonc`.

---

## 6. Vendor dashboard callback URLs (must match origins)

| Setting | Value | Source |
| --- | --- | --- |
| Stripe webhook endpoint | `${API_ORIGIN}/webhooks/stripe` | `index.ts:114` |
| Telnyx webhook URL + failover (per messaging profile, auto-set) | `${API_ORIGIN}/webhooks/telnyx` | `telnyx/wizard.ts:141`, `telnyx/provisioning.ts:22-23` |
| CORS allow-origin (API) | exactly `APP_ORIGIN` (no wildcard) | `index.ts:65` |
| Stripe checkout return URLs | `${APP_ORIGIN}/dashboard?...`, `${APP_ORIGIN}/settings/billing` | `routes/billing.ts:171-172,199` |

`API_ORIGIN`, `APP_ORIGIN` (api secrets) and `NEXT_PUBLIC_API_URL` (web) must all agree with the actual deployed Worker URLs, or webhooks/CORS/links break.

---

## 7. Post-deploy verification

1. `GET ${API_ORIGIN}/health` → `{"ok":true}` (env fully valid) (`index.ts:78-82`).
2. Load `${APP_ORIGIN}` and confirm the SPA renders and calls `${NEXT_PUBLIC_API_URL}`.
3. Trigger a Stripe test event → confirm 2xx at `/webhooks/stripe`.
4. Confirm the `*/5` sweeper cron fires (Cloudflare → Worker → Cron/Triggers, or `wrangler tail`).
5. Confirm migrations landed (`supabase db push` output; CI schema suite already gates them).
