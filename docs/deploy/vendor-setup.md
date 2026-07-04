# Vendor Setup — Ordered Actions → Env Vars

The per-vendor "what to do, in what order, and which secret it produces" index.
Detail pages: Supabase [05](./05-supabase-migrations.md), Telnyx/Resend/Sentry
[07](./07-webhooks-and-vendor-setup.md), Stripe
[09](./09-stripe-catalog-setup.md). Env inventory:
[env-and-secrets.md](./env-and-secrets.md). Every fact cites `file:line`; nothing
here is invented.

Correct cold-start order across vendors (each depends on the prior): **Supabase →
Stripe catalog → custom domains → Resend/Sentry/Telnyx creds → set Worker secrets
→ deploy → register Stripe webhook.** The Stripe webhook and both `*_ORIGIN`
values can only be finalized once the API custom domain exists.

---

## Supabase → yields `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

1. Create Pro project, US `us-east-1`, Postgres 17 (`SPEC.md:98`,
   `supabase/config.toml:42`).
2. **Enable an asymmetric ES256 signing key** (Auth → Signing Keys). Without it,
   no JWKS is published and every `/v1/*` request 401s — verification is ES256-only
   (`apps/api/src/auth/jwt.ts:41-44`, `SPEC.md:100`).
3. Copy Project URL → `SUPABASE_URL` (api) + `NEXT_PUBLIC_SUPABASE_URL` (web).
4. Copy **Secret key** `sb_secret_...` → `SUPABASE_SECRET_KEY`
   (`apps/api/src/db.ts:11-22`, `env.ts:24`).
5. Copy **Publishable key** `sb_publishable_...` →
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`apps/web/src/env.ts:5`).
6. Set `SUPABASE_JWKS_URL` =
   `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`
   (`apps/api/src/test/support.ts:16-17`, `env.ts:25`).
7. Set **custom SMTP = Resend** for Auth invite/reset emails (`SPEC.md:100,1065`).
8. Set **Turnstile** under Auth → Attack Protection → CAPTCHA (`SPEC.md:1052`):
   the Turnstile **secret** key goes here; the widget's **site** key becomes the
   optional `NEXT_PUBLIC_TURNSTILE_SITE_KEY` web build var
   (`apps/web/src/env.ts:10`, injected by deploy from the GitHub secret of the
   same name — `.github/workflows/deploy.yml:23-26`). **Set that secret and
   redeploy web BEFORE enabling this dashboard setting** — captcha enforced
   against a site-key-less build breaks every email/password
   signup/login/reset.
9. Migrations + `mms-media` bucket + extensions are applied by `supabase db push`
   in deploy — not by hand (`.github/workflows/deploy.yml:50-56`).

## Stripe → yields `STRIPE_STARTER_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, `STRIPE_STARTER_OVERAGE_PRICE_ID`, `STRIPE_PRO_OVERAGE_PRICE_ID`, `STRIPE_US_FEE_PRICE_ID`, `STRIPE_SMS_METER_EVENT_NAME`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

1. Get a secret key with catalog write (`sk_live_...`)
   (`apps/api/scripts/stripe-setup.ts:6,28-35`).
2. Run `STRIPE_SECRET_KEY=sk_live_... pnpm --filter @jobtext/api stripe:setup`
   once per mode — creates the `sms_segments` meter, 3 products, 6 prices,
   idempotently (`apps/api/scripts/stripe-setup.ts:39-163`).
3. Capture the six printed stdout lines → the six `STRIPE_*` id/name secrets
   (`apps/api/scripts/stripe-setup.ts:165-171`, `apps/api/src/env.ts:53-59`).
4. Enable **Stripe Tax** on the account (checkout sets `automatic_tax.enabled`
   in code — `apps/api/src/routes/billing.ts:170`).
5. Choose the runtime key → `STRIPE_SECRET_KEY` (a restricted `rk_live_...` is
   fine for runtime — see [env-and-secrets.md](./env-and-secrets.md) §Stripe).
6. **After the API domain exists** (the `API_ORIGIN` value — see
   [runbook.md](./runbook.md) §1c): register webhook endpoint
   `https://api.jobtext.app/webhooks/stripe` with the 7 events the handler
   switches on (`apps/api/src/webhooks/stripe.ts:124-138`); copy its signing
   secret → `STRIPE_WEBHOOK_SECRET` (`env.ts:36`).
7. Set failed-payment action to **cancel subscription** after Smart-Retry
   exhaustion (`SPEC.md:1017`).

## Telnyx → yields `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`, `TELNYX_VOICE_CONNECTION_ID`

1. Create a **V2 API key** (Account → API Keys) → `TELNYX_API_KEY`; bearer on
   every call (`apps/api/src/telnyx/client.ts:80`, `env.ts:26`).
2. Copy the **webhook signing Public Key** (Account → Public Key) →
   `TELNYX_PUBLIC_KEY` = base64 of the 32-byte raw Ed25519 key
   (`apps/api/src/telnyx/verify.ts:5-11,38-40`, `env.ts:27`).
3. Create **one Call-Control application** (Voice → Call Control / Programmable
   Voice) with webhook URL **and** webhook failover URL both
   `${API_ORIGIN}/webhooks/telnyx` (the same endpoint as messaging; `call.*`
   events are Ed25519-verified the same way) → its application id is
   `TELNYX_VOICE_CONNECTION_ID` (`env.ts:28-34`). The Worker binds each
   company's numbers to it for the missed-call text-back, D26
   (`apps/api/src/telnyx/voice.ts:73,88-101`).
4. Complete any account-level messaging/10DLC enablement + funding Telnyx
   requires (account prerequisite, not app config).
5. **Do nothing else in the portal.** Messaging profiles (one per company, with
   `webhook_url`+`webhook_failover_url` = `${API_ORIGIN}/webhooks/telnyx`),
   number orders, and 10DLC brand/campaign registration are all done at runtime
   by the Worker via the API (`apps/api/src/telnyx/provisioning.ts:134-170,
   330-365`, `apps/api/src/telnyx/registration.ts`). The Telnyx webhook URL is
   **never** entered in a portal field — it is set programmatically on each
   messaging profile and each 10DLC object (`apps/api/src/telnyx/wizard.ts:140-142,
   167-168,224-225`).

## Resend → yields `RESEND_API_KEY`, `RESEND_FROM`

1. Add + **verify the sending domain** (DKIM/SPF DNS records). `RESEND_FROM`
   must be an address at this domain, e.g. `JobText <notifications@jobtext.app>`
   (`apps/api/src/env.ts:42-43`, `.dev.vars.example:18`). Unverified domain → every
   send throws (`apps/api/src/email/resend.ts:43-50`).
2. Create an API key `re_...` → `RESEND_API_KEY`
   (`apps/api/src/email/resend.ts:30`, `env.ts:37`).
3. Provide Resend SMTP credentials to Supabase Auth (step 7 under Supabase).

## Sentry → yields `SENTRY_DSN`

1. Create a project; copy the DSN (Settings → Client Keys) → `SENTRY_DSN`. The
   Worker wraps fetch+scheduled with PII-scrubbing `beforeSend`
   (`apps/api/src/index.ts:242`, `observability/sentry.ts:117-125`, `env.ts:38`).

## PostHog → yields `POSTHOG_API_KEY` (OPTIONAL)

1. (Optional) Create a PostHog Cloud US project; copy the **Project API key** →
   `POSTHOG_API_KEY` (`apps/api/src/env.ts:65`). The API Worker's `capture`
   helper posts the north-star funnel events with `distinct_id` = company_id
   only — no PII (`apps/api/src/analytics/posthog.ts`).
2. Skip entirely to run without analytics — with the key unset every capture is
   a silent no-op (`apps/api/src/analytics/posthog.ts:31`). See
   [07](./07-webhooks-and-vendor-setup.md) §PostHog.

## Cloudflare / origins → yields `APP_ORIGIN`, `API_ORIGIN`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_APP_ORIGIN`

Not a third-party vendor account beyond Cloudflare, but these config values must
be decided with the custom domains (see [runbook.md](./runbook.md) §6):

- `APP_ORIGIN` = web Worker public origin, e.g. `https://app.jobtext.app` — CORS
  allow-origin (exact match) + all user-facing email links
  (`apps/api/src/index.ts:75`, `env.ts:39`).
- `API_ORIGIN` = api Worker public origin, e.g. `https://api.jobtext.app` — built
  into the Telnyx webhook callback URL (`apps/api/src/telnyx/wizard.ts:140-142`,
  `env.ts:41`).
- `NEXT_PUBLIC_API_URL` = same as `API_ORIGIN`, inlined into the web bundle at
  build (`apps/web/src/env.ts:6`). Wired into the workflows: CI builds with a
  fixed placeholder (`.github/workflows/ci.yml:44-47`) and Deploy reads the
  `NEXT_PUBLIC_API_URL` GitHub Actions secret (`deploy.yml:22`) — set that
  secret before relying on the automated deploy.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (optional) = the Cloudflare **Turnstile**
  widget's site key, inlined into the web bundle when Supabase Auth captcha is
  enabled (`apps/web/src/env.ts:10`; secret key → Supabase dashboard, step 8
  under Supabase above).
- `NEXT_PUBLIC_APP_ORIGIN` (optional) = same as `APP_ORIGIN`, inlined into the
  web bundle to activate the **D27 marketing/app host split**
  (`apps/web/src/env.ts:11-16`, `apps/web/src/lib/hosts.ts`): marketing only on
  `jobtext.app` (+ `www` → apex), the product only on `app.jobtext.app`; blank =
  no gating (dev/CI). Deploy reads the optional GitHub secret of the same name
  (`deploy.yml:27-30`). Requires `jobtext.app`, `www.jobtext.app`, and
  `app.jobtext.app` all attached as custom domains on the **one** web Worker.
  Supabase/Stripe return URLs stay on `APP_ORIGIN` unchanged.

## Web Push (self-generated) → yields `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`

Not a vendor — generate once: `npx web-push generate-vapid-keys`
(`apps/api/.dev.vars.example:19`, `apps/api/src/env.ts:44-50`). Reuse forever;
rotating invalidates all push subscriptions.
