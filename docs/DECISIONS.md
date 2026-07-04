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

## D14. Message-level done state (user decision 2026-07-01, supersedes the v1.1 "jobs" idea)

- Any message in a thread can be marked **Done / Not done** by any member. No job entity,
  no separate screen — the message itself is the task.
- Schema: `messages.done_at timestamptz NULL`, `messages.done_by_user_id uuid NULL`
  (FK profiles, ON DELETE RESTRICT). New migration; never edit existing ones.
- API: `PATCH /v1/messages/:id` body `{ done: boolean }` (any member; 404 outside company;
  idempotent — marking done twice is a no-op returning the row). Emits the realtime
  `message.status` broadcast so all open clients update.
- UI (amends DESIGN.md G5): desktop — a quiet circle-check affordance appears on message
  hover (right edge of the bubble, `stone-400`, petrol on hover); mobile — always-visible
  subtle circle on the bubble's action row. Marking done: the message text gets
  `line-through` + 55% opacity and a small petrol check badge with a tooltip
  ("Done · Sam · 2:14 PM"). Clicking again clears it. Applies to inbound, outbound, and
  notes alike. 150ms transition; aria-pressed toggle button, screen-reader label
  "Mark done"/"Mark not done".
- No filters, counts, or reports in MVP — strikethrough + sync is the whole feature.
  (Revisit counts-per-conversation only if usage shows demand.)

## D15. Timezones & preferences (user note 2026-07-01)

- All in-app timestamps render in the **viewer's browser timezone** (correct default);
  hovering a timestamp shows the absolute datetime including zone abbreviation.
- `companies.timezone` (IANA, NOT NULL with default 'America/Toronto' for safe migration,
  set from the creating browser at onboarding, editable in Settings → Workspace). Used for
  business-facing daily framing (grace/usage email send windows) — quiet hours remain
  **destination**-local per D4, unchanged.
- Per-user preferences surface = what exists: display name, theme (System/Light/Dark),
  notification toggles (email/push). No per-user timezone override in MVP.

## D16. Number porting / transfers (port-in) — bring your existing number

**Supersedes the D15-era "porting is a fast-follow / forward-your-number workaround" posture.**
Number transfer (port-in) is now a **shipped MVP capability**: a business can bring its existing
US or Canadian number to JobText instead of getting a new one. This is the honest answer to the
top-3 buyer objection ("can I keep the number on my trucks and my Google listing?") — a real port,
not carrier call-forwarding. The full build spec is `docs/PORTING.md`; the binding product calls:

- **Offered at signup AND post-signup.** Onboarding gets a **"New number vs. Bring my number"**
  fork (§4.1). An existing paying company can also start a port later from Settings → Numbers
  (`POST /v1/port-requests`). Pro's second number may be a port. Sole-prop companies keep their
  1-number cap (a port counts as the one number).

- **Paid-first is preserved, unchanged in principle. Pay first, then port.** The port order is
  **created by the same `checkout.session.completed` webhook** that today starts the provisioning
  saga — it is a *parallel branch of that trigger*, never a pre-payment action. No Telnyx porting
  order, no LOA upload, no portability commitment happens before `payment_status=='paid'`. A phone
  number row exists only after payment (D6/§1 rule 1 holds); for a port the row is created with
  `source='ported'`, `status='provisioning'`, and its own porting sub-status. The portability
  **check** (read-only, free, no commitment) is the one Telnyx call allowed pre-payment, so the
  wizard can tell the customer "yes this number can move" before they pay — but the actual port
  order is post-payment only. **Create-draft-then-complete:** the paid webhook's saga **creates the
  Telnyx porting order as a `draft`** (reusing the messaging profile + collected data) but does **NOT
  auto-confirm** it. Confirmation is a **distinct post-payment step hard-gated on the LOA + invoice
  being attached** (`telnyx_loa_document_id` AND `telnyx_invoice_document_id`) — the customer (now on
  an active subscription) uploads both via `PUT /:id/documents`, then `POST /:id/submit` confirms; the
  submit/resubmit path returns the existing `conflict` code if either document is missing. This is
  honest paid-first AND honest that a port inherently takes days: we never confirm an order the carrier
  would reject for having no documents.

- **The port window is handled honestly, and we DO NOT auto-provision a bridge number.**
  A port takes days to weeks; the number stays live on the **old carrier** until the FOC
  (Firm Order Commitment) cutover date, and **JobText inbound/outbound on that number only works
  after the messaging port completes** (voice `ported` → messaging `ported`, separate step). We set
  this expectation loudly at checkout and render the live port state in-app (state machine below).
  We **do not silently buy a temporary JobText number** during the port (it would confuse the ICP —
  two numbers, unclear which to give customers — and undercut the whole "keep your number" promise).
  Instead we offer an **explicit, opt-in "tide-me-over number"** the owner can choose in the port
  wizard: a checkbox "Give me a temporary JobText number to text from while my number transfers"
  → provisions a normal new number via the existing saga, which the owner later releases (or keeps,
  paying for a 2nd number on Pro) after the port completes. Default is **off** — most customers
  simply wait for the FOC date, which the copy makes safe and predictable. This keeps the default
  path clean and honest while giving the impatient an out.

- **A ported number gets the per-company messaging profile and 10DLC exactly like a purchased
  number — reusing D2's machinery, not a parallel one.** The port order carries
  `phone_number_configuration.messaging_profile_id = companies.telnyx_messaging_profile_id`
  (the S1 profile, created up-front by the port saga just like provisioning), and messaging is
  explicitly enabled on the port (`messaging.enable_messaging=true`). **10DLC brand + campaign are
  submitted at payment time exactly as today (§4.4), so the campaign is APPROVED before the number
  cuts over** — the D2 sequencing requirement for ports. When the messaging port reaches `ported`,
  the number is assigned to the (already-approved) campaign via the identical R3 call
  (`POST /v2/10dlc/phoneNumberCampaign`). No new registration state machine — the port state machine
  drives *number readiness*, the existing registration state machine drives *US-send eligibility*.
  These are enforced by **two independent, differently-scoped checks in the send path, not a single fused
  gate** (PORTING.md §7): number readiness is **per-number** (`phone_numbers.status='active'`, which the
  send path checks first — a still-porting number is rejected with the existing `conflict` "not ready to
  send," *never* `registration_pending`), and US-eligibility is **per-company** (`getSendGates().usApproved`
  on the company's campaign row, unaware of which number sends). Only after messaging ports and P6 flips
  the number to `active` does a US-bound send reach the per-company registration gate. Net: a ported US
  number is non-sendable until `active`, then governed by campaign `approved` exactly like a new number.

- **Port-in fee: absorbed, no line item.** Telnyx charges **$0 per port for US and Canada**
  (verified). There is therefore no pass-through and no Stripe line item for the port itself. The
  **US $29 registration fee still applies** on the same terms as today (US company, or CA company
  enabling US texting, once per company) — a ported US number needs a brand+campaign just like a new
  one. Port customers pay the same plan price as new-number customers; porting is a $0-COGS feature
  that removes the biggest adoption objection.

- **US + Canada scope only** — matches D2's US/CA-only geo-permissions and the ICP. Local numbers
  and toll-free numbers are both portable at Telnyx, but **MVP ports LOCAL numbers only** (D2 keeps
  toll-free out of MVP; toll-free porting is a separate RespOrg process and stays a documented
  post-MVP option). A portability check that returns a toll-free or non-US/CA number is rejected in
  the wizard with a plain-language message.

- **Rejections are a normal, recoverable state — fix-and-resubmit, mirroring the registration
  rejection UX.** Losing-carrier rejections (account-number mismatch, illegible LOA, name/address
  mismatch, PIN wrong) surface as a port `exception` with a human-readable reason; the owner edits
  the port data / re-uploads the LOA or invoice in the same wizard and resubmits
  (`POST /v1/port-requests/:id/resubmit`), incrementing an attempt counter. Telnyx port-in is **free
  and re-submittable**, so there is no per-attempt cost to the customer or to us. The daily port
  reconciliation cron is the authoritative fallback for missed webhooks, exactly like the
  registration poller.

- **Marketing copy flips from workaround to real porting.** The forwarding-workaround answer
  (`docs/marketing/COPY.md` §H12 Q "can I keep my number", and the BLUEPRINT.md FAQ note that
  frames it as call-forwarding) is **replaced** with the honest porting story: "Yes — bring your
  number. It keeps working on your old carrier while it transfers (usually a few days to two weeks
  for US, faster in Canada), and moves to JobText on the switch-over date. We'll tell you exactly
  where it is the whole way." The business-number feature page and the compare pages gain a real
  **"Bring your number"** capability line (replacing any "new number only" / "porting coming soon"
  framing). The honesty rule is kept: we state the multi-day/week window and the old-carrier-until-
  FOC reality plainly — no "instant port" claim, no hidden gotcha. Porting moves from the "not yet"
  list to a shipped feature; the "why US takes about a week" and "30-day number grace" answers are
  unaffected.

- **Consistency with D1–D15:** no always-on servers (port polling + reconciliation are Cron
  Triggers, §11); webhook-driven with a cron fallback (like every other async path); one messaging
  profile per company (D2, reused); paid-first (D6/§1, preserved); the send gate stays per-destination
  and, for a ported US number, layers number-readiness (per-number `status='active'`) ahead of the
  existing per-company registration gate as two independent checks (above; D2). No change to pricing (D5)
  beyond the $0 port fee. No change to the schema conventions (D7) — the new `port_requests` table follows
  the same FK/RLS/append-friendly rules, and `phone_numbers` gains only a `source` and a nullable
  `porting_status` mirror.

- **Verified Telnyx port-in facts (re-checked 2026-07 against the Telnyx API reference, porting
  quickstart, messaging-porting docs, and port-in-events docs) — these pin PORTING.md and correct earlier
  hedges:**
  - **Webhook wiring is one line in the shared dispatcher, not the route.** The `/webhooks/telnyx` route
    hands every event to `dispatchTelnyxEvent` (`apps/api/src/messaging/dispatch.ts`), shared by the live
    path and the webhook sweeper; the port branch
    (`if (eventType.startsWith('porting_order.')) return handlePortingEvent(...)`) goes there, which also
    covers sweeper replay. `porting_order.*` events are the only driver of FOC confirmation, P6 messaging
    completion, exceptions, and cancellation.
  - **Confirmed FOC = `activation_settings.foc_datetime_actual`, read via `GET /v2/porting_orders/{id}`.**
    The `porting_order.status_changed` webhook body carries only
    `{ id, customer_reference, status:{value,details}, support_key, updated_at, webhook_url }` — no
    `activation_settings` — so the confirmed date is fetched on the `foc-date-confirmed` transition, not
    read from the webhook. (`foc_datetime_requested` is the value we send.)
  - **Portability check is the top-level `POST /v2/portability_checks`** (body `{phone_numbers:[...]}`) —
    confirmed; it is NOT nested under `/v2/porting/`.
  - **LOA + invoice attach via the porting-order PATCH `documents:{loa,invoice}` UUID object** (the
    quickstart shows exactly this on `PATCH /v2/porting_orders/{id}`); `/v2/porting_orders/{id}/
    additional_documents` is a separate endpoint for extra documents later, not the primary attach.
  - **Messaging enablement (`messaging.enable_messaging=true` + `messaging_profile_id`) is settable only in
    `draft`/`in-process`/`exception`, and is re-sent on every resubmit PATCH** (a rejection can drop the
    messaging sub-order; exception is in-window) — never assumed to persist across a rejection.
  - **A messaging exception (`messaging_port_status='exception'`) is auto-handled by Telnyx** (Messaging
    Ops escalates the losing carrier's NetNumber-ID release; "you don't need to contact your previous
    provider yourself"; most US/CA local exceptions clear in ~1–2 business days). So the "nothing you need
    to do" customer copy is correct — this is distinct from a **10DLC assignment `FAILED`**
    (`10dlc.phone_number.update`), which IS customer-actionable (ask the old provider to remove the number
    from its carrier campaign). But a messaging exception can gate texting for days, and the flip to
    `ported` may arrive only via a webhook that can be missed, so the daily reconcile cron re-GETs
    exception-stuck orders and runs P6 on the reconciled `→ ported` transition. Relatedly, the orphan scan
    in `reconcileNumbers` must exclude numbers matching an open (`status <> 'cancelled'`)
    `port_requests.phone_e164`, or every voice-ported-but-messaging-pending number falsely pages the
    operator for the 1–2-day window.

---

## D17. Tasks — message-done stays trivial; promotion to a first-class Task is optional (user decision 2026-07-02)

D14 stands unchanged as the floor: **any** message can be marked Done/Not-done by any member with
zero ceremony (strikethrough + audit tooltip), no task entity required. D17 adds an **opt-in** layer
on top — it never replaces D14's one-tap done.

- **Promotion, not a parallel system.** A member may **promote a message to a Task** (thread overflow
  menu → "Make a task"). A Task is a lightweight record that *points at* the source message; the
  message's existing `done_at` remains the **single shared truth** for completion. There is no second
  done-state to keep in sync — the Task reads/writes the same `messages.done_at`.
- **Bidirectional done-sync falls out of the shared-truth design, it is not bespoke plumbing.**
  Checking the task's box calls the **same** `PATCH /v1/messages/:id {done}` (D14) on the source
  message; marking the source message done in-thread flips the task's rendered state because both read
  `messages.done_at`. One write path, one broadcast (`message.status`), both surfaces update live. This
  is deliberately the lowest-upkeep shape — a Task adds *metadata* (assignee, due, notes, attachments),
  never a competing completion flag.
- **Schema (new migration, never edit existing):** `tasks` (`id`, `company_id`, `message_id` FK →
  messages **NOT NULL** ON DELETE RESTRICT, `conversation_id` denormalized for cheap listing, `title`
  text — seeded from the message body, editable, `assigned_user_id` uuid NULL FK profiles, `due_at`
  timestamptz NULL, `created_by_user_id`, `created_at`, `updated_at`, soft-delete `deleted_at`). **No
  `status`/`done`/`done_at`/`done_by` column and no `task_status` enum** — completion is derived from
  the joined `messages.done_at` (avoids the exact dual-source-of-truth bug D17 is designed to prevent).
  `status` in the UI = a derived label: `open` when `done_at IS NULL`, `done` otherwise. UNIQUE(message_id)
  WHERE deleted_at IS NULL (one live task per message). Index `tasks(company_id, assigned_user_id) WHERE
  deleted_at IS NULL` and `tasks(company_id, due_at) WHERE deleted_at IS NULL`. Full build spec (table,
  RLS, indexes, functions) in `docs/TASKS.md` T1.
- **`message_id` is NOT NULL — every task promotes a real message; standalone (message-less) tasks are
  OUT of MVP.** Because completion *derives* from `messages.done_at`, a task with no message would have
  no completion source. Keeping `message_id` NOT NULL means completion is *always* derivable with zero
  branching, and holds the calm discipline that a task is a pointer to a real customer message, not a
  free-floating to-do. A task-owned `done_at` for null-message tasks (Option B) is a **deferred D17
  amendment**, not something the build spec adds silently (see `docs/TASKS.md` T0.1 / T9).
- **Surfaces:** (1) **in-conversation** — promoted tasks render as a checklist in the toggled contact/
  overview panel (checkbox = done state); (2) **dedicated `/tasks` page** — full-height list reusing the
  inbox's own segmented status tabs (Open | Mine | All | Done) + `+ Filter` chips (assignee/due), each row
  linking to its source message **and** conversation. `/tasks` is one-petrol-element (the primary action);
  everything else stone — not a Linear-style dense dashboard (APP-UI-ELEVATION §6).
- **Task attachments** go to Supabase Storage on the **same generic `attachments` table + bucket** as note
  attachments (D19), scoped by `owner_type='task'`. No new storage machinery.
- **Auditability:** promote / assign / set-due / delete emit `conversation_events` rows on the source
  conversation (D22), so a task's lifecycle is visible in the same timeline as everything else. Done/undone
  is audited **once** via D22 on the underlying message (`message_done`/`message_undone`) — the task
  inherits it for free; there is **no** separate `task_completed`/`task_reopened` event (it would
  double-log the same fact). The canonical `conversation_event_type` additions live in **one place** —
  `docs/TASKS.md` T8 — and every doc cites that list rather than restating a divergent one.
- **Realtime (refines "no new channel"):** **done rides the existing `message.status` broadcast** —
  checking a task calls `PATCH /v1/messages/:id {done}`, so no new channel is needed for completion
  (D9). Task **metadata** changes (create / assign / set-due / soft-delete) have **no** message write,
  so they need their own minimal signal or `/tasks` + the checklist go stale until refetch. The
  lowest-upkeep D9-consistent fix is a **single ID-only `task.changed {conversation_id}`** broadcast on
  `company:{id}` (the existing membership-authorized topic — no new RLS policy), **not** a
  `task.created/updated/deleted` trio and **not** a done signal. Spec in `docs/TASKS.md` T1.3.
- **Consistency:** honors D14 (message-is-the-task floor), D7 (FK/RLS/soft-delete conventions, derived
  state over duplicated state), D8 (Worker-mediated, membership-scoped), D9 (reuses the `message.status`
  broadcast for done; a minimal ID-only `task.changed` for metadata). API: `POST /v1/tasks {message_id}`
  (message_id **required** — promote only), `PATCH /v1/tasks/:id {title?, assigned_user_id?, due_at?}`
  (**metadata only — no `done` field**), `DELETE /v1/tasks/:id` (soft-delete), `GET /v1/tasks` (cursor
  list, filters), `GET /v1/conversations/:id/tasks`. Toggling done stays on `PATCH /v1/messages/:id` —
  tasks never own it, and there is **no** `PATCH /v1/tasks/:id {done}` route.

## D18. Auth — Google + Apple SSO, and email/password change in settings

**Decision:** add Google and Apple as Supabase Auth OAuth providers alongside the existing email/password,
and ship self-service email + password change in Settings. Keep the D8 auth boundary intact: the **browser**
talks to Supabase Auth directly (`@supabase/ssr`), the Worker never brokers login.

- **Provider setup (config, not code):** Google via a Google Cloud OAuth 2.0 Web client (authorized
  redirect URI = the Supabase project's `…/auth/v1/callback`); Apple via an Apple **Services ID** (the
  OAuth client), a Sign-in-with-Apple **Key**, and the **Team ID** — registered in the Supabase dashboard
  Apple provider (Client IDs = the Services ID; Apple's client secret is a short-lived JWT Supabase mints
  from the key). Both providers list JobText's production + preview origins in the Auth **redirect allow
  list**. No secrets ship to the browser (D8): the frontend still only gets `NEXT_PUBLIC_SUPABASE_URL` +
  publishable key.
- **PKCE flow with a server callback route (required for `@supabase/ssr`):** the "Continue with Google/
  Apple" buttons call `supabase.auth.signInWithOAuth({ provider, options:{ redirectTo:
  '<origin>/auth/callback?next=…' } })`. The provider redirects back to a Next.js **Route Handler**
  `GET /auth/callback` that runs `exchangeCodeForSession(code)` via a `createServerClient` bound to the
  request/response cookies, then redirects to `next` (default `/inbox`). This is a **web-app UI route on
  `apps/web`**, not a Worker/API auth route — it is the one and only OAuth server touchpoint and does not
  violate "no Worker auth route" (D8).
- **OAuth → company-link flow (the real integration work).** Supabase creates the `auth.users` row; the
  `profiles` trigger (D7) fills `display_name` from the OAuth identity. JobText's tenancy is separate
  (`company_members`, D8), so after any first sign-in the app routes on membership, identically for
  password and OAuth users:
  - **Invited user (email matches an open `invites` row):** the existing invite-accept path binds
    company + role and consumes the invite; seat limit enforced at acceptance (D8). Works whether they
    accept by setting a password or by clicking "Continue with Google/Apple" — we match on the verified
    email from the OAuth identity, so an invited teammate can SSO straight in.
  - **No membership + no invite:** they land on the **company-first onboarding** (`POST /v1/companies`,
    D6) exactly like a password signup — OAuth changes *how they authenticate*, never *how a tenant is
    created*. No auto-creation of a company from an OAuth login.
  - **Account linking:** rely on Supabase's automatic linking by verified email (same email across
    password + Google + Apple resolves to one `auth.users`), so a user who signed up with a password can
    later "Continue with Google" without orphaning their membership. Manual identity-unlink is out of MVP.
    (Apple caveat, documented for support: Apple only returns name/email on the *first* consent and offers
    private-relay addresses — we persist the email at first sign-in and never assume it re-arrives.)
- **Email change (Settings → Account):** `supabase.auth.updateUser({ email })` from the browser. Leave
  Supabase **"Secure email change" ON** — it emails a confirmation to **both** the current and the new
  address, and the change only commits when confirmed. UI states it plainly ("Confirm from both your old
  and new inbox"). On commit, Supabase updates `auth.users.email`; JobText reads email from there, so no
  app mirror to reconcile. OAuth-only users (no password) can still set/confirm an email this way.
- **Password change (Settings → Account):** `supabase.auth.updateUser({ password })`. Leave **"Secure
  password change" ON** — Supabase requires **reauthentication only if the session is older than 24h**;
  when required, the UI calls `supabase.auth.reauthenticate()` (emails a 6-digit nonce) and passes it as
  `updateUser({ password, nonce })`. Enforce Supabase's leaked-password + min-strength checks (already on
  per D8 posture). Users with **no password yet** (OAuth-only) get a "Set a password" affordance that is
  the same `updateUser({ password })` call — turning an SSO account into a dual-login account.
- **Settings → Account "Sign-in methods" (design the OAuth-only edge, don't just assert it).** Render a
  small **linked-methods list** from Supabase's `user.identities` array: **Google · Apple · Password**,
  each with a present/absent state. Show **"Set a password"** only when **no password identity exists**
  (an OAuth-only account) — the flow for a plumber who signed up with "Continue with Apple" and later
  wants to log in on a shop desktop without their phone. For **Apple private-relay** accounts, show the
  relay address **read-only** with a one-line note that email delivery routes through Apple (the account
  may have no reachable real email). Manual unlink stays out of MVP; this is read-with-one-action (set
  password), not a management console. Full UI in `docs/APP-FEATURES-V2.md` §1.8.
- **Consistency:** no change to the Worker's JWKS verification (D8) — an OAuth-issued Supabase JWT verifies
  identically (same `iss`/`aud`, ES256). No new tables. Sessions, RLS, and the `X-Company-Id` scoping are
  unchanged. Calm UI: SSO buttons are stone-outlined with the provider mark; the **one petrol element** on
  the auth screen stays the primary email submit / "Continue" action (APP-UI-ELEVATION accent budget).

## D19. Attachments storage — one generic table, one bucket, for note AND task attachments

**Decision:** notes and tasks store attachments in **Supabase Storage** (the product-owner call — lowest
upkeep, already in stack), via a **single generic `attachments` table** and a **single private bucket**,
deliberately *parallel to but separate from* the existing `message_attachments` / `mms-media` machinery
(D7). Lowest-upkeep shape wins: one polymorphic table beats a table-per-owner.

- **Why a new generic table, not extend `message_attachments`:** `message_attachments` is MMS-shaped
  (Telnyx-sourced, image-biased, downloaded in the webhook path, metered). Note/task attachments are
  **user-uploaded, any file type, un-metered, no Telnyx origin**. Overloading the MMS table would tangle
  the webhook ingest path with user uploads. A generic table keeps each concern clean while giving the
  gallery (D21) one uniform shape to union over.
- **Schema (`attachments`, new migration):** `id`, `company_id` NOT NULL, `owner_type` text CHECK IN
  (`'note'`,`'task'`) , `owner_id` uuid NOT NULL (→ the `messages` row for a note, the `tasks` row for a
  task — enforced in app code, not a polymorphic FK, per D7's explicit-FK preference sidestep for
  polymorphism), `conversation_id` uuid NULL (denormalized for note attachments, powers the gallery query
  cheaply), `storage_path` text NOT NULL, `file_name` text, `content_type` text, `size_bytes` bigint,
  `uploaded_by_user_id` uuid FK profiles, `created_at`, soft-delete `deleted_at`. Indexes:
  `attachments(company_id, conversation_id) WHERE deleted_at IS NULL`,
  `attachments(owner_type, owner_id) WHERE deleted_at IS NULL`. Append-friendly; hard-delete only via the
  owner's soft-delete cascade in app code.
- **Bucket + path (`attachments`, private):** company-scoped, deterministic path
  `attachments/{company_id}/{owner_type}/{owner_id}/{uuid}-{safe_filename}`. **Company_id is the leading
  path segment** so a single RLS predicate authorizes the whole tree. Keep it distinct from `mms-media` so
  bucket-level MIME/size limits differ (MMS is image-only; note attachments are any type).
- **RLS (Storage `storage.objects`) + Worker-mediated uploads (D8 posture preserved):** the browser never
  writes Storage directly. Uploads go through the API: `POST /v1/attachments` validates membership + owner
  ownership, then the Worker (using the `sb_secret_` key) either streams the bytes or, for large files,
  **mints a `createSignedUploadUrl`** the browser uses once (`uploadToSignedUrl`) — no broad
  authenticated-role INSERT grant on `storage.objects`, matching D8's "no anon/authenticated grants on data
  tables." A defense-in-depth RLS policy on `storage.objects` still restricts any authenticated path to
  `(storage.foldername(name))[2] = <caller's company>` (company is path segment 2 under the bucket), so a
  leaked token can't cross tenants even if grants widen later.
- **Allowed types + sizes (sane, un-metered, decisive):** bucket `file_size_limit = 25 MB` per file;
  `allowed_mime_types` = images (`image/*`), PDFs, common docs (`application/pdf`, Office/OpenDocument,
  `text/plain`, `text/csv`), and archives (`application/zip`) — the realistic set a tradesperson attaches
  (a photo of a part, a quote PDF, a spec sheet). **Explicitly blocked:** executables/scripts
  (`.exe/.bat/.sh/.js/.html` and `application/x-*` executable types) — rejected at the API before signing.
  A soft **per-owner cap of 10 attachments** keeps a note/task from becoming a dumping ground. Server
  re-validates content-type from the bytes, never trusting the client-declared type.
- **Serving:** identical to MMS — short-lived **signed download URLs** (`createSignedUrl`, ~60–300s TTL)
  minted by the API on demand (D7). Thumbnails for images reuse the existing blur-up/lightbox path.
- **Consistency:** D7 (private bucket, company-keyed, signed URLs — same pattern as `mms-media`); D8
  (Worker-mediated, `sb_secret_` key, membership check, RLS defense-in-depth); D17/D19 shared by tasks.
  No metering (D5 meters outbound SMS only). Deleting a note/task soft-deletes its attachment rows and
  best-effort removes the objects on a sweep cron (never blocks the user action).

## D20. Contacts — CSV export, vCard import, Web Contacts Picker progressive enhancement

**Decision:** extend the existing CSV **import** (D10) with CSV **export**, **vCard (.vcf) import**, and a
**Web Contacts Picker** progressive enhancement. Native address-book integration stays **roadmap**
(documented, not built). All three additions are thin, additive API routes — no schema change (contacts
already exist, UNIQUE(company_id, phone_e164), D7).

- **CSV export — `GET /v1/contacts/export`.** Streams a UTF-8 CSV (BOM for Excel) of the company's contacts
  (name, phone_e164, tags, consent_source/consent_at, created_at), respecting the *current filter/search*
  so "export what I'm looking at" works. Owner/admin or any member (read-only, same visibility as the list).
  Round-trips with the import columns so export→edit→import is lossless. Excludes soft-deleted contacts.
- **vCard (.vcf) import — `POST /v1/contacts/import-vcard`.** Accepts one .vcf containing one or many
  `VCARD` blocks (the format phones/Google/Apple export). Parse **vCard 3.0 and 4.0** (`FN`/`N` → name,
  `TEL` → phone). **Normalize every `TEL` to E.164** against the company's default country (US/CA per D2);
  drop non-mobile-shaped or un-normalizable numbers with a per-row reason in the import report. A card with
  multiple `TEL`s creates one contact per **distinct valid** number (contacts are phone-keyed, D7). Reuse
  the **exact upsert + dedupe + consent-attestation gating** the CSV importer already enforces (D4: import
  is a `consent_source='import'` path) — vCard is just a second parser feeding the same idempotent upsert,
  not a second import pipeline. Same preview→confirm UI and same per-row error report as CSV.
- **Web Contacts Picker — progressive enhancement, feature-detected, never required.** On supported
  browsers (Chrome on Android; **no iOS/Safari, no desktop** — so it is strictly additive), show a "Pick
  from phone contacts" button guarded by `('contacts' in navigator) && ('ContactsManager' in window)`.
  It calls `navigator.contacts.select(['name','tel'], { multiple: true })` **inside the tap gesture**
  (required; secure top-level context only), maps results into the same normalize→preview→confirm flow as
  vCard/CSV, and posts to the shared upsert route. If the API is absent the button simply isn't rendered —
  the CSV/vCard paths remain the universal fallback. This is a **client convenience over the existing
  import**, adding no new server surface beyond the shared upsert.
- **Native address book = roadmap (explicitly not built):** true OS contact sync needs native apps (out of
  MVP scope, D9/D11). Documented as a fast-follow so the decision is on record; the Contacts Picker is the
  progressive-enhancement stand-in for MVP.
- **Consistency:** D10 (CSV import already shipped; these are sibling routes under the contacts surface),
  D4 (imports carry `consent_source='import'`; no bulk-blast capability is introduced — import populates
  contacts, it never sends), D7 (phone-keyed upsert, soft-delete respected), D8 (all routes membership-
  scoped, Worker-side). Calm UI: one shared import surface with source tabs (CSV file · vCard file · Pick
  from phone), a single preview→confirm step, one petrol confirm action.

## D21. Conversation-view data support — in-thread filter + cross-source attachments gallery

**Decision:** the in-thread filter (Messages/Notes/Events) and the attachments gallery are specified as
**UX in APP-LAYOUT-V2**; the binding *data/API* calls live here. Both are cheap reads over data that
already exists — no new storage, minimal new surface.

- **In-thread filter needs no new endpoint.** Notes are `messages` rows with `direction='note'` and events
  live in `conversation_events` (both D7); `GET /v1/conversations/:id` already embeds messages and the
  timeline. The **All | Messages | Notes | Events** segmented control is a **client-side filter** over
  data already on the page (with the existing message cursor pagination for "load more"). If a server
  filter is ever wanted for very long threads, it is an additive `?kind=` query param on the messages list
  — not required for MVP.
- **Attachments gallery — one new read endpoint, `GET /v1/conversations/:id/attachments`.** Returns a
  single date-sorted list **unioning two sources**: (1) `message_attachments` for every message in the
  conversation (inbound + outbound MMS, D7) and (2) the new `attachments` rows (D19) whose
  `conversation_id` matches (note attachments; task attachments surface here too when their source message
  belongs to the conversation). Each item: `{ id, source: 'mms'|'note'|'task', kind: 'image'|'file',
  file_name, content_type, size_bytes, created_at, thumbnail? }` plus a **freshly-minted short-lived signed
  URL** (D7/D19) — the endpoint is the single place that authorizes + signs, so the browser never sees a
  Storage grant. Cursor-paginated on `(created_at, id) DESC` (D10 convention). Category tabs (Images |
  Files) filter client-side over the returned set.
- **Consistency:** D7 (both attachment sources already private-bucket + signed-URL; the union is a read,
  not a copy), D8 (endpoint verifies membership on the conversation, mints signed URLs Worker-side), D10
  (cursor list shape, `{ data, next_cursor }`), D19 (note/task attachments), D17 (task attachments).
  Calm UI: a stone-surfaced grid in the toggled right panel, lazy-loaded, click→existing lightbox
  (images) or signed-URL download (files) — Telegram's "Shared Media" trimmed to a tradesperson's reality.

## D22. Auditability — done/undone events, note-attachment and task events in the timeline

**Decision:** every completion and task/attachment lifecycle change writes a `conversation_events` row
(D7 audit table) and renders in the thread's Events timeline (D21). This closes the D14 gap (D14 broadcast
`message.status` for live UI but did not persist an audit row) and makes the new task/attachment actions
first-class in the same audit surface — one timeline, no second log.

- **Shipped column names are canonical (was a cross-doc mismatch).** The `conversation_events` table
  (SPEC.md) has columns **`type`** (the `conversation_event_type` enum — **not** `event_type`),
  **`payload`** (jsonb — **not** `meta`), and **`actor_user_id`**. Every doc that writes an event uses
  exactly these three names. The full list of enum literals to add is pinned in **one place** —
  `docs/TASKS.md` T8 — and this decision cites that list rather than restating it.
- **Done / undone is now audited.** `PATCH /v1/messages/:id {done}` (D14) additionally inserts a
  `conversation_events` row: **`type`**=`'message_done'` / `'message_undone'`, `actor_user_id`, and a
  `message_id` reference in the **`payload`** (so the timeline can render "Sam marked a message done ·
  2:14 PM" by joining the **live** message body — the body is **not** copied into the event, keeping one
  source for the text and respecting D8's PII posture). Insert is **in the same transaction** as the
  `done_at` write and is **idempotent with the D14 no-op** — a redundant mark-done that changes nothing
  writes **no** event (only real transitions are audited), preventing timeline spam. The `message.status`
  broadcast (D9/D14) is unchanged; the event row is the durable record behind it.
- **Task lifecycle audited (D17):** `type`=`task_created` (promote), `task_assigned`
  (payload: from/to user), `task_due_set`, `task_deleted` — each a `conversation_events` row on the source
  conversation, actor-stamped. A task's done/undone is **not** re-audited separately; it flows through the
  underlying message's `message_done`/`message_undone` (shared truth, D17) so there is exactly one audit
  event per real completion, no double-logging. **There is no `task_completed`/`task_reopened` event** —
  they are explicitly dropped (they would double-log completion; TASKS.md T2.1/T8).
- **Note-attachment audited (D19):** `note_attachment_added` / `note_attachment_removed`
  (payload: file_name, attachment_id) on the note's conversation, actor-stamped — so "who attached the
  quote PDF and when" is answerable from the same timeline. Task attachments likewise emit
  `task_attachment_added/removed` on the source conversation.
- **The `conversation_events_conv_required` CHECK does NOT change.** Every new event type
  (`message_done`/`message_undone`, all `task_*`, both `*_attachment_*`) always carries a **non-null
  `conversation_id`** (a message, task, and note each belong to a conversation), so the shipped CHECK
  (SPEC.md — which only *permits* null `conversation_id` for
  `'opted_out','opt_out_revoked','consent_attested'`) is satisfied as-is. **No `ALTER` to the constraint
  is needed** (editing a shipped constraint is forbidden by D14/D7). This is an explicit migration fact.
- **Rendering (D21):** all of the above appear as centered stone-400 timeline lines under the **Events**
  segment of the in-thread filter — invisible until the user selects Events, honoring "nothing fights for
  attention" (APP-UI-ELEVATION). Existing event types (status/assign/tag/opt-out, D3/D7) are unchanged and
  share the row style.
- **Consistency:** D7 (extends the existing `conversation_events` table + its `(conversation_id, created_at)`
  index — no new audit store), D8 (actor is the verified `sub`, membership-scoped), D9/D14 (broadcast
  untouched; events are the durable complement), D17/D19/D21 (task + attachment + timeline all land in one
  audit surface). Append-only, never edited or deleted (D7).

## D26. Voice wave — missed-call text-back, forward-to-cell, and keep-your-number text-enablement

**Decision:** the FEATURE-GAPS BUILD-NOW voice work ships as one wave: missed-call text-back (Step 2),
forward-to-cell (Step 2b, inside the Step-2 fence), and the keep-your-number **text-enablement** path
(Step 0-number path B — hosted SMS on a landline the owner keeps; path A port-in shipped as D16). The
after-hours reply, merge fields, auto-send guard, and review link (Steps 0a/0b/1/3) shipped previously.
(D23–D25 live in `docs/HOME-AND-VIEWS.md`; this log continues at D26.)

- **"Missed" is COMPUTED, never a bare `call.hangup`.** With a `forward_to_cell` configured: the inbound
  leg is answered and the cell dialed as a second leg with `timeout_secs=20` + AMD (`detect_beep`); the
  FORWARD leg's terminal signal decides — hangup cause timeout/no-answer/busy/rejected ⇒ missed, AMD
  `machine`/`not_human` ⇒ missed (carrier voicemail is a miss — the exact case AMD exists for), AMD
  `human` ⇒ answered, no text. With NO forward: nobody can answer live, so the inbound leg's hangup IS the
  miss. The compute is a pure function (`computeMissedFromEvent`) — unit-tested without network.
- **No forward ⇒ the call is never answered.** Answering with no one to connect would put the caller into
  dead air and bill the leg; the call rings out naturally (the caller hears an honest "no answer") and the
  hangup is the missed signal. AMD `not_sure` and a bare `normal_clearing` with no human verdict are
  treated as ANSWERED (never text someone a human just spoke to — conservative by design).
- **One shared Call-Control application** (`TELNYX_VOICE_CONNECTION_ID`, account-level secret, created
  once at vendor setup with its webhook pointed at `/webhooks/telnyx`), not per-company voice connections.
  Tenant isolation still holds: every `call.*` event resolves number → company before acting, exactly like
  inbound SMS. Enabling voice on a number PATCHes **only the voice facet** (`/v2/phone_numbers/:id/voice`)
  — the messaging binding is never touched, so SMS cannot regress.
- **Voice binding is triggered twice, idempotently:** (a) the settings PATCH that turns on `mctb_enabled`
  or sets `forward_to_cell` (fire-and-forget `waitUntil`), and (b) the 15-minute reconcile cron
  (`reconcileVoiceEnablement`) that binds any ACTIVE un-bound number of a feature-on company — covering
  enable-before-active (the normal onboarding order), numbers added/ported later, and transient failures
  of (a). **Hosted numbers are never voice-bound** — their voice deliberately stays on the owner's
  carrier, so missed-call text-back requires a JobText-carried (provisioned or ported) number; the UI says
  so plainly.
- **The text-back rides the shared auto-send machinery**: `claim_missed_call_text` (SECURITY DEFINER RPC)
  atomically threads the caller (same D7 rules as an inbound text — contact upsert, reopen-within-30d,
  else fresh), honors the opt-out mirror (D3), applies the shared `last_auto_reply_at` throttle (one
  auto-text per conversation per 3h — a repeat caller is texted once), and dedupes per call
  (`conversation_events` `missed_call` payload `call_id`) so a retried webhook can never double-text. The
  send is a REPLY (the caller dialed us — D4 reply-exempt: no consent gate, no quiet hours); the queued row
  dispatches through the exact §8 Telnyx path. The message is **owner-authored** (`mctb_message`,
  merge-fields applied; enabled-but-unauthored sends nothing) and booking-forward per FEATURE-GAPS.
- **Surfacing:** a `missed_call` conversation event renders in-thread ("This customer called and no one
  picked up — we texted them back") with the auto-text below it, and the crew gets the §8-mirrored loud
  alert (Resend email + Web Push to assignee-else-all). No new inbox row type, no D24 bell entry — the
  thread + alert are the record.
- **Text-enablement (keep-your-number path B):** `text_enablement_orders` mirrors the Telnyx
  hosted-messaging order lifecycle (`pending → action-required → in-progress → completed`, plus local
  `failed`/`cancelled`); the `phone_numbers` row is `source='hosted'`, `status='provisioning'` until the
  carrier completes — the product copy is honest about the multi-day carrier review (LOA + recent bill).
  Slot accounting is identical to provision/port (`claim_text_enablement_slot`: company lock,
  count-vs-plan, §4.2 sole-prop cap, Idempotency-Key replay). Releasing a hosted number cleans up the
  Telnyx hosted side and closes the order row.
- **The buy saga is fenced to its own rows (bug fix, recorded):** `reconcileNumbers`/`resumeProvisioning`
  now operate on `source='provisioned'` rows ONLY. Ported and hosted rows sit at `status='provisioning'`
  for weeks/days by design and are owned by their own sagas — running the buy saga on them would purchase
  a random new number and overwrite the owner's own `number_e164` (the exact keep-your-number betrayal).
- **Costs stated, not hidden:** forwarding bills two legs (inbound + outbound-to-cell), bounded by the
  20s ring cap; voice-capable DIDs carry the per-number voice charge. No IVR/PBX — explicit FEATURE-GAPS
  non-goal. Voice-minute metering is out of scope (SPEC §9 metering is SMS-only).
- **Consistency:** D2 (per-company messaging profiles untouched), D3 (opt-out mirror honored by the RPC),
  D4 (reply-exempt basis), D7 (threading rules reused verbatim; append-only events), D8 (Worker-side
  authorization; RPCs service-role-only), D9 (the queued message flows the normal broadcast paths), D16
  (port path untouched; a ported number voice-binds like a provisioned one once active), §10 (missed-call
  settings are owner/admin).

## D27. Marketing/app host split — one Worker, two hostnames, middleware-enforced

**Decision:** the landing site and the product are SEPARATED at the hostname level — `jobtext.app`
(+ `www`) serves ONLY the marketing pages, `app.jobtext.app` serves ONLY the product (app, auth,
onboarding) — WITHOUT adding a deploy surface. Both hostnames attach to the ONE existing web Worker
(D1's two-Worker architecture is unchanged), and the split is enforced by the session middleware's
first gate (`lib/hosts.ts`, a pure tested function).

- **Why middleware, not a third app:** a separate marketing app/Worker would double the web deploy
  surface (second build, second CI lane, second domain wiring, second dependency tree) against the
  product's one hard constraint — lowest possible upkeep. Host-based gating in the middleware that
  already runs on every request costs one pure-function call and zero new infrastructure.
- **The gate** (`decideHostRedirect`): on the marketing host, app-surface paths (the protected
  prefixes + auth pages + `/update-password`, `/invite`, `/auth`, `/dashboard`, `/join`) 308 to the
  app origin; `www` canonicalizes to the apex. On the app host, `/` roots at `/for-you` (the auth
  middleware bounces signed-out visitors to login) and marketing paths 308 to the canonical site.
  Requests from a host matching neither origin pass through untouched.
- **Activation is env-gated:** `NEXT_PUBLIC_APP_ORIGIN` (optional). Unset — local dev, CI, previews —
  the split is OFF and every route stays reachable on one origin, so nothing about development
  changes. A malformed value disables the split rather than breaking requests.
- **No component knows about hostnames.** Marketing pages keep linking to the app with relative
  paths (`/login`, `/signup` — `APP_LINKS`); the middleware hop makes them land on the app origin.
  `SITE_URL` (`https://jobtext.app`) remains the canonical base for sitemap/SEO/JSON-LD, which never
  emit app paths; robots.txt keeps disallowing the app surfaces.
- **Operator step:** attach `jobtext.app`, `www.jobtext.app`, and `app.jobtext.app` as custom
  domains on the web Worker, set the `NEXT_PUBLIC_APP_ORIGIN` GitHub Actions secret, and keep
  Supabase/auth/Stripe return URLs on `APP_ORIGIN` (unchanged — they always pointed at the app host).
- **Consistency:** D1 (still exactly two Workers), SPEC §10 (auth middleware unchanged, the host gate
  runs before any session read), BLUEPRINT §11 (canonical marketing origin; www→apex is now enforced
  in code rather than assumed at the DNS layer).

## D28. Attachment ingress — files enter through messages and notes ONLY (amends D17/D19's task arm)

**Decision (product owner, 2026-07-04):** attachments enter the system through exactly two doors —
**a text (MMS media)** and **a note (D19 generic attachments)** — everywhere a file can be added.
The standalone "add attachment to a task" ingress is **removed**: a task's attachments are a
**derived read view**, never a third upload path. Drag-and-drop and paste-to-attach ship on every
composer.

- **The two ingress doors:**
  - *Text mode:* the existing MMS path (≤3 images, ≤1 MB each, jpeg/png/gif — carrier limits).
  - *Note mode:* the composer's note mode gains the attach affordance (previously hidden). Files are
    STAGED client-side and, on save, the note is created first and each staged file uploads to
    `POST /v1/attachments {owner_type:'note', owner_id:<note id>}` — no API shape change; a partial
    upload failure surfaces on the note's existing Files section (retry = re-attach there). Full D19
    limits apply (≤25 MB/file, ≤10/note, allow-list).
  - The task drawer's discussion composer is a note composer and gets the same affordance — that is
    how a file is "attached to a task": on a note in its discussion.
- **Tasks: derived, not owned.** `owner_type='task'` is removed from the upload route's accepted
  owner types (read/serve/delete of any existing rows keeps working — additive removal, no data
  migration; pre-launch there are none in production). The task detail's Attachments section becomes
  a read view unioning: the source message's MMS attachments + attachments of notes linked to the
  task (`messages.task_id`) + any legacy task-owned rows. The checklist "Files (N)" count follows
  the same union. One mental model: *a file always lives on the thing that was said* — the task
  points at it, exactly like task completion derives from the message (D17).
- **Drag-and-drop + paste:** the thread composer (both modes) and the task discussion composer
  accept dropped files and pasted images (staged, multi-file, validated client-side against the
  active mode's limits with plain-language rejects); the note-bubble Files section accepts drops and
  multiple selection. No new dependency — native DataTransfer/clipboard events.
- **Not shipped, on purpose:** D19's two-step `createSignedUploadUrl` path stays unbuilt — 25 MB
  multipart is comfortably inside Workers request limits; one upload path is the low-upkeep choice.
- **Consistency:** D17 (derive-over-own, now applied to files too), D19 (storage machinery
  unchanged — same table, bucket, routes, sweep), D21/APP-FEATURES-V2 §4.2 (the gallery union is
  unchanged; task-owned rows simply stop being created).

## D29. Global search — one palette over messages, notes, conversations, contacts, tasks, attachments, templates

**Decision:** `GET /v1/search` grows from two arms (message FTS + contact trigram) to the full
entity set, all Postgres, no external service (D7 unchanged):

- **Arms:** conversations (message-body FTS incl. notes — hits now expose `direction` so notes are
  labeled), contacts (trigram, unchanged), **tasks** (trigram over title + description, live rows),
  **attachments** (fuzzy trigram over `file_name` on the generic table, live rows),
  **templates** (trigram over name + body — closing PORTAL-UX §2's promised palette scope).
- **A new migration** adds the trigram GIN indexes (tasks title/description, attachments file_name,
  templates name/body — partial on the live-row predicates) and a new `api_search_v2` function with
  the same security posture (SECURITY DEFINER, service-role-only); the shipped `api_search` is not
  edited (D7/D14 rule).
- **MMS media is NOT filename-searchable** — carrier media has no filename (message_attachments has
  no such column, correctly). Attachment search covers note-borne files; MMS images are reachable
  through the conversation/gallery. Stated so nobody "fixes" it later.
- **Ranking/pagination:** per-arm limits, palette-first design (first page per arm; the existing
  conversations keyset cursor remains the only paginated arm). Relevance = similarity/recency per
  arm; no cross-arm interleaving (sections, not a blended list).
- **Deep links:** tasks → `/tasks?task=<id>` (the existing drawer param), attachments → the owning
  conversation thread, templates → `/templates`.
- **Consistency:** SPEC §Search/D7 (Postgres FTS + pg_trgm only), PORTAL-UX §2 (palette scope now
  fully honored), §10 (member-level route, company-scoped arms).

## D30. Attachment storage — priced, capped, and accounted

**Decision:** storage stops being implicitly free/unbounded. The cost model, the caps, and the
accounting:

- **The marginal cost is real but small:** Supabase Pro includes 100 GB (then ~$0.021/GB-month).
  The plans now carry an explicit per-company budget for the generic attachments bucket:
  **Starter 5 GB, Pro 25 GB** — worst case ~$0.11/~$0.53 per month per maxed tenant, comfortably
  inside plan margin. Enforced at `POST /v1/attachments` as a company-wide `sum(size_bytes)` gate
  over live rows (409 `conflict` with plain copy when exceeded; freeing space = deleting files).
  The existing per-file (25 MB) and per-owner (10) caps stand.
- **MMS media is bounded differently, on purpose:** outbound MMS is already metered (3 segments)
  and rate/overage-capped — priced. Inbound MMS is customer content and is NEVER blocked on a
  budget; it is bounded per message (first 10 media items processed, ≤5 MB each — the item cap is
  new) and economically by the sender paying carriage. Inbound media counts toward the usage
  *display*, not the enforcement gate.
- **Accounting:** the usage surface (API + settings page) now reports per-company stored bytes for
  both arms, so an owner can see storage the way they see segments.
- **Retention stands as promised:** conversation history (including media) is kept while the
  account exists and through grace/release ("sign back in and it's there") — that promise is now a
  priced line item, not an accident. The generic-bucket sweep (soft-delete → 15-min hard-delete
  cron) is the only reclamation path, unchanged.
- **Consistency:** SPEC §2/§9 (metering stays SMS-segments-only; storage is a budgeted allowance,
  not a meter), D19 (machinery unchanged), §7 (stable `conflict` code for the budget gate).

## D31. Launch pass (SPEC §12 step 19) — a hermetic golden-path E2E, faked vendors, in CI

**Decision:** step 19's "both golden paths recorded green in CI against test-mode vendors" ships as a
**hermetic full-stack E2E harness**: the REAL `jobtext-api` Worker (`app.fetch`) against the REAL
local Supabase, with Telnyx and Stripe **faked at their HTTP boundary** and their state machines
advanced by the **same signed webhooks production receives**. No external network, no live vendor
keys, deterministic in CI.

- **Why faked, not live test-mode:** Telnyx has **no sandbox** that drives the 10DLC brand/campaign,
  number-order, or porting **state transitions** — the exact spine of the US golden path. A
  live-vendor E2E is therefore impossible for that path regardless of budget. A faithful fake that
  speaks Telnyx's real request/response + signed-webhook contract is the maximal achievable coverage
  and the lowest-upkeep choice (no flaky network, no secrets in CI, no vendor rate limits). Stripe is
  faked the same way for symmetry and determinism (its Checkout/subscription/invoice/meter calls and
  signed webhooks), rather than mixing a live Stripe test-mode into an otherwise hermetic run.
- **The seam:** `env.TELNYX_API_BASE` / `env.STRIPE_API_BASE` (both OPTIONAL, unset in production →
  the real hosts) retarget the Telnyx client and stripe-node at in-process fake servers. Inbound
  webhooks are signed by the harness with the matching test keys (Telnyx Ed25519, Stripe HMAC) and
  POSTed to the real `/webhooks/*` routes, so verification, the ledger, ack-then-`waitUntil`, and the
  dispatch state machines all execute as in production.
- **What it covers (the three sequences step 19 names):** (1) **US sole-prop** — signup → paid
  checkout (flips `active`) → number provisions (order + injected confirmation) → registration
  pending (CA-destined send works, US-destined send blocked by `registration_pending`) → injected
  10DLC approval → US send works; (2) **CA-only instant** — signup with `us_texting_enabled=false`,
  no wizard, immediate send; (3) **cancel → grace → release** — injected `subscription.deleted`
  suspends numbers, the grace cron on a wound-forward clock releases on day 30 and deactivates the
  campaign. Assertions are on observable state (API responses + DB rows + captured vendor calls).
- **Scope boundary (honest):** this is a **server/state-machine** E2E, not a Playwright browser
  drive — Stripe-hosted Checkout can't be exercised against a fake Stripe in a real browser, and the
  cross-vendor spine (the load-bearing, otherwise-uncovered part) is entirely server-side. The web UI
  is covered by its own unit suite + the CI `next build`. A browser smoke test against **live**
  vendor test-mode stays a manual go-live checklist item (docs/deploy/07 §C), where a human can drive
  Stripe test Checkout and a real handset.
- **CI:** a dedicated job stands up local Supabase (`supabase db reset`), runs the E2E vitest project,
  and must be green on `main`. It is additive to the existing unit + SQL-suite jobs.
- **Consistency:** SPEC §12 step 19 (the pass criterion, now met by the faithful-fake harness), §7
  (verify → ledger → ack → `waitUntil` exercised end to end), D13 (tests land with the step), and the
  minimal-upkeep rule (no new vendor, no live keys in CI, no browser-farm dependency).

## D32. One-tap review ask removed — reviews ride templates (amends FEATURE-GAPS Step 2 / Step 3)

- **Removed** (owner direction, issue #2): the thread-header Star, the ⌘K "Send review request"
  action, `POST /v1/conversations/:id/review-request`, and the `claim_review_request` RPC
  (dropped in `20260704060000_drop_claim_review_request.sql`). The dedicated one-tap ask was a
  second send path with its own suppression/quiet-hours plumbing for something a saved template
  already does.
- **What replaces it:** owners save a review template (the Reviews settings page now shows the
  suggested body) — `{review_link}` still merges server-side from `companies.google_review_link`
  on every ordinary send (compose / reply / away-reply). The column, its Settings editor, the
  merge field, and the 10DLC campaign's registered review-sample content (sample3,
  `embeddedLink=true`) all **stay** — the number still emits review URLs, so the carrier
  registration must keep declaring them.
- **Kept as history:** the `review_requested` conversation_event enum value (Postgres enum values
  are irremovable) and any historic rows; the web timeline renders unnarrated event types as
  nothing (SystemLine returns null) instead of a blank line.
- **Consequence:** one-per-job suppression and the review-specific quiet-hours interplay are gone
  with the endpoint; a review ask is now an ordinary message subject to the ordinary compose
  gates.
