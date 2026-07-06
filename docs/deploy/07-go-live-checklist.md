# 07 — Go-Live Checklist

Ordered pre-launch checklist plus the end-to-end smoke test. Do not launch until
every box is checked. Items marked **OPS BLOCKER** are non-engineering
prerequisites flagged by the marketing/legal docs.

---

## A. Infrastructure ready

- [ ] Domain zone **Active** in Cloudflare; `app.`, `api.`, root, and
      `status.` hostnames plan set ([01](./01-accounts-and-domain.md)).
- [ ] Supabase **Pro**, `us-east-1`, Postgres 17; **ES256 signing key enabled** and
      in use; JWKS served at `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`
      ([02](./02-supabase.md) §2).
- [ ] Migrations applied (`supabase db push` succeeded); `mms-media` bucket present
      (private, 5 MB); extensions installed ([02](./02-supabase.md) §4–§5).
- [ ] Turnstile CAPTCHA + Resend custom SMTP configured on Supabase Auth
      ([02](./02-supabase.md) §6–§7). **Captcha ordering:** the
      `NEXT_PUBLIC_TURNSTILE_SITE_KEY` GitHub secret must be set and web
      redeployed **before** enabling the Supabase captcha setting (site key in
      the build; secret key in the Supabase dashboard) — otherwise every
      email/password signup/login/reset breaks ([06](./06-env-reference.md) §B).
- [ ] Stripe **live** catalog created; 6 IDs captured; Tax active; portal + dunning
      (→ cancel) configured; webhook endpoint at
      `https://api.loonext.app/webhooks/stripe` with the **7** events; `whsec_`
      captured ([03](./03-stripe.md)).
- [ ] Telnyx live V2 API key + webhook public key captured; **Call-Control (voice)
      application created** with webhook + failover URL =
      `https://api.loonext.app/webhooks/telnyx` and its id captured as
      `TELNYX_VOICE_CONNECTION_ID`; account has US/CA + 10DLC
      and funded balance ([04](./04-telnyx.md)).
- [ ] Resend sending domain verified; `RESEND_FROM` on that domain. Sentry DSN
      captured. VAPID pair generated ([05](./05-workers-deploy.md) §1).
- [ ] All **21** required API Worker secrets set on `loonext-api` (+ optional
      `POSTHOG_API_KEY` if you use analytics); `GET
      https://api.loonext.app/health` → `{"ok":true}` ([05](./05-workers-deploy.md) §2).
- [ ] All **8** required GitHub Actions secrets set — including
      `NEXT_PUBLIC_API_URL`, which Deploy now reads
      (`.github/workflows/deploy.yml:22`) — plus the optional two:
      `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (`deploy.yml:23-26`, **required before
      enabling Supabase captcha**) and `NEXT_PUBLIC_APP_ORIGIN`
      (`deploy.yml:27-30`, activates the D27 host split; production value
      `https://app.loonext.app`) ([05](./05-workers-deploy.md) §5).
- [ ] Both Workers deployed; custom domains bound — `app.loonext.app`,
      `loonext.app`, **and** `www.loonext.app` all on the one `loonext-web`
      Worker (D27), `api.loonext.app` on `loonext-api`; `app.` loads,
      `api./health` OK ([05](./05-workers-deploy.md) §3–§4,
      [01](./01-accounts-and-domain.md) §2).
- [ ] D27 host split verified (with `NEXT_PUBLIC_APP_ORIGIN` set):
      `loonext.app/login` 308s to `app.loonext.app/login`, `www.loonext.app`
      canonicalizes to `loonext.app`, and a marketing path on `app.loonext.app`
      308s back to `loonext.app` (`apps/web/src/lib/hosts.ts`).
- [ ] Cron triggers visible on `loonext-api` (Cloudflare → Worker → Triggers) — all 9
      ([05](./05-workers-deploy.md) §6).

---

## B. OPS BLOCKERS (business/legal — resolve before launch)

Sourced from `docs/marketing/BLUEPRINT.md:979-985` and `docs/marketing/COPY.md:393-417`:

- [ ] **Real legal entity name + mailing address** — feeds `/contact`, the footer
      identity line, and 10DLC brand registration
      (`docs/marketing/BLUEPRINT.md:979`, `docs/marketing/COPY.md:417`).
- [ ] **Privacy officer name** for Québec **Law 25** compliance
      (`docs/marketing/BLUEPRINT.md:980`).
- [ ] **Founder real names** for the home founder-signed line — ship the sentence
      **without** names rather than fabricate them
      (`docs/marketing/BLUEPRINT.md:980-981`, `docs/marketing/COPY.md:393-394`).
- [ ] **Support-response SLA** for `/contact` (placeholder "we reply within 1
      business day" until confirmed) (`docs/marketing/BLUEPRINT.md:983-984`).
- [ ] **Status page live** — stand up `status.loonext.app` on a hosted provider
      (Instatus / BetterStack free tier) and link it in the footer; a
      deliverability-gated SMS product cannot launch without one
      (`docs/marketing/BLUEPRINT.md:984-985,1050`).
- [ ] **Refund-guarantee wording + one-line Stripe refund runbook**
      (`docs/marketing/BLUEPRINT.md:982`).
- [ ] Legal set published: Terms, Privacy, AUP, DPA + sub-processors, Security, Status
      (`docs/marketing/competitor-site-teardowns.md:191`).

---

## C. Smoke test (test mode end-to-end)

> **Automated coverage (D31).** The cross-vendor spine of the three golden paths —
> (1) US sole-prop signup → paid checkout → provision → 10DLC registration gate →
> approval → US send, (2) CA-only instant send, (3) cancel → grace → day-30 release —
> now runs green in CI as a **hermetic full-stack E2E** (the real `loonext-api` Worker
> against real local Supabase, Telnyx + Stripe faked at their HTTP boundary and advanced
> by the same signed webhooks production receives; `apps/api/e2e/*.e2e.ts`, the `e2e` job
> in `.github/workflows/ci.yml`). That covers the server/state-machine wiring
> deterministically on every push. The manual pass below stays the **human check**: it is
> the only place a real Stripe-hosted Checkout and a real handset exercise the parts a fake
> cannot (hosted payment UI, live carrier delivery). Run it before flipping to live.

Run against **Stripe test mode** and a **Telnyx sandbox number** before flipping to
live. Use two real phones (or one phone + the Telnyx test tooling).

1. **Sign up** — create an account at `https://app.loonext.app`. Confirm the signup
   CAPTCHA (Turnstile) appears (it renders only when the build had
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY` set) and the Supabase invite/confirmation email arrives via
   Resend. Confirm the app can call the API (a `/v1/me`-class request returns 200, not
   401 — this validates the ES256 JWKS path, `apps/api/src/auth/jwt.ts:41-44`).
2. **Pay in Stripe (test)** — start checkout, pay with `4242 4242 4242 4242`. Confirm
   Stripe fires `checkout.session.completed` and the endpoint returns 2xx (Stripe →
   Webhooks → the endpoint → recent deliveries). Confirm the company flips to
   `active` (`apps/api/src/webhooks/stripe.ts:187-232`). If the company owes US
   registration, confirm the $29 fee line was charged and
   `registration_fee_paid_at` stamped (`apps/api/src/webhooks/stripe.ts:238-250`).
3. **Number provisions** — confirm a local number is ordered automatically and the
   messaging profile is created with the webhook URL
   (`apps/api/src/telnyx/provisioning.ts:143-211`). Confirm the 10DLC brand/campaign
   submission starts (`apps/api/src/webhooks/stripe.ts:271`).
4. **Send + receive a real text** — send an outbound SMS from the app to your test
   phone; reply from the phone. Confirm the inbound arrives
   (`message.received` → `apps/api/src/messaging/dispatch.ts:21-23`) and appears in the
   conversation in near-real-time (realtime broadcast).
5. **Webhook delivery** — confirm `message.sent`/`message.finalized` status webhooks
   land and usage is metered (a `usage_events` row; then a Stripe meter event on the
   next `0 * * * *` cron or immediate report,
   `apps/api/src/billing/meter.ts:33-40`).
6. **Cancel → grace** — cancel the subscription in Stripe (or let dunning exhaust).
   Confirm `customer.subscription.deleted` sets `subscription_status = canceled`,
   suspends the numbers, and sends the day-1 grace notice
   (`apps/api/src/webhooks/stripe.ts:321-349`). Confirm outbound is blocked while
   inbound still works, and that the `0 14 * * *` grace cron would release on day 30
   ([08](./08-operations.md)).

**Pass criteria:** every step completes with no Sentry error and no webhook stuck
with `processed_at IS NULL` (the `*/5` sweeper should clear transient failures).

---

## D. Flip to production

- [ ] Re-run `stripe:setup` in **live** mode; swap the 6 `STRIPE_*` IDs,
      `STRIPE_SECRET_KEY` (live restricted key), and `STRIPE_WEBHOOK_SECRET` (live
      endpoint) on the Worker.
- [ ] Swap `TELNYX_API_KEY` / `TELNYX_PUBLIC_KEY` to the live Telnyx account (and
      `TELNYX_VOICE_CONNECTION_ID` to a Call-Control app created in that account);
      confirm 10DLC approval.
- [ ] Re-hit `https://api.loonext.app/health` → `{"ok":true}`.
- [ ] Repeat the smoke test's send/receive with a **live** number and a real card
      (small amount), then refund.

Next: [08 — operations](./08-operations.md).
