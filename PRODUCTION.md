# Production configuration — every secret, var, and binding

The complete production config for both Workers, generated from the code's own
validation schemas (`apps/api/src/env.ts`, `apps/web/src/env.ts`), the Stripe
setup script, and the deploy workflow. This is the shopping list; the numbered
step-by-step runbook is in [docs/deploy/](docs/deploy/README.md).

**Two Cloudflare Workers, five SaaS vendors, no other servers.**

| Worker | Serves | Config surface |
|---|---|---|
| `loonext-api` (Hono) | `/v1/*`, `/webhooks/*`, `/contact`, cron | Worker **secrets** (`wrangler secret put`) + **bindings** (`wrangler.jsonc`) |
| `loonext-web` (Next.js/OpenNext) | marketing site + app | **build-time** `NEXT_PUBLIC_*` vars (inlined at build) |

Legend: **Req** = required (Worker/build refuses to start without it). **Opt** =
optional (unset = the documented no-op / fallback). **Script** = value is printed
by `pnpm --filter @loonext/api stripe:setup` (see §3).

> **Filled-in values** (live credentials) live in `PRODUCTION.local.md` — a
> **gitignored** companion (same as `prod-secrets.json`), so secrets never enter
> git history. This tracked file stays secret-free.

---

## 1. `loonext-api` Worker secrets

Set each with `wrangler secret put <NAME> --config apps/api/wrangler.jsonc`
**before the first deploy** (CI does not set them). Source of truth:
`apps/api/src/env.ts`.

### Supabase
| Secret | Req | Source / value |
|---|---|---|
| `SUPABASE_URL` | Req | Supabase → Project Settings → API → Project URL (`https://<ref>.supabase.co`) |
| `SUPABASE_SECRET_KEY` | Req | Supabase → API keys → the `sb_secret_…` secret key (NOT the legacy service_role JWT) |
| `SUPABASE_JWKS_URL` | Req | `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` |

### Telnyx
| Secret | Req | Source / value |
|---|---|---|
| `TELNYX_API_KEY` | Req | Telnyx → API Keys |
| `TELNYX_PUBLIC_KEY` | Req | Telnyx → the account Ed25519 **public** key (webhook signature verification) |
| `TELNYX_VOICE_CONNECTION_ID` | Req | The Call-Control (voice) application id you create once (see §5) |

### Stripe — static
| Secret | Req | Source / value |
|---|---|---|
| `STRIPE_SECRET_KEY` | Req | Stripe → Developers → API keys → **restricted** live key |
| `STRIPE_WEBHOOK_SECRET` | Req | Stripe → the webhook endpoint's signing secret (`whsec_…`, see §5) |

### Stripe — catalog (printed by `stripe:setup`, §3)
| Secret | Req | Notes |
|---|---|---|
| `STRIPE_STARTER_PRICE_ID` | Req · Script | Starter $29/mo licensed price |
| `STRIPE_PRO_PRICE_ID` | Req · Script | Pro $79/mo licensed price |
| `STRIPE_STARTER_OVERAGE_PRICE_ID` | Req · Script | Starter graduated metered overage (0–500 free, then 3¢) |
| `STRIPE_PRO_OVERAGE_PRICE_ID` | Req · Script | Pro graduated metered overage (0–2,500 free, then 2.5¢) |
| `STRIPE_US_FEE_PRICE_ID` | Req · Script | One-time $29 US registration fee price |
| `STRIPE_SMS_METER_EVENT_NAME` | Req · Script | Billing meter event name (`sms_segments`) |
| `STRIPE_MODULE_MMS_PRICE_ID` | Opt · Script | RETIRED (#103): the module is gone (pictures are included, 3 texts each). **Keep it SET wherever the price was ever created** — the daily reconcile uses it to strip stale $5 items off live subscriptions. Unsetting it silently disables that sweep. |
| `STRIPE_MODULE_VOICE_PRICE_ID` | Opt · Script | $8/mo Call-forwarding add-on. Required to sell it |
| `STRIPE_MODULE_EXTRA_STORAGE_PRICE_ID` | Opt · Script | $5/mo Extra-storage add-on. Required to sell it |
| `STRIPE_MODULE_REGIONS_CA_PRICE_ID` | Opt · Script | Canada-numbers module (not yet sold; create for parity) |

### Email (Resend)
| Secret | Req | Source / value |
|---|---|---|
| `RESEND_API_KEY` | Req | Resend → API Keys (domain must be verified) |
| `RESEND_FROM` | Req | Sender at the verified domain, e.g. `Loonext <notifications@loonext.com>` |
| `RESEND_REPLY_TO` | Opt | Reply-To on every send. Set to `support@loonext.com` in production (routed per [docs/deploy/10-email-inbox.md](docs/deploy/10-email-inbox.md)) so "just reply to this email" reaches a human. Unset = no Reply-To |

### Origins
| Secret | Req | Source / value |
|---|---|---|
| `APP_ORIGIN` | Req | The **app** origin, e.g. `https://app.loonext.com` (CORS allow-origin + base of billing/email links) |
| `API_ORIGIN` | Req | This Worker's own origin, e.g. `https://api.loonext.com` (baked into Telnyx/Stripe webhook callback URLs) |
| `SITE_ORIGIN` | Opt* | The **marketing** origin, e.g. `https://loonext.com`. **\*Required when the D27 host split is on** (marketing and app on different hosts) or the public `/contact` form is CORS-blocked. Unset = single-host, falls back to `APP_ORIGIN` |

### Observability, push, captcha
| Secret | Req | Source / value |
|---|---|---|
| `SENTRY_DSN` | Req | Sentry → Project → Client Keys (DSN) |
| `VAPID_PUBLIC_KEY` | Req | `npx web-push generate-vapid-keys` (once, forever) — base64url P-256 point |
| `VAPID_PRIVATE_KEY` | Req | same command — base64url private scalar |
| `TURNSTILE_SECRET_KEY` | Opt | Cloudflare Turnstile **secret** for server-side verification on `/contact`. Unset = honeypot + rate-limit + daily-cap only |
| `POSTHOG_API_KEY` | Opt | PostHog Cloud project key. Unset = analytics is a silent no-op |

### Do NOT set in production
| Secret | Why |
|---|---|
| `TELNYX_API_BASE`, `STRIPE_API_BASE` | Vendor base-URL overrides for the hermetic E2E harness only. Leave **unset** so clients hit the real vendor hosts |

**Required count: 21 secrets** (Supabase 3 · Telnyx 3 · Stripe static 2 · Stripe
catalog 6 · Resend 2 · Origins 2 · Sentry 1 · VAPID 2). Plus the recommended
optionals: `SITE_ORIGIN`, `RESEND_REPLY_TO`, the 4 `STRIPE_MODULE_*_PRICE_ID`,
`TURNSTILE_SECRET_KEY`, `POSTHOG_API_KEY`.

---

## 2. `loonext-api` Worker bindings (in `wrangler.jsonc`, NOT secrets)

Deployed with the Worker — nothing to `secret put`, but each `namespace_id`
must be **unique within your Cloudflare account** (change if it collides).

| Binding | Type | namespace_id | Purpose |
|---|---|---|---|
| `SEND_RATE_LIMITER` | ratelimit | `1001` | Per-company outbound throttle (~1 msg/s) |
| `VERIFY_RATE_LIMITER` | ratelimit | `1002` | Per-target throttle on number-verification + contact form |

Also in `wrangler.jsonc`: **9 cron triggers** (usage re-report, alerts,
registration/port reconcile, grace release, webhook sweep, etc.) and
`compatibility_date`.

---

## 3. Stripe catalog — generate the IDs with the script

The Stripe price IDs above are **not typed by hand** — a checked-in script
creates the catalog and prints the exact env lines. Idempotent (reuses existing
objects by meter `event_name`, product `metadata.loonext_catalog`, and price
`lookup_key`), so it is safe to re-run.

```bash
# Run ONCE per Stripe mode (i.e. once against your LIVE key), from repo root:
STRIPE_SECRET_KEY=sk_live_... pnpm --filter @loonext/api stripe:setup
```

It creates: the `sms_segments` billing meter; Starter/Pro licensed prices
($29 / $79); Starter/Pro graduated metered overage; the one-time $29 US fee; and
the four module add-on prices ($5 MMS / $8 voice / $5 storage / $5 CA). Then it
prints, to stdout, the lines to copy into `wrangler secret put`:

```
STRIPE_SMS_METER_EVENT_NAME=sms_segments
STRIPE_STARTER_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_STARTER_OVERAGE_PRICE_ID=price_...
STRIPE_PRO_OVERAGE_PRICE_ID=price_...
STRIPE_US_FEE_PRICE_ID=price_...
STRIPE_MODULE_MMS_PRICE_ID=price_...
STRIPE_MODULE_VOICE_PRICE_ID=price_...
STRIPE_MODULE_EXTRA_STORAGE_PRICE_ID=price_...
STRIPE_MODULE_REGIONS_CA_PRICE_ID=price_...
```

Set each of those as a `loonext-api` Worker secret.

---

## 4. `loonext-web` build-time vars (`NEXT_PUBLIC_*`)

Inlined into the browser bundle **at build time**, so they are supplied to the
web build in CI as GitHub Actions secrets (§5), not `wrangler secret put`.
Source of truth: `apps/web/src/env.ts`.

| Var | Req | Source / value |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Req | Same as the API's `SUPABASE_URL` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Req | Supabase → API keys → the `sb_publishable_…` key (safe in the browser) |
| `NEXT_PUBLIC_API_URL` | Req | The api Worker origin — must equal `API_ORIGIN` exactly, e.g. `https://api.loonext.com` |
| `NEXT_PUBLIC_APP_ORIGIN` | Opt | The app origin, e.g. `https://app.loonext.com`. **Set to enable the D27 marketing/app host split** (must match the API's `APP_ORIGIN`). Unset = single-host, no split |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Opt | Turnstile **site** key (public). ⚠️ Must be set and web redeployed **before** enabling Supabase Auth captcha, or auth breaks |
| `NEXT_PUBLIC_SENTRY_DSN` | Opt | Sentry browser DSN. Unset = client error reporting off |
| `NEXT_PUBLIC_POSTHOG_KEY` | Opt | PostHog project key. Unset = client analytics off |

---

## 5. GitHub Actions secrets (CI / deploy)

Set under repo → Settings → Secrets and variables → Actions. Consumed by
`.github/workflows/deploy.yml`.

| Secret | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Wrangler deploy auth (Workers edit) |
| `CLOUDFLARE_ACCOUNT_ID` | Target Cloudflare account |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI auth (`supabase db push`) |
| `SUPABASE_PROJECT_REF` | Which Supabase project to link |
| `SUPABASE_DB_PASSWORD` | DB password for the migration push |
| `NEXT_PUBLIC_SUPABASE_URL` | Web build var (§4) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Web build var (§4) |
| `NEXT_PUBLIC_API_URL` | Web build var (§4) — **must exist before the first automated deploy** |
| `NEXT_PUBLIC_APP_ORIGIN` | Web build var (§4, optional — enables host split) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Web build var (§4, optional) |
| `NEXT_PUBLIC_SENTRY_DSN` | Web build var (§4, optional) — browser error reporting |
| `NEXT_PUBLIC_POSTHOG_KEY` | Web build var (§4, optional) — browser analytics |

> **Client telemetry (wired 2026-07-08):** `deploy.yml` now passes all six
> `NEXT_PUBLIC_*` build vars, including `NEXT_PUBLIC_SENTRY_DSN` and
> `NEXT_PUBLIC_POSTHOG_KEY`. Both stay optional — leave the Actions secret unset
> (or blank) and that client is a silent no-op. Two caveats: (1) PostHog's host is
> hardcoded to Cloud **US** (`us.i.posthog.com`), so the project must be US-region;
> (2) no Sentry build plugin is configured, so browser stack traces arrive
> minified (add `@sentry/nextjs`'s source-map upload later for readable traces).

---

## 6. Dashboard steps that have NO env var (easy to miss)

| Vendor | Step |
|---|---|
| **Supabase** | Enable an **ES256 (asymmetric) JWT signing key** — without it every `/v1/*` request 401s. Set **custom SMTP = Resend**. (Optional) Attack Protection → CAPTCHA = Turnstile (set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + redeploy web FIRST). Paste the branded auth email templates (`supabase/templates/`) |
| **Telnyx** | Create one **Call-Control (voice) application**, webhook + failover both `https://api.loonext.com/webhooks/telnyx`; its id → `TELNYX_VOICE_CONNECTION_ID` |
| **Stripe** | Create the **webhook endpoint** `https://api.loonext.com/webhooks/stripe` (the 7 events in `apps/api/src/webhooks/stripe.ts`); enable **Tax**; configure the **customer portal** + dunning → cancel |
| **Cloudflare** | Attach custom domains: `loonext.com` + `www.loonext.com` + `app.loonext.com` → `loonext-web`; `api.loonext.com` → `loonext-api`. Enable **Email Routing** for support@/privacy@/security@/notifications@/dmarc@ ([docs/deploy/10-email-inbox.md](docs/deploy/10-email-inbox.md)). Add the **DMARC** TXT record |

---

## 7. Deploy order (each step consumes the last)

1. Create the accounts + domain; delegate DNS to Cloudflare; get the 3 web hostnames + `api.loonext.com`.
2. Supabase Pro project → enable the ES256 key → `supabase db push` (applies all migrations) → grab the keys.
3. `pnpm --filter @loonext/api stripe:setup` (§3) → catalog IDs; create the Stripe webhook; enable Tax; configure the portal.
4. Telnyx API key + Ed25519 public key + Call-Control voice app → the 3 Telnyx values.
5. `wrangler secret put` all §1 secrets (incl. the §3 IDs, `SITE_ORIGIN`, `RESEND_REPLY_TO`) + set the §5 GitHub Actions secrets.
6. Push `main` → CI typechecks/lints/tests/builds, then deploys both Workers and pushes migrations. Bind the custom domains; register the live webhook URLs.
7. **Go-live smoke test** — [docs/deploy/07-go-live-checklist.md](docs/deploy/07-go-live-checklist.md): confirm the 9 cron triggers, `GET /health` → `{"ok":true}`, and run the test-mode end-to-end (sign up → pay → number provisions → send/receive a real text → cancel → grace).

---

*Authoritative sources this file is generated from: `apps/api/src/env.ts`,
`apps/web/src/env.ts`, `apps/api/scripts/stripe-setup.ts`, `apps/api/wrangler.jsonc`,
`.github/workflows/deploy.yml`. If they change, regenerate this table.*
