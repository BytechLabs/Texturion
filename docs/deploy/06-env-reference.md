# 06 — Environment Reference (single source of truth)

**Status: CURRENT DIRECTION (#323).** The ONE variable inventory (#377). `scripts/check-env-doc.mjs` fails CI when this and `apps/api/src/env.ts` / `apps/web/src/env.ts` disagree, so it cannot drift silently.

Every variable Loonext reads, split by surface. **Secret?** = whether it's a
Cloudflare Worker encrypted secret / GitHub Actions secret vs a build-time public
value. Formats are illustrative — real values come from the vendor dashboards.

- **API Worker secrets** are validated at startup by the zod schema in
  `apps/api/src/env.ts:22-104`; a missing/invalid one fails loudly and `/health`
  re-validates (`apps/api/src/index.ts:88-92`). There are **25 required for
  launch + 1 optional** (`POSTHOG_API_KEY`). Four of the 25 — the
  `STRIPE_MODULE_*_PRICE_ID` add-on price ids — are *optional in the schema*
  (the Worker boots without them, `apps/api/src/env.ts:64-67`) but
  **launch-required**: with any of them unset, that opt-in module is reported
  `available: false` and refused at checkout and in the add-on toggle
  ("isn't available yet" — `apps/api/src/routes/billing.ts:190-200,553-559`,
  `apps/api/src/billing/modules.ts:103-114`), so it cannot be sold.
- **Web build vars** are the `NEXT_PUBLIC_*` inlined at `next build` — three
  required plus two optional (`apps/web/src/env.ts:3-17`).
- **GitHub Actions secrets** feed CI/Deploy (`.github/workflows/*`).
- Two Worker **bindings** are configured in `wrangler.jsonc`, not as secrets:
  `SEND_RATE_LIMITER` and `VERIFY_RATE_LIMITER` (see A.1 below).

---

## A. API Worker secrets (`loonext-api`) — 25 required for launch + 1 optional

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
| `RESEND_FROM` | yes | Operator-set; address at the verified Resend domain | `Loonext <notifications@loonext.com>` |
| `SENTRY_DSN` | yes | Sentry → Project → Client Keys (DSN) | `https://abc123@o0.ingest.sentry.io/0` |
| `APP_ORIGIN` | yes | Operator decision (app origin) | `https://app.loonext.com` |
| `API_ORIGIN` | yes | Operator decision (this Worker's origin) | `https://api.loonext.com` |
| `SITE_ORIGIN` | **required with the D27 host split** (optional otherwise) | Operator decision (marketing origin) | `https://loonext.com` |
| `VAPID_PUBLIC_KEY` | yes | `npx web-push generate-vapid-keys` (once, forever) | base64url ~87 chars |
| `VAPID_PRIVATE_KEY` | yes | same command as above | base64url ~43 chars |
| `STRIPE_STARTER_PRICE_ID` | yes | Printed by `pnpm --filter @loonext/api stripe:setup` | `price_xxxxxxxxxxxx` |
| `STRIPE_PRO_PRICE_ID` | yes | `stripe:setup` output | `price_xxxxxxxxxxxx` |
| `STRIPE_STARTER_OVERAGE_PRICE_ID` | yes | `stripe:setup` output | `price_xxxxxxxxxxxx` |
| `STRIPE_PRO_OVERAGE_PRICE_ID` | yes | `stripe:setup` output | `price_xxxxxxxxxxxx` |
| `STRIPE_US_FEE_PRICE_ID` | yes | `stripe:setup` output | `price_xxxxxxxxxxxx` |
| `STRIPE_STARTER_YEAR_PRICE_ID` | no | `stripe:setup` output. #400/D107 prepaid year, one-time $290. **Unset = no offer** | `price_xxxxxxxxxxxx` |
| `STRIPE_PRO_YEAR_PRICE_ID` | no | `stripe:setup` output. #400/D107 prepaid year, one-time $790. **Unset = no offer** | `price_xxxxxxxxxxxx` |
| `STRIPE_PREPAID_YEAR_COUPON_ID` | no | `stripe:setup` output. The 100%-off, 12-month coupon that delivers the year | `loonext_prepaid_year` |
| `STRIPE_REFERRAL_MONTH_COUPON_ID` | no | `stripe:setup` output. #399, the free month each side of a referral earns. **Unset = referrals record but never pay out** | `loonext_referral_month` |
| `STRIPE_SMS_METER_EVENT_NAME` | yes | `stripe:setup` output (always `sms_segments`) | `sms_segments` |
| `STRIPE_VOICE_METER_EVENT_NAME` | yes — **launch-required** (schema-optional) | `stripe:setup` output (always `voice_seconds`) — D36 voice overage. Unset: forwarded seconds are stamped non-reportable at insert and go unbilled (never over-billed, no retroactive backlog). | `voice_seconds` |
| `STRIPE_STARTER_VOICE_OVERAGE_PRICE_ID` | yes — **launch-required** (schema-optional) | `stripe:setup` output — D36 voice metered price (2,500 min at $0, then 1¢/min) | `price_xxxxxxxxxxxx` |
| `STRIPE_PRO_VOICE_OVERAGE_PRICE_ID` | yes — **launch-required** (schema-optional) | `stripe:setup` output — D36 voice metered price (6,000 min at $0, then 1¢/min) | `price_xxxxxxxxxxxx` |
| `STRIPE_MODULE_MMS_PRICE_ID` | yes — **launch-required** (schema-optional) | `stripe:setup` output — Picture messages add-on, $5/mo | `price_xxxxxxxxxxxx` |
| `STRIPE_MODULE_VOICE_PRICE_ID` | yes — **launch-required** (schema-optional) | `stripe:setup` output — Calling add-on, $8/mo | `price_xxxxxxxxxxxx` |
| `STRIPE_MODULE_EXTRA_STORAGE_PRICE_ID` | yes — **launch-required** (schema-optional) | `stripe:setup` output — Extra storage add-on, $5/mo | `price_xxxxxxxxxxxx` |
| `STRIPE_MODULE_REGIONS_CA_PRICE_ID` | yes — **launch-required** (schema-optional) | `stripe:setup` output — Canada numbers add-on, $5/mo. Set it now so the live flip is complete, but the module itself stays **coming soon**: the API refuses to sell `regions_ca` regardless of the price id until multi-region provisioning ships (`apps/api/src/billing/company-modules.ts:26-33`). | `price_xxxxxxxxxxxx` |
| `POSTHOG_API_KEY` | yes — **OPTIONAL** | PostHog → Project Settings → Project API key | `phc_xxxxxxxxxxxx` |
| `OPS_ALERT_EMAIL` | yes — **OPTIONAL** | Operator decision; the address FOUNDER alerts go to. Unset falls back to `support@loonext.com`, so nothing is lost by omitting it — but every founder-facing alert then lands in the support inbox rather than wherever you actually read them. Carries: storage-abuse tiers (#121), AI per-feature cap alerts, the per-dial volume alert (#448), the "this tenant is projected to cost more than they pay" copy and its weekly digest (#447), and the opt-out reconciliation report (#331), and the #387 liveness alerts — the one channel that reports things which did NOT happen, and the only way a stopped cron or a dead delivery channel is ever noticed. | `founder@loonext.com` |
| `CANARY_FROM_E164` | no — **OPTIONAL, off by default** | #308 synthetic inbound canary: the number the hourly probe texts FROM. Unset (with or without its pair) leaves the canary off entirely — a logged no-op, and its liveness expectation is withheld so it cannot alert about a feature nobody enabled. Set BOTH halves to switch it on. | `+15125550100` |
| `CANARY_TO_E164` | no — **OPTIONAL, off by default** | The number the canary texts TO, and it **must be a number this platform owns** — the job checks `phone_numbers` and refuses otherwise, which is what makes this the one send path allowed to skip the §5 gates. Prefer a number no workspace owns, so the round trip never threads into a customer's inbox. Cost when enabled: ~1.7c per hourly round trip (one segment out, one in), and sending stops automatically once 6 round trips in 24h go unanswered — by then the alert is raised and further sends only re-buy it. | `+15125550199` |
| `STRIPE_EXTRA_NUMBER_STARTER_PRICE_ID` | yes — **launch-required** (schema-optional) | `stripe:setup` output — extra number on Starter. Unset does NOT give a free number: `billing/extra-numbers.ts` fails CLOSED and refuses to sell one. | `price_xxxxxxxxxxxx` |
| `STRIPE_EXTRA_NUMBER_PRO_PRICE_ID` | yes — **launch-required** (schema-optional) | `stripe:setup` output — extra number on Pro. Same fail-closed behaviour as the Starter id. | `price_xxxxxxxxxxxx` |
| `TELNYX_WEBRTC_CONNECTION_ID` | yes — **required for calling** | Telnyx → Voice → Credential connection used to mint softphone tokens. Unset boots fine and the token endpoint 503s honestly, which means **the browser phone does not work** — every call feature is dark. | `2XXXXXXXXXXXXXXXXX` |
| `TURNSTILE_SECRET_KEY` | yes — **OPTIONAL** | Cloudflare → Turnstile → widget secret. Unset leaves signup on its honeypot, rate limits and daily cap only, and no token is required — weaker, not broken. | `0x4AAAAAAA...` |
| `FCM_SERVICE_ACCOUNT_JSON` | yes — **required for Android push** | Firebase → Project settings → Service accounts → generate key, pasted as one JSON line. Unset makes an Android push a logged no-op; Web Push is unaffected. | `{"type":"service_account",…}` |
| `RESEND_WEBHOOK_SECRET` | yes — **OPTIONAL** | The Svix signing secret from the Resend dashboard's webhook page. Without it `/webhooks/resend` returns 503 to every request and NOTHING is suppressed — bounces and spam complaints accumulate against the sending domain unseen, which is the #386 failure in full. The endpoint refuses rather than trusting an unsigned body: an unauthenticated bounce feed would let anybody suppress any address in the product. Resend retries, so events queue up and arrive once this is set. | `whsec_…` |
| `RESEND_REPLY_TO` | yes — **OPTIONAL** | Operator decision; the Reply-To stamped on every outbound email. A per-send value overrides it. | `support@loonext.com` |
| `BILLING_WRITES_DISABLED` | no — **incident switch** | Set only to pause Stripe WRITES during an incident. Reads are never gated; absent is the normal posture and the one to deploy with. | `1` |
| `STRIPE_API_BASE` | no — **local/e2e only** | Points the Stripe client at a stub (`http://127.0.0.1:8791`). Must be **absent in production** or billing talks to nothing. | *(unset)* |
| `TELNYX_API_BASE` | no — **local/e2e only** | Points the Telnyx client at a stub. Must be **absent in production** or messaging and calling talk to nothing. | *(unset)* |

**Validation notes** (`apps/api/src/env.ts`): `SUPABASE_URL`, `SUPABASE_JWKS_URL`,
`SENTRY_DSN`, `APP_ORIGIN`, `API_ORIGIN` must parse as URLs (`z.url()`, lines
23,25,38,39,41); the rest are non-empty strings (`z.string().min(1)`).
Schema-optional secrets: the four `STRIPE_MODULE_*_PRICE_ID` ids
(`apps/api/src/env.ts:64-67` — boot succeeds, but the corresponding add-on is
unsellable until each is set; see the header note) and `POSTHOG_API_KEY`
(`apps/api/src/env.ts:75`) — unset, every analytics capture is a silent no-op
(`apps/api/src/analytics/posthog.ts:31`). Set them all with `wrangler secret put`
— see [05](./05-workers-deploy.md) §2. `wrangler.jsonc` `vars` is intentionally
empty (`apps/api/wrangler.jsonc:64`).

### A.1 Not secrets — the two rate-limiter bindings

Two Workers **rate-limiting unsafe bindings** are declared in
`apps/api/wrangler.jsonc:23-54`, deployed with the Worker — there is nothing to
`wrangler secret put`. Both are typed `optional` in the schema
(`apps/api/src/env.ts:83,93`), so local dev/tests run without either binding and
the respective gate is skipped. Each `namespace_id` must be **unique within your
Cloudflare account** — change it if it collides with another Worker's limiter.

| Binding | `namespace_id` | Config | Keyed on | Guards |
|---------|:--:|--------|----------|--------|
| `SEND_RATE_LIMITER` | `"1001"` | `limit: 10` / `period: 10`s | `company_id` | The per-company outbound-send choke point (≡ the SPEC's 1 msg/s average with sub-10s bursts). `wrangler.jsonc:33-37`, `env.ts:83`. |
| `VERIFY_RATE_LIMITER` | `"1002"` | `limit: 3` / `period: 60`s | target number | The keep-your-number ownership-verification endpoints (`routes/text-enablement.ts`): requesting a code makes Telnyx SMS/CALL the target number the company has not yet proven it owns, and the verify endpoint accepts code guesses — so both are bounded per target number (3/min caps call/SMS-bombing and code brute-force). `wrangler.jsonc:48-51`, `env.ts:93`. |

---

## B. Web build-time public vars (`loonext-web`) — 3 required + 6 optional

Inlined at `next build`; the build **fails** if any of the three required ones is
missing (`apps/web/src/env.ts:3-17,22-38`). They are public (shipped in the
browser bundle).

| Name | Secret? | Source | Example format |
|------|:------:|--------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | no (public) | Same as `SUPABASE_URL` | `https://abcdefghijklmnop.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | no (public) | Supabase → Settings → API → **Publishable key** | `sb_publishable_xxxxxxxxxxxx` |
| `NEXT_PUBLIC_API_URL` | no (public) | Operator decision; must equal `API_ORIGIN` | `https://api.loonext.com` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — **OPTIONAL** | no (public) | Cloudflare → Turnstile → your widget → **Site key** | `0x4AAAAAAA...` |
| `NEXT_PUBLIC_APP_ORIGIN` — **OPTIONAL** | no (public) | Operator decision; must equal the api Worker's `APP_ORIGIN` secret | `https://app.loonext.com` |
| `NEXT_PUBLIC_GTM_ID` — **OPTIONAL** | no (public) | Google Tag Manager → container → **Container ID** (#124) | `GTM-MTL658DD` |
| `NEXT_PUBLIC_SENTRY_DSN` — **OPTIONAL** | no (public) | Sentry → the WEB project → Client Keys (DSN). Unset means client-side error reporting is silently off — the server Worker keeps reporting either way. | `https://abc123@o0.ingest.sentry.io/1` |
| `NEXT_PUBLIC_POSTHOG_KEY` — **OPTIONAL** | no (public) | PostHog → Project Settings → Project API key. Unset means product analytics is silently off. Distinct from the Worker's `POSTHOG_API_KEY`. | `phc_xxxxxxxxxxxx` |
| `NEXT_PUBLIC_BLOG_ORIGIN` — **OPTIONAL** | no (public) | Operator decision (#130). When set, the middleware serves the blog at this host's root; `loonext.com/blog` keeps working either way. Unset = no blog host. | `https://blog.loonext.com` |
| `NEXT_PUBLIC_MAP_TILE_URL` — **OPTIONAL** | no (public) | #428: the Map's basemap tile template, from a provider whose terms permit a PAID product to serve their tiles. Unset means the map draws pins on an empty ground and says so — it never falls back to `tile.openstreetmap.org`, which the OSMF does not license for commercial use (and which the code refuses even if configured). Requires the attribution below to be set too. See `docs/MAP-TILES.md`. | `https://api.example.com/maps/{z}/{x}/{y}.png?key=…` |
| `NEXT_PUBLIC_MAP_TILE_ATTRIBUTION` — **OPTIONAL** | no (public) | #428: the provider's required credit line, VERBATIM as they word it — most require crediting both themselves and OpenStreetMap where OSM data underlies their tiles. Set together with the URL above; either one alone counts as no basemap, because a tile source with no credit is the same licensing problem under a different name. | `&copy; Example Maps &copy; OpenStreetMap contributors` |
| `NEXT_PUBLIC_MAP_TILE_MAX_ZOOM` — **OPTIONAL** | no (public) | #428: the provider's deepest zoom. Defaults to 19; a non-numeric or non-positive value falls back to 19 rather than rendering a broken map. | `22` |

> `NEXT_PUBLIC_GTM_ID` (`apps/web/src/env.ts`, #124): when set, the MARKETING
> layout loads Google Tag Manager (marketing pages only — never the app) under
> **Consent Mode v2 with a consent banner built in**: the loader seeds a
> denied-by-default consent state from the visitor's stored choice (the
> `loonext.consent` cookie) before gtm.js loads, the banner asks once, and
> /legal/cookies carries a change-your-mind control. Cookie-setting tags
> (GA4, ads pixels) added in the GTM UI therefore fire only for visitors who
> said yes — provided the tags use GTM's built-in consent checks (they read
> exactly these signals; leave "additional consent checks" at its default).
> There is deliberately NO GTM `<noscript>` iframe: it cannot respect consent.
> Unset (dev/CI/previews) = GTM off and no banner. the `backend` job in `ship.yml` carries this
> var as a repo secret (set 2026-07-10), so production builds ship with it.
>
> `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (`apps/web/src/env.ts:10`): when set,
> signup/login/reset-password render Cloudflare Turnstile and pass the
> `captchaToken` to Supabase Auth; when unset the pages behave as before. It is
> the web-side half of the "enable Supabase Auth captcha" go-live step — the
> Turnstile **secret** key goes in the Supabase dashboard (section D), the
> **site** key in this var. Deploy passes it into the web build from the
> optional GitHub secret of the same name (`.github/workflows/ship.yml` → the `backend` job's `env:` block);
> CI builds without it (the CI artifact is never deployed). **Set the GitHub
> secret and redeploy web BEFORE enabling captcha in the Supabase dashboard** —
> captcha enforced against a build with no site key breaks every email/password
> signup, login, and password reset.

> `NEXT_PUBLIC_APP_ORIGIN` (`apps/web/src/env.ts:11-16`): the D27 marketing/app
> host split (`docs/DECISIONS.md` D27, `apps/web/src/lib/hosts.ts`). When set
> (production: `https://app.loonext.com`), the middleware serves **only**
> marketing pages on `loonext.com` (with `www` → apex canonicalization) and
> **only** the product on the app origin — app-surface paths on the marketing
> host 308 to the app origin and vice versa. Unset (dev/CI/previews) = no
> gating; every route stays on one origin. Deploy passes it from the optional
> GitHub secret of the same name (`.github/workflows/ship.yml` → the `backend` job's `env:` block). All
> three hostnames (`loonext.com`, `www.loonext.com`, `app.loonext.com`) attach
> as custom domains on the **one** web Worker ([01](./01-accounts-and-domain.md)
> §2). Supabase/Stripe return URLs stay on `APP_ORIGIN` unchanged.

> `NEXT_PUBLIC_API_URL` is wired into both workflows: CI builds with a fixed
> placeholder (`.github/workflows/checks.yml` → the `build` job's `env:` block — the CI artifact is never
> deployed), Deploy reads the `NEXT_PUBLIC_API_URL` GitHub secret
> (`.github/workflows/ship.yml` → the `backend` job's `env:` block).

---

## C. GitHub Actions secrets (CI / Deploy) — 9 required + 2 optional

Consumed by the **Deploy** workflow only; never reach the Workers as runtime
bindings. CI reads **no repo secrets** — its web build uses fixed placeholders
for all three `NEXT_PUBLIC_*` vars (`.github/workflows/checks.yml` → the `build` job's `env:` block; the CI
artifact is never deployed).

| Name | Secret? | Source | Used at |
|------|:------:|--------|---------|
| `CLOUDFLARE_API_TOKEN` | yes | Cloudflare → My Profile → API Tokens (Workers Scripts + DNS edit + **Cache Purge**) | the `backend` job's `env:` block in `ship.yml` |
| `CLOUDFLARE_ACCOUNT_ID` | yes | Cloudflare dashboard (account ID) | the `backend` job's `env:` block in `ship.yml` |
| `CLOUDFLARE_ZONE_ID` | yes | Cloudflare → loonext.com zone → Overview → Zone ID | the `backend` job's “Purge Cloudflare cache” step in `ship.yml` |
| `NEXT_PUBLIC_SUPABASE_URL` | yes (as GitHub secret) | Supabase Project URL | the `backend` job's `env:` block in `ship.yml` (CI uses a fixed placeholder instead — the `build` job's `env:` block in `checks.yml`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes (as GitHub secret) | Supabase publishable key | the `backend` job's `env:` block in `ship.yml` (CI uses a fixed placeholder instead — the `build` job's `env:` block in `checks.yml`) |
| `NEXT_PUBLIC_API_URL` | yes (as GitHub secret) | Operator decision = API origin | the `backend` job's `env:` block in `ship.yml` (CI uses a fixed placeholder instead — the `build` job's `env:` block in `checks.yml`) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — **OPTIONAL** | yes (as CI secret) | Cloudflare Turnstile site key (section B) | the `backend` job's `env:` block in `ship.yml` — **must be set before enabling Supabase captcha** |
| `NEXT_PUBLIC_APP_ORIGIN` — **OPTIONAL** | yes (as CI secret) | App origin for the D27 host split (section B) | the `backend` job's `env:` block in `ship.yml` — blank = no host split |
| `SUPABASE_ACCESS_TOKEN` | yes | Supabase → Account → Access Tokens (`sbp_...`) | the `backend` job's “Push database migrations” step in `ship.yml` |
| `SUPABASE_DB_PASSWORD` | yes | The project DB password (from project creation) | the `backend` job's “Push database migrations” step in `ship.yml` |
| `SUPABASE_PROJECT_REF` | yes | The project ref (subdomain of the project URL) | the `backend` job's “Push database migrations” step in `ship.yml` |

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
