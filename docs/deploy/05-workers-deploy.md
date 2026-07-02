# 05 — Deploy the two Workers

Set the API Worker's secrets, configure GitHub Actions, deploy both Workers, bind
custom domains, and register the now-live webhook URLs back into Stripe and Telnyx.

Both Workers pin `compatibility_date = "2026-06-01"` and
`compatibility_flags = ["nodejs_compat"]`
(`apps/api/wrangler.jsonc:5-6`, `apps/web/wrangler.jsonc:5-6`).

---

## 1. Prerequisites before deploying

You should already have (from [02](./02-supabase.md)–[04](./04-telnyx.md)):

- Supabase URL, `sb_secret_` key, JWKS URL, publishable key; migrations applied.
- 6 `STRIPE_*` IDs, `STRIPE_WEBHOOK_SECRET` (can be set after the webhook endpoint
  exists in §4), restricted `STRIPE_SECRET_KEY`.
- `TELNYX_API_KEY`, `TELNYX_PUBLIC_KEY`.
- Resend key + verified `RESEND_FROM`; Sentry DSN.
- The two chosen origins: `APP_ORIGIN=https://app.jobtext.app`,
  `API_ORIGIN=https://api.jobtext.app` (PLACEHOLDERS).

### Generate the VAPID pair (once, keep forever)

Web Push keys are Worker secrets, generated once and **never rotated** (rotation
invalidates all push subscriptions — `apps/api/src/env.ts:23-29`,
`apps/api/.dev.vars.example:16`):

```bash
npx web-push generate-vapid-keys
```

Take the printed **Public Key** → `VAPID_PUBLIC_KEY` (base64url uncompressed P-256
point, 65 bytes) and **Private Key** → `VAPID_PRIVATE_KEY` (base64url scalar, 32
bytes).

---

## 2. Set the 20 API Worker secrets (before the first deploy)

CI does **not** set these — `deploy.yml` only runs `wrangler deploy`
(`.github/workflows/deploy.yml:49-53`). The Worker validates all 20 at startup and
`/health` re-validates, naming any missing key (`apps/api/src/env.ts:8-39,54-70`,
`apps/api/src/index.ts:78-82`). Set every one on `jobtext-api`.

### Option A — bulk (recommended)

Create a local, **uncommitted** JSON of `KEY: value` pairs (e.g.
`secrets.prod.json`), then:

```bash
# from the repo root; do NOT commit secrets.prod.json
pnpm --filter @jobtext/api exec wrangler secret bulk ./secrets.prod.json
```

### Option B — one at a time

Each command prompts for the value (paste, Enter):

```bash
cd apps/api   # or prefix each with: pnpm --filter @jobtext/api exec

pnpm exec wrangler secret put SUPABASE_URL
pnpm exec wrangler secret put SUPABASE_SECRET_KEY
pnpm exec wrangler secret put SUPABASE_JWKS_URL
pnpm exec wrangler secret put TELNYX_API_KEY
pnpm exec wrangler secret put TELNYX_PUBLIC_KEY
pnpm exec wrangler secret put STRIPE_SECRET_KEY
pnpm exec wrangler secret put STRIPE_WEBHOOK_SECRET
pnpm exec wrangler secret put RESEND_API_KEY
pnpm exec wrangler secret put RESEND_FROM
pnpm exec wrangler secret put SENTRY_DSN
pnpm exec wrangler secret put APP_ORIGIN
pnpm exec wrangler secret put API_ORIGIN
pnpm exec wrangler secret put VAPID_PUBLIC_KEY
pnpm exec wrangler secret put VAPID_PRIVATE_KEY
pnpm exec wrangler secret put STRIPE_STARTER_PRICE_ID
pnpm exec wrangler secret put STRIPE_PRO_PRICE_ID
pnpm exec wrangler secret put STRIPE_STARTER_OVERAGE_PRICE_ID
pnpm exec wrangler secret put STRIPE_PRO_OVERAGE_PRICE_ID
pnpm exec wrangler secret put STRIPE_US_FEE_PRICE_ID
pnpm exec wrangler secret put STRIPE_SMS_METER_EVENT_NAME
```

That's the **complete set of 20** (`apps/api/src/env.ts:9-38`). Full descriptions
and formats are in [06 — env reference](./06-env-reference.md). `wrangler.jsonc`'s
`vars` is intentionally empty — every credential is a secret
(`apps/api/wrangler.jsonc:30`).

> **Chicken-and-egg with `STRIPE_WEBHOOK_SECRET`:** you only get the `whsec_` after
> creating the Stripe endpoint in §4 (which needs the live API domain). It's fine to
> deploy first with a placeholder, then set the real secret and re-verify `/health`.
> `SUPABASE_URL`, `SUPABASE_JWKS_URL`, `SENTRY_DSN`, `APP_ORIGIN`, `API_ORIGIN` must
> all be valid **URLs** (zod `z.url()`, `apps/api/src/env.ts:9,11,17,18,20`) or
> startup fails.

---

## 3. Deploy the Workers

CI/Deploy does this automatically on merge to `main` (§5). To deploy **manually**:

### API Worker (`jobtext-api`)

```bash
pnpm --filter @jobtext/api exec wrangler deploy
```

This runs `wrangler deploy` (`apps/api/package.json:8`), which also **registers the
cron triggers** (§6) — no dashboard action needed.

### Web Worker (`jobtext-web`) — MUST build on Linux/WSL

```bash
# The NEXT_PUBLIC_* vars are inlined at build time and MUST be in the shell env.
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
NEXT_PUBLIC_API_URL=https://api.jobtext.app \
  pnpm --filter @jobtext/web run deploy
```

`run deploy` = `opennextjs-cloudflare build && opennextjs-cloudflare deploy`
(`apps/web/package.json:10`). **The OpenNext Cloudflare build must run on Linux or
WSL** (`SPEC.md:88,96`) — run it from CI or a WSL shell, not native Windows. If any
of the three `NEXT_PUBLIC_*` are missing, the build throws
(`apps/web/src/env.ts:3-7,19-24`).

---

## 4. Custom domains / routes

Bind each Worker to its hostname (Cloudflare dashboard → Workers & Pages → the
Worker → **Settings → Domains & Routes → Add Custom Domain**, or `wrangler`):

| Worker | Custom domain(s) |
|--------|------------------|
| `jobtext-api` | `api.jobtext.app` |
| `jobtext-web` | `app.jobtext.app`, plus `jobtext.app` (+ `www.jobtext.app`) for marketing |

Adding a custom domain creates the proxied DNS record automatically (see
[01](./01-accounts-and-domain.md) §3). After this, confirm:

- `https://api.jobtext.app/health` returns `{"ok":true}` (`apps/api/src/index.ts:78-82`).
- `https://app.jobtext.app` loads the app.

The origins must match the secrets exactly: CORS is `APP_ORIGIN` with **no wildcard**
(`apps/api/src/index.ts:65`); the Telnyx/Stripe webhook URLs derive from `API_ORIGIN`.

---

## 5. GitHub Actions secrets + the CI/Deploy pipeline

### Set these repo/environment secrets

| Secret | Used by |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | `.github/workflows/deploy.yml:18` |
| `CLOUDFLARE_ACCOUNT_ID` | `.github/workflows/deploy.yml:19` |
| `NEXT_PUBLIC_SUPABASE_URL` | web build — `ci.yml:36`, `deploy.yml:20` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | web build — `ci.yml:37`, `deploy.yml:21` |
| `SUPABASE_ACCESS_TOKEN` | migrations — `deploy.yml:43` |
| `SUPABASE_DB_PASSWORD` | migrations — `deploy.yml:44` |
| `SUPABASE_PROJECT_REF` | migrations — `deploy.yml:46` |

### KNOWN GAP — `NEXT_PUBLIC_API_URL` is not wired into CI

`apps/web/src/env.ts:6,19-24` **fails the build** without `NEXT_PUBLIC_API_URL`, but
it is **not** present in `ci.yml:34-37` or `deploy.yml:20-21`. Add it to both the
`ci` job env (`.github/workflows/ci.yml:34-37`) and the deploy job env
(`.github/workflows/deploy.yml:17-21`), sourced from a `NEXT_PUBLIC_API_URL` GitHub
secret set to your API origin. **That edit touches `.github/**`, which is outside
this runbook's write scope — assign it to whoever owns CI before relying on the
automated web deploy.** Until then, deploy web manually (§3) with the var in the
shell env.

### What the pipeline does on merge to `main`

- **CI** (`ci.yml`) runs on PRs and pushes to `main`: schema tests against a
  from-zero `supabase db reset`, then typecheck/lint/test, `next build`, OpenNext
  build, and `wrangler deploy --dry-run` for the API
  (`.github/workflows/ci.yml:9-67`).
- **Deploy** (`deploy.yml`) runs on `workflow_run` of a **successful CI on `main`**,
  concurrency group `deploy-production` with no cancel-in-progress
  (`.github/workflows/deploy.yml:3-15`). Steps, in order
  (`.github/workflows/deploy.yml:22-53`):
  1. Checkout the exact `head_sha` that passed CI.
  2. `pnpm install --frozen-lockfile`.
  3. `supabase link --project-ref <ref>` → `supabase db push` (**migrations first**).
  4. `pnpm --filter @jobtext/api exec wrangler deploy` (API Worker).
  5. `pnpm --filter @jobtext/web run deploy` (OpenNext build + deploy).

---

## 6. Cron triggers (registered on API deploy)

Declared in `apps/api/wrangler.jsonc:11-19`, mapped to jobs in
`apps/api/src/index.ts:142-162`. Cloudflare registers them automatically on
`wrangler deploy` — no dashboard step. `scheduled()` throws on any unmapped cron
(`apps/api/src/index.ts:176-180`).

| Cron (UTC) | Jobs |
|------------|------|
| `*/5 * * * *` | Webhook sweeper — replay unprocessed `webhook_events` (both providers) |
| `*/15 * * * *` | `reconcileNumbers` + `retryCampaignAssignments` (provisioning retry/reconcile) |
| `0 * * * *` | `reportUnreportedUsage` + `runUsageAlertsJob` (hourly usage re-report + 80%/100% alerts) |
| `30 * * * *` | `nudgeSoleProprietorOtp` (hourly) |
| `0 13 * * *` | `pollRegistrations` (daily 10DLC registration poller) |
| `0 14 * * *` | `runGraceJob` (daily grace warnings + day-30 release) |
| `0 15 * * *` | `runSubscriptionReconcileJob` (daily subscription reconcile) |

Operational details in [08 — operations](./08-operations.md).

---

## 7. Sentry / PostHog wiring

- **Sentry:** DSN only. The whole Worker (fetch + scheduled) is wrapped by
  `Sentry.withSentry` with `sendDefaultPii: false`, `tracesSampleRate: 0`, and
  PII-scrubbing `beforeSend`/`beforeBreadcrumb`
  (`apps/api/src/index.ts:206`, `apps/api/src/observability/sentry.ts:117-125`).
  Setting `SENTRY_DSN` (§2) is the entire integration. **No web-side Sentry exists.**
- **PostHog:** no code integration anywhere — nothing to wire.

---

## 8. Register the live webhook URLs back into the vendors

Now that `api.jobtext.app` is live:

- **Stripe:** create/confirm the webhook endpoint at
  `https://api.jobtext.app/webhooks/stripe` with the 7 events, and set its `whsec_`
  as `STRIPE_WEBHOOK_SECRET` (re-run the relevant `wrangler secret put`). See
  [03](./03-stripe.md) §3.
- **Telnyx:** nothing to register — the webhook URL is set **programmatically** per
  messaging profile from `API_ORIGIN` (`apps/api/src/telnyx/wizard.ts:140-142`). Just
  confirm `API_ORIGIN` on the Worker is `https://api.jobtext.app`. See
  [04](./04-telnyx.md) §3.

After changing any secret, redeploy is **not** required for secret pickup, but
re-hit `GET https://api.jobtext.app/health` to confirm validation passes.

Next: [06 — env reference](./06-env-reference.md).
