# 06 — Environment Reference (single source of truth)

Every variable JobText reads, split by surface. **Secret?** = whether it's a
Cloudflare Worker encrypted secret / GitHub Actions secret vs a build-time public
value. Formats are illustrative — real values come from the vendor dashboards.

- **API Worker secrets** are validated at startup by the zod schema in
  `apps/api/src/env.ts:8-39`; a missing/invalid one fails loudly and `/health`
  re-validates (`apps/api/src/index.ts:78-82`). There are **exactly 20**.
- **Web build vars** are the three `NEXT_PUBLIC_*` inlined at `next build`
  (`apps/web/src/env.ts:3-7`).
- **GitHub Actions secrets** feed CI/Deploy (`.github/workflows/*`).

---

## A. API Worker secrets (`jobtext-api`) — 20 total

| Name | Secret? | Source (dashboard) | Example format |
|------|:------:|--------------------|----------------|
| `SUPABASE_URL` | yes | Supabase → Settings → API → Project URL | `https://abcdefghijklmnop.supabase.co` |
| `SUPABASE_SECRET_KEY` | yes | Supabase → Settings → API → **Secret keys** | `sb_secret_xxxxxxxxxxxxxxxx` |
| `SUPABASE_JWKS_URL` | yes | Constructed: `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` | `https://abcdefghijklmnop.supabase.co/auth/v1/.well-known/jwks.json` |
| `TELNYX_API_KEY` | yes | Telnyx → Account → API Keys (V2) | `KEYxxxxxxxxxxxxxxxxxxxxxxxx` |
| `TELNYX_PUBLIC_KEY` | yes | Telnyx → Account → Public Key | base64 of 32 raw bytes, e.g. `e3b0c44298fc1c149afbf4c8996fb924...` (44 chars base64) |
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

**Validation notes** (`apps/api/src/env.ts`): `SUPABASE_URL`, `SUPABASE_JWKS_URL`,
`SENTRY_DSN`, `APP_ORIGIN`, `API_ORIGIN` must parse as URLs (`z.url()`, lines
9,11,17,18,20); the rest are non-empty strings (`z.string().min(1)`). Set them all
with `wrangler secret put` — see [05](./05-workers-deploy.md) §2. `wrangler.jsonc`
`vars` is intentionally empty (`apps/api/wrangler.jsonc:30`).

---

## B. Web build-time public vars (`jobtext-web`) — 3 total

Inlined at `next build`; the build **fails** if any is missing
(`apps/web/src/env.ts:3-7,19-24`). They are public (shipped in the browser bundle).

| Name | Secret? | Source | Example format |
|------|:------:|--------|----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | no (public) | Same as `SUPABASE_URL` | `https://abcdefghijklmnop.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | no (public) | Supabase → Settings → API → **Publishable key** | `sb_publishable_xxxxxxxxxxxx` |
| `NEXT_PUBLIC_API_URL` | no (public) | Operator decision; must equal `API_ORIGIN` | `https://api.jobtext.app` |

> `NEXT_PUBLIC_API_URL` is **not currently wired into CI** — see the known gap in
> [05](./05-workers-deploy.md) §5.

---

## C. GitHub Actions secrets (CI / Deploy) — 7

Consumed by the workflows; never reach the Workers as runtime bindings.

| Name | Secret? | Source | Used at |
|------|:------:|--------|---------|
| `CLOUDFLARE_API_TOKEN` | yes | Cloudflare → My Profile → API Tokens (Workers + DNS edit) | `deploy.yml:18` |
| `CLOUDFLARE_ACCOUNT_ID` | yes | Cloudflare dashboard (account ID) | `deploy.yml:19` |
| `NEXT_PUBLIC_SUPABASE_URL` | yes (as CI secret) | Supabase Project URL | `ci.yml:36`, `deploy.yml:20` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes (as CI secret) | Supabase publishable key | `ci.yml:37`, `deploy.yml:21` |
| `SUPABASE_ACCESS_TOKEN` | yes | Supabase → Account → Access Tokens (`sbp_...`) | `deploy.yml:43` |
| `SUPABASE_DB_PASSWORD` | yes | The project DB password (from project creation) | `deploy.yml:44` |
| `SUPABASE_PROJECT_REF` | yes | The project ref (subdomain of the project URL) | `deploy.yml:46` |
| `NEXT_PUBLIC_API_URL` *(to add)* | yes | Operator decision = API origin | **not yet referenced** — add per [05](./05-workers-deploy.md) §5 |

---

## D. Not env vars — dashboard-only settings

These are configured in a vendor dashboard and have **no** app env var:

| Setting | Where | Reference |
|---------|-------|-----------|
| Supabase **ES256 signing key** | Supabase → Auth → JWT/Signing Keys | `apps/api/src/auth/jwt.ts:41-44` |
| Supabase **custom SMTP = Resend** | Supabase → Auth → SMTP | `SPEC.md:100,1065` |
| Supabase signup **CAPTCHA = Turnstile** | Supabase → Auth → Attack Protection → CAPTCHA | `SPEC.md:1052` |
| Stripe **Tax** activation | Stripe → Settings → Tax | `apps/api/src/routes/billing.ts:170` |
| Stripe **dunning → cancel** | Stripe → Billing → failed payments | `SPEC.md:1017` |
| Stripe **customer portal** config | Stripe → Billing → Customer portal | `apps/api/src/routes/billing.ts:197-199` |
| Telnyx **webhook URL** | *programmatic*, from `API_ORIGIN` — never a portal field | `apps/api/src/telnyx/wizard.ts:140-142` |

---

## E. Not used — do not configure

- **PostHog** — appears only as a subprocessor in marketing prose
  (`apps/web/src/app/(marketing)/legal/subprocessors/page.tsx:73`). No code reads a
  PostHog key; nothing to set.

Next: [07 — go-live checklist](./07-go-live-checklist.md).
