# JobText — Production Deploy Runbook

The operator's authoritative guide to standing up and deploying **JobText** in
production. JobText is two Cloudflare Workers plus five backing SaaS vendors:

- **`jobtext-web`** — Next.js 15, deployed to Cloudflare Workers via the
  `@opennextjs/cloudflare` adapter (`apps/web/wrangler.jsonc:3`, `apps/web/package.json:10`).
- **`jobtext-api`** — Hono API + scheduled cron jobs, deployed with `wrangler deploy`
  (`apps/api/wrangler.jsonc:3`, `apps/api/package.json:8`).
- **Supabase** (Postgres 17, Auth, Storage), **Telnyx** (SMS/MMS + 10DLC),
  **Stripe** (billing + usage metering), **Resend** (transactional email +
  Supabase Auth SMTP), **Sentry** (API error tracking).

Every command, secret name, dashboard setting, and URL below was verified
against the committed source — each fact cites its `file:line`. Nothing is
invented. Where a value is genuinely the operator's choice (domain names,
account emails) it is marked **PLACEHOLDER** with a worked example.

> **Running example used throughout** (replace with your real values):
> web = `https://app.jobtext.app`, api = `https://api.jobtext.app`,
> marketing root = `https://jobtext.app`, Supabase project ref = `abcdefghijklmnop`.

---

## Deploy order at a glance

Provisioning must happen in this order — later steps consume IDs/keys produced
by earlier ones.

| # | Step | Page | Produces |
|---|------|------|----------|
| 1 | Create all accounts + register the domain, plan DNS | [01-accounts-and-domain.md](./01-accounts-and-domain.md) | The 3 hostnames, a Cloudflare zone |
| 2 | Supabase Pro project (US), **ES256 signing key**, migrations, keys | [02-supabase.md](./02-supabase.md) | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`, publishable key, `SUPABASE_*` CI secrets |
| 3 | Stripe catalog (`stripe:setup`), webhook, Tax, portal | [03-stripe.md](./03-stripe.md) | 6 `STRIPE_*` price/meter IDs, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY` |
| 4 | Telnyx API key + Ed25519 public key, geo/10DLC prerequisites | [04-telnyx.md](./04-telnyx.md) | `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY` |
| — | Resend domain + key; Sentry DSN; VAPID pair | [02](./02-supabase.md) §7, [06-env-reference.md](./06-env-reference.md) | `RESEND_API_KEY`, `RESEND_FROM`, `SENTRY_DSN`, `VAPID_*` |
| 5 | Set all 20 API Worker secrets + GitHub Actions secrets, deploy both Workers, custom domains, register live webhook URLs | [05-workers-deploy.md](./05-workers-deploy.md) | Live `api.` + `app.` Workers |
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
| **PostHog** | — | **No code integration exists.** Listed as a subprocessor in marketing prose only; nothing to deploy or configure. | — |
| **Domain registrar** | — | Register `jobtext.app` (or your domain); DNS delegated to Cloudflare | [01](./01-accounts-and-domain.md) |
| **Status page** (Instatus / BetterStack free) | — | Launch blocker per marketing (`docs/marketing/BLUEPRINT.md:984`) | [07](./07-go-live-checklist.md) |

### Toolchain (local operator machine)

- **Node ≥ 22**, **pnpm** (CI pins Node 22 — `.github/workflows/ci.yml:45`).
- **wrangler `^4.106.0`** (bundled as a dev dependency — `apps/api/package.json:31`,
  `apps/web/package.json:55`; invoke via `pnpm --filter … exec wrangler`).
- **Supabase CLI** (`supabase/setup-cli@v1` in CI — `.github/workflows/deploy.yml:37`).
- **Stripe CLI** (optional, for testing webhooks locally).
- A **Linux or WSL** shell for the web deploy — the OpenNext Cloudflare build must
  run on Linux/WSL (`SPEC.md:88,96`), so run the `jobtext-web` deploy from CI or WSL,
  not native Windows.
- `pnpm install --frozen-lockfile` from the repo root before any deploy
  (`.github/workflows/deploy.yml:35`).

### The three secret surfaces — do not conflate them

1. **GitHub Actions secrets** — consumed by CI/Deploy (`.github/workflows/*`):
   Cloudflare auth, Supabase link/push, the web build's `NEXT_PUBLIC_*`. See [05](./05-workers-deploy.md) §5.
2. **`jobtext-api` Worker encrypted secrets** — the **20** runtime bindings validated
   at startup (`apps/api/src/env.ts:8-39`). Set with `wrangler secret put` **before the
   first deploy** — CI does *not* set them (`.github/workflows/deploy.yml:49-53`). See [05](./05-workers-deploy.md) §2.
3. **`jobtext-web` build-time public vars** — the three `NEXT_PUBLIC_*` inlined at
   `next build` (`apps/web/src/env.ts:3-7`). See [06](./06-env-reference.md).

### Two things that will bite on the first deploy

- **Supabase must have an ES256 (asymmetric) JWT signing key enabled**, or every
  `/v1/*` request 401s — the API verifies access tokens **ES256-only** against the
  project JWKS (`apps/api/src/auth/jwt.ts:41-44`). See [02](./02-supabase.md) §2.
- **`NEXT_PUBLIC_API_URL` is not wired into CI**, yet `apps/web/src/env.ts` fails the
  build without it (`apps/web/src/env.ts:6,19-24`; not present in
  `.github/workflows/ci.yml:34-37` or `deploy.yml:20-21`). Provide it in the web build
  env before relying on the automated deploy — that fix touches `.github/**`, which is
  **outside this runbook's write scope**; flag it to whoever owns CI. See [05](./05-workers-deploy.md) §5.
