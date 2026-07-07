# Loonext — What you need to deploy

The one-page answer to *"what do I have to provide to run this in production."*
Every command, secret, and dashboard step is detailed in **[docs/deploy/](docs/deploy/README.md)** —
start with `docs/deploy/README.md` and work the numbered `01`–`08` pages in order.
This page is the shopping list; the runbook is the recipe.

Loonext is **two Cloudflare Workers + five SaaS vendors**, no other servers.
`loonext-web` (Next.js via OpenNext) serves the marketing site and the app;
`loonext-api` (Hono) serves `/v1/*`, `/webhooks/*`, and the cron jobs.

---

## 1. Accounts to create (all pay-as-you-go or free tier)

| Vendor | Plan | Why | Rough cost at launch |
|--------|------|-----|----------------------|
| **Cloudflare** | Workers **Paid** ($5/mo) | Both Workers, DNS, custom domains, cron triggers | $5/mo |
| **Supabase** | **Pro**, US region ($25/mo) | Postgres 17, Auth (ES256), Storage | $25/mo |
| **Telnyx** | Standard, Level-2 for 10DLC | SMS/MMS, numbers, voice (missed-call), 10DLC | usage + ~$1/number/mo |
| **Stripe** | Standard + **Tax** enabled | Subscriptions, usage metering | % of revenue |
| **Resend** | Any, with a **verified sending domain** | Transactional email + Supabase Auth SMTP | free tier fine |
| **Sentry** | Any (Team+) | API error tracking (DSN only) | free tier fine |
| **PostHog** | *Optional*, Cloud US | Product analytics (silent no-op if unset) | free tier fine |
| **Domain registrar** | — | `loonext.app` (or yours), DNS delegated to Cloudflare | ~$12/yr |
| **Status page** | Instatus / BetterStack free | Launch blocker (deliverability-gated SMS product) | free tier fine |

**Fixed platform cost ≈ $30/mo** (Cloudflare $5 + Supabase $25); everything else scales with usage.

---

## 2. Secrets & config — the three surfaces (do not conflate)

### (a) `loonext-api` Worker secrets — **25 required for launch + 1 optional**
Set with `wrangler secret put` **before the first deploy** (CI does not set them).
Full table with sources in [docs/deploy/06-env-reference.md](docs/deploy/06-env-reference.md) §A.

- **Supabase (3):** `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`
- **Telnyx (3):** `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, `TELNYX_VOICE_CONNECTION_ID`
- **Stripe (12):** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and the 10 catalog IDs printed by `pnpm --filter @loonext/api stripe:setup` — the 6 plan/meter IDs (`STRIPE_STARTER_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_STARTER_OVERAGE_PRICE_ID`, `STRIPE_PRO_OVERAGE_PRICE_ID`, `STRIPE_US_FEE_PRICE_ID`, `STRIPE_SMS_METER_EVENT_NAME`) plus the 4 module add-on price IDs (`STRIPE_MODULE_MMS_PRICE_ID`, `STRIPE_MODULE_VOICE_PRICE_ID`, `STRIPE_MODULE_EXTRA_STORAGE_PRICE_ID`, `STRIPE_MODULE_REGIONS_CA_PRICE_ID`). ⚠️ The 4 module IDs are *schema-optional* (the Worker boots without them) but **launch-required**: without them every opt-in add-on (Picture messages, Call forwarding, Extra storage) is refused at checkout as "isn't available yet" and cannot be sold.
- **Email/errors/push (5):** `RESEND_API_KEY`, `RESEND_FROM`, `SENTRY_DSN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (VAPID pair: `npx web-push generate-vapid-keys`, once forever)
- **Origins (2):** `APP_ORIGIN`, `API_ORIGIN`
- **Optional (1):** `POSTHOG_API_KEY` — unset = analytics off

### (b) `loonext-api` Worker bindings (not secrets, live in `wrangler.jsonc`)
Two Workers rate-limiting bindings, deployed with the Worker — **nothing to put**, but each
`namespace_id` must be **unique within your Cloudflare account** (change if it collides):
`SEND_RATE_LIMITER` (namespace 1001, 1 msg/s per company) and `VERIFY_RATE_LIMITER`
(namespace 1002, verification-code throttle).

### (c) `loonext-web` build vars — **3 required + 2 optional** (`NEXT_PUBLIC_*`, inlined at build)
- **Required:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_API_URL`
- **Optional:** `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (signup captcha), `NEXT_PUBLIC_APP_ORIGIN` (marketing/app host split)

### (d) GitHub Actions secrets — **8 required + 2 optional** (CI/deploy)
Cloudflare auth (2), Supabase link/push (3), the web build's three `NEXT_PUBLIC_*` — including
`NEXT_PUBLIC_API_URL` which **must exist before the first automated deploy** — plus the optional
`NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `NEXT_PUBLIC_APP_ORIGIN`. See [05-workers-deploy.md](docs/deploy/05-workers-deploy.md) §5.

---

## 3. Dashboard steps that have no env var (easy to miss)

- **Supabase → Auth → enable an ES256 (asymmetric) JWT signing key.** Without it every `/v1/*` request 401s — the API verifies tokens ES256-only against the project JWKS.
- **Supabase → Auth → custom SMTP = Resend**, and (optional) **Attack Protection → CAPTCHA = Turnstile.** ⚠️ If you enable the captcha setting, the `NEXT_PUBLIC_TURNSTILE_SITE_KEY` secret must be set and the web redeployed **first**, or all email/password auth breaks.
- **Telnyx → create one Call-Control (voice) application**, webhook + failover both `https://api.loonext.app/webhooks/telnyx`; its id becomes `TELNYX_VOICE_CONNECTION_ID`.
- **Stripe → webhook endpoint** `https://api.loonext.app/webhooks/stripe` (7 events); enable **Tax**; configure the **customer portal** and **dunning → cancel**.
- **Cloudflare → attach three custom domains to `loonext-web`** (`loonext.app`, `www.loonext.app`, `app.loonext.app`) and `api.loonext.app` to `loonext-api`.

---

## 4. Deploy order (each step consumes IDs from the last)

1. Accounts + domain + Cloudflare zone → the 3 hostnames.
2. Supabase Pro project, ES256 key, `supabase db push` (applies **every migration** under `supabase/migrations/` — the whole directory, no manual picking), keys.
3. `stripe:setup` (catalog) → 10 IDs (6 plan/meter + 4 module add-on prices); webhook; Tax; portal.
4. Telnyx API key + Ed25519 public key + Call-Control voice app → 3 Telnyx values.
5. Set all 25 API secrets + the GitHub Actions secrets; deploy both Workers; bind custom domains; register the live webhook URLs.
6. **Go-live checklist + smoke test** — [docs/deploy/07-go-live-checklist.md](docs/deploy/07-go-live-checklist.md). Confirm all **9 cron triggers** are visible, `GET https://api.loonext.app/health` → `{"ok":true}`, and run the test-mode end-to-end (sign up → pay → number provisions → send/receive a real text → cancel→grace).

---

## 5. Non-engineering blockers (resolve before public launch)

These gate launch and only you can provide them (see [07-go-live-checklist.md](docs/deploy/07-go-live-checklist.md) §B):
legal entity name + mailing address (feeds 10DLC brand registration + the site footer),
a Québec Law 25 privacy-officer name, founder names for the signed home line (ship without rather than fabricate),
a support-response SLA, a live status page, and the published legal set (Terms, Privacy, AUP, DPA/sub-processors, Security, Messaging, Refunds — the last two now shipped in-app).

---

## 6. Toolchain to run the deploy

Node ≥ 22, pnpm, wrangler (bundled dev dep), Supabase CLI. The `loonext-web` (OpenNext) build must
run on **Linux or WSL**, not native Windows — deploy web from CI or WSL. `pnpm install --frozen-lockfile`
from the repo root first.

---

## 7. What it costs to run (cost model)

Fixed ≈ **$30/mo** (Cloudflare + Supabase) regardless of tenants. Per-tenant COGS is Telnyx SMS/MMS
(metered and priced into overage), the number rental, and Stripe fees — modeled at ~45–63% gross margin
on the $29/$79 plans in [SPEC.md §14](SPEC.md). **Attachment storage** is a budgeted allowance
(Starter 5 GB / Pro 25 GB of note files), enforced at upload; a maxed tenant costs ~$0.11–$0.53/mo of
Supabase storage — inside plan margin. Inbound MMS is capped per message and never blocks the customer.
Nothing here adds a new vendor or a per-tenant fixed cost.

---

*The authoritative, cited, step-by-step version of all of this is **[docs/deploy/](docs/deploy/README.md)**.
This page just tells you what to have ready before you open it.*
