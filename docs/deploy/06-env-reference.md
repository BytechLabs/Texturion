# 06 — Environment Reference (single source of truth)

Every variable JobText reads, split by surface. **Secret?** = whether it's a
Cloudflare Worker encrypted secret / GitHub Actions secret vs a build-time public
value. Formats are illustrative — real values come from the vendor dashboards.

- **API Worker secrets** are validated at startup by the zod schema in
  `apps/api/src/env.ts:22-74`; a missing/invalid one fails loudly and `/health`
  re-validates (`apps/api/src/index.ts:88-92`). There are **21 required + 1
  optional** (`POSTHOG_API_KEY`).
- **Web build vars** are the `NEXT_PUBLIC_*` inlined at `next build` — three
  required plus two optional (`apps/web/src/env.ts:3-17`).
- **GitHub Actions secrets** feed CI/Deploy (`.github/workflows/*`).
- Two Worker **bindings** are configured in `wrangler.jsonc`, not as secrets:
  `SEND_RATE_LIMITER` and `VERIFY_RATE_LIMITER` (see A.1 below).

---

## A. API Worker secrets (`jobtext-api`) — 21 required + 1 optional

| Name | Secret? | Source (dashboard) | Example format |
|------|:------:|--------------------|----------------|
| `SUPABASE_URL` | yes | Supabase → Settings → API → Project URL | `https://abcdefghijklmnop.supabase.co` |
| `SUPABASE_SECRET_KEY` | yes | Supabase → Settings → API → **Secret keys** | `sb_secret_xxxxxxxxxxxxxxxx` |
| `SUPABASE_JWKS_URL` | yes | Constructed: `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` | `https://abcdefghijklmnop.supabase.co/auth/v1/.well-known/jwks.json` |
| `TELNYX_API_KEY` | yes | Telnyx → Account → API Keys (V2) | `KEYxxxxxxxxxxxxxxxxxxxxxxxx` |
| `TELNYX_PUBLIC_KEY` | yes | Telnyx → Account → Public Key | base64 of 32 raw bytes, e.g. `e3b0c44298fc1c149afbf4c8996fb924...` (44 chars base64) |
| `TELNYX_VOICE_CONNECTION_ID` | yes | Telnyx → Voice → the **Call-Control application** you create once ([04](./04-telnyx.md) §1) | numeric id, e.g. `2593906985...` |
| `STRIPE_SECRET_KEY` | yes | Stripe → Developers → API keys (**restricted** `rk_` for runtime) | `rk_live_xxxxxxxxxxxx` (or `sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | yes | Stripe → Developers → Webhooks → endpoint → Signing secret | `whsec_xxxxxxxxxxxxxxxx` |
| `RESEND_API_KEY` | yes | Resend → API Keys | `re_xxxxxxxxxxxxxxxx` |
| `RESEND_FROM` | yes | Operator-set; address at the verified Resend domain | `JobText <notifications@jobtext.app>` |
| `SENTRY_DSN` | yes | Sentry → Project → Client Keys (DSN) | `https://abc123@o0.ingest.sentry.io/0` |
| `APP_ORIGIN` | yes | Operator decision (web origin) | `https://app.jobtext.app` |
| `API_ORIGIN` | yes | Operator decision (this Worker's origin) | `https://api.jobtext.app` |
| `VAPID_PUBLIC_KEY` | yes | `npx web-push generate-vapid-keys` (once, forever) | base64url ~87 chars |
| `VAPID_PRIVATE_KEY` | yes | same command as above | base64url ~43 chars |
| `STRIPE_STARTER_PRICE_ID` | yes | Printed by `pnpm --filter @jobtext/api stripe:setup` | `price_xxxxxxxxxxxx` |
| `STRIPE_PRO_PRICE_ID` | yes | `stripe:setup` output | `price_xxxxxxxxxxxx` |
| `STRIPE_STARTER_OVERAGE_PRICE_ID` | yes | `stripe:setup` output | `price_xxxxxxxxxxxx` |
| `STRIPE_PRO_OVERAGE_PRICE_ID` | yes | `stripe:setup` output | `price_xxxxxxxxxxxx` |
| `STRIPE_US_FEE_PRICE_ID` | yes | `stripe:setup` output | `price_xxxxxxxxxxxx` |
| `STRIPE_SMS_METER_EVENT_NAME` | yes | `stripe:setup` output (always `sms_segments`) | `sms_segments` |
| `POSTHOG_API_KEY` | yes — **OPTIONAL** | PostHog → Project Settings → Project API key | `phc_xxxxxxxxxxxx` |

**Validation notes** (`apps/api/src/env.ts`): `SUPABASE_URL`, `SUPABASE_JWKS_URL`,
`SENTRY_DSN`, `APP_ORIGIN`, `API_ORIGIN` must parse as URLs (`z.url()`, lines
23,25,38,39,41); the rest are non-empty strings (`z.string().min(1)`).
`POSTHOG_API_KEY` is the only optional secret (`apps/api/src/env.ts:65`) — unset,
every analytics capture is a silent no-op
(`apps/api/src/analytics/posthog.ts:31`). Set them all with `wrangler secret put`
— see [05](./05-workers-deploy.md) §2. `wrangler.jsonc` `vars` is intentionally
empty (`apps/api/wrangler.jsonc:50`).

### A.1 Not secrets — the two rate-limiter bindings

Two Workers **rate-limiting unsafe bindings** are declared in
`apps/api/wrangler.jsonc:23-53`, deployed with the Worker — there is nothing to
`wrangler secret put`. Both are typed `optional` in the schema
(`apps/api/src/env.ts:73,83`), so local dev/tests run without either binding and
the respective gate is skipped. Each `namespace_id` must be **unique within your
Cloudflare account** — change it if it collides with another Worker's limiter.

| Binding | `namespace_id` | Config | Keyed on | Guards |
|---------|:--:|--------|----------|--------|
| `SEND_RATE_LIMITER` | `"1001"` | `limit: 10` / `period: 10`s | `company_id` | The per-company outbound-send choke point (≡ the SPEC's 1 msg/s average with sub-10s bursts). `wrangler.jsonc:33-37`, `env.ts:73`. |
| `VERIFY_RATE_LIMITER` | `"1002"` | `limit: 3` / `period: 60`s | target number | The keep-your-number ownership-verification endpoints (`routes/text-enablement.ts`): requesting a code makes Telnyx SMS/CALL the target number the company has not yet proven it owns, and the verify endpoint accepts code guesses — so both are bounded per target number (3/min caps call/SMS-bombing and code brute-force). `wrangler.jsonc:48-51`, `env.ts:83`. |

---

## B. Web build-time public vars (`jobtext-web`) — 3 required + 2 optional

Inlined at `next build`; the build **fails** if any of the three required ones is
missing (`apps/web/src/env.ts:3-17,22-38`). They are public (shipped in the
browser bundle).

| Name | Secret? | Source | Example format |
|------|:------:|--------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | no (public) | Same as `SUPABASE_URL` | `https://abcdefghijklmnop.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | no (public) | Supabase → Settings → API → **Publishable key** | `sb_publishable_xxxxxxxxxxxx` |
| `NEXT_PUBLIC_API_URL` | no (public) | Operator decision; must equal `API_ORIGIN` | `https://api.jobtext.app` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — **OPTIONAL** | no (public) | Cloudflare → Turnstile → your widget → **Site key** | `0x4AAAAAAA...` |
| `NEXT_PUBLIC_APP_ORIGIN` — **OPTIONAL** | no (public) | Operator decision; must equal the api Worker's `APP_ORIGIN` secret | `https://app.jobtext.app` |

> `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (`apps/web/src/env.ts:10`): when set,
> signup/login/reset-password render Cloudflare Turnstile and pass the
> `captchaToken` to Supabase Auth; when unset the pages behave as before. It is
> the web-side half of the "enable Supabase Auth captcha" go-live step — the
> Turnstile **secret** key goes in the Supabase dashboard (section D), the
> **site** key in this var. Deploy passes it into the web build from the
> optional GitHub secret of the same name (`.github/workflows/deploy.yml:23-26`);
> CI builds without it (the CI artifact is never deployed). **Set the GitHub
> secret and redeploy web BEFORE enabling captcha in the Supabase dashboard** —
> captcha enforced against a build with no site key breaks every email/password
> signup, login, and password reset.

> `NEXT_PUBLIC_APP_ORIGIN` (`apps/web/src/env.ts:11-16`): the D27 marketing/app
> host split (`docs/DECISIONS.md` D27, `apps/web/src/lib/hosts.ts`). When set
> (production: `https://app.jobtext.app`), the middleware serves **only**
> marketing pages on `jobtext.app` (with `www` → apex canonicalization) and
> **only** the product on the app origin — app-surface paths on the marketing
> host 308 to the app origin and vice versa. Unset (dev/CI/previews) = no
> gating; every route stays on one origin. Deploy passes it from the optional
> GitHub secret of the same name (`.github/workflows/deploy.yml:27-30`). All
> three hostnames (`jobtext.app`, `www.jobtext.app`, `app.jobtext.app`) attach
> as custom domains on the **one** web Worker ([01](./01-accounts-and-domain.md)
> §2). Supabase/Stripe return URLs stay on `APP_ORIGIN` unchanged.

> `NEXT_PUBLIC_API_URL` is wired into both workflows: CI builds with a fixed
> placeholder (`.github/workflows/ci.yml:47` — the CI artifact is never
> deployed), Deploy reads the `NEXT_PUBLIC_API_URL` GitHub secret
> (`.github/workflows/deploy.yml:22`).

---

## C. GitHub Actions secrets (CI / Deploy) — 8 required + 2 optional

Consumed by the workflows; never reach the Workers as runtime bindings.

| Name | Secret? | Source | Used at |
|------|:------:|--------|---------|
| `CLOUDFLARE_API_TOKEN` | yes | Cloudflare → My Profile → API Tokens (Workers + DNS edit) | `deploy.yml:18` |
| `CLOUDFLARE_ACCOUNT_ID` | yes | Cloudflare dashboard (account ID) | `deploy.yml:19` |
| `NEXT_PUBLIC_SUPABASE_URL` | yes (as CI secret) | Supabase Project URL | `ci.yml:42`, `deploy.yml:20` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes (as CI secret) | Supabase publishable key | `ci.yml:43`, `deploy.yml:21` |
| `NEXT_PUBLIC_API_URL` | yes (as CI secret) | Operator decision = API origin | `deploy.yml:22` (CI uses a fixed placeholder instead — `ci.yml:47`) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — **OPTIONAL** | yes (as CI secret) | Cloudflare Turnstile site key (section B) | `deploy.yml:23-26` — **must be set before enabling Supabase captcha** |
| `NEXT_PUBLIC_APP_ORIGIN` — **OPTIONAL** | yes (as CI secret) | App origin for the D27 host split (section B) | `deploy.yml:27-30` — blank = no host split |
| `SUPABASE_ACCESS_TOKEN` | yes | Supabase → Account → Access Tokens (`sbp_...`) | `deploy.yml:52` |
| `SUPABASE_DB_PASSWORD` | yes | The project DB password (from project creation) | `deploy.yml:53` |
| `SUPABASE_PROJECT_REF` | yes | The project ref (subdomain of the project URL) | `deploy.yml:55` |

---

## D. Not env vars — dashboard-only settings

These are configured in a vendor dashboard and have **no** app env var:

| Setting | Where | Reference |
|---------|-------|-----------|
| Supabase **ES256 signing key** | Supabase → Auth → JWT/Signing Keys | `apps/api/src/auth/jwt.ts:41-44` |
| Supabase **custom SMTP = Resend** | Supabase → Auth → SMTP | `SPEC.md:100,1065` |
| Supabase signup **CAPTCHA = Turnstile** (the Turnstile **secret** key; the **site** key is the web build var in section B) | Supabase → Auth → Attack Protection → CAPTCHA | `SPEC.md:1052`, `apps/web/src/env.ts:10` |
| Stripe **Tax** activation | Stripe → Settings → Tax | `apps/api/src/routes/billing.ts:170` |
| Stripe **dunning → cancel** | Stripe → Billing → failed payments | `SPEC.md:1017` |
| Stripe **customer portal** config | Stripe → Billing → Customer portal | `apps/api/src/routes/billing.ts:197-199` |
| Telnyx **webhook URL** | *programmatic*, from `API_ORIGIN` — never a portal field | `apps/api/src/telnyx/wizard.ts:140-142` |

---

## E. PostHog — optional product analytics

PostHog **is** integrated in the API Worker (`apps/api/src/analytics/posthog.ts`):
a single `capture` helper posts the north-star funnel events to PostHog Cloud US.
Configuration is one optional secret, `POSTHOG_API_KEY` (section A) — when it is
unset every capture is a silent no-op (`apps/api/src/analytics/posthog.ts:31`),
so leaving it out is safe. `distinct_id` is always the **company_id** — never a
person, never PII (`apps/api/src/analytics/posthog.ts:40`). There is still no
web-side PostHog client.

Next: [07 — go-live checklist](./07-go-live-checklist.md).
