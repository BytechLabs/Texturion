# Loonext — Production Deploy Runbook

The operator's authoritative guide to standing up and deploying **Loonext** in
production. Loonext is two Cloudflare Workers plus five backing SaaS vendors:

- **`loonext-web`** — Next.js 15, deployed to Cloudflare Workers via the
  `@opennextjs/cloudflare` adapter (`apps/web/wrangler.jsonc:3`, `apps/web/package.json:11`).
- **`loonext-api`** — Hono API + scheduled cron jobs, deployed with `wrangler deploy`
  (`apps/api/wrangler.jsonc:3`, `apps/api/package.json:8`).
- **Supabase** (Postgres 17, Auth, Storage), **Telnyx** (SMS/MMS + 10DLC),
  **Stripe** (billing + usage metering), **Resend** (transactional email +
  Supabase Auth SMTP), **Sentry** (API error tracking).

Every command, secret name, dashboard setting, and URL below was verified
against the committed source — each fact cites its `file:line`. Nothing is
invented. Where a value is genuinely the operator's choice (domain names,
account emails) it is marked **PLACEHOLDER** with a worked example.

> **Running example used throughout** (replace with your real values):
> web = `https://app.loonext.com`, api = `https://api.loonext.com`,
> marketing root = `https://loonext.com`, Supabase project ref = `abcdefghijklmnop`.

---

## Deploy order at a glance

Provisioning must happen in this order — later steps consume IDs/keys produced
by earlier ones.

| # | Step | Page | Produces |
|---|------|------|----------|
| 1 | Create all accounts + register the domain, plan DNS | [01-accounts-and-domain.md](./01-accounts-and-domain.md) | The 3 hostnames, a Cloudflare zone |
| 2 | Supabase Pro project (US), **ES256 signing key**, migrations, keys | [02-supabase.md](./02-supabase.md) | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`, publishable key, `SUPABASE_*` CI secrets |
| 3 | Stripe catalog (`stripe:setup`), webhook, Tax, portal | [03-stripe.md](./03-stripe.md) | 10 `STRIPE_*` price/meter IDs (6 plan/meter + 4 module add-ons), `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY` |
| 4 | Telnyx API key + Ed25519 public key, Call-Control (voice) application, geo/10DLC prerequisites | [04-telnyx.md](./04-telnyx.md) | `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, `TELNYX_VOICE_CONNECTION_ID` |
| — | Resend domain + key; Sentry DSN; VAPID pair | [02](./02-supabase.md) §7, [06-env-reference.md](./06-env-reference.md) | `RESEND_API_KEY`, `RESEND_FROM`, `SENTRY_DSN`, `VAPID_*` |
| 5 | Set all 25 API Worker secrets + GitHub Actions secrets, deploy both Workers, custom domains, register live webhook URLs | [05-workers-deploy.md](./05-workers-deploy.md) | Live `api.` + `app.` Workers |
| 6 | Complete env reference (single source of truth) | [06-env-reference.md](./06-env-reference.md) | — |
| 7 | Pre-launch checklist + full smoke test | [07-go-live-checklist.md](./07-go-live-checklist.md) | Go/no-go |
| 8 | Ongoing operations, crons, rotation, backups, incidents | [08-operations.md](./08-operations.md) | — |

There are additional vendor deep-dive pages in this directory
(`05-supabase-migrations.md`, `06-cron-triggers.md`, `07-webhooks-and-vendor-setup.md`,
`09-stripe-catalog-setup.md`, `vendor-setup.md`, `runbook.md`, `env-and-secrets.md`)
authored by a parallel effort; they cover the same facts from a per-vendor angle
and can be read as cross-references. **This numbered `01`–`08` set is the
operator walkthrough — start here.**

---

## Prerequisites

### Accounts you must create

| Vendor | Plan | Why | Page |
|--------|------|-----|------|
| **Cloudflare** | Workers Paid (Standard) | Hosts both Workers, DNS zone, custom domains, cron triggers | [01](./01-accounts-and-domain.md) |
| **Supabase** | **Pro** (US region) | Postgres 17, Auth (ES256), Storage; Pro required per SPEC §3 | [02](./02-supabase.md) |
| **Telnyx** | Standard (Level 2 for 10DLC) | SMS/MMS, phone numbers, 10DLC brand/campaign | [04](./04-telnyx.md) |
| **Stripe** | Standard + **Stripe Tax** enabled | Subscriptions, usage-based billing, tax | [03](./03-stripe.md) |
| **Resend** | Any (with a verified sending domain) | Transactional email + Supabase Auth custom SMTP | [02](./02-supabase.md) §7 |
| **Sentry** | Any (Team+) | API Worker error tracking (DSN only) | [06](./06-env-reference.md) |
| **PostHog** | Optional (Cloud US) | Product analytics in the API Worker via the optional `POSTHOG_API_KEY` secret — silent no-op when unset, `distinct_id` = company_id only (`apps/api/src/analytics/posthog.ts`). | [06](./06-env-reference.md) §E |
| **Domain registrar** | — | Register `loonext.com` (or your domain); DNS delegated to Cloudflare | [01](./01-accounts-and-domain.md) |
| **Status page** (Instatus / BetterStack free) | — | Launch blocker per marketing (`docs/marketing/BLUEPRINT.md:984`) | [07](./07-go-live-checklist.md) |

### Toolchain (local operator machine)

- **Node ≥ 22**, **pnpm** (CI pins Node 22 — `.github/workflows/ci.yml:48,100`).
- **wrangler `^4.106.0`** (bundled as a dev dependency — `apps/api/package.json:32`,
  `apps/web/package.json:61`; invoke via `pnpm --filter … exec wrangler`).
- **Supabase CLI** (`supabase/setup-cli@v1` in CI — `.github/workflows/deploy.yml:46-48`).
- **Stripe CLI** (optional, for testing webhooks locally).
- A **Linux or WSL** shell for the web deploy — the OpenNext Cloudflare build must
  run on Linux/WSL (`SPEC.md:88,96`), so run the `loonext-web` deploy from CI or WSL,
  not native Windows.
- `pnpm install --frozen-lockfile` from the repo root before any deploy
  (`.github/workflows/deploy.yml:43-44`).

### The three secret surfaces — do not conflate them

1. **GitHub Actions secrets** — consumed by CI/Deploy (`.github/workflows/*`):
   Cloudflare auth, Supabase link/push, the web build's `NEXT_PUBLIC_*`. See [05](./05-workers-deploy.md) §5.
2. **`loonext-api` Worker encrypted secrets** — the **25 required for launch**
   (+ optional `POSTHOG_API_KEY`) runtime bindings validated at startup
   (`apps/api/src/env.ts:22-104`). The four `STRIPE_MODULE_*_PRICE_ID` ids are
   schema-optional (the Worker boots without them) but launch-required — every
   opt-in add-on is unsellable until they are set (`apps/api/src/env.ts:64-67`,
   `apps/api/src/routes/billing.ts:190-200`). Set with `wrangler secret put`
   **before the first deploy** — CI does *not* set them
   (`.github/workflows/deploy.yml:58-62`).
   The `SEND_RATE_LIMITER` and `VERIFY_RATE_LIMITER` rate-limiting bindings are
   the two non-secret bindings — declared in `apps/api/wrangler.jsonc:23-54`,
   deployed with the Worker. See [05](./05-workers-deploy.md) §2.
3. **`loonext-web` build-time public vars** — the three required `NEXT_PUBLIC_*`
   (plus two optional: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` for Supabase Auth captcha
   and `NEXT_PUBLIC_APP_ORIGIN` for the D27 marketing/app host split)
   inlined at `next build` (`apps/web/src/env.ts:3-17`). See [06](./06-env-reference.md).

### Two things that will bite on the first deploy

- **Supabase must have an ES256 (asymmetric) JWT signing key enabled**, or every
  `/v1/*` request 401s — the API verifies access tokens **ES256-only** against the
  project JWKS (`apps/api/src/auth/jwt.ts:41-44`). See [02](./02-supabase.md) §2.
- **`NEXT_PUBLIC_API_URL` must exist as a GitHub Actions secret** before the first
  automated deploy: `deploy.yml` builds the web Worker with it
  (`.github/workflows/deploy.yml:22`) and `apps/web/src/env.ts` fails the build
  without it. (CI itself uses a fixed placeholder — `.github/workflows/ci.yml:81-92`
  — since the CI artifact is never deployed.) See [05](./05-workers-deploy.md) §5.
