# JobText — Product Owner Decision Log

Binding decisions for SPEC v2 and the build. Each decision resolves findings from the
spec-review team (7 reviewers, 56 verified findings) and 5 web-verified research briefs
(mid-2026 facts). Where reviewers disagreed, the resolution below is final.

---

## D1. Hosting: Cloudflare Workers, not Pages

- Next.js app deploys to **Cloudflare Workers via `@opennextjs/cloudflare`** (OpenNext adapter,
  Node.js runtime). `next-on-pages` is deprecated/archived; Pages gets no new investment and
  cannot host Cron Triggers or Queue consumers.
- **Two Workers**: `apps/web` (OpenNext, UI only) and `apps/api` (Hono: `/v1/*` API,
  `/webhooks/*`, Cron Triggers). Webhook ingestion is isolated from frontend deploys.
- No route may declare `export const runtime = 'edge'`. No Next.js 15.2+ Node middleware.
- Workers Paid plan ($5/mo) assumed for cron CPU headroom.
- Production builds/deploys run on Linux CI (GitHub Actions); OpenNext does not guarantee
  Windows support locally.

## D2. Numbers & compliance: local numbers, per-company messaging profiles, registration state machine

- **Local numbers only in MVP** (local presence is core product value for this ICP;
  toll-free verification is equally slow (~5 business days), now requires EIN/BRN for new
  submissions, and adds a second compliance pipeline). Toll-free is a documented post-MVP option.
- **One Telnyx messaging profile per company**, created during provisioning, stored on
  `companies.telnyx_messaging_profile_id`. Numbers are ordered via
  `GET /v2/available_phone_numbers` → `POST /v2/number_orders` passing `messaging_profile_id`
  (webhook auto-attach) and `customer_reference = company_id`. This isolates opt-out lists,
  throughput, and reputation per tenant (Telnyx opt-out blocks are profile-scoped).
- Profile geo-permissions: **US + Canada only** (SMS-pumping defense, layer 1).
- **Registration state machine** (`messaging_registrations` table: brand + campaign rows,
  statuses draft → submitted → pending → approved/rejected):
  - Onboarding wizard collects brand data (legal name, EIN or no-EIN → **Sole Proprietor path**
    with last-4 SSN/SIN + OTP, address, website, opt-in flow description). Auto-submit via
    Telnyx API immediately after payment. No manual steps.
  - US-bound outbound is **blocked until campaign approval** (carriers hard-block unregistered
    10DLC since Feb 2025; approval 3–7+ business days). Canada-bound outbound from Canadian
    companies works **immediately** (no 10DLC for CA→CA; CASL rules apply instead).
    Gating is **per destination country**, not all-or-nothing.
  - Inbound works immediately for everyone. UI shows "US texting activates in ~3–7 business
    days" banner; the expectation is also stated **at checkout, before payment**.
  - Campaign approval/rejection tracked via Telnyx webhook + daily cron poll fallback;
    approval triggers a Resend email.
  - On cancellation, the Telnyx campaign is **deactivated** (stops recurring fees for churned
    customers).

## D3. Opt-out compliance (STOP/HELP)

- Keep Telnyx's default keyword auto-handling **enabled** (auto-reply + profile-level block;
  do NOT send a duplicate app auto-reply).
- **Mirror app-side**: `opt_outs` table (`company_id`, `phone_e164`, `source`:
  `stop_keyword | manual | import`, `created_at`, `revoked_at`, UNIQUE(company, phone)).
  Inbound webhook records STOP/START keywords (Telnyx marks them; also match the standard
  keyword list). START/UNSTOP revokes.
- **Manual "mark opted out"** staff action (FCC 2025 rule: honor *any reasonable* revocation
  phrasing, e.g. "please stop texting me" — Telnyx only catches exact standalone keywords).
  Manual opt-out also pushes a block to Telnyx via API where supported.
- `POST /v1/messages/send` **hard-rejects** sends to opted-out numbers (error code
  `recipient_opted_out`); conversation shows an "Opted out" banner and disables the composer;
  `messages.error_code` captures Telnyx 40300 so blocked sends are never silent.
- Opt-out/opt-in changes are logged to `conversation_events`.

## D4. Consent, quiet hours, first-message identification

- Replying within an existing inbound conversation: unrestricted.
- **Starting a new outbound conversation requires a consent attestation** (one checkbox:
  "This customer asked us to text them") → writes `consent_source`, `consent_at`,
  `consent_attested_by` on the contact + event log. This makes the declared 10DLC opt-in
  flow truthful. Bulk compose / import-and-blast / broadcast are **explicitly out of scope**.
- **Quiet hours (soft)**: composing a *new* outbound conversation between 8pm–8am destination
  local time (inferred from area code) shows a confirm dialog; confirmed sends are logged.
  Replies are exempt. No hard block.
- **First outbound-first message to a contact** auto-appends: `— {Business name}. Reply STOP
  to opt out` (CASL identification + CTIA). Replies to inbound are not decorated.
- Signup requires accepting an acceptable-use policy (no SHAFT content, no purchased lists).

## D5. Pricing & packaging

- **Starter $29/mo**: 3 users, 1 number, 500 outbound segments included, $0.03/extra segment.
- **Pro $79/mo**: 10 users, 2 numbers, 2,500 outbound segments included, $0.025/extra segment.
- Positioning: flat team pricing ("one price for your whole crew") vs per-seat rivals
  (Quo $19/user, Heymarket $49/user). No per-seat add-ons in MVP; upgrade is the path.
- **Inbound is free and unmetered** (market table-stakes; COGS ~0.7¢/segment absorbed).
  Only outbound segments count against the quota. Outbound MMS meters as **3 segments**;
  inbound MMS free.
- **US registration fee: $29 one-time** (covers $4.50 brand + $15 vetting + resubmission risk).
  Recurring 10DLC campaign fees ($1.50–$2/mo low-volume/sole-prop) are **absorbed into plan
  pricing** — no visible monthly compliance line item.
- **Overage cap**: default 3× included quota, owner-adjustable (raise/remove). At cap, sends
  return `usage_cap_reached`; owner gets a one-click raise. Email alerts at 80% and 100% of
  included quota. (Resolves the "never hard-block" vs "cap" dispute: cap with owner control.)
- **USD-only at launch** (CAD prices via `currency_options` is a fast-follow).
- Stripe Tax enabled from day one (SaaS product tax code, automatic_tax on Checkout +
  subscription). GST/HST registration is an operational runbook item (CAD $30k threshold).
- Unit economics must account for: $0.004/part + ~$0.003–0.0045 carrier passthrough,
  $1.10/mo per number ($1 + $0.10 SMS capability), campaign fees, Stripe 2.9%+$0.30,
  Stripe Billing 0.7%, Stripe Tax 0.5%.

## D6. Billing mechanics (Stripe)

- **Company-first ordering**: signup (Supabase Auth) → `POST /v1/companies` (creates company,
  `subscription_status='incomplete'`) → `POST /v1/billing/checkout` (subscription-mode
  Checkout Session, `client_reference_id=company_id`; line items: licensed flat price +
  metered graduated price (no quantity) + one-time $29 US fee when applicable) →
  **`checkout.session.completed` webhook (with `payment_status=='paid'`) is the only trigger
  for provisioning**. Never provision from the redirect page.
- **Billing Meters API** (legacy usage records were removed in Stripe API 2025-03-31.basil;
  Metronome is for enterprise complexity — not us). One meter `sms_segments`; plans are
  licensed flat price + metered graduated price (tier 1: 0–500/2,500 at $0; tier 2: $0.03 /
  `unit_amount_decimal` 2.5).
- **Meter events fire on Telnyx `message.finalized`** (authoritative `parts` + encoding;
  GSM-7 vs UCS-2 changes segment count), `identifier = telnyx_message_id` (accidental-retry
  safeguard), value = parts (×3 for MMS). Local `usage_events` rows (with `stripe_reported_at`
  stamp) are the app-side source of truth for the usage dashboard; a cron re-reports
  unreported rows.
- **Webhook events handled**: `checkout.session.completed`, `customer.subscription.created/
  updated/deleted`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`.
  Handlers treat events as triggers and re-fetch subscription state from the Stripe API
  (out-of-order guard). `companies.subscription_status` mirrors Stripe statuses.
- **Dunning**: Stripe Smart Retries (default 8 retries / 2 weeks), post-exhaustion = cancel.
  `past_due` → outbound blocked (402 `subscription_inactive`); inbound + dashboard stay live.
- **Cancellation**: `canceled` → numbers `suspended` (inbound still stored) → **30-day grace**
  → daily cron releases the Telnyx number + deactivates the campaign. Warning emails at
  day 1, 15, 27. Resubscribing within grace restores the same number. (Telnyx's ~15-day
  repurchase window is a safety net, not the mechanism.)
- **Plan changes in-app** (`POST /v1/billing/change-plan`): the hosted portal cannot switch
  plans on multi-item usage-based subscriptions. Upgrades prorate immediately
  (`always_invoice`); downgrades apply at period end and are blocked until extra numbers are
  released and members deactivated (never auto-release a number). Portal handles payment
  methods, invoices, cancellation only.

## D7. Data model decisions

- **Conversation statuses**: `new | open | waiting | closed` + `is_spam boolean`.
  Pipeline stages ship as **pre-seeded conversation tags** ("Quote sent", "Scheduled",
  "Won", "Lost"). "Message-level labels" is renamed **conversation tags**. `closed_at` is
  set/cleared by close/reopen transitions.
- **Threading rule** (inbound message from phone P to number N of company C):
  1. Upsert contact on UNIQUE(company_id, phone_e164).
  2. If a conversation with `closed_at IS NULL` exists for (C, N, contact) → append.
     If its status is `waiting` → flip to `open`. (Partial unique index enforces at most
     one open conversation per (company, number, contact).)
  3. Else if the most recent closed conversation is `is_spam` → append to it silently
     (stays closed, stays spam).
  4. Else if closed within 30 days → reopen it (`closed_at=NULL`, status `new`).
  5. Else create a new conversation (status `new`).
  All under idempotency: partial unique index on `messages.telnyx_message_id`.
- **Notes are `messages` rows** with `direction='note'` (they thread, search, and paginate
  for free). `conversation_events` is the audit timeline for status/assign/tag/opt-out
  changes only.
- **Unread state**: `conversation_reads` (conversation_id, user_id, last_read_at, PK both).
- **MMS both directions in MVP**: `message_attachments` table; inbound media downloaded
  idempotently in the webhook path (Telnyx URLs expire after 30 days — but download
  immediately) into a private Supabase Storage bucket keyed by company; served via
  short-lived signed URLs generated by the API.
- **Constraints** (all confirmed by verification, with corrections applied):
  contacts UNIQUE(company_id, phone_e164); tags unique index (company_id, lower(name));
  conversation_tags PK(conversation_id, tag_id); company_members UNIQUE(company_id, user_id);
  phone_numbers partial UNIQUE(number_e164) WHERE status != 'released';
  messages partial UNIQUE(telnyx_message_id) WHERE NOT NULL;
  messages UNIQUE(company_id, idempotency_key) WHERE NOT NULL;
  usage_events partial UNIQUE(message_id) (nullable for non-message rows);
  conversations partial UNIQUE(company_id, phone_number_id, contact_id) WHERE closed_at IS NULL;
  webhook_events PK(provider, event_id).
- **FKs declared explicitly, ON DELETE RESTRICT** default. Contacts/companies soft-delete
  (`deleted_at`); companies never hard-deleted; messages/usage_events/opt_outs append-only;
  phone_numbers rows retained forever (status `released`).
- `updated_at` on all mutable tables (moddatetime trigger). `profiles` table (user_id PK →
  auth.users, display_name) synced by trigger.
- Money: customer-facing amounts in integer cents; **COGS in `numeric` dollars**
  (per-segment costs are fractions of a cent — `cost_cents int` cannot represent them).
- **Search in Postgres**: generated tsvector + GIN on messages.body; pg_trgm GIN on
  contacts.name / phone_e164. No external search service.
- **Indexes**: conversations(company_id, status, last_message_at DESC);
  messages(conversation_id, created_at); conversation_events(conversation_id, created_at);
  partial conversations(assigned_user_id) WHERE closed_at IS NULL; plus the uniques above.

## D8. Security architecture

- **Auth boundary**: browser handles signup/login/reset/invite-accept **directly against
  Supabase Auth** (`@supabase/ssr`); there is no Worker auth route. Every API request carries
  `Authorization: Bearer <Supabase access token>`, verified **locally in the Worker** via
  JWKS (ES256 asymmetric keys — enable at project setup; verify `iss`, `aud`, `exp`).
  Caller's company derived server-side: `X-Company-Id` header validated against
  `company_members` for the verified `sub`.
- **RLS posture**: deny-by-default RLS enabled on every table; **no anon/authenticated
  grants on data tables** (browser never reads PostgREST directly). The Worker uses the
  `sb_secret_` key (not legacy service_role JWT). Browser talks to Supabase only for Auth
  and Realtime. `realtime.messages` RLS policy authorizes private Broadcast topics
  `company:{id}` by membership.
- **Webhook security**: Telnyx — Ed25519 over `{timestamp}|{payload}` from
  `telnyx-signature-ed25519` + `telnyx-timestamp` headers (WebCrypto; 5-min tolerance).
  Stripe — `stripe.webhooks.constructEventAsync` with `createSubtleCryptoProvider()`
  (sync variant fails on Workers). Pattern: **verify → insert `webhook_events` row
  (PK conflict → ack 200 and stop) → ack 200 within 2s → process in `ctx.waitUntil` →
  cron sweeps unprocessed events** (durability without Queues).
- **SMS-pumping defense (layered)**: Telnyx profile geo-permissions US/CA; Worker-side
  destination validation of **US/CA area codes specifically** (NANP includes ~20 Caribbean
  countries billed at international rates — `+1` alone is not a check); per-company rate
  limit (1 msg/s, 250 segments/hr) via Workers rate-limiting binding backed by a DB counter;
  overage cap (D5).
- **Provisioning route**: initial number provisioning is webhook-driven only.
  `POST /v1/numbers/provision` (Pro's 2nd number) is owner/admin-only, requires active
  subscription, atomic count-vs-plan-allowance check, per-request idempotency key.
- **Role matrix**: billing, numbers, member management, company settings = owner/admin.
  Conversations/messages/notes/tags/contacts = any member. Owner role is not assignable
  via invite.
- **Invites**: Supabase Auth `inviteUserByEmail` (Resend as custom SMTP) + app `invites`
  table binding company/email/role, seat limit enforced at invite creation *and* acceptance;
  member remove/role-change routes included.
- **Secrets**: all server credentials are Worker encrypted secrets (wrangler), injected from
  GitHub Actions environment secrets. Frontend gets only `NEXT_PUBLIC_SUPABASE_URL` +
  publishable key. Stripe uses a restricted key. Startup-time env validation (zod) fails
  loudly on missing config.
- **PII policy**: message bodies, names, addresses, phone numbers never reach Sentry or
  PostHog. Sentry `beforeSend` redacts E.164 patterns + payloads; PostHog captures UUIDs,
  counts, and feature events only, autocapture masked. Logs reference IDs, never bodies.

## D9. Realtime & notifications

- **Supabase Realtime Broadcast-from-Database** (NOT `postgres_changes` — single-threaded,
  per-client RLS reads): Postgres triggers call `realtime.broadcast_changes()` on
  messages INSERT and conversations UPDATE into private topic `company:{company_id}`.
  Payloads carry **IDs only**; clients refetch via API (authorization stays in one place).
  Events: `message.created {conversation_id, message_id, direction}`,
  `conversation.updated {conversation_id}`, `message.status {message_id, status}`.
  Clients refetch page 1 on reconnect.
- **Send lifecycle**: API inserts message row `status='queued'` (that insert IS the
  optimistic UI via Broadcast) → calls Telnyx → stores `telnyx_message_id` → status webhook
  updates by telnyx_message_id → `sent`/`delivered`/`failed` badges push live.
  Telnyx API failure → row marked `failed` + retry affordance.
- **Notifications**: email (Resend) + **Web Push (VAPID, service worker)** in MVP.
  Trigger: new/reopened conversation, or first inbound after 15 min of thread inactivity
  (debounced — never one email per message). Audience: assignee, or all members if
  unassigned. Per-user toggles (email/push) in `notification_prefs`. Responsive
  mobile-first UI is an explicit MVP requirement; native apps are out of scope.

## D10. API conventions

- Prefix `/v1` (webhooks unversioned at `/webhooks/*`). Single resources: bare JSON, 200/201.
  Lists: `{ data, next_cursor }`, cursor-based (conversations keyed on
  (last_message_at, id) DESC — clients dedupe by id; messages on (created_at, id) DESC,
  default 50/max 100; conversations default 25).
- Errors: `{ error: { code, message } }`; codes include `subscription_inactive` (402),
  `usage_cap_reached`, `recipient_opted_out`, `registration_pending`, `validation_failed`,
  `not_found`, `conflict`, `rate_limited`.
- `POST /v1/messages/send` requires an `Idempotency-Key` header; row inserted **before**
  the Telnyx call; concurrent duplicate returns the existing row.
- Single Telnyx webhook route `POST /webhooks/telnyx` dispatching on `data.event_type`
  (one URL per messaging profile is the delivery model).
- `GET /v1/conversations/:id` embeds the first page of messages.
- Full surface additionally includes: contacts CRUD + CSV import, tags (list, create-on-attach,
  detach, delete), members + invites, search, usage, templates (saved replies), notification
  prefs, push subscriptions, conversation events timeline, opt-out mark/revoke,
  billing (checkout, portal, change-plan), numbers, registration status, `GET /me`.

## D11. MVP scope changes vs draft

**Added** (all confirmed table-stakes or legally required): opt-out handling; registration
state machine; MMS (both directions); saved replies; CSV contact import; email + web push
notifications; team invites/management; usage alerts + caps; consent attestation;
audit timeline; realtime inbox; search (FTS); dunning + grace-period release automation.
**Renamed**: message-level labels → conversation tags.
**Explicitly out of scope for MVP** (named fast-follows): scheduled sends, missed-call
text-back (headline differentiator for v1.x), broadcast/bulk messaging (excluded
deliberately, also for compliance), toll-free numbers, CAD pricing, native mobile apps,
Cloudflare Queues (waitUntil + ledger + cron is sufficient at MVP scale).

## D12. Goals

- **ICP**: US/Canada home-service businesses (plumbing, landscaping, cleaning, HVAC, salons)
  with 1–10 field staff currently texting customers from a personal cell.
- **Activation**: company sends its first outbound SMS *and* receives an inbound reply
  within 7 days of payment. Target: 60% of paying signups activated in week 1;
  week-4 logo retention ≥ 85%.
- **North-star onboarding metric**: time from payment to first outbound send (10DLC wait
  is the main threat — instrument it in PostHog).

## D13. Repo & delivery

- pnpm monorepo: `apps/web` (Next.js 15 + Tailwind + shadcn/ui), `apps/api` (Hono Worker,
  TypeScript), `packages/shared` (zod schemas, types, constants shared by web+api),
  `supabase/` (migrations + config), `.github/workflows` (CI: typecheck, lint, tests,
  build; deploy via wrangler on main).
- Tests: vitest. Unit tests exercise real product code with only the network edge stubbed
  (Telnyx/Stripe HTTP via fetch mocks in test code only); integration tests run against
  local Supabase in CI. Webhook signature verification, threading, quota, opt-out
  enforcement, and the Stripe state machine all have dedicated suites.
- Sentry: `@sentry/cloudflare` in both Workers + Next.js client, with the D8 PII scrubbing.
- No mocks, stubs, simulations, or hardcoded values in product code paths. All config via
  validated env bindings.
