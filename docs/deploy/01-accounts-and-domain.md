# 01 — Accounts & Domain

Create the vendor accounts and set up the domain + DNS. Do this first: every
later step needs credentials and hostnames from here.

> Domain and account emails are **operator decisions** — the values below are
> **PLACEHOLDERS**. The worked example uses the domain `loonext.com`.

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

**PostHog:** optional. The API Worker captures product analytics when the
optional `POSTHOG_API_KEY` secret is set (silent no-op when unset,
`apps/api/src/analytics/posthog.ts:31`) — create a PostHog Cloud US project only
if you want analytics. See [06](./06-env-reference.md) §E.

---

## 2. The hostname plan

Loonext resolves three public hostnames. The two Worker origins are baked into
config and env, so decide them before setting secrets.

| Hostname (PLACEHOLDER) | Serves | Cloudflare object | Feeds env |
|------------------------|--------|-------------------|-----------|
| `app.loonext.com` | The product (app/auth/onboarding) — `loonext-web` Worker | Custom domain on `loonext-web` | `APP_ORIGIN` (api secret), `NEXT_PUBLIC_APP_ORIGIN` (web build, optional — D27) |
| `api.loonext.com` | The API + webhooks (`loonext-api` Worker) | Custom domain on `loonext-api` | `API_ORIGIN` (api secret), `NEXT_PUBLIC_API_URL` (web build) |
| `loonext.com` (root) + `www.loonext.com` | Marketing site **only** (D27) | Custom domains on the same `loonext-web` Worker | — |
| `blog.loonext.com` | The blog **only** (#130) — same `loonext-web` Worker, served at the host root | Custom domain on `loonext-web` | `NEXT_PUBLIC_BLOG_ORIGIN` (web build, optional) |
| `status.loonext.com` | Hosted status page | CNAME to the status provider | — |

> **D27 — marketing/app host split** (`docs/DECISIONS.md` D27): there is still
> only **one** web Worker. `loonext.com`, `www.loonext.com`, **and**
> `app.loonext.com` all attach to it as custom domains; the middleware's first
> gate (`apps/web/src/lib/hosts.ts`) decides per request. With
> `NEXT_PUBLIC_APP_ORIGIN` set, the marketing host serves only marketing pages
> (app-surface paths 308 to the app origin; `www` canonicalizes to the apex) and
> the app host serves only the product (marketing paths 308 to the canonical
> site; `/` roots at `/for-you`). Unset (dev/CI/previews) = no gating.

Why these matter in code:

- **`APP_ORIGIN`** is the *exact* CORS allow-origin for the API — no wildcard
  (`apps/api/src/index.ts:75`) — and the base of every email/billing link
  (e.g. `apps/api/src/routes/billing.ts:216-217,293`, `apps/api/src/webhooks/stripe.ts:726`).
  Supabase/Stripe return URLs stay on `APP_ORIGIN` — the D27 split changes none
  of them.
- **`API_ORIGIN`** is built into the Telnyx webhook callback URL
  (`${API_ORIGIN}/webhooks/telnyx`, `apps/api/src/telnyx/wizard.ts:140-142`) and the
  Stripe webhook endpoint (`${API_ORIGIN}/webhooks/stripe`, `apps/api/src/index.ts:128`).
- **`NEXT_PUBLIC_API_URL`** (the web bundle's API base) must equal `API_ORIGIN`
  (`apps/web/src/env.ts:6`).
- **`NEXT_PUBLIC_APP_ORIGIN`** (optional, web build) must equal `APP_ORIGIN` and
  activates the D27 host split (`apps/web/src/env.ts:11-16`,
  `apps/web/src/lib/hosts.ts`).
- **`NEXT_PUBLIC_BLOG_ORIGIN`** (optional, web build; #130) = `https://blog.loonext.com`.
  When set, the middleware (`decideBlogRewrite`, `apps/web/src/lib/hosts.ts`)
  serves the blog at the subdomain root: `blog.loonext.com/<slug>` rewrites
  internally to the `/blog/<slug>` route, `blog.loonext.com/` → the index,
  `/rss.xml` → the feed. `loonext.com/blog` keeps working unchanged, and blog
  canonical URLs stay `loonext.com/blog/<slug>` (one canonical, no duplicate
  content) until you decide to flip them. Unset (dev/CI/previews) = no blog host.

`APP_ORIGIN`, `API_ORIGIN`, `NEXT_PUBLIC_API_URL` (and `NEXT_PUBLIC_APP_ORIGIN`
when set) must all agree with the actual deployed Worker URLs or CORS, webhooks,
links, and the host split break.

---

## 3. Cloudflare zone setup

1. In the Cloudflare dashboard, **Add a site** → enter your root domain
   (`loonext.com`). Choose the Free plan for the zone (Workers Paid is a separate
   account-level subscription).
2. Cloudflare shows two **nameservers**. At your registrar, replace the registrar's
   nameservers with Cloudflare's. Wait for the zone to go **Active** (minutes to a
   few hours).
3. Leave the zone with no `A`/`AAAA` records for the app hostnames yet — the
   **custom-domain** bindings you add to each Worker in [05](./05-workers-deploy.md)
   §4 create the routing records for `app.` and `api.` automatically (orange-cloud
   proxied).
4. For the **marketing** hostnames, the same `loonext-web` Worker serves them —
   add `loonext.com` **and** `www.loonext.com` as additional custom domains on
   `loonext-web` in [05](./05-workers-deploy.md) §4. (With the D27 host split
   active, `www` must be attached so the middleware can 308 it to the apex.)
5. For the **blog** (#130), add `blog.loonext.com` as **another** custom domain on
   the same `loonext-web` Worker (its custom-domain binding creates the proxied
   DNS record for you), then set `NEXT_PUBLIC_BLOG_ORIGIN=https://blog.loonext.com`
   in the web build env and redeploy. The middleware then serves the blog at the
   subdomain root. No new Worker, no MDX pipeline: the existing typed blog routes
   render identically on the subdomain.
6. For **`status.loonext.com`**, add a `CNAME` to whatever host your status provider
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
