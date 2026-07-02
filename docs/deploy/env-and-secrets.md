# JobText — Environment & Secrets Surface

The complete env/secrets inventory for both Workers. Every entry is traceable to code (`file:line`). Nothing here is invented — if a value is not read by the code, it is not listed.

Two deploy artifacts:

| Worker | wrangler name | main entry | reads secrets via |
| --- | --- | --- | --- |
| **api** (Hono) | `jobtext-api` (`apps/api/wrangler.jsonc:3`) | `src/index.ts` (`apps/api/wrangler.jsonc:4`) | Worker encrypted secrets (`wrangler secret put`) — validated by zod in `apps/api/src/env.ts:8-39` |
| **web** (Next.js / OpenNext) | `jobtext-web` (`apps/web/wrangler.jsonc:4`) | `.open-next/worker.js` (`apps/web/wrangler.jsonc:5`) | `NEXT_PUBLIC_*` build-time inlined vars only — `apps/web/src/env.ts:3-7` |

---

## 1. API Worker secrets (`jobtext-api`)

Every one of these is a **Worker encrypted secret** in production (`wrangler secret put <NAME>`), and a `.dev.vars` line locally. The zod schema in `apps/api/src/env.ts` requires all of them; a missing/invalid one makes the Worker fail loudly on first request or first cron (`apps/api/src/env.ts:54-70`, and `/health` re-validates at `apps/api/src/index.ts:78-82`). `wrangler.jsonc` `"vars": {}` is empty on purpose — no plaintext config lives there (`apps/api/wrangler.jsonc:30`).

The canonical local template is `apps/api/.dev.vars.example` (lines 4-26).

### Supabase

| Var | What it is | Where the operator gets it | Secret? |
| --- | --- | --- | --- |
| `SUPABASE_URL` | Project base URL, e.g. `https://<ref>.supabase.co`. Used to build the Supabase client (`apps/api/src/db.ts:22`) and to derive the expected JWT issuer `<SUPABASE_URL>/auth/v1` (`apps/api/src/auth/jwt.ts:26-29,42`). | Supabase dashboard → Project Settings → API → Project URL. | Secret (not sensitive, but injected as a secret alongside the rest). `env.ts:9` |
| `SUPABASE_SECRET_KEY` | The `sb_secret_...` service key. It is the server credential for PostgREST over HTTP — zero Postgres connections consumed (`apps/api/src/db.ts:11-22`). This is the new-style **secret** key, NOT the legacy `service_role` JWT, and NOT the publishable key. | Supabase dashboard → Project Settings → API keys → **Secret keys** (`sb_secret_...`). Test fixture confirms the prefix: `apps/api/src/test/support.ts:15`. | **Secret.** `env.ts:10` |
| `SUPABASE_JWKS_URL` | The project JWKS endpoint. Canonical form: `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` (`apps/api/src/test/support.ts:16-17`). Used by `jose` `createRemoteJWKSet` to verify access tokens with **ES256** (`apps/api/src/auth/jwt.ts:40-44`). | Constructed from the project URL; requires Supabase Auth to be using an **asymmetric (ES256) JWT signing key** so a JWKS is published. Supabase dashboard → Authentication → JWT/Signing Keys. | Secret. `env.ts:11` |

> **Supabase auth prerequisite:** token verification is **ES256 only** and pulls the public key from the JWKS URL (`apps/api/src/auth/jwt.ts:41-44`). The project must have an ECC/ES256 JWT signing key active (not the legacy shared HS256 secret), or every `/v1/*` request 401s.

### Telnyx

| Var | What it is | Where the operator gets it | Secret? |
| --- | --- | --- | --- |
| `TELNYX_API_KEY` | Telnyx v2 REST bearer token. Sent as `Authorization: Bearer <key>` on every Telnyx call (`apps/api/src/telnyx/client.ts:80`). Drives number search/order, messaging profiles, 10DLC registration. | Telnyx Portal → Account → API Keys → create a **V2 API Key**. Fixture prefix `KEY...`: `apps/api/src/test/support.ts:18`. | **Secret.** `env.ts:12` |
| `TELNYX_PUBLIC_KEY` | Base64 of the **32-byte raw Ed25519** webhook signing public key. Used to verify inbound webhook signatures (`telnyx-signature-ed25519` header, `{timestamp}\|{body}`, 5-min tolerance) in `apps/api/src/telnyx/verify.ts:5-11,34-40,75`. Anything not exactly 32 bytes after base64-decode is treated as misconfig. | Telnyx Portal → Account → Public Key (the webhook-signing Ed25519 public key). | **Secret.** `env.ts:13` |

### Stripe

| Var | What it is | Where the operator gets it | Secret? |
| --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | Stripe API key used by stripe-node (`apps/api/src/billing/stripe.ts:25`). The code and fixtures use a **restricted key** (`rk_...`): `apps/api/src/test/support.ts:20`, and the setup script prompts for `sk_...` (`scripts/stripe-setup.ts:6,32`). See scope note below. | Stripe Dashboard → Developers → API keys → **Restricted keys** (`rk_live_...`). The `stripe:setup` script can be run once with a full `sk_...`. | **Secret.** `env.ts:14` |
| `STRIPE_WEBHOOK_SECRET` | Signing secret (`whsec_...`) for the Stripe webhook endpoint. Used by `constructEventAsync` over the raw body with WebCrypto (`apps/api/src/webhooks/stripe.ts:44-47`, `billing/stripe.ts:43`). Fixture: `apps/api/src/test/support.ts:21`. | Stripe Dashboard → Developers → Webhooks → your endpoint → Signing secret. | **Secret.** `env.ts:15` |
| `STRIPE_STARTER_PRICE_ID` | Starter licensed price ($29/mo). | **Printed by `stripe:setup`** — `scripts/stripe-setup.ts:167`. | Secret. `env.ts:32` |
| `STRIPE_PRO_PRICE_ID` | Pro licensed price ($79/mo). | Printed by `stripe:setup` — `scripts/stripe-setup.ts:168`. | Secret. `env.ts:33` |
| `STRIPE_STARTER_OVERAGE_PRICE_ID` | Starter metered overage (graduated: 0–500 @ $0, then $0.03/segment). | Printed by `stripe:setup` — `scripts/stripe-setup.ts:169`. | Secret. `env.ts:34` |
| `STRIPE_PRO_OVERAGE_PRICE_ID` | Pro metered overage (graduated: 0–2,500 @ $0, then $0.025/segment). | Printed by `stripe:setup` — `scripts/stripe-setup.ts:170`. | Secret. `env.ts:35` |
| `STRIPE_US_FEE_PRICE_ID` | US texting-registration one-time fee ($29). | Printed by `stripe:setup` — `scripts/stripe-setup.ts:171`. | Secret. `env.ts:36` |
| `STRIPE_SMS_METER_EVENT_NAME` | Billing Meter `event_name`; hardcoded to `sms_segments` (`scripts/stripe-setup.ts:23,166`; default in `.dev.vars.example:26`). | Fixed value `sms_segments`; also printed by `stripe:setup`. | Non-secret in effect (public constant), but injected as a secret with the rest. `env.ts:37-38` |

> **Stripe restricted-key scope:** the runtime key needs read/write on the objects the API actually touches: **Checkout Sessions** (`routes/billing.ts:171-172`), **Billing Portal sessions** (`routes/billing.ts:199`), **Subscriptions/Customers** (webhook sync + reconcile, `webhooks/stripe.ts`, `billing/reconcile.ts`), and **Billing Meter Events** (usage reporting, `billing/meter.ts`). Webhook verification needs no scope (it's HMAC). Creating the catalog (Products, Prices, Meter) is done once by `stripe:setup` and needs write on Products/Prices/Billing Meters — run that with a full `sk_...` if your restricted key lacks catalog-write.

### Resend

| Var | What it is | Where the operator gets it | Secret? |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | Resend REST key (`re_...`), bearer on `POST https://api.resend.com/emails` (`apps/api/src/email/resend.ts:15,30`). Fixture: `apps/api/src/test/support.ts:22`. | Resend dashboard → API Keys. | **Secret.** `env.ts:16` |
| `RESEND_FROM` | The `from` header, e.g. `JobText <notifications@jobtext.app>` (`apps/api/src/email/resend.ts:35`; fixture `test/support.ts:26`; note `env.ts:21`). | Operator-chosen; the domain must be a **verified sending domain** in Resend. | Secret (config value). `env.ts:22` |

### Sentry

| Var | What it is | Where the operator gets it | Secret? |
| --- | --- | --- | --- |
| `SENTRY_DSN` | DSN for the Cloudflare Sentry SDK wrapping the whole Worker (`apps/api/src/index.ts:206`, `observability/sentry.ts:117-125`). `sendDefaultPii:false`, `tracesSampleRate:0`, with PII-scrubbing `beforeSend`/`beforeBreadcrumb`. Fixture: `test/support.ts:23`. | Sentry dashboard → your project → Settings → Client Keys (DSN). | Secret. `env.ts:17` |

### Origins

| Var | What it is | Where the operator gets it | Secret? |
| --- | --- | --- | --- |
| `APP_ORIGIN` | The web app's public origin, e.g. `https://app.jobtext.app` (fixture `test/support.ts:24`). Used as the **CORS allow-origin** (exact match, no wildcard — `apps/api/src/index.ts:65`), for all user-facing links in emails/notifications/billing return URLs (e.g. `routes/billing.ts:171-172,199`, `billing/grace.ts:28`, `notifications/inbound.ts:145`), and as the VAPID `sub` contact URI (`notifications/webpush.ts:232`). | Operator-chosen; must equal the web Worker's public URL exactly. | Secret (config). `env.ts:18` |
| `API_ORIGIN` | This API Worker's own public origin, e.g. `https://api.jobtext.app` (fixture `test/support.ts:25`). Used to build the **Telnyx webhook callback URL** `${API_ORIGIN}/webhooks/telnyx` (`apps/api/src/telnyx/wizard.ts:141`), set on the messaging profile during provisioning (`telnyx/provisioning.ts:22-23`). | Operator-chosen; must equal the api Worker's public URL exactly. | Secret (config). `env.ts:20` |

### Web Push (VAPID)

| Var | What it is | Where the operator gets it | Secret? |
| --- | --- | --- | --- |
| `VAPID_PUBLIC_KEY` | Base64url uncompressed P-256 point (65 bytes) — the VAPID application server public key (`apps/api/src/env.ts:23-29`; real test pair `test/support.ts:29-30`). | Generate **once** with `npx web-push generate-vapid-keys` (`.dev.vars.example:16`, `env.ts:24`). | **Secret.** `env.ts:28` |
| `VAPID_PRIVATE_KEY` | Base64url private scalar (32 bytes) of the same pair. | Same `web-push generate-vapid-keys` run. | **Secret.** `env.ts:29` |

> The VAPID **public** key is also needed client-side for push subscription. It is served to the browser by the API (not baked into the web bundle) — there is no `NEXT_PUBLIC_VAPID_*` var. Generate the pair once and reuse it forever; rotating it invalidates all existing push subscriptions.

---

## 2. Web Worker vars (`jobtext-web`)

The **only** environment values the browser bundle receives (`apps/web/src/env.ts:26`, `.env.example:2-6`). All three are `NEXT_PUBLIC_*` → **inlined at build time** by `next build` (`apps/web/src/env.ts:9-11`), so they must be present in the environment of the build step (CI sets them for the web build; see the deploy pipeline). They are **not secrets** — they ship to every browser.

| Var | What it is | Where the operator gets it | Secret? |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL for the browser Supabase client and the SSR middleware client (`apps/web/src/env.ts:13`, `apps/web/src/middleware.ts:18`). | Supabase dashboard → Project Settings → API → Project URL (same value as api's `SUPABASE_URL`). | **Public.** Build-time inlined. `env.ts:4` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The `sb_publishable_...` key (the browser-safe anon-equivalent). Distinct from the api's `sb_secret_` key. Used in the browser and middleware Supabase clients (`apps/web/src/env.ts:14-15`, `apps/web/src/middleware.ts:19`). | Supabase dashboard → Project Settings → API keys → **Publishable key** (`sb_publishable_...`). | **Public.** Build-time inlined. `env.ts:5` |
| `NEXT_PUBLIC_API_URL` | Base URL of the api Worker the browser calls, e.g. `https://api.jobtext.app` (validated as a URL, `apps/web/src/env.ts:16`). Should equal the api's `API_ORIGIN`. | Operator-chosen; the api Worker's public URL. | **Public.** Build-time inlined. `env.ts:6` |

> **Publishable vs secret Supabase keys:** web uses the **publishable** key (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`), api uses the **secret** key (`SUPABASE_SECRET_KEY`, `sb_secret_...`). Never put the secret key in any `NEXT_PUBLIC_*` var — it would ship to every browser.

There are **no** Sentry or PostHog integrations in the web app. The strings "PostHog"/"Sentry" appear only as text in marketing/legal pages (`apps/web/src/app/(marketing)/legal/subprocessors/page.tsx`, `.../security/page.tsx`, `.../legal/privacy/page.tsx`) — no env var, no client init. The web Worker `wrangler.jsonc` declares only the `ASSETS` binding (`apps/web/wrangler.jsonc:7-10`); no `vars`, no secrets.

---

## 3. CI/CD injection (GitHub Actions secrets)

The pipeline is `CI` → (on success, main) → `Deploy` (`.github/workflows/deploy.yml:3-7`). GitHub secrets used:

| GitHub secret | Used where | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | `deploy.yml:18` | wrangler auth for both `wrangler deploy` steps. |
| `CLOUDFLARE_ACCOUNT_ID` | `deploy.yml:19` | wrangler account target. |
| `NEXT_PUBLIC_SUPABASE_URL` | `ci.yml:36`, `deploy.yml:20` | Inlined into the web build (needed at build in **both** CI and Deploy). |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `ci.yml:37`, `deploy.yml:21` | Inlined into the web build. |
| `SUPABASE_ACCESS_TOKEN` | `deploy.yml:43` | `supabase link` / `db push` auth. |
| `SUPABASE_DB_PASSWORD` | `deploy.yml:44` | DB password for migration push. |
| `SUPABASE_PROJECT_REF` | `deploy.yml:46` | `supabase link --project-ref`. |

> **IMPORTANT — the API Worker secrets are NOT set by CI.** `deploy.yml:49-53` runs only `wrangler deploy` (api) and the OpenNext build+deploy (web); it never runs `wrangler secret put` and never passes the `apps/api/src/env.ts` secrets. Despite the aspirational comment in `apps/api/wrangler.jsonc:21-29` ("one injection path from GitHub Actions"), the actual workflow does **not** inject them. The operator must set every api secret manually with `wrangler secret put` (or `wrangler secret bulk`) **before the first deploy**, once per Worker. See `runbook.md` §"Set API Worker secrets". `NEXT_PUBLIC_API_URL` is likewise not set in CI — it must be present in the build environment or the web build defaults it to undefined and `apps/web/src/env.ts:19-24` throws.
