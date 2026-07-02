# 01 — Accounts & Domain

Create the vendor accounts and set up the domain + DNS. Do this first: every
later step needs credentials and hostnames from here.

> Domain and account emails are **operator decisions** — the values below are
> **PLACEHOLDERS**. The worked example uses the domain `jobtext.app`.

---

## 1. Accounts to create

| Vendor | Sign-up | Plan / tier | Notes |
|--------|---------|-------------|-------|
| Cloudflare | dash.cloudflare.com | **Workers Paid** (Standard) | Needed for both Workers, cron triggers, and the DNS zone. |
| Supabase | supabase.com | **Pro** | US region, Postgres 17 (`SPEC.md:98`, `supabase/config.toml:42`). Pro is required. See [02](./02-supabase.md). |
| Telnyx | telnyx.com | Standard; request **10DLC / Level 2** messaging | US + Canada messaging, 10DLC brand/campaign. See [04](./04-telnyx.md). |
| Stripe | stripe.com | Standard, then **enable Stripe Tax** | Automatic tax is set in code (`apps/api/src/routes/billing.ts:170`). See [03](./03-stripe.md). |
| Resend | resend.com | Any (needs a **verified sending domain**) | Transactional email + Supabase Auth SMTP. See [02](./02-supabase.md) §7. |
| Sentry | sentry.io | Team+ | API Worker error tracking (DSN only). |
| Domain registrar | your registrar | — | Register the domain, delegate DNS to Cloudflare. |
| Status page | Instatus / BetterStack (free tier) | — | Launch blocker (`docs/marketing/BLUEPRINT.md:984`). Stand up `status.<domain>`. |

**PostHog:** listed as a subprocessor in marketing prose
(`apps/web/src/app/(marketing)/legal/subprocessors/page.tsx:73`) but **there is no
PostHog code integration** in `apps/api` or `apps/web` and no env var reads it —
nothing to create or configure for deploy.

---

## 2. The hostname plan

JobText resolves three public hostnames. The two Worker origins are baked into
config and env, so decide them before setting secrets.

| Hostname (PLACEHOLDER) | Serves | Cloudflare object | Feeds env |
|------------------------|--------|-------------------|-----------|
| `app.jobtext.app` | The web app (`jobtext-web` Worker) | Custom domain on `jobtext-web` | `APP_ORIGIN` (api secret), `NEXT_PUBLIC_API_URL`'s peer |
| `api.jobtext.app` | The API + webhooks (`jobtext-api` Worker) | Custom domain on `jobtext-api` | `API_ORIGIN` (api secret), `NEXT_PUBLIC_API_URL` (web build) |
| `jobtext.app` (root) | Marketing site | Part of the `jobtext-web` app (marketing route group) | — |
| `status.jobtext.app` | Hosted status page | CNAME to the status provider | — |

Why these matter in code:

- **`APP_ORIGIN`** is the *exact* CORS allow-origin for the API — no wildcard
  (`apps/api/src/index.ts:65`) — and the base of every email/billing link
  (e.g. `apps/api/src/routes/billing.ts:171,199`, `apps/api/src/webhooks/stripe.ts:412`).
- **`API_ORIGIN`** is built into the Telnyx webhook callback URL
  (`${API_ORIGIN}/webhooks/telnyx`, `apps/api/src/telnyx/wizard.ts:140-142`) and the
  Stripe webhook endpoint (`${API_ORIGIN}/webhooks/stripe`, `apps/api/src/index.ts:114`).
- **`NEXT_PUBLIC_API_URL`** (the web bundle's API base) must equal `API_ORIGIN`
  (`apps/web/src/env.ts:6`).

`APP_ORIGIN`, `API_ORIGIN`, and `NEXT_PUBLIC_API_URL` must all agree with the actual
deployed Worker URLs or CORS, webhooks, and links break.

---

## 3. Cloudflare zone setup

1. In the Cloudflare dashboard, **Add a site** → enter your root domain
   (`jobtext.app`). Choose the Free plan for the zone (Workers Paid is a separate
   account-level subscription).
2. Cloudflare shows two **nameservers**. At your registrar, replace the registrar's
   nameservers with Cloudflare's. Wait for the zone to go **Active** (minutes to a
   few hours).
3. Leave the zone with no `A`/`AAAA` records for the app hostnames yet — the
   **custom-domain** bindings you add to each Worker in [05](./05-workers-deploy.md)
   §4 create the routing records for `app.` and `api.` automatically (orange-cloud
   proxied).
4. For the **root marketing** hostname, the same `jobtext-web` Worker serves it —
   add `jobtext.app` (and optionally `www`) as additional custom domains on
   `jobtext-web` in [05](./05-workers-deploy.md) §4.
5. For **`status.jobtext.app`**, add a `CNAME` to whatever host your status provider
   gives you (this is external to the Workers).

> **DNS records are created for you** when you attach a Worker custom domain — you
> do not hand-author `A` records for `app.`/`api.`. Verify after [05](./05-workers-deploy.md)
> that `app.` and `api.` resolve and are proxied.

---

## 4. Record these for later

Capture into a secure store (you'll paste them in [02](./02-supabase.md)–[05](./05-workers-deploy.md)):

- Cloudflare **Account ID** (`CLOUDFLARE_ACCOUNT_ID`) and an **API token** with
  *Workers Scripts: Edit* + *Workers Routes: Edit* + *DNS: Edit* on the zone
  (`CLOUDFLARE_API_TOKEN`) — both used by CI (`.github/workflows/deploy.yml:18-19`).
- The three chosen hostnames.

Next: [02 — Supabase](./02-supabase.md).
