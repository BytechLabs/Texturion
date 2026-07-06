# Loonext — Build Specification v2

**Status: authoritative.** This document is the single source of truth for the Loonext MVP build. It supersedes draft spec v1 and implements every binding decision in `docs/DECISIONS.md` (D1–D13). Where this spec states a value, API name, or behavior, it is final — build exactly this.

---

## 1. Overview & goals

Loonext is a shared SMS inbox for small service businesses. A company buys a subscription, gets a local business phone number, and every incoming text becomes a conversation that the whole team can see, reply to, assign, tag, note, and close — replacing the owner's personal cell as the business's texting front door.

**ICP (D12):** US and Canada home-service businesses — plumbing, landscaping, cleaning, HVAC, salons — with 1–10 field staff who currently text customers from a personal cell phone.

**Activation (D12):** a company sends its first outbound SMS **and** receives an inbound reply within 7 days of payment. Target: **60% of paying signups activated in week 1**; **week-4 logo retention ≥ 85%**.

**North-star onboarding metric (D12):** time from payment to first outbound send. The US 10DLC approval wait is the main threat to this metric; it is instrumented end-to-end in PostHog (event pair: `checkout_completed` → `first_outbound_sent`, plus `registration_submitted`, `registration_approved`).

**Positioning:** flat per-company pricing ("one price for your whole crew") against per-seat rivals (Quo at $15–19/user, Heymarket at ~$98/mo entry with 2-user minimum), and no-contract self-serve against Podium-style annual contracts. No sales calls, no onboarding calls, ever.

### Key rules (paid-first, updated for registration reality)

1. **No free trial that provisions a number.** A phone number exists only after a paid `checkout.session.completed` webhook with `payment_status == 'paid'`.
2. **No unpaid phone numbers.** Cancellation suspends the number; a daily cron releases it after a 30-day grace period.
3. **No outbound SMS unless the subscription is `active`.** `past_due`, `unpaid`, `canceled`, and `incomplete` all block outbound (HTTP 402 `subscription_inactive`). Inbound and the dashboard stay live through `past_due` and the cancellation grace period.
4. **Outbound to US destinations additionally requires an approved 10DLC campaign.** Gating is **per destination country**, never all-or-nothing: Canada-bound outbound works immediately after provisioning; US-bound outbound unlocks on campaign approval (~3–7 business days). Inbound works immediately for everyone. This expectation is stated **at checkout, before payment**.
5. **No manual onboarding.** Signup → checkout → number provisioning → 10DLC registration submission are fully automated. No human touches a customer account to activate it.
6. **No always-on servers.** Everything runs on Cloudflare Workers (request-driven + Cron Triggers), Supabase, and vendor webhooks. Idle cost is the fixed platform subscriptions only (§14).

---

## 2. Pricing & packaging (D5)

### Plans

| | **Starter — $29/mo** | **Pro — $79/mo** |
|---|---|---|
| Users (seats) | 3 | 10 |
| Phone numbers | 1 | 2 |
| Included **outbound** segments / month | 500 | 2,500 |
| Overage per extra outbound segment | $0.03 | $0.025 |
| Inbound SMS & MMS | Free, unmetered | Free, unmetered |

- **Metered:** outbound SMS segments only. Outbound **MMS meters as 3 segments**. Notes are free. Inbound SMS and MMS are free and unmetered (market table-stakes; COGS ~0.7¢/segment absorbed).
- **No per-seat add-ons in MVP.** The upgrade path is Starter → Pro. Seat and number limits are enforced server-side (§7, §10).
- **US registration fee: $29 one-time**, charged as a one-time line item on the first invoice (covers Telnyx's $4.50 brand fee + $15 campaign vetting + resubmission risk). It applies to every US company, and to Canadian companies that enable US texting (see §4.2). It is charged **at most once per company**: the line item is included only while `companies.registration_fee_paid_at IS NULL` — a company that cancels and resubscribes is never charged the fee again. Recurring 10DLC campaign fees ($1.50/mo Low Volume Mixed, $2/mo Sole Proprietor) are **absorbed into plan pricing** — there is never a visible monthly compliance line item.
- **Overage cap:** default **3× the included quota** (Starter: 1,500 total outbound segments/period; Pro: 7,500). Stored as `companies.overage_cap_multiplier` (default `3.00`; `NULL` = no cap). At the cap, `POST /v1/messages/send` returns `usage_cap_reached` and the owner gets a one-click raise in the usage screen. **Owner-only** setting (raise or remove). Email alerts fire at **80% and 100% of the included quota** (not of the cap).
- **Currency: USD only at launch.** CAD display prices via Stripe `currency_options` is a named fast-follow (§13).
- **Tax:** Stripe Tax enabled from day one — `automatic_tax` on Checkout and the subscription, SaaS product tax code set on both Stripe Products, prices tax-exclusive. Stripe Tax pay-as-you-go costs 0.5% per transaction. GST/HST registration is an operational runbook item (register at/before CAD $30,000 rolling-12-month revenue; Stripe Tax threshold monitoring watches US state nexus and Canadian thresholds).
- **UI copy rule:** usage displays say "messages" with the segment count beside it and a plain-English tooltip ("Long texts and emoji use more than one segment — 160 characters per segment for plain text, 70 with emoji"). Billing is always in segments; the pricing page states "outbound segments" explicitly.

### Unit-economics inputs (verified, used in §14)

$0.004/part Telnyx local SMS (each direction) + ~$0.003–0.0045/part US carrier passthrough; $1.10/mo per number ($1.00 number + $0.10 SMS capability); MMS $0.015/part out, $0.005/part in + $0.005–0.01 carrier; 10DLC $4.50 brand + $15/vetting-submission + $1.50–$2/mo campaign (billed 3 months upfront); Stripe 2.9% + $0.30 payments, 0.7% Billing, 0.5% Tax.

---

## 3. Architecture (D1, D13)

```
                         ┌──────────────────────────────────────────┐
Browser (desktop+mobile) │  apps/web — Cloudflare Worker            │
  Next.js UI, PWA,       │  Next.js 15 via @opennextjs/cloudflare   │
  service worker    ───► │  (OpenNext adapter, Node.js runtime)     │
        │                │  UI ONLY — no API routes, no webhooks    │
        │                └──────────────────────────────────────────┘
        │  Authorization: Bearer <Supabase JWT> + X-Company-Id
        ▼
┌──────────────────────────────────────────────────────────────────┐
│  apps/api — Cloudflare Worker (Hono, TypeScript)                 │
│  • /v1/*        JSON API (JWT-verified)                          │
│  • /webhooks/telnyx   (Ed25519-verified, single route)           │
│  • /webhooks/stripe   (HMAC-verified via constructEventAsync)    │
│  • Cron Triggers (all scheduled jobs, §11)                       │
└──────┬───────────────┬───────────────┬───────────────┬───────────┘
       │               │               │               │
       ▼               ▼               ▼               ▼
   Supabase         Telnyx          Stripe          Resend
   Postgres+RLS     numbers, SMS/   Checkout,       transactional
   Auth (ES256)     MMS, 10DLC,     Billing Meters, email
   Storage (MMS)    msg profiles    Portal, Tax
   Realtime
   (Broadcast)

Browser ──(direct)── Supabase Auth (@supabase/ssr: signup/login/reset/invite-accept)
Browser ──(direct)── Supabase Realtime (private topic company:{id}, Broadcast)
Telnyx webhooks ───► apps/api /webhooks/telnyx
Stripe webhooks ───► apps/api /webhooks/stripe
Sentry (@sentry/cloudflare in both Workers + Next.js client) · PostHog (events only)
GitHub Actions (Linux CI): typecheck, lint, vitest, build, wrangler deploy on main
```

### Components

- **Two Workers (D1).** `apps/web` serves the Next.js UI via `@opennextjs/cloudflare` (OpenNext adapter, **Node.js runtime**). `apps/api` is a plain Hono Worker owning the entire API, all webhooks, and all Cron Triggers. Webhook ingestion is thereby isolated from frontend deploys.
  - **No route may declare `export const runtime = 'edge'`** (OpenNext does not support the Edge runtime). **No Next.js 15.2+ Node middleware** (unsupported by the adapter).
  - **Workers Paid plan ($5/mo)** for cron CPU headroom (Paid: 10M requests + 30M CPU-ms included; cron allowance 250 triggers/account, 30s CPU for sub-hourly schedules; static asset requests free and unlimited).
  - Production builds and deploys run on **Linux CI (GitHub Actions)** — OpenNext does not guarantee Windows support locally; local development on Windows uses WSL.
  - `next/image` runs unoptimized (`images.unoptimized = true`) — Cloudflare Images is separately billed and the dashboard doesn't need it; keeps idle cost near zero.
- **Supabase (Pro plan, $25/mo, single US region `us-east-1`):**
  - **Postgres** — all tenant data, deny-by-default RLS (§6), FTS + pg_trgm search.
  - **Auth** — browser-direct via `@supabase/ssr`; **asymmetric ES256 signing keys enabled at project setup**; Worker verifies JWTs locally against `https://<project-id>.supabase.co/auth/v1/.well-known/jwks.json` (edge-cached 10 min). Invite emails via `inviteUserByEmail` with **Resend as custom SMTP**.
  - **Storage** — private per-company-keyed bucket `mms-media` for MMS attachments; 5 MB per-bucket file limit; served via short-lived signed URLs minted by the API.
  - **Realtime** — **Broadcast-from-Database** (never `postgres_changes`), private topics `company:{id}` authorized by RLS on `realtime.messages` (§8).
  - The Worker talks to Supabase with **supabase-js over HTTP using the `sb_secret_` key** (not the legacy service_role JWT); zero Postgres connections consumed. If raw SQL is ever required, Supavisor transaction mode on port 6543 — but the MVP uses PostgREST RPC (`security definer` SQL functions) for the multi-statement transactional paths (threading, send-gating).
- **Telnyx** — number search/orders, per-company messaging profiles, SMS/MMS, 10DLC registration, webhooks.
- **Stripe** — subscription-mode Checkout, Billing Meters, hosted portal (payment methods/invoices/cancellation only), Stripe Tax, Smart Retries.
- **Resend** — all transactional email (product notifications, billing, registration, invites via Supabase SMTP).
- **Sentry** (`@sentry/cloudflare` in both Workers + Next.js browser SDK) and **PostHog** — with the PII policy in §10.
- **No-server rule:** all time-based work (grace-period release, webhook sweeping, usage re-reporting, registration polling) runs on **Workers Cron Triggers** in `apps/api` (§11). **Cloudflare Queues is explicitly not used in MVP** (D11): the `waitUntil` + `webhook_events` ledger + sweeper cron pattern is sufficient at MVP scale.

### Monorepo layout (D13)

```
loonext/
├── apps/
│   ├── web/            # Next.js 15 + Tailwind + shadcn/ui (OpenNext → CF Worker)
│   └── api/            # Hono Worker: /v1, /webhooks, cron handlers
├── packages/
│   └── shared/         # zod schemas, API types, error codes, segment estimator,
│                       # NANP area-code → {country, region, timezone} table
│                       # (region = USPS state / CA province code), constants
├── supabase/           # config.toml, migrations/
├── .github/workflows/  # ci.yml (typecheck, lint, vitest, build), deploy.yml (wrangler)
├── pnpm-workspace.yaml
└── package.json
```

**Testing (D13):** vitest everywhere. Unit tests exercise real product code with only the network edge stubbed (Telnyx/Stripe HTTP via fetch mocks **in test code only**); integration tests run against local Supabase in CI. Dedicated suites required for: webhook signature verification (both providers), threading, quota/cap enforcement, opt-out enforcement, and the Stripe subscription state machine. **No mocks, stubs, simulations, or hardcoded values in product code paths.** All config via validated env bindings (zod schema evaluated at Worker startup; missing config fails loudly).

---

## 4. Onboarding & provisioning flow (D2, D6)

### 4.1 End-to-end sequence

```
1. Signup (browser ↔ Supabase Auth directly; email+password).
   Signup screen requires acceptance of the Acceptable Use Policy (checkbox;
   no SHAFT content, no purchased lists). Timestamp stored on company create.

2. POST /v1/companies
   { name, country ('US'|'CA'), requested_area_code, us_texting_enabled (CA only),
     aup_accepted: true }
   → creates company (subscription_status='incomplete'), creator becomes owner
     member, creates notification_prefs row.

3. Registration wizard (pre-checkout, in-app; ~2 minutes)
   Collects brand + campaign data into messaging_registrations rows (status='draft'):
   • Legal business name, address, website (optional for sole prop)
   • EIN (US) / BN (CA) — OR "I don't have an EIN/BN" → Sole Proprietor path:
     first/last name, last-4 SSN (US) / SIN (CA), mobile number for OTP
   • Brand contact email + phone (pre-filled from the owner's account email;
     required by the Telnyx brand payload — see §4.4 field mapping)
   • Business vertical (dropdown of TCR vertical values; default 'PROFESSIONAL')
   • Opt-in flow description (pre-filled truthful default, editable):
     "Customers text our business number first, or ask us in person / by phone
      to text them. We never send marketing blasts."
   • Sample messages (pre-filled from ICP templates)
   Canadian companies with us_texting_enabled=false skip the wizard entirely.

4. POST /v1/billing/checkout { plan: 'starter'|'pro' } → Stripe Checkout
   (subscription mode).
   Gates (both return 409 `conflict`):
   • subscription_status already in ('active','past_due','unpaid') — one
     subscription per company, ever concurrent.
   • The company owes US registration (country='US', or 'CA' with
     us_texting_enabled=true) and the wizard's brand + campaign draft rows are
     not complete — no such company reaches payment without a submittable draft.
   Line items: licensed flat price (plan) + metered graduated price (NO quantity)
   + one-time $29 US-registration price when applicable (US company, or CA company
   with us_texting_enabled — AND registration_fee_paid_at IS NULL; see §2).
   client_reference_id = company_id. automatic_tax on.
   CHECKOUT PAGE COPY (shown before payment, verbatim):
     "Receiving texts works the moment your number is ready (minutes).
      Texting Canadian numbers works immediately.
      Texting US numbers activates after carrier approval — typically
      3–7 business days. We'll email you the moment you're approved."

5. checkout.session.completed webhook (payment_status == 'paid') — THE ONLY
   provisioning trigger. Never provision from the redirect/success page.
   In waitUntil, atomically:
   a. Store stripe_customer_id, stripe_subscription_id, plan, period dates;
      subscription_status = 'active'; registration_fee_paid_at when fee line present.
   b. Start the provisioning saga (4.3).
   c. Submit the 10DLC registration (4.4) — the checkout gate (step 4)
      guarantees a complete draft for every company that owes US registration;
      CA companies with us_texting_enabled=false have nothing to submit.
   Idempotent via webhook_events PK + phone_numbers.provisioning_key.

6. Customer lands on the dashboard, which live-renders (via Realtime) the states:
   number provisioning → number active; US registration pending → approved.
```

### 4.2 Country/registration branches

| Company | Registration | $29 fee | Can send to CA | Can send to US |
|---|---|---|---|---|
| US | Brand + campaign, auto-submitted after payment | Yes, at checkout | Immediately after number active | After campaign `approved` |
| CA, `us_texting_enabled=true` | Same as US | Yes, at checkout | Immediately | After campaign `approved` |
| CA, `us_texting_enabled=false` | None submitted | No | Immediately (CASL rules apply, §5) | Blocked — `registration_pending` with an "Enable US texting" CTA |

"Enable US texting" later (CA companies): owner clicks the CTA → completes the wizard → `POST /v1/registration/enable-us` creates a one-off Stripe invoice for the $29 fee **with invoice metadata `{ purpose: 'us_registration', company_id }`** (auto-charged to the default payment method) → the §9 `invoice.paid` handler matches that metadata, stamps `registration_fee_paid_at`, and submits the registration (§4.4 R1). Same state machine from there.

**Sole Proprietor branch (D2):** brand is registered via Telnyx's Sole Proprietor path (last-4 SSN/SIN + OTP that the brand contact must complete within 24 hours; limits: 1 campaign, 1 number, ~1,000 msgs/day). Mechanics: immediately after brand submission the API calls Telnyx `POST /v2/10dlc/brand/{brandId}/smsOtp`, which texts a 6-digit PIN (24-hour expiry) to the wizard's mobile number. The dashboard shows an explicit "Confirm your verification code" step while the OTP is outstanding (brand `identityStatus='PENDING'`): the input submits via `POST /v1/registration/otp { code }` → Telnyx `PUT /v2/10dlc/brand/{brandId}/smsOtp { otpPin }`; a "Resend code" action calls `POST /v1/registration/otp/resend` → Telnyx `POST /v2/10dlc/brand/{brandId}/smsOtp` (fresh PIN, new 24-hour window). PIN expiry never rejects the brand — the banner switches to "code expired" and Resend issues a new PIN. An hourly cron (§11) sends **one** Resend nudge email at +12h if the OTP is still outstanding (`messaging_registrations.otp_nudged_at` records the send). Sole-prop campaign fee is $2/mo (absorbed). Sole-prop companies are capped to 1 number regardless of plan (UI states this at the wizard; `POST /v1/numbers/provision` returns 409 `conflict` when the brand row has `sole_proprietor=true` and a non-released number exists).

### 4.3 Number provisioning saga (idempotent)

One Telnyx **messaging profile per company** (D2) — isolates opt-out lists, throughput, and reputation per tenant. Saga steps, each independently retryable, keyed to a `phone_numbers` row inserted **first** with `status='provisioning'` and `provisioning_key` = Stripe checkout session id (initial number) or the request Idempotency-Key (Pro's 2nd number). Number columns are nullable until purchase succeeds. The initial insert copies `companies.requested_area_code` (collected at `POST /v1/companies`) into `phone_numbers.requested_area_code`; Pro's 2nd number takes it from the request body (§7).

```
S1. Ensure messaging profile:
    POST /v2/messaging_profiles { name: company_id, webhook_url:
      https://api.loonext.app/webhooks/telnyx, webhook_failover_url:
      https://api.loonext.app/webhooks/telnyx,   ← same route; enables Telnyx's
      whitelisted_destinations: ['US','CA'] }      3+3 delivery attempts (§7)
    Store companies.telnyx_messaging_profile_id. Skip if already set.
S2. Search: GET /v2/available_phone_numbers
      ?filter[country_code]=<company country>&filter[features]=sms
      &filter[phone_number_type]=local
      &filter[national_destination_code]=<requested_area_code>
    Fallback if the area code has no inventory: repeat the search with
      &filter[administrative_area]=<region> (the requested area code's state/
      province from the shared NANP table, §3) instead of the NDC filter
    (numbers must appear in a recent search to be orderable).
S3. Order: POST /v2/number_orders
      { phone_numbers: [{ phone_number }], messaging_profile_id,
        customer_reference: company_id }
    Persist telnyx_order_id IMMEDIATELY after the call returns (crash-after-buy
    protection), then number_e164 + telnyx_phone_number_id; status='active'.
```

**Failure handling:** any step error → `status='provision_failed'`, `last_provision_error` stored, Sentry event. The 15-minute cron (§11) retries with backoff up to 5 attempts, and reconciles crash-after-buy windows by listing Telnyx numbers with `customer_reference = company_id` and adopting any orphan. After 5 failures, Sentry alert escalates (page the operator) — the customer-facing state stays "We're setting up your number — this is taking longer than usual. You don't need to do anything." The dashboard never shows a dead end.

Pro's second number: `POST /v1/numbers/provision` (owner/admin, active subscription, atomic count-vs-plan check, Idempotency-Key required) runs the same saga from S2.

### 4.4 Registration state machine (D2)

`messaging_registrations`: one **brand** row and one **campaign** row per company. Statuses: `draft → submitted → pending → approved | rejected`. Rejected → (customer edits in wizard) → `submitted` again (`submission_count` increments; resubmission vetting cost is absorbed — the $29 fee priced it in).

```
After payment (webhook, waitUntil):
  R1. Submit brand: POST /v2/10dlc/brand (standard or sole-prop payload, field
      mapping below) → store telnyx_id (brandId) → brand: submitted.
      Sole-prop only: immediately trigger the OTP (POST /v2/10dlc/brand/
      {brandId}/smsOtp) — see §4.2.
  R2. On brand acceptance → submit campaign: POST /v2/10dlc/campaignBuilder
      (usecase LOW_VOLUME; SOLE_PROPRIETOR on the sole-prop path), declaring
      the STOP/HELP handling that §5 implements and the opt-in flow description
      from the wizard → store telnyx_id (campaignId) → campaign: submitted
  R3. Campaign approved → assign the company's number(s) to the campaign
      (POST /v2/10dlc/phoneNumberCampaign { phoneNumber, campaignId } per number)
      → registration complete; unlock US-bound sends; Resend email:
      "US texting is live" ; PostHog `registration_approved`.
  R4. Campaign rejected → status 'rejected' + rejection_reason stored; Resend
      email with a link to the wizard's fix-and-resubmit form; dashboard banner.
```

A row transitions `submitted → pending` when the first Telnyx webhook or daily poll reports the brand/campaign in an in-review state (brand event `type` REGISTRATION with a non-final status, or campaign event `type` TELNYX_REVIEW / MNO_REVIEW); it stays `submitted` until Telnyx first acknowledges review.

**The US-send gate** (enforced by `POST /v1/messages/send` and `POST /v1/conversations`, and mirrored by the composer UI): US-bound outbound requires the company's campaign row to have `status='approved' AND deactivated_at IS NULL`; otherwise the send fails 403 `registration_pending`.

**Post-grace resubscribe (reactivation):** if `checkout.session.completed` arrives for a company whose campaign row has `deactivated_at` set (the grace-expiry cron deactivated it), the handler re-submits a new campaign against the existing approved brand via `POST /v2/10dlc/campaignBuilder` (campaign row → `submitted`, clear `deactivated_at`/`approved_at`/`rejected_at`, increment `submission_count`; brand row untouched). The US-send gate stays closed until the new campaign is approved (R3).

Status transitions are driven by **Telnyx webhooks** to `/webhooks/telnyx` — `event_type` values `10dlc.brand.update` and `10dlc.campaign.update` dispatch to the registration handler; unknown `event_type`s are acked and ignored — **plus a daily cron poll** of `GET /v2/10dlc/brand/{brandId}` and `GET /v2/10dlc/campaign/{campaignId}` as the authoritative fallback (D2): the poller compares remote status and applies any missed transition.

#### 10DLC API contract (Telnyx)

| Operation | Telnyx call |
|---|---|
| Create brand (standard & sole-prop) | `POST /v2/10dlc/brand` (payload includes `webhookURL` + `webhookFailoverURL` = `https://api.loonext.app/webhooks/telnyx`) |
| Brand status (poller) | `GET /v2/10dlc/brand/{brandId}` |
| Sole-prop OTP: trigger / resend | `POST /v2/10dlc/brand/{brandId}/smsOtp` |
| Sole-prop OTP: verify | `PUT /v2/10dlc/brand/{brandId}/smsOtp { otpPin }` |
| Sole-prop OTP: status | `GET /v2/10dlc/brand/{brandId}/smsOtp` |
| Create campaign | `POST /v2/10dlc/campaignBuilder` |
| Campaign status (poller) | `GET /v2/10dlc/campaign/{campaignId}` |
| Assign number to campaign | `POST /v2/10dlc/phoneNumberCampaign { phoneNumber, campaignId }` |
| Deactivate campaign (grace-expiry cron) | `DELETE /v2/10dlc/campaign/{campaignId}` |

**Webhook event mapping** (`data.event_type` → app transition):
- `10dlc.brand.update`: `type=REGISTRATION` in review → brand `pending`; brand accepted/verified (sole-prop: `identityStatus='VERIFIED'`) → brand `approved` (triggers R2); failed with `reasons` → brand `rejected` (reasons → `rejection_reason`).
- `10dlc.campaign.update`: `type=TELNYX_REVIEW`/`MNO_REVIEW` → campaign `pending`; `status=ACCEPTED` after MNO review → campaign `approved` (triggers R3); `status=REJECTED` → campaign `rejected` (reasons → `rejection_reason`).
- `10dlc.phone_number.update`: assignment `FAILED` → Sentry alert + provisioning-retry cron re-runs R3's assignment; `ADDED` → no-op (assignment already recorded).

**Wizard → Telnyx payload field mapping:**

| Wizard field (§4.1 step 3) | Brand payload (`POST /v2/10dlc/brand`) |
|---|---|
| Legal business name | `companyName` (standard) / `firstName`+`lastName` (sole-prop); `displayName` = company display name |
| EIN (US) / BN (CA) | `ein` (standard path; full identifier, stored — see §6) |
| Last-4 SSN/SIN + mobile (sole-prop) | `ein` = last-4 identifier, `mobilePhone` = OTP target, `entityType='SOLE_PROPRIETOR'` |
| EIN present | `entityType='PRIVATE_PROFIT'` |
| Address | `street`, `city`, `state`, `postalCode`, `country` |
| Website | `website` (omitted for sole-prop without one) |
| Brand contact email / phone | `email`, `phone` |
| Vertical | `vertical` |

| Wizard field | Campaign payload (`POST /v2/10dlc/campaignBuilder`) |
|---|---|
| — | `brandId` (from R1), `usecase='LOW_VOLUME'` (`'SOLE_PROPRIETOR'` on sole-prop path), `autoRenewal=true` |
| Opt-in flow description | `messageFlow` |
| Sample messages | `sample1`, `sample2` |
| — (fixed, matches §5) | `description` (ICP boilerplate: conversational customer service for a home-service business), `optinKeywords='START'`, `optoutKeywords='STOP'`, `helpKeywords='HELP'`, `helpMessage` = "{Business name}: reply STOP to opt out. Contact us at {brand contact phone}.", `embeddedLink=false`, `numberPool=false`, `ageGated=false` |

**Customer-facing states & copy (dashboard banner, exact strings):**

| State | Banner |
|---|---|
| Number provisioning | "Setting up your business number — usually under a minute." |
| Provisioning delayed/failed (internal) | "We're setting up your number — this is taking longer than usual. You don't need to do anything." |
| Registration submitted/pending | "US texting activates in ~3–7 business days (carrier approval). Receiving texts and texting Canadian numbers already work." |
| Sole-prop OTP outstanding | "One step left: enter the verification code we sent to {phone} to finish US registration." + input |
| Rejected | "US registration needs a fix: {rejection_reason}. Update and resubmit — it takes 2 minutes." + button |
| Approved (dismissible, 7 days) | "🎉 US texting is live." |

**Composer gating in the thread view:** attempting a US-bound send pre-approval disables the send button with inline text "US texting unlocks when carrier approval completes (~3–7 business days)." — the API independently enforces `registration_pending`.

**On cancellation:** the Telnyx campaign is **deactivated by the grace-expiry release cron** (§11, `DELETE /v2/10dlc/campaign/{campaignId}`, `deactivated_at` stamped on the campaign row) together with number release — this stops recurring campaign fees for churned customers (D2's requirement) while keeping the campaign alive during the 30-day grace so a resubscribe restores texting instantly. A post-grace resubscribe goes through the reactivation path above.

---

## 5. Messaging compliance (D3, D4)

### Opt-out model (D3)

- **Telnyx default keyword auto-handling stays enabled** on every messaging profile: Telnyx auto-replies to STOP/HELP and maintains a profile-level block (sends to blocked numbers fail with Telnyx error **40300**). The app **never sends its own duplicate auto-reply**.
- **App-side mirror — `opt_outs` table** (`company_id`, `phone_e164`, `source: stop_keyword | manual | import`, `created_at`, `revoked_at`, UNIQUE(company_id, phone_e164)). The inbound webhook detects opt-out keywords **app-side only**: case-insensitive exact match of the trimmed message body against the standard standalone keyword list (STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT) — no Telnyx payload flag is relied on. START/UNSTOP/YES revokes (`revoked_at` set).
- **Manual "Mark opted out"** staff action on every contact/conversation (FCC 2025 rule: honor *any reasonable* revocation phrasing, e.g. "please stop texting me" — Telnyx only catches exact standalone keywords). Manual opt-outs are enforced **solely app-side** by the send-time `recipient_opted_out` rejection below — no block rule is pushed to Telnyx (Telnyx exposes no write API for its opt-out list; its profile-level keyword block remains the carrier backstop for STOP-keyword opt-outs only). Revoke ("Mark opted in again") exists and is logged.
- **Send-time enforcement:** `POST /v1/messages/send` **hard-rejects** sends to opted-out numbers with error code `recipient_opted_out`. The conversation renders an "Opted out" banner and disables the composer. If a send ever slips through to Telnyx and comes back 40300, `messages.error_code = '40300'` is stored and displayed — blocked sends are never silent.
- All opt-out/opt-in changes write `conversation_events` rows (`opted_out` / `opt_out_revoked`), attached to the most recent conversation for the (company, phone) pair when one exists, with `conversation_id` null otherwise (§6 permits null for contact-level event types).
- CSV contact import supports an optional `opted_out` column → creates `opt_outs` rows with `source='import'`.

### Consent attestation (D4)

- Replying within an existing **inbound** conversation: unrestricted.
- **Starting a new outbound conversation requires a consent attestation**: one mandatory checkbox in the compose flow — "**This customer asked us to text them**" — which writes `consent_source='attested'`, `consent_at`, `consent_attested_by` on the contact plus a `consent_attested` event. Contacts who texted in first get `consent_source='inbound_sms'` automatically. This makes the 10DLC-declared opt-in flow truthful.
- **Bulk compose, import-and-blast, and broadcast are explicitly out of scope** (D11) — deliberately, and for compliance. The API has no bulk-send surface.

### Quiet hours (soft, D4)

Composing a **new** outbound conversation between **8pm–8am destination local time** (timezone inferred from the destination area code via the static NANP table in `packages/shared`) shows a confirm dialog: "It's {time} where this customer is. Send anyway?" Confirmed sends proceed and are logged (`quiet_hours_confirmed` event, `quiet_hours_confirmed: true` on the `POST /v1/conversations` request — the only route carrying the flag). Replies within existing conversations are exempt, so `POST /v1/messages/send` has no quiet-hours parameter. **No hard block.**

### First-message identification (D4)

The **first outbound-first message ever sent to a contact** auto-appends: `— {Business name}. Reply STOP to opt out` (CASL identification + CTIA). Tracked via `contacts.first_identification_sent_at`. Replies to inbound conversations are never decorated. The composer previews the footer so the sender sees the final text.

### AUP & records

- Signup requires accepting the Acceptable Use Policy: no SHAFT content, no purchased lists, no cold marketing. The same commitments appear in the 10DLC campaign descriptions.
- Consent records and message history are retained **at least 3 years** (CASL proof-of-consent). Nothing in the retention/soft-delete design (§6) deletes them earlier.
- Privacy policy discloses that personal information is stored/processed in the US (PIPEDA/Law 25 cross-border disclosure); Supabase region is US.

---

## 6. Database schema (D7, D8)

All tables live in `public`. Conventions: `uuid` PKs via `gen_random_uuid()`; **FKs declared explicitly, `ON DELETE RESTRICT` default** (CASCADE only on join/child tables noted); `updated_at` maintained by `moddatetime` on every mutable table; money customer-facing in **integer cents**, provider COGS in **`numeric` dollars** (per-segment costs are fractions of a cent). Companies are never hard-deleted; contacts and companies soft-delete via `deleted_at`; `messages`, `usage_events`, `opt_outs` are append-only (rows are never deleted; permitted column updates only).

### Extensions & enums

```sql
create extension if not exists moddatetime;
create extension if not exists pg_trgm;
create extension if not exists citext;

create type member_role         as enum ('owner','admin','member');
create type subscription_status as enum ('incomplete','incomplete_expired','active',
                                         'past_due','unpaid','canceled');
create type plan_id             as enum ('starter','pro');
create type number_status       as enum ('provisioning','active','suspended',
                                         'released','provision_failed');
create type registration_kind   as enum ('brand','campaign');
create type registration_status as enum ('draft','submitted','pending','approved','rejected');
create type conversation_status as enum ('new','open','waiting','closed');
create type message_direction   as enum ('inbound','outbound','note');
create type message_status      as enum ('received','queued','sent','delivered','failed');
create type opt_out_source      as enum ('stop_keyword','manual','import');
create type consent_source_t    as enum ('inbound_sms','attested');
create type usage_event_type    as enum ('sms_outbound','mms_outbound','adjustment');
create type conversation_event_type as enum
  ('status_changed','assigned','tag_added','tag_removed','opted_out',
   'opt_out_revoked','consent_attested','quiet_hours_confirmed',
   'spam_marked','spam_unmarked');
```

### Tables

```sql
-- Synced from auth.users by trigger (below).
create table public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.companies (
  id                          uuid primary key default gen_random_uuid(),
  name                        text not null,
  owner_user_id               uuid not null references auth.users(id) on delete restrict,
  country                     text not null check (country in ('US','CA')),
  us_texting_enabled          boolean not null default true,
  requested_area_code         text not null,                 -- collected at POST /v1/companies;
                                                             -- copied into phone_numbers by the saga (§4.3)
  stripe_customer_id          text unique,
  stripe_subscription_id      text unique,
  subscription_status         subscription_status not null default 'incomplete',
  plan                        plan_id,                       -- null until first checkout
  current_period_start        timestamptz,
  current_period_end          timestamptz,
  overage_cap_multiplier      numeric(6,2) default 3.00,     -- null = no cap (owner-set)
  telnyx_messaging_profile_id text unique,
  registration_fee_paid_at    timestamptz,
  aup_accepted_at             timestamptz not null,
  canceled_at                 timestamptz,
  deleted_at                  timestamptz,                   -- soft delete; never hard-deleted
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create table public.company_members (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete restrict,
  user_id        uuid not null references auth.users(id) on delete restrict,
  role           member_role not null default 'member',
  deactivated_at timestamptz,                                -- frees the seat
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, user_id)
);

create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  email       citext not null,
  role        member_role not null check (role <> 'owner'),  -- owner not assignable (D8)
  invited_by  uuid not null references auth.users(id) on delete restrict,
  expires_at  timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index invites_pending_uq on public.invites (company_id, email)
  where accepted_at is null and revoked_at is null;

create table public.phone_numbers (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies(id) on delete restrict,
  status                  number_status not null default 'provisioning',
  provisioning_key        text not null,        -- checkout session id | Idempotency-Key
  requested_area_code     text,
  country                 text not null check (country in ('US','CA')),
  number_e164             text,                 -- null until purchased
  telnyx_phone_number_id  text,
  telnyx_order_id         text,
  provision_attempts      int not null default 0,
  last_provision_error    text,
  suspended_at            timestamptz,
  released_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create unique index phone_numbers_provkey_uq on public.phone_numbers (provisioning_key);
create unique index phone_numbers_e164_uq    on public.phone_numbers (number_e164)
  where status <> 'released';                   -- rows retained forever (status 'released')

create table public.messaging_registrations (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete restrict,
  kind             registration_kind not null,
  status           registration_status not null default 'draft',
  sole_proprietor  boolean not null default false,
  telnyx_id        text,                        -- Telnyx brand_id / campaign_id
  data             jsonb not null default '{}'::jsonb,  -- wizard payload. Stores the FULL EIN/BN
                                                        -- (business identifier — required for brand
                                                        -- submission, §4.4). SSN/SIN: last-4 only,
                                                        -- ever (all the sole-prop path requires).
  rejection_reason text,
  submission_count int not null default 0,
  submitted_at     timestamptz,
  approved_at      timestamptz,
  rejected_at      timestamptz,
  deactivated_at   timestamptz,                 -- set by grace-expiry cron on churn (campaign row)
  otp_nudged_at    timestamptz,                 -- +12h sole-prop OTP nudge email sent (§4.2, §11)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, kind)                     -- one brand + one campaign per company
);

create table public.contacts (
  id                           uuid primary key default gen_random_uuid(),
  company_id                   uuid not null references public.companies(id) on delete restrict,
  phone_e164                   text not null,
  name                         text,
  address                      text,
  notes                        text,
  consent_source               consent_source_t,
  consent_at                   timestamptz,
  consent_attested_by          uuid references auth.users(id) on delete restrict,
  first_identification_sent_at timestamptz,     -- first-message footer sent (§5)
  deleted_at                   timestamptz,     -- soft delete
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  unique (company_id, phone_e164)
);
create index contacts_name_trgm  on public.contacts using gin (name gin_trgm_ops);
create index contacts_phone_trgm on public.contacts using gin (phone_e164 gin_trgm_ops);

create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete restrict,
  contact_id       uuid not null references public.contacts(id) on delete restrict,
  phone_number_id  uuid not null references public.phone_numbers(id) on delete restrict,
  status           conversation_status not null default 'new',
  is_spam          boolean not null default false,
  assigned_user_id uuid references auth.users(id) on delete set null,
  last_message_at  timestamptz not null default now(),
  last_notified_at timestamptz,                 -- notification debounce (§8)
  closed_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint conversations_closed_consistency check ((status = 'closed') = (closed_at is not null))
);
-- THE THREADING INVARIANT: at most one open conversation per (company, number, contact).
create unique index conversations_open_uq on public.conversations
  (company_id, phone_number_id, contact_id) where closed_at is null;
create index conversations_inbox_idx    on public.conversations (company_id, status, last_message_at desc);
create index conversations_assigned_idx on public.conversations (assigned_user_id) where closed_at is null;

create table public.conversation_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- Notes are messages rows with direction='note' (they thread, search, paginate for free).
create table public.messages (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete restrict,
  conversation_id   uuid not null references public.conversations(id) on delete restrict,
  direction         message_direction not null,
  body              text not null default '',
  body_tsv          tsvector generated always as (to_tsvector('english', body)) stored,
  telnyx_message_id text,
  status            message_status,             -- null iff direction='note'
  segments          int,                        -- authoritative from Telnyx finalized `parts`
  encoding          text,                       -- 'GSM-7' | 'UCS-2' from Telnyx
  sent_by_user_id   uuid references auth.users(id) on delete restrict,
  error_code        text,                       -- e.g. Telnyx '40300' — never silent (D3)
  error_detail      text,
  idempotency_key   text,
  provider_cost     numeric(12,6),              -- COGS dollars (D7)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint messages_note_status    check ((direction = 'note') = (status is null)),
  constraint messages_outbound_actor check (direction <> 'outbound' or sent_by_user_id is not null)
);
create unique index messages_telnyx_id_uq on public.messages (telnyx_message_id)
  where telnyx_message_id is not null;          -- webhook idempotency (D7)
create unique index messages_idem_uq on public.messages (company_id, idempotency_key)
  where idempotency_key is not null;            -- send idempotency (D10)
create index messages_conv_created_idx on public.messages (conversation_id, created_at);
create index messages_body_tsv_idx     on public.messages using gin (body_tsv);

create table public.message_attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.messages(id) on delete cascade,
  company_id   uuid not null references public.companies(id) on delete restrict,
  storage_path text not null,                   -- mms-media/{company_id}/{message_id}/{n} (both directions)
  content_type text not null,
  size_bytes   int,
  source_url   text,                            -- inbound: Telnyx media URL (expires ~30 days); outbound: NULL
  created_at   timestamptz not null default now(),
  unique (message_id, source_url)               -- idempotent inbound downloads (nulls are distinct,
);                                              -- so multiple outbound rows per message are allowed)

-- Audit timeline for status/assign/tag/opt-out/consent changes ONLY (notes live in messages).
create table public.conversation_events (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete restrict,
  conversation_id uuid references public.conversations(id) on delete cascade,
  actor_user_id   uuid references auth.users(id) on delete restrict,  -- null = system
  type            conversation_event_type not null,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  -- conversation_id may be null only for contact-level events written when the
  -- contact has no conversation (POST /v1/contacts/:id/opt-out, CSV import, attest);
  -- when one exists, the event attaches to the most recent conversation for the pair.
  constraint conversation_events_conv_required check (
    conversation_id is not null
    or type in ('opted_out','opt_out_revoked','consent_attested'))
);
create index conversation_events_conv_idx on public.conversation_events (conversation_id, created_at);

create table public.tags (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  name       text not null,
  color      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index tags_name_uq on public.tags (company_id, lower(name));
-- Pre-seeded per company at creation: 'Quote sent', 'Scheduled', 'Won', 'Lost' (D7).

create table public.conversation_tags (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  tag_id          uuid not null references public.tags(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (conversation_id, tag_id)
);

create table public.opt_outs (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  phone_e164 text not null,
  source     opt_out_source not null,
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (company_id, phone_e164)               -- re-opt-out updates the row (never deleted)
);

create table public.usage_events (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete restrict,
  message_id         uuid references public.messages(id) on delete restrict,  -- null for 'adjustment'
  type               usage_event_type not null,
  quantity           int not null,              -- segments (MMS rows carry 3)
  meter_identifier   text,                      -- telnyx_message_id sent to Stripe
  stripe_reported_at timestamptz,               -- null = pending re-report by cron
  created_at         timestamptz not null default now()
);
create unique index usage_events_message_uq on public.usage_events (message_id)
  where message_id is not null;                 -- D7: nullable for non-message rows
create index usage_events_period_idx on public.usage_events (company_id, created_at);

create table public.webhook_events (
  provider    text not null check (provider in ('stripe','telnyx')),
  event_id    text not null,
  event_type  text not null,
  payload     jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts    int not null default 0,
  last_error  text,
  primary key (provider, event_id)              -- D7
);
create index webhook_events_unprocessed_idx on public.webhook_events (received_at)
  where processed_at is null;

create table public.templates (                  -- saved replies
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  name       text not null,
  body       text not null,
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index templates_name_uq on public.templates (company_id, lower(name));

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create table public.notification_prefs (
  user_id       uuid not null references auth.users(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  email_enabled boolean not null default true,
  push_enabled  boolean not null default true,
  updated_at    timestamptz not null default now(),
  primary key (user_id, company_id)
);

create table public.usage_alerts (               -- 80%/100% email idempotency
  company_id   uuid not null references public.companies(id) on delete restrict,
  period_start timestamptz not null,
  threshold    smallint not null check (threshold in (80,100)),
  sent_at      timestamptz not null default now(),
  primary key (company_id, period_start, threshold)
);

create table public.grace_notices (              -- day-1/15/27 grace-warning email idempotency (§9, §11)
  company_id    uuid not null references public.companies(id) on delete restrict,
  canceled_at   timestamptz not null,            -- the cancellation this notice belongs to
  threshold_day smallint not null check (threshold_day in (1,15,27)),
  sent_at       timestamptz not null default now(),
  primary key (company_id, canceled_at, threshold_day)
);
```

### Threading rule — the invariant (D7)

On inbound message from phone `P` to number `N` of company `C` (executed inside one transaction in a `security definer` SQL function; race-safe via the partial unique index + on-conflict re-select; message insert idempotent via `messages_telnyx_id_uq`):

1. **Upsert contact** on `UNIQUE(company_id, phone_e164)`; the upsert **clears `deleted_at`** — an inbound message resurrects a soft-deleted contact (soft delete hides a contact from lists; it never blocks the phone number).
2. If a conversation with `closed_at IS NULL` exists for `(C, N, contact)` → **append**. If its status is `waiting` → flip to `open`.
3. Else if the **most recent closed** conversation for the triple has `is_spam` → **append to it silently** (stays closed, stays spam, no notification — §8's notification pipeline checks `is_spam`; the `message.created` broadcast still fires, and clients ignore events for conversations with `is_spam=true` outside the spam filter view).
4. Else if closed **within 30 days** → **reopen it** (`closed_at = NULL`, status `new`).
5. Else **create a new conversation** (status `new`).

Close/reopen semantics: `status='closed'` sets `closed_at`; transitioning to any other status clears it (enforced by the CHECK constraint; API sets both atomically). "Mark as spam" sets `is_spam = true` **and** `status='closed'`; un-spam clears `is_spam`. Outbound-first conversations are created with status `open`. Pipeline stages ("Quote sent", "Scheduled", "Won", "Lost") are **pre-seeded conversation tags**, not statuses.

### RLS posture (D8)

- **RLS enabled, deny-by-default, on every table above.** No policies grant `anon`/`authenticated` any access to data tables, and **no GRANTs** are issued to those roles (the project's post-May-2026 no-auto-grant default is kept). The browser never touches PostgREST.
- The Worker uses the **`sb_secret_` key** (BYPASSRLS) and performs all authorization itself (§10). RLS is defense-in-depth.
- The **only** RLS policy for end users is on `realtime.messages`, authorizing private Broadcast topics (§8).
- Storage: `mms-media` bucket is private; no storage RLS policies for end users; the API mints signed URLs after membership checks.

### Triggers

```sql
-- updated_at on every mutable table:
create trigger set_updated_at before update on public.<table>
  for each row execute function moddatetime(updated_at);
-- (applied to: profiles, companies, company_members, invites, phone_numbers,
--  messaging_registrations, contacts, conversations, messages, tags, opt_outs,
--  templates, notification_prefs)

-- Profile sync from Supabase Auth:
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', ''))
  on conflict (user_id) do update set display_name = excluded.display_name;
  return new;
end $$;
create trigger on_auth_user_created after insert or update on auth.users
  for each row execute function public.handle_new_user();

-- Realtime broadcast triggers: see §8 (messages INSERT, messages UPDATE-of-status,
-- conversations UPDATE, phone_numbers UPDATE, messaging_registrations INSERT/UPDATE
-- → realtime.send(...) with ID-only payloads into company:{id}).
```

### Search (D7, scope extended by D29)

- **Messages (incl. notes):** generated `tsvector` column + GIN (`messages_body_tsv_idx`); queried with `websearch_to_tsquery('english', q)`; hits expose the matched message's `direction` so notes are labelable.
- **Contacts:** pg_trgm GIN on `name` and `phone_e164` (partial-name and partial-number matches).
- **Tasks / attachments / templates (D29):** pg_trgm GIN on `tasks.title`+`description`, `attachments.file_name`, and `templates.name`+`body` (partial indexes on the live-row predicates); fuzzy similarity-ranked arms in the same function. MMS media is deliberately not filename-searchable (carrier media carries no filename).
- No external search service. `GET /v1/search` (backed by `api_search_v2`) returns per-entity sections; conversations stay keyset-paginated, the palette arms are first-page-only.

---

## 7. API surface (D8, D10)

### Conventions (D10)

- Base prefix **`/v1`**; webhooks unversioned at **`/webhooks/*`**.
- Auth: `Authorization: Bearer <Supabase access token>` on every `/v1` route; **`X-Company-Id`** header on every route except `GET /v1/me`, `POST /v1/companies`, `POST /v1/invites/accept`. The Worker validates the header against `company_members` for the verified `sub` (§10).
- **Single resources:** bare JSON object, `200`/`201`. **Lists:** `{ "data": [...], "next_cursor": "…" | null }` — cursor-based only, opaque base64 of the sort key; **no offset pagination anywhere**. Conversations key on `(last_message_at, id) DESC` (mutable-key caveat: clients dedupe by `id`), default 25. Messages key on `(created_at, id) DESC`, default 50, max 100.
- **Errors:** `{ "error": { "code": "...", "message": "..." } }` with stable codes:

| Code | HTTP | Meaning |
|---|---|---|
| `unauthorized` | 401 | Missing/invalid JWT |
| `forbidden` | 403 | Role or membership insufficient |
| `subscription_inactive` | 402 | Company not `active` (send/provision paths) |
| `usage_cap_reached` | 402 | Overage cap hit; owner can raise |
| `registration_pending` | 403 | US-bound send without an `approved`, non-deactivated campaign (§4.4 gate) |
| `recipient_opted_out` | 403 | Destination is on the opt-out list |
| `validation_failed` | 422 | Body/param validation (zod) |
| `not_found` | 404 | — |
| `conflict` | 409 | Uniqueness/state conflict |
| `rate_limited` | 429 | Per-company or per-IP limit |

- **`POST /v1/messages/send` and `POST /v1/conversations` require an `Idempotency-Key` header** (client UUID). The message row is inserted **before** the Telnyx call; a concurrent/duplicate request returns the existing row (and, on `POST /v1/conversations`, the existing conversation) with `200`.
- **CORS:** `apps/api` serves CORS for the exact web origin **`https://app.loonext.app` only** — allow methods `GET, POST, PATCH, PUT, DELETE`; allow headers `Authorization, X-Company-Id, Idempotency-Key, Content-Type`. No wildcard origins. `/webhooks/*` routes send **no** CORS headers.

### Routes

Roles: **O**=owner, **A**=admin, **M**=member. "O/A" = owner or admin. All conversation/message/contact/tag/template routes = any active member.

| Method & path | Role | Purpose / shape |
|---|---|---|
| `GET /v1/me` | any | `{ user_id, display_name, memberships: [{company_id, name, role, subscription_status}] }` |
| `POST /v1/companies` | any | Create company: `{ name, country, requested_area_code, us_texting_enabled?, aup_accepted: true }` → company; creator = owner |
| `GET /v1/company` | M | Company + plan, subscription_status, period, cap, numbers summary, registration summary |
| `PATCH /v1/company` | O/A | `{ name? }`; `{ overage_cap_multiplier? }` **owner only** (number or null) |
| `POST /v1/billing/checkout` | O/A | `{ plan: 'starter'\|'pro' }` → `{ url }` Stripe Checkout session (§9 composition); 409 `conflict` when `subscription_status` ∈ ('active','past_due','unpaid') or a required registration draft is incomplete (§4.1 step 4) |
| `POST /v1/billing/portal` | O/A | → `{ url }` hosted portal (payment methods, invoices, cancellation only) |
| `POST /v1/billing/change-plan` | O/A | `{ plan: 'starter'\|'pro' }` — upgrade prorates now; downgrade at period end, blocked (409 `conflict`) until numbers ≤ 1 and active members ≤ 3 |
| `GET /v1/usage` | M | `{ period_start, period_end, included_segments, used_segments, overage_segments, cap_segments, projected_overage_cents }` from `usage_events` |
| `GET /v1/numbers` | M | List numbers with status |
| `POST /v1/numbers/provision` | O/A | Pro 2nd number: `{ requested_area_code }` (zod-validated against the shared NANP table; country fixed to the company's). Requires `Idempotency-Key`, active subscription, atomic count-vs-plan check; 409 `conflict` when the brand row has `sole_proprietor=true` and a non-released number exists (§4.2 cap) |
| `DELETE /v1/numbers/:id` | O | Release a number (type-to-confirm in UI); needed pre-downgrade; **never automatic** |
| `GET /v1/registration` | M | Brand + campaign rows (status, rejection_reason, timestamps) |
| `PUT /v1/registration` | O/A | Save/update wizard data (draft or rejected → resubmit) |
| `POST /v1/registration/submit` | O/A | Submit a completed `draft` (first-submission recovery path) or resubmit after a rejection fix |
| `POST /v1/registration/otp` | O/A | Sole-prop OTP: `{ code }` → Telnyx `PUT /v2/10dlc/brand/{brandId}/smsOtp { otpPin }` (§4.2); 422 `validation_failed` on a wrong/expired PIN |
| `POST /v1/registration/otp/resend` | O/A | Re-trigger the sole-prop OTP SMS (`POST /v2/10dlc/brand/{brandId}/smsOtp` — fresh PIN, new 24h window) |
| `POST /v1/registration/enable-us` | O | CA companies: one-off $29 invoice with metadata `{ purpose: 'us_registration', company_id }` → submit on `invoice.paid` (§4.2, §9) |
| `GET /v1/conversations` | M | Filters: `status`, `assigned_user_id`, `tag_id`, `is_spam`, `q`; cursor list |
| `POST /v1/conversations` | M | Start outbound-first: `{ contact_id \| phone_e164, phone_number_id, body, consent_attested: true, quiet_hours_confirmed? }` + `Idempotency-Key` → creates/attests contact, conversation (status `open`), sends first message (all send gates apply; footer appended per §5). If an open conversation already exists for the (contact, number) pair (`conversations_open_uq`), the message is appended to it instead — gates and consent attestation still apply and are recorded — and that conversation is returned (`200`) |
| `GET /v1/conversations/:id` | M | Conversation + contact + tags + **embedded first page of messages** (`messages: { data, next_cursor }`) |
| `PATCH /v1/conversations/:id` | M | `{ status?, assigned_user_id?, is_spam? }` — writes `conversation_events` per changed field; close/reopen = status transitions |
| `GET /v1/conversations/:id/messages` | M | Cursor list, newest-first. Message objects everywhere (here and the embedded page) carry `attachments: [{id, content_type, size_bytes}]` |
| `GET /v1/attachments/:id/url` | M | Mint a short-lived signed Storage URL (membership-checked) → `{ url, expires_at }`; TTL 1 hour |
| `POST /v1/conversations/:id/notes` | M | `{ body }` → messages row `direction='note'` |
| `GET /v1/conversations/:id/events` | M | Audit timeline, cursor list |
| `POST /v1/conversations/:id/tags` | M | `{ tag_id }` or `{ name }` (create-on-attach) |
| `DELETE /v1/conversations/:id/tags/:tag_id` | M | Detach |
| `POST /v1/conversations/:id/read` | M | Upsert `conversation_reads` for caller |
| `POST /v1/messages/send` | M | `{ conversation_id, body, media?: [{content_type, base64}] }` + `Idempotency-Key` → message row (status `queued`). Media limits (422 `validation_failed`): max 3 items, ≤1 MB each decoded, `content_type` ∈ image/jpeg \| image/png \| image/gif. Gate order: membership → subscription `active` → destination is US/CA NANP area code → per-destination registration gate → opt-out check → cap check → rate limit → insert → Telnyx `POST /v2/messages` |
| `POST /v1/messages/:id/retry` | M | Re-send a `failed` outbound **only when `telnyx_message_id IS NULL`** (the Telnyx API call failed before an ID was assigned): new Telnyx call, same row. Carrier-finalized failures (e.g. 40300) are not retryable — 409 `conflict`; the user composes a new message |
| `GET /v1/contacts` | M | `q` via pg_trgm; cursor list |
| `POST /v1/contacts` | M | `{ phone_e164, name?, address?, notes? }` — upsert on `(company_id, phone_e164)`: an existing row (soft-deleted included) is updated and `deleted_at` cleared |
| `GET /v1/contacts/:id` · `PATCH /v1/contacts/:id` | M | Read/update |
| `DELETE /v1/contacts/:id` | M | Soft delete (`deleted_at`) — hides the contact from lists only; any later upsert path (inbound message, `POST /v1/contacts`, CSV import) clears it |
| `POST /v1/contacts/import` | O/A | CSV multipart: columns `phone,name,address,notes,opted_out?`; upserts on phone (clears `deleted_at`); `opted_out=true` → opt_outs `source='import'`; returns `{ imported, updated, skipped, errors }` |
| `POST /v1/contacts/:id/opt-out` | M | Manual opt-out (`source='manual'`) + event; enforced app-side at send time only (§5 — no Telnyx push) |
| `POST /v1/contacts/:id/opt-out/revoke` | M | Revoke + event |
| `GET /v1/tags` | M | List (create happens on attach) |
| `DELETE /v1/tags/:id` | O/A | Delete tag (cascades from conversation_tags) |
| `GET /v1/templates` · `POST /v1/templates` | M | Saved replies |
| `PATCH /v1/templates/:id` · `DELETE /v1/templates/:id` | M | — |
| `GET /v1/search?q=` | M | `{ conversations: [...], contacts: [...] }` (FTS + trgm, §6) |
| `GET /v1/members` | M | Members + roles + profiles |
| `PATCH /v1/members/:id` | O/A | `{ role: 'admin'\|'member' }` — owner role never assignable; owner row immutable |
| `DELETE /v1/members/:id` | O/A | Deactivate (sets `deactivated_at`, frees seat) |
| `GET /v1/invites` · `POST /v1/invites` | O/A | Create: `{ email, role }`; seat limit enforced **here and at acceptance** — seat count = active members (`deactivated_at IS NULL`) + pending invites (`accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`) ≤ plan seats; sends Supabase `inviteUserByEmail` (Resend SMTP) |
| `DELETE /v1/invites/:id` | O/A | Revoke |
| `POST /v1/invites/accept` | any | `{ invite_id }` (the id is embedded in the invite email link). Verifies the JWT's verified email equals `invites.email` and the invite is pending/unexpired → creates the `company_members` row **and a `notification_prefs` row (defaults true/true)**; re-checks the seat limit with the same formula (409 `conflict` if full) |
| `GET /v1/notification-prefs` · `PUT /v1/notification-prefs` | M | `{ email_enabled, push_enabled }` |
| `POST /v1/push-subscriptions` | M | `{ endpoint, keys: {p256dh, auth} }` |
| `DELETE /v1/push-subscriptions/:id` | M | — |

There is **no** `POST /auth/*` on the Worker — all auth flows (signup, login, logout, refresh, password reset, invite acceptance) go through Supabase Auth directly from the browser (D8).

### Webhook routes — verify → ledger → ack → waitUntil (D8, D10)

**Single Telnyx route** `POST /webhooks/telnyx` (one URL per messaging profile is Telnyx's delivery model; payloads dispatch on `data.event_type`). Telnyx requires a 2xx **within 2 seconds** and retries up to 3× per URL plus 3× on a failover URL (6 attempts max) — duplicates are expected.

```
1. VERIFY   Telnyx: Ed25519 over `${telnyx-timestamp}|${rawBody}` from the
            telnyx-signature-ed25519 + telnyx-timestamp headers, via WebCrypto
            crypto.subtle.verify('Ed25519', …), public key from the portal
            (Worker secret). Reject > 5-min skew. 400 on failure.
            Stripe: stripe.webhooks.constructEventAsync(rawBody, sig, secret,
            tolerance, Stripe.createSubtleCryptoProvider()) — the sync variant
            fails on Workers.
2. LEDGER   INSERT INTO webhook_events (provider, event_id, event_type, payload)
            ON CONFLICT (provider, event_id) DO NOTHING.
            Conflict → already seen → ack 200 and stop.
3. ACK      Return 200 immediately (well inside Telnyx's 2 s window).
4. PROCESS  ctx.waitUntil(handler): dispatch, do the work, set processed_at
            (or attempts++/last_error on failure).
5. SWEEP    The 5-minute cron (§11) reprocesses rows where processed_at IS NULL —
            durability without Queues.
```

**Telnyx `event_type` dispatch:**
- `message.received` → threading transaction (§6), opt-out keyword handling (§5), MMS media download (idempotent: fetch each `media[].url` **immediately** — URLs expire after ~30 days but we never wait — into `mms-media/{company_id}/{message_id}/{n}`, insert `message_attachments`), notification pipeline (§8).
- `message.sent` → `messages.status='sent'` by `telnyx_message_id`.
- `message.finalized` → status `delivered`/`failed` (+`error_code`/`error_detail`), **authoritative `parts` + `encoding` stored**, `provider_cost` from payload cost when present, then the metering step (§9): insert `usage_events` + fire the Stripe meter event. Status webhooks whose `telnyx_message_id` matches no row are acked as no-ops.
- `10dlc.brand.update` / `10dlc.campaign.update` / `10dlc.phone_number.update` → registration state machine (§4.4 webhook event mapping). Unknown `event_type`s → ack, no-op.

**Stripe events handled** (configured on the webhook endpoint): `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`. Handlers treat events as **triggers** and re-fetch the subscription from the Stripe API before applying state (out-of-order guard) — see §9.

---

## 8. Realtime & notifications (D9)

### Broadcast-from-Database

**Supabase Realtime Broadcast**, never `postgres_changes` (single-threaded, per-client RLS reads — rejected). Postgres triggers publish into the **private topic `company:{company_id}`** with **ID-only payloads** (clients refetch via the API so authorization stays in one place). Because `realtime.broadcast_changes()`'s default payload includes row data, the triggers call the underlying **`realtime.send()`** primitive with a minimal JSON body — same mechanism, ID-only payload as D9 requires:

```sql
create or replace function public.broadcast_message_change() returns trigger
language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    perform realtime.send(
      jsonb_build_object('conversation_id', new.conversation_id,
                         'message_id', new.id, 'direction', new.direction),
      'message.created', 'company:' || new.company_id::text, true);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform realtime.send(
      jsonb_build_object('message_id', new.id, 'status', new.status),
      'message.status', 'company:' || new.company_id::text, true);
  end if;
  return null;
end $$;
create trigger messages_broadcast after insert or update on public.messages
  for each row execute function public.broadcast_message_change();

create or replace function public.broadcast_conversation_change() returns trigger
language plpgsql security definer as $$
begin
  perform realtime.send(jsonb_build_object('conversation_id', new.id),
    'conversation.updated', 'company:' || new.company_id::text, true);
  return null;
end $$;
create trigger conversations_broadcast after update on public.conversations
  for each row execute function public.broadcast_conversation_change();

-- Onboarding live states (§4.1 step 6): number provisioning → active,
-- registration pending → approved render without refresh.
create or replace function public.broadcast_provisioning_change() returns trigger
language plpgsql security definer as $$
begin
  if tg_table_name = 'phone_numbers' then
    perform realtime.send(
      jsonb_build_object('number_id', new.id, 'status', new.status),
      'number.updated', 'company:' || new.company_id::text, true);
  else
    perform realtime.send(
      jsonb_build_object('kind', new.kind, 'status', new.status),
      'registration.updated', 'company:' || new.company_id::text, true);
  end if;
  return null;
end $$;
create trigger phone_numbers_broadcast after update on public.phone_numbers
  for each row execute function public.broadcast_provisioning_change();
create trigger registrations_broadcast after insert or update on public.messaging_registrations
  for each row execute function public.broadcast_provisioning_change();
```

**Events:** `message.created {conversation_id, message_id, direction}` · `conversation.updated {conversation_id}` · `message.status {message_id, status}` · `number.updated {number_id, status}` · `registration.updated {kind, status}`.

**Topic authorization** — RLS on `realtime.messages` (the only end-user policy in the system):

```sql
create policy company_topic_read on realtime.messages
for select to authenticated using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1 from public.company_members cm
    where cm.user_id = auth.uid()
      and cm.deactivated_at is null
      and realtime.topic() = 'company:' || cm.company_id::text
  )
);
```

Clients subscribe on inbox mount (`private: true`), apply events by refetching the referenced resources, and **refetch page 1 of the inbox on reconnect**. Capacity is a non-issue at MVP scale (Supabase Pro: 500 concurrent connections, 5M messages/mo included).

### Send lifecycle (D9)

```
POST /v1/messages/send
 → gates pass → INSERT messages (status='queued')      ← this insert IS the
   optimistic UI: the broadcast trigger pushes it to every open inbox
 → outbound media, when present (validated per §7: ≤3 items, ≤1 MB each,
   jpeg/png/gif): upload each item to mms-media/{company_id}/{message_id}/{n},
   INSERT message_attachments rows (source_url NULL for outbound), mint a
   24-hour signed URL per item (TTL covers Telnyx's fetch + retries) and pass
   those URLs as media_urls
 → Telnyx POST /v2/messages { from, to, text, media_urls? }
 → store telnyx_message_id on the row
 → Telnyx API error: row → status='failed' + error_detail; UI shows a retry
   affordance (POST /v1/messages/:id/retry — permitted only while
   telnyx_message_id IS NULL, §7)
 → webhooks: message.sent → 'sent'; message.finalized → 'delivered'/'failed'
   (+error_code) — status badges push live via message.status broadcasts
```

### Notifications (D9)

- **Channels (both MVP):** email via Resend, and **Web Push** (VAPID key pair as Worker secrets; service worker in `apps/web`; payload: contact display name + 80-char snippet + deep link).
- **Trigger (debounced — never one email per message):** a conversation is **new or reopened by inbound**, or a **first inbound after ≥15 minutes of thread inactivity** (`conversations.last_notified_at` gate: notify only if `last_notified_at IS NULL OR last_notified_at < now() - interval '15 minutes'`, then stamp it).
- **Audience:** the assignee; if unassigned, all active members. Filtered per `notification_prefs` (per-user email/push toggles).
- Spam-thread appends (threading step 3) never notify.
- **Operational emails** — billing (dunning, SCA action-required, grace warnings), usage (80%/100% alerts, cap reached), and registration (approval, rejection, OTP nudge) — go to **the owner plus all active admins**, and **bypass `notification_prefs`**: prefs govern conversation notifications only.
- **Responsive mobile-first UI is an explicit MVP requirement** (this ICP lives on phones); native apps are out of scope (D11).

---

## 9. Billing mechanics (D6)

### Stripe catalog (created by a checked-in setup script, ids stored as env config)

- **Products:** `Loonext Starter`, `Loonext Pro` (SaaS product tax code on both), `US texting registration`.
- **Meter:** one Billing Meter, `event_name = 'sms_segments'`, aggregation `sum`, `customer_mapping` by `stripe_customer_id`.
- **Prices:**
  - Starter licensed: $29/mo flat.
  - Starter metered: `recurring[usage_type]=metered`, `recurring[meter]=<METER_ID>`, `billing_scheme=tiered`, `tiers_mode=graduated`: tier 1 `up_to=500, unit_amount=0`; tier 2 `up_to=inf, unit_amount=3` ($0.03).
  - Pro licensed: $79/mo flat.
  - Pro metered: graduated: tier 1 `up_to=2500, unit_amount=0`; tier 2 `up_to=inf, unit_amount_decimal=2.5` ($0.025 — fractional cents require `unit_amount_decimal`).
  - Registration: $29 one-time price.
- Metered usage bills **in arrears** on the monthly invoice; Stripe enforces the included quota via tier 1 at $0. (Meter events process asynchronously — the in-app usage screen reads `usage_events`, never Stripe.)

### Checkout composition (D6)

Request body: `{ plan: 'starter'|'pro' }` (zod-validated) selects the price pair. Gates (409 `conflict`): `subscription_status` already in ('active','past_due','unpaid'); or the company owes US registration (US, or CA with `us_texting_enabled=true`) and the wizard's brand + campaign draft rows are incomplete (§4.1 step 4). Subscription-mode Checkout Session: `client_reference_id = company_id`; line items = licensed price (qty 1) + metered price (**no quantity** — required for metered items) + the one-time $29 price when applicable (US company or CA with `us_texting_enabled`, **and `registration_fee_paid_at IS NULL`** — never charged twice; initial invoice only); `automatic_tax[enabled]=true`; success/cancel URLs back to the dashboard. **Company-first ordering:** signup → `POST /v1/companies` (status `incomplete`) → checkout. **`checkout.session.completed` with `payment_status=='paid'` is the only provisioning trigger** — never the redirect page.

### Webhook handling & subscription_status state machine

Every handler **re-fetches the subscription from the Stripe API** and mirrors its status into `companies.subscription_status` (out-of-order guard). Event-driven actions:

| Event | Guard | State → | Actions |
|---|---|---|---|
| `checkout.session.completed` | `payment_status=='paid'`; ledger dedupe; `phone_numbers.provisioning_key` backstop | `incomplete → active` | Store customer/subscription/plan/period; start provisioning saga; submit registration; stamp `registration_fee_paid_at` when the fee line is present. Resubscribe-within-grace: un-suspend numbers instead of provisioning (saga skips when a non-released number exists). Post-grace resubscribe (campaign row has `deactivated_at` set): re-submit the campaign per §4.4 reactivation |
| `customer.subscription.created` / `updated` | refetch | mirror Stripe status | Sync plan + `current_period_*`; on period rollover nothing else (Stripe resets the meter tiering); handle `cancel_at_period_end` display |
| `customer.subscription.deleted` | — | `→ canceled` | `canceled_at=now()`; numbers → `suspended` (inbound still received & stored); grace clock starts; send the day-1 warning **through the `grace_notices` ledger** (insert `(company_id, canceled_at, 1)`, skip on conflict — the §11 cron shares the ledger, so overlap can never double-send) |
| `invoice.paid` | — | `→ active` | Clear dunning banners. Branch: if `invoice.metadata.purpose == 'us_registration'` (the §4.2 enable-us invoice), stamp `registration_fee_paid_at` and start the §4.4 submission (R1) |
| `invoice.payment_failed` | — | `→ past_due` | Outbound blocked (402 `subscription_inactive`); inbound + dashboard stay live; Resend email + banner |
| `invoice.payment_action_required` | — | — | Resend email with hosted invoice link (SCA) |

`incomplete` sessions that never pay expire per Stripe (`incomplete_expired`, 23-hour window) — the company simply remains unprovisioned and can retry checkout.

**Dunning:** Stripe **Smart Retries at defaults (8 retries over 2 weeks)**; post-exhaustion action = **cancel subscription** → flows into the cancellation path above.

**Cancellation → grace → release:** `canceled` → numbers `suspended` → **30-day grace** (warning emails at **day 1, 15, 27**, deduped via the `grace_notices` ledger, §6) → daily cron (§11) **releases the Telnyx number(s) and deactivates the 10DLC campaign**. Resubscribing within grace restores the same number instantly (Telnyx's ~15-day repurchase window is a safety net, not the mechanism); resubscribing after grace re-registers per §4.4 reactivation.

### Metering pipeline (D6)

```
Telnyx message.finalized (outbound; authoritative `parts` + `encoding`)
 → messages.segments = parts (MMS: metered quantity = 3 per D5)
 → INSERT usage_events { message_id, type sms_outbound|mms_outbound,
     quantity, meter_identifier = telnyx_message_id }   ← unique(message_id)
 → POST /v1/billing/meter_events { event_name: 'sms_segments',
     identifier: telnyx_message_id,        ← accidental-retry safeguard (24h+)
     payload: { stripe_customer_id, value: quantity } }
 → stamp usage_events.stripe_reported_at
 → usage-alert check: 80%/100% of included quota → usage_alerts upsert
   (PK-idempotent) → Resend email + banner
```

- `usage_events` (with `stripe_reported_at`) is the **app-side source of truth** for the usage dashboard and cap checks; the hourly cron re-reports rows where `stripe_reported_at IS NULL` (gate on the local stamp — Stripe's identifier dedupe is a safeguard, not idempotency).
- Sent-but-undelivered parts are still metered (Telnyx charges for them); `failed`-before-send (Telnyx API error) rows produce no usage event.
- Cap check at send time: `sum(usage_events.quantity)` for the current period + a GSM-7/UCS-2 estimate (160/153, 70/67 chars) of queued-but-unfinalized messages; the 250-segments/hour rate limit bounds any race at the margin.

### Plan changes (D6)

In-app only via `POST /v1/billing/change-plan` — the hosted portal **cannot** switch plans on multi-item usage-based subscriptions. **Upgrades:** swap both subscription items to the Pro prices with `proration_behavior='always_invoice'` (immediate). **Downgrades:** applied at period end via a subscription schedule, and **blocked** (409) until extra numbers are released (owner-initiated `DELETE /v1/numbers/:id` — never automatic) and active members ≤ 3. Portal scope: payment methods, invoices, cancellation only.

---

## 10. Security (D8)

- **Auth boundary:** browser ↔ Supabase Auth directly (`@supabase/ssr`) for signup/login/reset/invite-accept; there is no Worker auth route. Every API request carries the Supabase access token; the Worker verifies it **locally** via JWKS (**ES256 asymmetric keys — enabled at project setup**; verify `iss`, `aud`, `exp`; JWKS cached, edge-cached 10 min upstream). The caller's company comes from `X-Company-Id` validated against `company_members` (active, for the verified `sub`) — **company id is never trusted from the body**; users may belong to multiple companies.
- **Tenant isolation:** every query in the Worker's data-access layer takes an explicit `company_id` parameter (no default-scoped queries); RLS deny-by-default + no-grants posture (§6) backstops any handler bug; Realtime topics are membership-gated (§8).
- **Webhook signatures:** Telnyx Ed25519 over `{timestamp}|{payload}` (`telnyx-signature-ed25519` + `telnyx-timestamp`, WebCrypto verify, 5-min tolerance); Stripe `constructEventAsync` + `createSubtleCryptoProvider()` (sync `constructEvent` fails on Workers). Webhook routes are exempt from JWT auth; signature verification is their authentication. Verify → ledger → ack → waitUntil → cron sweep (§7).
- **SMS-pumping defense (layered, D8):**
  1. Telnyx messaging-profile geo-permissions: **US + Canada only**.
  2. Worker-side destination validation against the **US/CA area-code table** in `packages/shared` — NANP includes ~20 Caribbean countries billed at international rates, so `+1` alone is never accepted.
  3. Per-company rate limit: **1 msg/s** via the Workers rate-limiting binding; **250 segments/hour** via a DB check evaluated inside the send RPC — `sum` of segment estimates (shared estimator, §9) over `messages` where `company_id = X AND direction = 'outbound' AND created_at > now() - interval '1 hour'`; at ≥250 the send is rejected 429 `rate_limited`.
  4. Overage cap (default 3× quota, §2).
- **Front door:** Cloudflare WAF rate-limiting rule on `/v1/billing/checkout` (10 req/min/IP). Supabase Auth traffic goes browser → `<project>.supabase.co` directly (§3) — it is **not** behind Loonext's Cloudflare zone, so it is protected by Supabase Auth's built-in rate limits plus **Cloudflare Turnstile enabled through Supabase Auth's captcha-protection setting** (Auth → Attack Protection → CAPTCHA, provider "Turnstile") — that setting *is* the signup Turnstile mechanism.
- **Provisioning:** initial number provisioning is **webhook-driven only**. `POST /v1/numbers/provision` is owner/admin-only, requires active subscription, atomic count-vs-plan check, per-request `Idempotency-Key` (backstopped by `phone_numbers.provisioning_key` uniqueness); sole-prop companies are capped at 1 number (409 `conflict`, §4.2/§7).
- **Role matrix (D8):**

| Capability | owner | admin | member |
|---|---|---|---|
| Billing (checkout, portal, change-plan) | ✔ | ✔ | — |
| Overage cap raise/remove | ✔ | — | — |
| Numbers (provision/release), registration | ✔ | ✔ (release, enable-us: owner only) | — |
| Members & invites, company settings | ✔ | ✔ | — |
| Conversations, messages, notes, tags, contacts, templates, search (tag delete, CSV import: owner/admin) | ✔ | ✔ | ✔ |

  The owner role is not assignable via invite; the owner membership row cannot be deactivated or demoted.
- **Invites:** Supabase `inviteUserByEmail` (Resend custom SMTP) + `invites` table binding company/email/role; seat limits enforced at creation **and** acceptance; 7-day expiry; revocation supported.
- **Secrets:** all server credentials are Worker encrypted secrets (`wrangler secret put`), injected from GitHub Actions environment secrets; never in `wrangler.toml` or the repo. Frontend receives only `NEXT_PUBLIC_SUPABASE_URL` + the `sb_publishable_` key (the allowed `NEXT_PUBLIC_*` set is enumerated in CI and reviewed). Stripe uses a **restricted key**. Supabase uses `sb_secret_` (independently revocable). Startup zod env validation fails loudly.
- **PII / telemetry policy:** message bodies, names, addresses, and phone numbers never reach Sentry or PostHog. Sentry `beforeSend` strips request/response bodies and redacts E.164 patterns; `sendDefaultPii` off. PostHog: UUIDs, counts, and feature events only; autocapture masked; no session replay on inbox/conversation pages. Logs reference IDs, never bodies or destination numbers. `messaging_registrations.data` stores the **full EIN/BN** (business identifier — required for brand submission, which happens later at webhook time) but **SSN/SIN as last-4 only**: full SSN/SIN are never collected or persisted (Telnyx's Sole Proprietor path requires only the last-4, §4.4).

---

## 11. Scheduled jobs (Cron Triggers, `apps/api`)

All crons are idempotent and safe to re-run; each processes work-item rows selected by state, never by "last run" bookkeeping.

| Cron | Schedule | Work | Idempotency |
|---|---|---|---|
| Webhook sweeper | `*/5 * * * *` | Reprocess `webhook_events` where `processed_at IS NULL AND received_at < now()-2min AND attempts < 5`; Sentry alert at attempt 5 | `processed_at` stamp; handlers are idempotent by design (unique indexes) |
| Provisioning retry & reconcile | `*/15 * * * *` | Retry `phone_numbers` in `provisioning`/`provision_failed` (backoff, ≤5 attempts); list Telnyx numbers by `customer_reference` to adopt crash-after-buy orphans | `provisioning_key` unique; saga steps skip completed work |
| Usage re-reporter | `0 * * * *` (hourly) | Re-POST meter events for `usage_events` where `stripe_reported_at IS NULL` | Local stamp gate + Stripe `identifier` dedupe |
| Registration poller | `0 13 * * *` (daily) | Poll Telnyx brand/campaign status (`GET /v2/10dlc/brand/{brandId}`, `GET /v2/10dlc/campaign/{campaignId}`) for `submitted`/`pending` rows; apply missed transitions + emails (webhooks are primary, this is the D2 fallback) | State-diff apply; emails keyed to transitions |
| Sole-prop OTP nudge | `30 * * * *` (hourly) | Sole-prop brand rows with the OTP outstanding ≥ 12h (`identityStatus` pending, `submitted_at < now() - 12h`) and `otp_nudged_at IS NULL` → send the Resend nudge email, stamp `otp_nudged_at` (§4.2) | `otp_nudged_at` stamp — one nudge per brand submission |
| Grace & release | `0 14 * * *` (daily) | For `canceled` companies: send day-1/15/27 warning emails keyed to `canceled_at` age — INSERT INTO `grace_notices (company_id, canceled_at, threshold_day)` first, skip on conflict, then send; at ≥30 days: release numbers via Telnyx, set `released`, **deactivate the 10DLC campaign** (`DELETE /v2/10dlc/campaign/{campaignId}`), set `deactivated_at` on the campaign row | `grace_notices` PK (shared with the §9 `subscription.deleted` handler); status transitions are one-way; release skips already-`released` rows |
| Subscription reconcile | `0 15 * * *` (daily) | For non-`active` companies, re-fetch Stripe subscription and re-mirror status (backstop for missed webhooks); expire stale `invites` past `expires_at` (report only — acceptance already checks) | Mirror is convergent |

---

## 12. Build order (D11 scope, dependency-ordered)

Each step lands with its tests (D13) and deploys green from CI.

1. **Monorepo + CI scaffold.** pnpm workspace, `apps/web` (Next 15 + Tailwind + shadcn/ui via OpenNext), `apps/api` (Hono), `packages/shared`, GitHub Actions (typecheck/lint/vitest/build on PR; wrangler deploy on main), zod env validation in both Workers. ✅ Both Workers deploy; a missing env var fails startup loudly.
2. **Supabase schema migration 001.** Everything in §6: enums, tables, indexes, RLS-enable-all, triggers, realtime policy; local Supabase in CI. ✅ Migration applies cleanly; constraint tests pass (threading unique index, idempotency uniques).
3. **Auth + API skeleton.** ES256 signing keys enabled; `@supabase/ssr` signup/login/reset in web; Worker JWT middleware (JWKS, iss/aud/exp) + `X-Company-Id` membership check; `GET /v1/me`. ✅ Valid token + membership → 200; wrong company → 403; forged token → 401.
4. **Company creation + onboarding wizard shell.** `POST /v1/companies` (AUP gate, tag pre-seed, prefs row), registration wizard UI writing `messaging_registrations` drafts (EIN / sole-prop branch), area-code picker. ✅ CA company can skip wizard via `us_texting_enabled=false`.
5. **Stripe catalog + checkout + webhook route.** Setup script (products/prices/meter), `POST /v1/billing/checkout`, `/webhooks/stripe` with verify→ledger→ack→waitUntil, subscription state machine (§9 table). ✅ Test-mode paid checkout flips company to `active` exactly once under duplicate webhook delivery.
6. **Provisioning saga.** §4.3 with retries + reconciliation cron; numbers UI states. ✅ Kill the Worker between order and persist → reconcile adopts the number; duplicate `checkout.session.completed` never orders twice.
7. **Registration state machine.** Brand/campaign submission per the §4.4 10DLC API contract, sole-prop OTP step (`POST /v1/registration/otp` + `/otp/resend`, +12h nudge cron), Telnyx `10dlc.*` status webhooks + daily poller, rejection fix-and-resubmit, post-grace reactivation, Resend emails, dashboard banners (§4.4 copy). ✅ Simulated approve/reject/OTP transitions drive banners and gate flags.
8. **Inbound pipeline.** `/webhooks/telnyx` (Ed25519 verify, ledger, dispatch); threading transaction (all 5 rules); contact upsert; opt-out keyword capture; MMS media download to Storage + `message_attachments`. ✅ Concurrent duplicate `message.received` deliveries produce exactly one message; STOP creates an opt-out; spam-closed threads swallow silently.
9. **Send pipeline.** `POST /v1/messages/send` with the full gate order (§7), Idempotency-Key, insert-before-call, outbound MMS (validate → Storage upload → `message_attachments` rows → 24h signed `media_urls`, §8), Telnyx send, status webhooks (`sent`/`finalized`), retry route (API-failure-only, §7), error_code surfacing (40300). ✅ Each gate returns its distinct error code; double-click sends once; an outbound photo round-trips to a test handset.
10. **Inbox UI.** Conversation list (filters, cursor pagination, unread via `conversation_reads`), thread view (embedded first page, MMS attachments rendered via `GET /v1/attachments/:id/url`), statuses new/open/waiting/closed + spam, assignment, notes, tags (create-on-attach), close/reopen, events timeline, **saved-replies picker in the composer** (inserts the template body; §5 footer/attestation rules still apply). Mobile-first responsive. ✅ Full triage loop works on a 375-px viewport; a saved reply can be picked, edited, and sent from the composer.
11. **Realtime.** Broadcast triggers live (all five §8 events, incl. `number.updated`/`registration.updated` onboarding states), client subscription to `company:{id}`, ID-only refetch handling, reconnect refetch, live status badges. ✅ Two browsers see each other's messages/status changes without refresh; provisioning → active renders without refresh; non-member cannot join the topic.
12. **Contacts + search.** Contacts CRUD (soft delete), CSV import (with `opted_out` column), `GET /v1/search` (FTS + trgm), inbox `q` filter. ✅ Partial phone and misspelled-name lookups hit.
13. **Compliance UX.** Consent attestation on outbound-first compose (`POST /v1/conversations`), quiet-hours confirm dialog + event, first-message footer + preview, manual opt-out/revoke actions + banners, opted-out composer lockout. ✅ Outbound-first without attestation is impossible; footer appears exactly once per contact.
14. **Metering + usage.** `message.finalized` → usage_events → meter events; re-reporter cron; `GET /v1/usage` + usage screen; 80%/100% alerts; overage cap enforcement + owner one-click raise. ✅ Duplicate finalized webhooks bill once; cap blocks at 3× with `usage_cap_reached`; Stripe test invoice shows correct overage.
15. **Notifications.** Resend email + Web Push (VAPID, service worker), debounce rules, audience resolution, per-user prefs. ✅ 3 rapid inbound messages → one notification; assignee-only routing works; toggles honored.
16. **Team management.** Invites (Supabase invite + `invites` table + accept flow), members list, role change, deactivate; seat limits at invite and acceptance. ✅ 4th Starter seat rejected at both points; deactivated member loses API + Realtime access.
17. **Billing lifecycle.** Portal session route, `change-plan` (upgrade prorate / downgrade block+schedule), dunning states (past_due blocks outbound, banners, emails), cancellation → suspend → grace emails → release cron (+ campaign deactivation), resubscribe-within-grace restore. ✅ State-machine suite covers every §9 table row; grace-expiry releases in Telnyx test.
18. **Hardening + observability.** Turnstile, WAF rules, rate limits (1 msg/s, 250 seg/hr), Sentry PII scrubbing verified with canary events, PostHog events (checkout_completed, first_outbound_sent, registration_*), `DELETE /v1/numbers/:id`. ✅ Redaction test proves no phone number reaches Sentry; pump simulation trips 429.
19. **Launch pass.** Full E2E: US sole-prop signup → pay → number → registration pending → CA send works → approve → US send; CA-only signup instant path; cancel → grace → release. Cost/limit review of live dashboards. ✅ Both golden paths recorded green in CI against test-mode vendors.

---

## 13. Out of scope / fast-follows (D11)

| Item | Rationale (one line) |
|---|---|
| Scheduled sends | Table-stakes at rivals but not activation-critical; clean add on the existing send pipeline. |
| Missed-call text-back | **Headline differentiator for v1.x** — requires Telnyx voice on the number; first fast-follow. |
| Broadcast / bulk messaging | Excluded deliberately — also a compliance decision (keeps the declared opt-in flow truthful). |
| Toll-free numbers | Local presence is the MVP value; TFV is equally slow (~5 business days), needs EIN/BRN for new submissions, and adds a second compliance pipeline — documented post-MVP option. |
| CAD pricing (`currency_options`) | USD-only at launch keeps one price book; fast-follow. |
| Native mobile apps | Mobile-first responsive web + Web Push covers the ICP in MVP. |
| Cloudflare Queues | `waitUntil` + `webhook_events` ledger + sweeper cron is sufficient at MVP scale. |

---

## 14. Cost model (verified numbers)

### Platform fixed costs (monthly)

| Item | Cost |
|---|---|
| Cloudflare Workers Paid (both Workers; 10M req + 30M CPU-ms incl.; static assets free) | $5.00 |
| Supabase Pro (never auto-paused; 8 GB disk, 100 GB storage, 250 GB egress, 500 Realtime conns, 5M Realtime msgs) | $25.00 |
| Resend / Sentry / PostHog (free tiers at MVP volume) | $0.00 |
| **Fixed total** | **~$30/mo** |

Plus Stripe percentages on revenue (below) and per-tenant Telnyx COGS.

### Per-tenant COGS — Starter, US company, typical month (500 outbound + 750 inbound segments)

| Line | Basis | Cost |
|---|---|---|
| Number rental + SMS capability | $1.00 + $0.10 | $1.10 |
| 10DLC campaign fee (Low Volume Mixed; $2 sole-prop) | absorbed per D5 | $1.50 |
| Outbound SMS | 500 × ($0.004 + ~$0.003–0.0045 passthrough) | $3.50–$4.25 |
| Inbound SMS (free to customer) | 750 × ($0.004 + $0.003 T-Mobile receive share ≈ $0.004–0.007 avg) | $3.00–$5.25 |
| Stripe payments 2.9% + $0.30 on $29 | | $1.14 |
| Stripe Billing 0.7% | | $0.20 |
| Stripe Tax 0.5% | | $0.15 |
| **Total COGS** | | **≈ $10.6–$13.6** |
| **Gross margin on $29** | | **≈ 53–63%** |

MMS shifts the mix ($0.015/part out + $0.005–0.01 carrier; $0.005/part in) — outbound MMS metering at 3 segments preserves margin. Canadian tenants: no campaign fee unless US texting enabled; CA carrier passthrough ~CAD $0.006–0.011/msg.

**Storage (D30):** attachment storage is a budgeted allowance, not a meter — Starter 5 GB / Pro
25 GB of note-borne attachments per company, enforced at upload (409 when full). Marginal cost on
Supabase Pro beyond the included 100 GB is ~$0.021/GB-month, so a maxed tenant costs ~$0.11
(Starter) / ~$0.53 (Pro) per month — inside plan margin. MMS media is bounded by metering (outbound,
3 segments) and per-message item caps (inbound, ≤10 items × ≤5 MB); it is never budget-blocked
(customer content). Per-company stored bytes for both arms surface on the usage page.

### Per-tenant COGS — Pro, heavy month (2,500 outbound + 3,000 inbound)

| Line | Cost |
|---|---|
| 2 numbers × $1.10 | $2.20 |
| Campaign fee | $1.50 |
| Outbound 2,500 × ~$0.008 | ~$20.00 |
| Inbound 3,000 × ~$0.0055 | ~$16.50 |
| Stripe (2.9%+$0.30 + 0.7% + 0.5% on $79) | ~$3.54 |
| **Total ≈ $43.7 → margin ≈ 45% on $79** | |

Overage pricing protects the tail: true cost ~$0.0075–0.0085/segment vs $0.025–0.03 billed.

### US registration one-time economics

$4.50 brand + $15 campaign vetting + $4.50 (3 months campaign fee billed upfront) ≈ **$24 day-one cost vs the $29 fee**; one $15 resubmission puts a single tenant ~$10 underwater — accepted and priced across the cohort (D5). Campaign deactivation at grace expiry (§11) stops the recurring fee for churned tenants.

---

*End of SPEC v2.*
