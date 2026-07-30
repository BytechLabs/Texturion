# Loonext — Product Owner Decision Log

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
    - ⚠️ **The Canada half is UNVERIFIED and now dated (#379). Checked
      2026-07-28; next review 2026-10-28.** The US half above carries a date
      because its authors knew carrier rules move. The Canada half never did,
      and it is the claim our whole Canada-first position (#369) rests on.
      **Verified against the live Telnyx account, 2026-07-28:** our one Canadian
      number (+1 825, Alberta) was purchased **2026-07-09** — after the
      2025-03-26 cutoff beyond which numbers are reportedly no longer
      grandfathered for domestic Canadian A2P — carries
      **`messaging_campaign_id: None`**, and is classified by Telnyx itself as
      `traffic_type: A2P`. We are sending traffic Telnyx calls A2P, from a
      post-cutoff number, with no campaign attached.
    - ✅ **RESOLVED 2026-07-29 (#379) — verified against published sources;
      next review 2027-01-29.** The claim above is **correct as written**, and
      the thing that actually threatens Canadian delivery turned out not to be
      registration at all. Supersedes the ⚠️ block above.
      **(1) There is no CA→CA registration to complete, on our network or any
      other.** Telnyx's *International SMS Compliance Guide* documents Canada
      explicitly — permitted sender types (long code, short code, toll-free),
      consent (**express or implied** under CASL), a required unsubscribe
      mechanism — and the only pre-registration item it lists for Canada is
      **short-code approval**. No long-code registration requirement appears.
      Their 10DLC program is scoped to the US in its own words ("businesses
      using Telnyx to send A2P messages using 10DLC numbers **in the US**").
      So this is no longer an absence of evidence: it is Telnyx's own published
      Canada documentation, and it agrees with D2.
      **(2) The real exposure is carrier FILTERING, which registration would not
      have fixed.** Twilio's published Canada guidelines state it plainly:
      *"Canadian mobile carriers enforce strict filtering on A2P messages"*, and
      they recommend A2P traffic go over **short codes or verified toll-free
      numbers** for delivery — not long codes. They add that *"carriers will not
      cease filtering."* That is a statement about **carrier** behaviour, not a
      Twilio policy, so it applies to us on Telnyx exactly the same way. #379's
      premise was right; its proposed remedy (a registration wizard) was aimed
      at the wrong mechanism.
      **(3) A peer aggregator has built a gate for precisely our situation**,
      which is why the 2025-03-26 cutoff is real and not a blog artifact: Twilio
      requires numbers bought on/after that date to complete **either A2P
      registration or Persona verification** for Canada-only sending. That is a
      *Twilio-network* policy, not Canadian law — which is how Telnyx can
      require nothing without either vendor being wrong.
      **What this changes.** Ask 3 (Canadian registration as a wizard step) is
      **not applicable**: you cannot build a status machine for a registration
      that does not exist. The mitigation that does exist is the one Twilio
      names — **verified toll-free for A2P into Canada** (#329, already open, and
      this is now its strongest driver) — plus the delivery instrumentation
      already shipped. `caAllowed` stays `true` and is now *verified*-true.
      **Deliberately NOT changed: the /canada landing-page claims.** "No
      registration, no fee, no wait" is literally true and now verified; adding a
      filtering caveat to a conversion page on the strength of a competitor's
      documentation, with zero filtering observed in our own telemetry, would be
      over-correcting. The nuance belongs in editorial content, so the blog post
      whose premise *is* registration honesty carries it.
      **Still unconfirmed, and it no longer gates anything:** whether Telnyx
      applies a Twilio-style gate of its own. Recorded as **R3** (answered) in
      `docs/VENDOR-QUESTIONS.md` (#373), with the residual folded into **V5**
      alongside the toll-free question it belongs with — worth asking while
      scoping #329, not worth holding a market for.
      **Shipped ahead of the answer:** delivery rate split by destination
      country (`messaging/delivery-by-country.ts`, daily), because carrier
      filtering returns no error — the message is accepted, billed, marked sent,
      and never arrives — so an absence is the only evidence there would ever
      be. #379 ask 4; see also #235.
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
  - **REVERSED (2026-07, owner direction):** the enforced auto-append is removed — no message
    carries the identification/opt-out footer anymore, and the composer shows no footer
    preview. `contacts.first_identification_sent_at` is no longer written (the column stays;
    dropping it is a destructive migration for zero gain). **The compliance trade-off was
    accepted knowingly:** first messages are no longer guaranteed to carry
    identification/opt-out text, which can weaken 10DLC standing and invite carrier
    filtering. Inbound STOP honoring and opt-out send-blocking (D3) are unchanged.
  - **AMENDED 2026-07-28 (#393) — the other half of the ledger, recorded so a
    future reader sees what was traded.** The reversal above weighs a CARRIER
    risk: deliverability, commercial, recoverable, and ours. It does not
    mention a STATUTORY one, and the footer it removed was labelled in this
    document's own words *"(CASL identification + CTIA)"*.
    CASL's requirements are cumulative rather than alternative: **s.6(1)**
    consent, **s.6(2)** identification of the sender with contact information,
    **s.6(3)** an unsubscribe mechanism. The consent attestation above is a
    genuinely good answer to s.6(1). **s.6(2) is a separate obligation, and the
    removed footer was the only thing addressing it.** Liability under CASL
    attaches to the sending business — our customer — not only to us.
    **The exposure is narrow and worth stating precisely:** replies inside an
    inbound conversation are not at issue (the customer texted first, and this
    document never decorated them). The one message type in question is the
    **first outbound to a new contact** — which is also the highest-volume
    compliance surface in the product, since every customer relationship starts
    with one.
    **This amendment does NOT reverse the reversal.** An owner decision made
    with eyes open is the owner's to make, and the product argument behind it is
    real: trades text customers who just called them, about a job they just
    discussed, and a footer there reads as marketing. What was missing was that
    the statutory side was never on the table when the trade was made.
    **The open question, for counsel and not for us** — tracked as L1 in
    `docs/VENDOR-QUESTIONS.md`: *does a first outbound SMS from a Canadian
    business to a customer who verbally asked to be texted require sender
    identification in the message body under CASL s.6(2)?* A yes/no answer
    settles everything downstream.
  - **BUILT 2026-07-29 (#393 ask 3) — the capability exists and is OFF.**
    `companies.first_message_identification`, default `false`. **No message
    anybody sends today changed**: D4's reversal above is still the shipped
    behaviour, and turning identification on is a deliberate owner act, which is
    the property ask 3 asked for.
    **Why this did not wait for L1**, despite ask 3 saying nothing should be
    built until it is answered. That instruction bundled two separable
    questions. Whether identification is *required* is statutory, unanswerable
    here, and it decides the **default**. Whether the capability should *exist*
    is a deliverability question, and it is ours — and it changed the same day.
    #379 established there is **no CA→CA registration to obtain** and that
    Canadian carriers filter long-code A2P **at their own discretion**, by their
    own published statement, permanently. With registration unavailable as a
    remedy, the levers left are toll-free (#329) and the content signals
    carriers actually score — and an unidentified first message from an
    unrecognised long code is precisely what spam heuristics flag. So L1's
    answer is now a **default flip**, not a three-client build on the critical
    path. If it comes back "required", one migration changes the default.
    **A cost fact discovered building it, which changes D4's own text.** The
    footer this document specifies used an **em dash**, and an em dash is
    outside GSM-7 — one non-GSM character switches the WHOLE message to UCS-2,
    which carries 67 units per concatenated segment instead of 153. Measured
    through the real estimator: a 150-character first message costs **1**
    segment bare, **2** with a hyphen separator, and **3** with the em dash. The
    original footer would have silently near-tripled the segment cost of the
    product's highest-volume compliance surface. **The shipped separator is a
    hyphen**; D4's wording is otherwise unchanged, and a test pins the
    encoding so it cannot be edited back. `mctb.ts` had already established the
    no-em-dashes rule for the same reason.
    **How it works.** The suffix is appended server-side in the compose route,
    after merge fields and **before the segment estimate**, so the segments we
    pre-check, meter and bill are the segments actually sent. Once per contact,
    ledgered by `contacts.first_identification_sent_at` — which D4's reversal
    deliberately kept and this makes live again. Stamped only after the carrier
    accepts the message, so a failed send does not spend a stranger's one
    identification. Clients never compose the string: the API hands them the
    exact suffix as `company.first_message_identification_suffix`, so a
    composer preview and its segment count cannot drift from what is billed.
    **On all three clients (2026-07-29).** The toggle is a "Sign your texts"
    card in Workspace settings on web, Android and iOS — deliberately NOT titled
    "identification", because the card beside it uses that word for carrier
    registration data and two cards saying it read as one thing. Each shows the
    server's suffix verbatim and states its length, because the part cost is
    real and the customer pays per part.
    **The composer folds the signature into the part count**, which is the half
    that matters: the meter only appears at two parts, so a first text that is
    one part bare and two parts signed would otherwise show nothing and bill
    two. The "Sends as:" preview now also appears for a plain draft about to be
    signed — previously it required a `{token}`, which left the one case where
    the sent text differs from the typed text with no cue at all.
    **Whether THIS send is signed** needs the recipient's history, so
    `contacts.first_identification_sent_at` is on the contact read now: an
    imported contact who has never been texted is common (#248), and guessing
    would put the meter wrong. The rule is one function —
    `pendingIdentificationSuffix` in shared, ported as `Signature.pending` in
    Kotlin and Swift — asserted against the server's own `shouldIdentify` so the
    four cannot disagree.
- Signup requires accepting an acceptable-use policy (no SHAFT content, no purchased lists).

## D5. Pricing & packaging

- **Starter $29/mo**: 3 users, 1 number, 500 outbound segments included, $0.03/extra segment.
- **Pro $79/mo**: 15 users, 2 numbers, 2,500 outbound segments included, $0.025/extra segment.
  (Seat caps set to Starter 3 / Pro 15 by #83, 2026-07-09.)
- **Enterprise (contact-sales)**: unlimited users, for crews larger than 15. Not a self-serve
  billable `plan_id` — no Stripe price, no DB migration; a "talk to us" tier (CTA → /contact)
  that keeps the flat, no-per-user model at custom scale. The billing system only ever sees
  `starter`/`pro`, so seats are always finite there.
- Positioning: flat team pricing ("one price for your whole crew") vs per-seat rivals
  (Quo $19/user, Heymarket $49/user). No per-seat add-ons in MVP; upgrade is the path.
- **Inbound is free and unmetered** (market table-stakes; COGS ~1.0¢/segment absorbed — raised from 0.7¢ by #445, which measured the real four-carrier composition).
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
  - **MEASURABLE as defined, 2026-07-29 (#281).** The activation above needs an
    inbound REPLY, and only the outbound half was instrumented — so the number
    we could compute counted every workspace that texted once into silence as
    activated, and systematically overstated the metric. A 60% target is
    unfalsifiable while the numerator is a different quantity from the
    definition. `first_inbound_reply` now fires once per workspace, the first
    time an inbound lands on a conversation we had **already texted**. That
    qualifier is load-bearing: an inbound on a thread the CUSTOMER started is
    the product working, but it is not a reply to us, and counting it would
    overstate activation the same way the outbound-only metric did.
    `companies.first_inbound_reply_at` is the ledger rather than a heuristic
    count, so "first" is exact under concurrent replies and the 7-day window
    stays computable in SQL beside the subscription dates it is measured
    against.
  - **Reported apart for Canada-only and US-enabled workspaces (#369).** Both
    funnel ends now carry `country` and `us_texting_enabled`. A Canada-only
    workspace has no registration wait at all, so its payment-to-send time is
    structurally different; averaging the two hides both numbers, and the one it
    hides is the one worth marketing with.
  - **The crew signal, 2026-07-29 (#281 item 2).** `second_member_sent` fires
    once when a SECOND distinct member first sends. A one-person workspace is a
    trial however long it has paid; a workspace where somebody else answers
    customers from the shared number has actually changed how the business runs,
    and that is what the 85% week-4 target should move.
    `companies.second_member_sent_at` is a column for a hot-path reason rather
    than a modelling one: "how many distinct members have ever sent" is the one
    funnel question that cannot be answered cheaply per send, so the stamp stops
    the probe running once the answer is yes. An **automated** send never counts
    — an away reply is the product sending, not a teammate joining in.
  - **The mid-funnel span (#281 item 3).** `team_invited` (with the role) and
    `contacts_imported` (with the counts, from BOTH the CSV and vCard paths, so
    the step cannot under-count by arrival route) make approved→first-send show
    drop-off rather than only duration. Emitted per occurrence, not once per
    workspace: a workspace does each a handful of times ever, PostHog funnels
    read the first occurrence anyway, and two more stamped columns to save a few
    events would be the wrong trade.
  - **Stall detection, 2026-07-29 (#281 item 4).** `job:activation-stall`,
    daily, transitions only. The distinction that makes it readable is one
    `job:call-silence` never had to draw: **a US workspace inside the carrier
    wait is QUEUED, not stalled.** Alerting on it would fire for every US signup
    in its first week, and an alarm that fires on the normal case is one nobody
    reads (#244). So the states separate what somebody can act on:
    `not_sent` (past every gate, sent nothing, 3+ days), `no_reply` (sent, and
    D12's 7 days elapsed with no reply — an activation failure by the
    definition), and `awaiting_carrier` (submitted, unapproved past the 3-to-7
    business days our own copy promises — not their fault, but our claim is what
    is failing). Precedence runs **backwards** through the funnel, so a
    workspace that sent and got no reply is judged on that rather than on an
    approval it cleared a fortnight ago.
  - **D12 is now measurable end to end**, and #281 is closed.

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
US or Canadian number to Loonext instead of getting a new one. This is the honest answer to the
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
  (Firm Order Commitment) cutover date, and **Loonext inbound/outbound on that number only works
  after the messaging port completes** (voice `ported` → messaging `ported`, separate step). We set
  this expectation loudly at checkout and render the live port state in-app (state machine below).
  We **do not silently buy a temporary Loonext number** during the port (it would confuse the ICP —
  two numbers, unclear which to give customers — and undercut the whole "keep your number" promise).
  Instead we offer an **explicit, opt-in "tide-me-over number"** the owner can choose in the port
  wizard: a checkbox "Give me a temporary Loonext number to text from while my number transfers"
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
  for US, faster in Canada), and moves to Loonext on the switch-over date. We'll tell you exactly
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

> **AMENDED by D64 (#356, 2026-07-28): a task promotes a message OR an answered
> call.** D17 was decided 2026-07-02, before the calls feature (D37–D43), so its
> rationale never mentions calls — and the constraint it implies is that work can
> only exist here if a *text* caused it. D64 widens the anchor and restates the
> invariant this section is really protecting: exactly one row owns a task's
> done-state, and the anchor determines which. Everything below still describes
> the message-anchored case exactly.

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
  from the key). Both providers list Loonext's production + preview origins in the Auth **redirect allow
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
  `profiles` trigger (D7) fills `display_name` from the OAuth identity. Loonext's tenancy is separate
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
  and new inbox"). On commit, Supabase updates `auth.users.email`; Loonext reads email from there, so no
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
  carrier, so missed-call text-back requires a Loonext-carried (provisioned or ported) number; the UI says
  so plainly.
- **The text-back rides the shared auto-send machinery**: `claim_missed_call_text` (SECURITY DEFINER RPC)
  atomically threads the caller (same D7 rules as an inbound text — contact upsert, reopen-within-30d,
  else fresh), honors the opt-out mirror (D3), applies the shared `last_auto_reply_at` throttle (one
  auto-text per conversation per 3h — a repeat caller is texted once), and dedupes per call
  (`conversation_events` `missed_call` payload `call_id`) so a retried webhook can never double-text. The
  send is a REPLY (the caller dialed us — D4 reply-exempt: no consent gate, no quiet hours); the queued row
  dispatches through the exact §8 Telnyx path. **#192 supersedes the original send rule:** the toggle alone
  decides WHETHER a text goes out; a product default (`DEFAULT_MCTB_MESSAGE`, `@loonext/shared`) always
  exists, and the owner's `mctb_message` overrides ONLY when non-blank — an enabled text-back never
  silently sends nothing. The company view + PATCH echo expose `mctb_effective_message` +
  `mctb_message_is_custom` so no client hardcodes the default; settings UIs autosave (no Save button) and
  hide the message input while the toggle is off.
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
  *(Superseded by D36, 2026-07-10: forwarded minutes are metered and bill 1¢/min past the fair-use allowance.)*
- **Consistency:** D2 (per-company messaging profiles untouched), D3 (opt-out mirror honored by the RPC),
  D4 (reply-exempt basis), D7 (threading rules reused verbatim; append-only events), D8 (Worker-side
  authorization; RPCs service-role-only), D9 (the queued message flows the normal broadcast paths), D16
  (port path untouched; a ported number voice-binds like a provisioned one once active), §10 (missed-call
  settings are owner/admin).

## D27. Marketing/app host split — one Worker, two hostnames, middleware-enforced

**Decision:** the landing site and the product are SEPARATED at the hostname level — `loonext.com`
(+ `www`) serves ONLY the marketing pages, `app.loonext.com` serves ONLY the product (app, auth,
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
  `SITE_URL` (`https://loonext.com`) remains the canonical base for sitemap/SEO/JSON-LD, which never
  emit app paths; robots.txt keeps disallowing the app surfaces.
- **Operator step:** attach `loonext.com`, `www.loonext.com`, and `app.loonext.com` as custom
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
- **Consistency:** SPEC §2/§9 (metering stays SMS-segments-only — *amended by D36: voice minutes meter too*; storage is a budgeted allowance,
  not a meter), D19 (machinery unchanged), §7 (stable `conflict` code for the budget gate).

## D31. Launch pass (SPEC §12 step 19) — a hermetic golden-path E2E, faked vendors, in CI

**Decision:** step 19's "both golden paths recorded green in CI against test-mode vendors" ships as a
**hermetic full-stack E2E harness**: the REAL `loonext-api` Worker (`app.fetch`) against the REAL
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

## D32. Reviews feature removed entirely — no review surface remains (amends FEATURE-GAPS Step 2 / Step 3)

- **First removal** (owner direction, issue #2): the thread-header Star, the ⌘K "Send review
  request" action, `POST /v1/conversations/:id/review-request`, and the `claim_review_request`
  RPC (dropped in `20260704060000_drop_claim_review_request.sql`). The dedicated one-tap ask was
  a second send path with its own suppression/quiet-hours plumbing for something a saved template
  already does.
- **Full removal** (owner direction: "remove the Reviews section completely, we don't need
  that"): the Reviews **Settings page + nav entry**, the **`companies.google_review_link`**
  column (dropped in `20260705010000_drop_google_review_link.sql`), and the **`{review_link}`**
  merge token — gone from `@loonext/shared` `MERGE_FIELD_TOKENS` and from every send path
  (compose / reply / away-reply / missed-call). No review-specific surface remains anywhere in
  the product; an owner who wants to ask for a review pastes their link into an ordinary message
  or saved template like any other text.
- **Kept as history:** the `review_requested` conversation_event enum value (Postgres enum values
  are irremovable) and any historic rows; the web timeline renders unnarrated event types as
  nothing (SystemLine returns null) instead of a blank line.
- **Left in place, deliberately:** the 10DLC campaign's registered review-sample content
  (`wizard.ts` sample3, `embeddedLink=true`). Over-declaring content the number no longer
  auto-sends is harmless to carriers and avoids re-vetting an approved campaign — a number that
  merely *can* carry a link an owner types is not emitting undeclared content.
- **Consequence:** one-per-job suppression and the review-specific quiet-hours interplay went
  with the first removal; nothing review-shaped is left — a link an owner types is an ordinary
  message subject to the ordinary compose gates.

## D33. Launch-audit hardening wave 1 — egress metering, module reconcile, retry/sweeper atomicity (2026-07-07)

Owner decisions resolving the pre-deploy audit's P0/P1 wave (GitHub issues #15–#22, #35, #37,
#39, #41, #43, #44, #46, #47, #52, #53; commits c27ef21, 4d2213a, 3a60af0, 6880133). The
cost-protection mandate (cap-and-drop, alert BEFORE the cap, fail closed) governs all of these.

- **Signed-URL egress is a metered cost center (#16).** Downloads hit Supabase directly, so the
  MINT is the meterable moment: every signed-URL mint (attachments `/url` route AND the
  conversation gallery) atomically claims the object's `size_bytes` via `claim_signed_url_egress`
  against a derived per-period allowance of **4× the company's combined effective storage
  budgets** (Starter 40 GB, Pro 200 GB, grows with `extra_storage`; the PRICING-AUDIT "egress ≈ 4×
  storage" sizing). Over the allowance the mint returns 402 `usage_cap_reached`; accounting
  errors THROW (no URL). 80%/100% owner alerts ride the existing ledgered usage-alerts cron
  (`egress` arm). Worst-case maxed Pro tenant ≈ $18/mo egress against $79 revenue — inside margin.
- **Uploads claim budget BEFORE Storage writes (#15),** with orphan-object + ghost-row sweep
  passes as the crash-window backstop on the 15-min sweep cadence.
- **Module state mirrors Stripe, both directions (#17).** `company_modules` reconciles against
  the live subscription items on every subscription webhook and the daily reconcile; a module
  absent from the paid subscription is disabled (voice disable clears forwarding config).
  Cancel-then-resubscribe can no longer keep unpaid modules. Module toggles are
  schedule-aware (#18) and 409 on canceled subscriptions (#44); `regions_ca` is refused at
  checkout/toggle until it actually ships (#41).
- **A reconcile-discovered missed cancellation enters the same suspend → grace → release
  machinery as the webhook path (#21)** — churned numbers always stop renting.
- **Send-path atomicity (#19, #20, #46, #47):** retry requeue is a SQL claim (one winner);
  crashes between queued-insert and dispatch fail the row immediately
  (`persistSendInterruption`, send + compose) with the `fail_stuck_outbound_sends` cron as
  backstop; retries re-run the number-status, rate, and cap gates.
- **Webhook sweeper rows are claimed per-event (#22)** (attempts CAS + `claimed_at`) so
  overlapping cron runs cannot double-process; Stripe duplicate-identifier meter errors count
  as success (#53).
- **Ingest fail-closed posture (#35, #37, #39, #43):** suspended companies get no call
  forwarding; MMS budget-lookup errors skip media (never download unaccounted bytes); inbound
  notification emails have a per-company daily ceiling with a one-time owner alert; outbound MMS
  media is byte-sniffed against its declared type.

## D34. Storage is free; hard-limit numbers live only in the fair-use policy (#121, 2026-07-10)

Founder ruling (supersedes D30's enforcement posture and the #12 extra_storage module):

- **Storage is free.** No storage caps, no storage meter, no extra-storage add-on. Uploads never
  409, inbound MMS media is never dropped for space, and the usage page has no storage card. The
  `claim_attachment_storage` RPC keeps its atomic row-insert/accounting role (the Worker passes an
  unbounded budget); a later migration may drop its gate parameter.
- **The backstop is alerting, not blocking.** The hourly usage-alerts cron's `storage_abuse` arm
  emails the customer (friendly, explicitly non-blocking copy) and ops (`OPS_ALERT_EMAIL`, default
  support@loonext.com) when a company's total stored bytes crosses absolute tiers
  (25/50/100/200/400 GB), once per tier per period via the existing ledger. Human follow-up under
  the fair-use policy replaces the old 409/cap-and-drop.
- **`extra_storage` retired exactly like `mms` (D-#103 recipe):** removed from the catalog and
  every sales surface; its Stripe price joins `retiredModulePrices()` so the daily reconcile strips
  live line items with a prorated credit (KEEP `STRIPE_MODULE_EXTRA_STORAGE_PRICE_ID` set in prod);
  migration `20260710120000` deletes its `company_modules` rows and tightens the CHECK to
  `('voice','regions_ca')`. Deploy Worker BEFORE migration.
- **Egress backstop re-based:** the signed-URL download allowance is a fixed 200 GB/period
  (`EGRESS_ALLOWANCE_BYTES`) for every plan — an anti-abuse cost cap equal to the old maxed-Pro
  ceiling, never a marketed limit.
- **Marketing/app carry no hard-limit numbers.** Allowance figures, per-text overage rates, the
  picture-counts-as-three rule, and voice minutes live in exactly one public place:
  `/legal/fair-use` (canonical as of this decision). Marketing and plan surfaces tell the
  fair-use + spending-cap story and link there. The composer's "Sent in N parts" hint and the
  billing spending-cap control (with its concrete usage figures) stay — they are honesty and
  remediation surfaces, not marketing. Binding copy decks carry dated #121 amendments.

## D35. GTM ships consent-first: banner + Consent Mode v2, no noscript iframe (#124, 2026-07-10)

Founder asked for GTM (`GTM-MTL658DD`) on the marketing site, then for the consent banner and a
cookie-policy update so tags added in the GTM UI are lawful (GDPR/PIPEDA/Quebec Law 25).

- **Consent-first loading.** The GTM loader (marketing layout only, gated on
  `NEXT_PUBLIC_GTM_ID`) seeds a Consent Mode v2 default IN THE SAME inline script, BEFORE
  gtm.js: all four v2 signals (`ad_storage`, `ad_user_data`, `ad_personalization`,
  `analytics_storage`) denied unless the `loonext.consent` cookie says granted;
  `security_storage` always granted. `consentSignals()` in
  `components/marketing/consent/consent.ts` is the single source of truth for both the inline
  default and the banner's update push (which must be a genuine Arguments object — GTM ignores
  plain-array consent pushes).
- **One yes/no, equal weight, 180 days.** The banner (fixed overlay, never inserts — BLUEPRINT
  CLS law) offers "Allow cookies" / "No thanks" at equal prominence; the choice lives in the
  first-party `loonext.consent` cookie (Max-Age 180 days, SameSite=Lax, host-only) and expiry
  re-asks. Withdrawal is as easy as consent: /legal/cookies §6 embeds a live preferences
  control, synced with the banner via a window event.
- **No GTM `<noscript>` iframe.** It cannot read consent state, so it would fire the container
  unconditionally for no-JS visitors. With JS off, GTM never loads and the banner never shows.
- **Gate = GTM configured.** No `NEXT_PUBLIC_GTM_ID` (dev/CI/previews/forks) → no GTM, no
  banner, no preferences control; there is nothing to consent to. ship.yml carries the var as
  a repo secret (set 2026-07-10) so production builds with it.
- **PostHog unchanged:** cookieless, memory-persistence, consent-free by design (D8/D12).

## D36. Voice joins the fair-use meter: 2,500/6,000 included forwarded minutes, 1¢/min overage (#128, 2026-07-10)

Founder directive ("use the same fair use mechanism, don't show numbers in plans; 2,500 minutes
Starter / 6,000 Pro for projection; past that, bill 1¢ per minute"). Supersedes the #12
cap-and-drop posture (`PLAN_VOICE_MINUTES` 300/300 as a hard ceiling) and D26's "voice-minute
metering is out of scope" scope line — plans.ts pre-authorized exactly this: "retune upward only
alongside metered voice overage."

- **The billed measure is the forwarded (dialed) leg.** A customer's "minute" is a minute their
  call was actually forwarded to their cell — the phone-bill meaning — via the new
  `api_period_forward_seconds` RPC (`leg='forward'` only). The both-legs sum
  (`api_period_voice_seconds`) stays for cost analysis; the allowance no longer silently
  double-counts (under the old measure, 300 "included minutes" were ~150 talk minutes).
- **Allowances are fair-use lines, not walls:** `PLAN_VOICE_MINUTES` = 2,500 (Starter) / 6,000
  (Pro). The 80%/100% usage alerts and the #85 projection run against them; the alert copy now
  promises billed overage, never a silent pause.
- **Overage bills like segments:** a second Stripe Billing Meter (`voice_seconds`,
  `STRIPE_VOICE_METER_EVENT_NAME`) with per-plan graduated metered prices
  (`loonext_{starter,pro}_voice_overage`: tier 1 at $0 up to the allowance × 60 seconds,
  then 1¢/60 per second — "1¢ a minute, rated to the second"; app-side constant
  `VOICE_OVERAGE_CENTS_PER_MINUTE` = 1). The meter is fed the SAME raw seconds the
  gate/alerts/usage sum (adversarial-review fix: a per-leg ceil-to-minutes report
  let short calls bill unboundedly past every displayed figure and past the cap). The voice metered item rides wherever the $8
  voice module is on the subscription: checkout attaches it, the module toggle adds/removes it
  (schedule-aware), plan changes swap it to the target plan's tiering (upgrade drops it rather
  than over-bill if the target price is unprovisioned; downgrade rolls it to the Starter price).
  `moduleForPrice` deliberately maps it to null — module enablement stays decided by the
  licensed item alone (#17).
- **Reporting is the segments recipe verbatim:** per forward-leg RAW SECONDS reported on
  `call.hangup` with `call_leg_id` as the identifier (a rang-out forward leg records ZERO
  billable seconds — ring time is never a forwarded minute, per the same missed-cause
  classifier the text-back uses), `call_records.stripe_reported_at` as the
  local exactly-once stamp, and an hourly `reportUnreportedVoiceUsage` re-reporter with the #53
  duplicate-identifier stamp-through. Non-billable rows (inbound legs, zero-minute legs, meter
  unconfigured) are stamped at insert; the migration backfills every pre-D36 row as reported so
  history can NEVER retroactively bill.
- **Forwarding pauses only at the spending cap** — allowance × `overage_cap_multiplier`, the same
  owner control that pauses texts (default 3×, hard max 10×). At the cap the inbound call is
  rejected (USER_BUSY) and the caller still gets the missed-call text-back, unchanged. Worst-case
  exposure is bounded there; the #85 projection (voice ceiling now allowance × multiplier, voice
  overage revenue counted at 1¢/min) warns before any tenant trends underwater.
- **Economics, stated plainly (founder call):** both legs cost ~1.2¢ per forwarded minute against
  the 1¢ overage price, so the marginal overage minute runs ~0.2¢ under cost and the included
  allowance is subsidized by the flat $8 module. Bounded by the cap, watched by the projection,
  accepted for simplicity of the "1¢ a minute" story. The ~10¢/forwarded-call transfer fee stays
  uncapped-by-minutes and projection-watched (#98); the pre-answer cap-check concurrency race is
  a bounded overshoot past the cap (up to 60 min per concurrent in-flight call), not a
  cost leak (PRICING-AUDIT residual).
- **No numbers in plans (D34 pattern):** the API module-catalog detail is number-free ("Generous
  forwarded minutes under fair use."), matching the web mirror; the concrete figures (2,500 /
  6,000 / 1¢) live in exactly one public place, `/legal/fair-use` §7, positively pinned by
  legal-pages tests. The pricing sweep bans `6,000` and "minutes a month" alongside the existing
  figure bans. In-app honesty surfaces (usage meter, missed-calls fine print) state the concrete
  figures per D34.
- **Deploy order + operator steps:** migration `20260710150000` BEFORE the Worker (the Worker
  reads the new RPC/column). Then `pnpm stripe:setup` (idempotent; creates the voice meter + two
  prices) and set `STRIPE_VOICE_METER_EVENT_NAME` + `STRIPE_{STARTER,PRO}_VOICE_OVERAGE_PRICE_ID`
  on the API Worker. All three are env-optional fail-safes: unconfigured, minutes go unbilled
  (never over-billed), nothing queues retroactively, and the cap still bounds cost.
- **Review hardening (same day, 5-lens adversarial review):** (a) the voice metered price is
  PLAN-SPECIFIC, so on a pending-downgrade schedule it is resolved PER PHASE from each phase's
  licensed price (`applyVoiceOverageToSchedulePhases`) — never pinned as one price; disable
  strips EVERY voice price from every phase so a re-enable can never stack both plans' prices
  on one meter (double-billing). (b) Every subscription mirror pass converges the metered item
  onto the paid voice module (`ensureVoiceMeteredItem`): pre-D36 module buyers get it attached,
  a wrong-plan tiering is swapped, duplicates are removed; grandfathered modules (no licensed
  item) are never attached. (c) A GRANDFATHERED voice module keeps the pre-D36 deal exactly —
  forwarding pauses at the legacy 300 minutes (`GRANDFATHERED_VOICE_MINUTES`), because nothing
  can bill its overage and the new cap would otherwise be a 25×+ unbilled cost ceiling. (d) The
  hourly voice re-reporter sweep-stamps non-billable rows left unstamped by the deploy window
  (old Worker + new schema), so the queue index never accumulates dead entries; billable legs
  recorded in that window bill honestly under the already-published policy (bounded to minutes
  of deploy lag).
- **Consistency:** D5 (spending-cap semantics extended, not changed), D26 (call flow, tagging,
  missed-call computation untouched; its metering scope line is superseded), D33/#17 (reconcile
  ignores the metered price for module ENABLEMENT by design, while converging its presence),
  D34 (fair-use page stays the only public home of the numbers), SPEC §2/§9 amended.

## D37. Calls ships end to end: every inbound call is a visible, actionable item (#129, 2026-07-10)

Founder directive ("not just metering but the full feature, end to end — designers, developers,
security, desktop, mobile, PWA"). Product spec: docs/CALLS-FEATURE.md. Ships on the D36 billing
pillar (#128).

- **Session-grain `calls` read model** (migration `20260710160100`), merged across webhook
  events by the convergent `api_upsert_call` RPC — one row per `call_session_id`, outcome
  `answered | voicemail | missed` ('voicemail', an AMD verdict, always beats the hangup-cause
  'answered' fallback; first verdict otherwise — webhooks arrive out of order),
  `forward_seconds` = talk time only (a rang-out leg contributes zero — never ring time).
  `call_records` stays untouched as the D36 per-leg billing substrate; its ignoreDuplicates
  upsert can never host merge semantics.
- **Threading rule:** a MISSED call finds-or-creates the caller's conversation
  (`api_thread_call`, the claim RPC's D7 recipe verbatim — a miss is actionable and must reach
  the inbox even with text-back off); answered/voicemail calls only JOIN an open conversation
  (never reopen or create — an answered call is not a work item). Anonymous callers stay
  list-only. One idempotent `call_completed` conversation event per session (new enum value,
  standalone migration `20260710160000`; the existing `missed_call` event is untouched — it is
  the text-back's idempotency key, so a missed-with-text-back thread shows two honest lines).
- **Timeline:** `call_completed` renders as a quiet SystemLine — "Call answered · 4m 32s" /
  "Call went to voicemail" / "Missed call" — so a thread reads as the full history, texts AND
  calls. Unknown event types still render nothing (forward compatibility).
- **`GET /v1/calls` + /calls surface:** the `api_list_calls` RPC applies the #106 deny list
  INSIDE the SQL before the keyset window (NULL `phone_number_id` rows stay visible — released
  numbers, matching conversations semantics); the route clones the conversations list
  (member role, `resolveNumberAccess`, cursor envelope, `?outcome=` filter). The page is a calm
  scrolling document in the shipped vocabulary: for-you Section card, inbox row anatomy,
  missed = the row's ONE warning-tint pill (accent budget #64), All/Missed segment control,
  CalmEmptyState pointing at /settings/missed-calls, threaded rows link to /inbox/{id} and
  unthreaded rows never dead-link.
- **Navigation:** Calls joins the desktop sidebar (PhoneIncoming, quiet row, NO count pill) and
  the ⌘K palette. The mobile tab bar stays four links + avatar (#100 — pinned by a new nav
  test); on mobile Calls lives in the account sheet, and every call reaches the inbox timeline
  regardless. PWA: /calls deep links pass through sw.js unchanged (same-origin passthrough).
- **Security review (inline, all gates):** RPCs are SECURITY DEFINER + `search_path=''` +
  service-role-only (pinned in calls_feature.test.sql C-5); hidden numbers are absent, never
  403 (no enumeration); threading is reachable only through the signature-verified Telnyx
  webhook and is idempotent per session; no new unbounded cost center (call volume is bounded
  by the D36 voice gate).
- **Verified end to end:** api 1,357 + web 1,228 vitest green; SQL suites C-1..C-5 green;
  dev-seed call fixtures + dev-shot screenshots on desktop light/dark, mobile, the thread call
  line, and the account sheet.
- **Non-goals (binding, from the spec):** no outbound calling from the app, no call
  recording/voicemail transcription, no IVR/PBX, no concrete numbers on marketing surfaces
  (D34/D36). Deferred, tracked in docs/CALLS-FEATURE.md: the D24 bell arm for missed calls +
  decoupling the crew alert from MCTB (the in-app feed still only learns of misses via the
  text-back path), and a For You "Recent calls" section.

## D38. Outbound calling ships: click-to-call bridging from the business number (#131, 2026-07-10)

Founder directive ("full calling feature end to end" — outbound too). REVERSES the D37
"no outbound calling" non-goal and the marketing claim "Loonext itself doesn't place calls"
(plan-addons fine print + compare pages updated; the module blurb now says "Call customers
and forward calls from your business number").

- **The mechanism is a two-leg bridge, not WebRTC:** POST /v1/calls dials the MEMBER'S cell
  from the business number (agent leg, `oc_agent|<customer>` tag, AMD `detect`), and on a
  human/undetermined verdict the webhook transfers to the customer (`oc_customer` tag,
  business number presented). A machine verdict hangs up — the member's own voicemail can
  never be bridged to a customer — and marks the session 'missed'. Works on every phone and
  the PWA with zero WebRTC risk; in-browser audio remains a possible later wave.
- **Gates, in order:** member role; #106 `text` level on the conversation's number (calling
  is outreach); live subscription; the voice module; the member's cell configured
  (`company_members.call_cell_e164`, NANP CHECK, self-service via GET/PUT /v1/calls/cell —
  collected inline in the app's first-call dialog); and the D36 voice spending cap
  (`usage_cap_reached` 402, checked before any Telnyx dial). Calls to texting-opted-out
  contacts are ALLOWED — STOP is SMS consent, and a requested callback may be the only
  channel; noted deliberately.
- **One calling-minutes pool, both directions (D36 amended):** the billed measure is the
  far-party leg — `forward` (inbound) and `out_customer` (outbound) — summed by the
  re-created `api_period_forward_seconds` and reported to the same `voice_seconds` meter;
  ring time never bills (a no-answer customer leg records zero). Agent legs record for cost
  analysis only; the per-dial fee counter now counts both outbound legs (outbound runs two
  dial commands — over-counting cost is the safe direction). The fair-use page, alert
  emails, and usage surfaces now say "calling minutes"; migration `20260710170000` (calls
  .direction, leg CHECK widening, RPC re-creations with dropped-first old signatures,
  call_cell column).
- **Session semantics:** `calls.direction` ('outbound' never flips on merge); outcome
  'answered' = customer connected, 'missed' = never connected (customer no-answer OR the
  member not picking up their own leg). Outbound calls thread JOIN-ONLY (they start from a
  conversation; an agent-only failure stays list-only — the customer was never contacted);
  the `call_completed` event carries `direction` and renders "You called · 3m 12s" /
  "Called, no answer". The missed-call text-back NEVER fires for outbound legs.
- **UI:** the thread header's Call control is now the bridge (the old bare `tel:` link
  leaked personal cells and bypassed the business number; it remains only as the
  no-module fallback). /calls rows read from the crew's side; an outbound no-answer is
  quiet text, never the warning pill (the tint stays reserved for inbound misses, #64).
- **Verified end to end:** api 1,366 + web 1,232 vitest green; SQL C-1..C-7 green
  (direction merge, billed pool, dial counter, cell CHECK, event direction); dev-shot
  pixels for the two-direction call log and the thread timeline with the Call button.
- **Deferred (unchanged from D37 + new):** the D24 bell arm + MCTB-decoupled crew alert; a
  For You "Recent calls" section; per-member cell VERIFICATION (today the agent leg simply
  rings whatever the member entered — self-harm-bounded since it dials before any bridge);
  a visible per-member cell field on the Calls settings page (the first-call dialog is the
  collection point this wave); the "Call forwarding" module label rename to "Calling"
  (cosmetic, many pinned marketing strings).

## D39. Missed calls reach the bell; the crew alert stops depending on the text-back (#132, 2026-07-10)

The D37/D38 deferred "P4 remainder", plus the settings half of deferred item 3. Three
binding choices:

- **Bell audience = push audience:** the new `missed_call` arm on the `api_notifications`
  twins (migration `20260711000000`) shows an INBOUND missed call to the conversation's
  assignee when assigned, and to every member when unassigned — exactly the audience
  `notifyMissedCall` already emails/pushes, so the bell and the push can never tell two
  different stories. Outbound no-answers NEVER reach the bell (the crew's own unanswered
  dial is not news); a legacy D37 event with no `direction` key reads as inbound. The
  #106 deny-list filters the arm like every other arm, twins in lockstep (N7).
- **The timeline event insert is the alert claim:** `api_thread_call` now returns
  `event_inserted` (true exactly once per call session). The webhook fires
  `notifyMissedCall` gated on it whenever the text-back path didn't alert — MCTB
  off/unauthored, caller opted out, throttled — so a missed call always alerts the crew.
  The text-DISPATCHED path keeps its claim-gated alert (it alone knows sent-vs-failed and
  survives ledger replay-heal); `sendMissedCallText` returns `{alerted}` so the two sites
  can never double-fire (webhook tests pin one-alert-per-call in all four paths).
- **Tri-state truthful copy:** `notifyMissedCall` takes `textStatus: sent|failed|none` —
  'none' says "They haven't been texted back — call them back", never "we tried" when
  nothing was attempted. Trade accepted: if the worker dies between the event insert and
  the alert, the push/email for that call is lost (never duplicated); the bell arm is the
  durable record, which is why it ships in the same wave.
- **Settings:** /settings/missed-calls gains the per-member "Your cell for outbound
  calls" card (self-service `call_cell_e164`, no owner gate — each member edits only
  their own; the Call button's first-use dialog remains the inline collection point).
- **Still deferred:** For You "Recent calls" section; per-member cell verification; the
  "Call forwarding" → "Calling" label rename.

## D40. The product finishes: cell verification, Recent calls, the Calling rename, and every audit gap (#133, 2026-07-11)

Founder directive: nothing deferred, no half-baked shortcuts. A five-agent discovery +
adversarial audit mapped the remaining surface; everything confirmed shipped in one wave.

- **Cell verification (the headline):** the bridge may only dial a cell its member has
  PROVEN they hold. PUT /v1/calls/cell texts a 6-digit code from the business number —
  a RAW Telnyx send: no messages row, so it can never meter, bill, or count against
  rate/cap arithmetic (status webhooks for it are ledgered no-ops); it runs the full
  runPreSendGates compliance chain and pre-checks opt_outs (a prior STOP would otherwise
  40300-drop the code invisibly). Codes live hashed (sha-256, membership-scoped) with a
  10-min TTL, 5 guarded-increment attempts, a 60s resend cooldown, a 6-per-24h durable
  window (cost protection — every send is our money), and VERIFY_RATE_LIMITER keyed on
  the TARGET cell. POST /v1/calls refuses an unverified cell; cells that predate D40
  grandfather as verified (they were collected under D38 and already placed real calls).
  Migration `20260711100000`.
- **Both BROKEN audit findings fixed:** (1) the voice re-reporter dropped out_customer
  legs — its hygiene sweep stamped them non-billable and its retry query never selected
  them, so any outbound leg whose inline Stripe report failed was silently un-billed
  forever; both billed legs now retry (crons.ts). (2) notifyMissedCall ignored the #106
  deny list the bell arm honors — level-'none' members received the caller's name by
  email/push; the audience filter now mirrors notifyInboundMessage.
- **Liveness:** `calls` gains a §8 broadcast trigger (`call.updated`) + web invalidation,
  so /calls and the For You section update live; `api_sweep_stale_calls` (hourly cron)
  flips sessions wedged in-flight >4h to 'missed' (migration `20260711110000`; trade:
  a >4h-late answered hangup can no longer correct the row — at that age the webhook is
  lost, not late). POST /v1/calls adds a per-conversation in-flight guard (double-dial =
  double Telnyx spend), hangs up the agent leg when Telnyx returns no session id or when
  post-dial persistence fails (the retry-inviting error must be safe to obey), and the
  Call button holds a 30s "calling" state instead of instantly re-arming.
- **Grandfathered honesty:** usage.ts, the alerts job, and every fed surface now read the
  module's grandfathered flag — included = 300, cap = allowance, `overage_billed: false`,
  pause-not-bill copy, and the 80%/100% alerts fire against the REAL pause line (they
  previously fired at 12% of it… i.e. never before the pause).
- **Reach:** the Call button is visible on MOBILE (it was `hidden sm:inline-flex` — the
  phone-first customer literally could not call), gated off for #106 note-level viewers
  (dead control), rendered disabled while modules load (the tel: fallback leaked personal
  cells in that window), and the contact page gains the same Call control next to
  Message. For You gains "Recent calls" (3 rows + View all — the mobile entry point).
  /calls rows carry direction icons, in-flight labels ("Calling…"/"In progress"), an
  unthreaded-row explainer, and a module-off upsell banner when rows exist.
- **The rename:** the module is "Calling" in both catalogs, the live Stripe product
  (renamed in place — `prod_UqjfyFqM50VpvM` → "Loonext — Calling"; stripe-setup now
  converges names), every app string, and all marketing/docs — including retiring the
  now-FALSE claims "Loonext can't place calls" / "no calling inside the app" on the
  compare pages and llms.txt. "Forwarding" survives only as the verb for the inbound
  mechanic.

**D40 addendum — adversarial review (34 agents), 11 confirmed findings, all fixed
before ship:** the verify handler's TOCTOU (an old code could verify a NEWLY-PUT
number — the exact harassment-by-proxy D40 exists to stop) closed by scoping the
code hash to the CELL and guarding the success UPDATE on (cell, hash); the
double-dial guard made atomic (`api_claim_outbound_dial` lease, one winner per
conversation, 2-min TTL, released once the calls row is visible) with the state
check extended to the 4h sweeper window (it lapsed 10 minutes into a live call);
the code-send window made a guarded increment (the 6/24h budget is enforced, not
observed); grandfathered alert thresholds ledger under `voice_minutes_grandfathered`
so a mid-period paid upgrade re-arms the plan alerts; the overage projection reads
the grandfathered flag (no phantom 1¢ revenue, ceiling at the legacy line, no
phantom $8 module revenue); and the wave's biggest catch — every calling surface
gated module state on ADMIN-ONLY GET /v1/billing/modules, so plain members always
read module-off and got the tel: personal-cell leak: the company view now carries
member-visible `enabled_modules` and every gate reads it (errored/loading state
renders a disabled button, never tel:). Verify dialog opens on the code step for
a saved-unverified cell with an explicit Resend. #106 alert tests use schema-real
fixtures and pin the notes-only case.

## D42. Calling is included on every plan — the $8 module retires (#134, 2026-07-11)

Founder: "why are we charging for voice? shouldn't it just be included and available
for everyone?" Yes — and the honest economics say the $8 never carried the risk anyway:

- **The exposure was never the module fee.** A heavy caller's cost lives in the
  INCLUDED minutes (2,500 × ~1.2¢ combined-leg ≈ $30 against a $29 Starter) and that
  existed with the module too. What bounds it: almost no crew approaches the allowance
  (fair-use posture), the #85 pacing warning flags a tenant trending to cost more than
  they pay mid-period, overage past the allowance BILLS at 1¢/min to the cap then
  pauses (D36 mechanics unchanged), and reasonable-use enforcement covers abuse.
- **The gate was hurting the product.** Missed-call text-back is the hook, and it sat
  behind a toggle; three of the #133 production bugs were module-gate states
  (module-off tel:, admin-only module reads, unbound numbers). Retiring the module
  deletes the whole class: no module-off UI, no upsell dialogs, no grandfathered
  variants, no voice-binding gates.
- **Mechanics:** the #103/#121 retirement playbook. PLAN_MODULES drops 'voice';
  the daily reconcile's retired-price sweep strips live $8 items WITH prorated
  credit; the voice METERED item now attaches to EVERY live subscription (overage
  still bills — that part is usage, not packaging); voice binds on every active
  number of every active workspace; GRANDFATHERED_VOICE_MINUTES and every
  grandfathered read/copy/metric retire (plan allowances for all); MCTB/forwarding
  settings gates drop. Legal/fair-use reframes from "the optional calling add-on"
  to calling-included; marketing drops every "$8/mo" calling claim (the one
  remaining add-on is Canada numbers).

## D43. Calls v2 — the browser is the phone (#135, 2026-07-11)

Founder directives, four in one wave: voicemail; Telnyx inbound screening
(per-workspace toggle, scam labels in UI); NO cell forwarding whatsoever
(forward_to_cell, the D38 bridge, and the D40 cell verification all DELETE —
the browser replaces the cell as the endpoint, so the machinery that existed
to reach a cell dies with it); caller ID both directions with a
workspace-chosen outbound CNAM; and full live-call handling (in-call notes on
the thread, server-side hold, blind + announce member transfer with
auto-recovery, call waiting). Full design with verified Telnyx mechanics:
docs/CALLS-V2.md. Key research facts that shaped it: Telnyx inbound
screening is FREE and native (flag_calls verdicts on call.initiated);
outbound CNAM is per-number and free (≤15 chars, 12–72h propagation);
inbound CNAM is a $0.40/number/month flat dip; browser ringing keeps the
number on OUR Call Control app (one Dial per online member's credential,
first answer wins) so the server never loses webhook control; Telnyx custom
recording storage doesn't support R2 → fetch-and-copy within the 10-minute
presigned window, then delete their copy. Honest tradeoff accepted by the
founder: a closed browser cannot ring — push + voicemail + text-back are the
nets. Ships in three phases after D42.

**D42 addendum — money-path adversarial review, 6 confirmed findings, all fixed
pre-ship:** the voice metered item now ALSO converges from the daily reconcile
sweep (webhook-only attach left every quiet pre-D42 subscription unbilled for up
to a cycle — the majority case, since healthy subs emit no events); its
idempotency key is day+price-scoped (a cached Stripe failure or a plan change
can no longer stall the attach for 24h); enableVoiceForCompany isolates
per-number failures (one un-bindable number no longer aborts the batch);
ENABLING MCTB/forwarding requires a live subscription again (honest 402 — the
voice webhook would silently never fire for a canceled workspace); deploy skew
is handled server-side (a stale pre-D42 bundle sending modules:["voice"] checks
out cleanly WITHOUT the retired item instead of dead-ending 422, and a stale
settings toggle gets the honest "calling is included now" 409). Known bounded
gap accepted: a pre-D42 PENDING-DOWNGRADE schedule owns its items and carries
no voice price until it releases at period end — fails toward unbilled,
customer-favorable, prod population zero.

**D43 phase-1+2 progress (2026-07-12).** Phase 1 (browser softphone) and
phase 2 (inbound ring + voicemail + screening + CNAM) are BUILT and the
deletion is DONE:

- Outbound: POST /v1/webrtc/token mints per-member credentials on the shared
  WebRTC connection; POST /v1/calls/browser authorizes (all gates
  server-side) and the SDK dials with the `oc_customer` tag so billing/
  threading ride the existing webhook path unchanged.
- Inbound: call.initiated rings every eligible member's credential in
  parallel (`brm` legs; #106 'text' holders only; the caller keeps carrier
  ringback — nothing answers or bills until a human does). First answer wins
  atomically (api_claim_ring_answer); the winner's answer stamps the `bri`
  tag whose timestamp anchors talk-time billing (new call_records leg
  'in_browser' in the one D36 pool). Last leg to fail → voicemail
  (api_ring_leg_failed, exactly-once): TTS greeting → beeped mp3 (≤120s) →
  fetched into the private 'voicemails' bucket inside Telnyx's 10-minute
  window → Telnyx copy deleted → outcome upgraded via the voicemail-wins
  merge → threaded with CREATE + a playable timeline line. Text-back fires
  for every unanswered path.
- Line model (founder-binding): the calls row lands at call.initiated
  (outcome null = the line is occupied); a busy line goes straight to
  voicemail. One live call per number; NO conferencing ever.
- Screening: off/flag/divert. Telnyx-side both flag and divert map to
  flag_calls — divert is OUR routing (flagged → voicemail), so a misflagged
  human can still leave a message. Verdict + STIR/SHAKEN + dipped caller
  name persist on the calls row for honest labels.
- DELETED (founder: "no forwarding whatsoever"): companies.forward_to_cell,
  the D38 cell bridge (POST /v1/calls), the D40 cell verification (endpoints
  + company_members.call_cell_* columns), the ForwardCard/YourCellCard/
  dialog UI, and the marketing "rings your cell" copy. The webhook keeps
  classifying legacy forward-leg tags so calls in flight across the deploy
  terminate correctly; nothing creates them anymore.
- Settings › Calling (nav renamed from "Missed calls"; slug kept): text-back,
  voicemail greeting (spoken default from the company name), screening
  choice, CNAM display name + caller-name lookup — synced per number.
- Open for phase 3: hold/transfer/call-waiting/in-call notes, outbound
  in-flight rows at call.initiated (the browser-dial guard currently only
  sees rows after hangup), and real-device audio verification (mic + WebRTC
  cannot run in the screenshot harness — founder test pending).

**D43 phase-3 progress (2026-07-12, same day).** Live-call handling shipped
under the line model (one live call per NUMBER; no Telnyx conferences ever):

- The session row now lands at call.initiated for OUTBOUND browser calls too
  (oc_customer leg) — the line reads busy for the call's whole life, and the
  browser-dial guard is NUMBER-scoped ("This line is on another call").
- Threading happens at ANSWER (create-if-missing for every inbound call), so
  the member takes notes DURING the call — the call bar deep-links to the
  conversation. api_thread_call's create rule widened accordingly.
- HOLD is client-side (@telnyx/webrtc call.hold(); the customer stays
  connected — held time bills honestly, per design). The web softphone is
  MULTI-CALL: one active + one held/ringing per member (call waiting =
  hold-and-answer, flip freely); a third concurrent invite auto-declines so
  races resolve fast.
- BLIND TRANSFER: Telnyx `transfer` on the customer leg to the target's
  credential (brt tag carrying session/target/sender/hops/caller; the
  customer leg's client_state is never re-sent, preserving the bri billing
  anchor). Decline/timeout auto-recovers: hop 0 snaps the customer back to
  the sender; the hop cap (1) diverts to voicemail — never dead air.
- ANNOUNCE (CONSULT) TRANSFER: the consult is its own two-party member call
  (both legs dialed on the Call-Control app, brc tags, call_member_legs
  kind='consult' — the ring RPCs now filter kind='ring'); complete =
  bridge-STEAL the customer onto the target's consult leg + hang up the
  sender's. Journey lines ("A transferred the call to B") land on the
  thread via dedupe-scanned call_completed events.
- Endpoints: GET/POST /v1/calls/live/:sessionId{,/targets,/transfer,
  /consult,/consult/complete,/consult/cancel} — all #106 'text'-gated on
  the call's number, company-scoped, live-and-answered only.
- Suites: API 1403, web 1277, tsc+eslint clean both. Real-device audio
  verification (mic + WebRTC) remains the founder's test.

**D43 hardening — adversarial review, ~15 confirmed findings fixed
(2026-07-12, migration 20260712000400).** A multi-dimension adversarial
review (race, replay, security, telephony, billing, ux) surfaced real bugs;
all confirmed ones are fixed:

- CRITICAL fixes: (a) voicemail pipeline no longer depends on
  payload.to/from (call.recording.saved doesn't carry them) — it resolves
  company/number/caller from the calls row, so voicemail actually persists;
  (b) inbound answered calls resolve the CUSTOMER session id via
  GET /v1/calls/live/by-leg/:legCcid (the SDK exposes the member RING leg's
  session, which is NOT the calls-row key) — transfer/consult/notes now
  address the right row; (c) api_claim_ring_answer returns won|already|lost
  and the handler NEVER hangs up the winner on a replayed call.answered
  (the old boolean claim killed live calls on webhook redelivery);
  (d) announce-transfer complete deletes the consult ledger rows BEFORE
  hanging up the sender leg, so the sender-hangup's dismiss can't tear down
  the target leg now carrying the customer.
- SECURITY: the outbound gate is enforced SERVER-SIDE in the webhook
  (handleOutboundInitiated rejects a leg over the voice cap, from a dead
  subscription, or presenting a number we don't own) — the browser can no
  longer skip POST /calls/browser to place ungated/cross-tenant calls; and
  the blind-transfer leg is now LEDGERED (kind='transfer') so a forged brt
  client_state can't rewrite answered_by / fabricate journey events.
- COST: in_browser billable legs rejoin the Stripe re-report queue (the #133
  bug reintroduced); a runaway-call sweep hangs up any live call answered >2h
  ago (browser legs carry no Telnyx time_limit); the voicemail leg is hung
  up after the recording saves; out_customer bills from answered_at (not
  ring time), matching the inbound bri anchor.
- CORRECTNESS: anonymous/CLIR callers ('anonymous' marker) normalize to null
  so the SIP dial presents the business number instead of 422-ing;
  api_ring_leg_failed takes a per-session advisory lock (no deadlock on
  simultaneous timeouts); line-busy is an ATOMIC claim (api_claim_inbound_line
  under a per-number advisory lock); the transfer hop-cap ends the call
  cleanly (correct talk-time billing) instead of a broken answer on the
  already-answered leg; cnam_listing moves to the /voice sub-resource (the
  base PATCH silently ignored it — verified against the live Telnyx API);
  transfer/consult targets see the CUSTOMER as caller ID; a replayed
  initiated for an ended call no longer re-rings; the over-cap reject
  tolerates a dead-leg 4xx (no ledger-replay burn).
- Refuted / not-a-bug (documented residuals): the client-side WebRTC #106
  per-member check can't run in the webhook (the leg carries no member id) —
  a note-only member forging a call only bills their OWN workspace, the small
  residual behind the two closed holes. Suites: API 1411, web 1277.

**D43 hardening round 2 — the fix-verification workflow found 8 bugs IN THE
FIXES (2026-07-12, migration 20260712000500).** An Opus adversarial re-review
of the round-1 fixes (42 confirmed good, 8 real, 1 refuted) caught:
- MAJOR: api_claim_ring_answer had the same write-skew the sibling
  api_ring_leg_failed was already locked against — two distinct member legs
  answering concurrently both passed the lock-free NOT EXISTS and both won,
  stranding a leg; added the per-session advisory lock.
- MAJOR: the outbound gate only fired for the oc_customer-TAGGED leg, so a
  browser call crafted WITHOUT the tag (untagged outgoing → inbound_untagged
  → handleInboundInitiated returns) skipped the gate entirely and still hit
  the PSTN; now EVERY outgoing initiated routes through the gate (our own
  server-issued legs are recognized and skipped; an untagged/forged leg is
  rejected outright).
- MAJOR: the Telnyx recording was deleted BEFORE the outcome/thread/timeline
  writes committed — a replay after a throw in that window lost the voicemail
  (no re-fetch source); the delete now happens LAST, and a replay recovers
  from our own bucket (voicemail_path stamped) instead of re-fetching.
- MINOR (all fixed): the answered stamp is compensated when the caller
  abandons in the answer window; ring compensation hangups are per-leg
  best-effort; /consult/complete requires the caller to BE the sender;
  stampOutboundAnswered throws (→ replay) when answered races ahead of
  initiated; the blind-transfer target leg is now resolvable (its real ccid
  is stamped onto the ledger row and by-leg matches kind in ring|transfer).
Suites: API 1413, web 1277.

**D43 — cross-tenant caller-ID residual CLOSED (2026-07-12, migration
20260712000600).** The founder rejected shipping the documented residual (a
member presenting another tenant's number as caller ID and billing it). Root
cause: the browser originates the WebRTC leg, so the webhook saw only the
presented number, not who placed the call. Fix: POST /v1/calls/browser —
which already proves the authenticated member has #106 'text' access to THEIR
OWN company's number, with a live subscription and under the voice cap — now
mints a SINGLE-USE authorization (outbound_call_authorizations nonce);
handleOutboundInitiated requires it (api_authorize_outbound_call consumes it
IFF minted for exactly this presented caller number + fresh, and binds the
call to the AUTHORIZED company/number, never the presented one). A member can
only ever mint a nonce for their own company's numbers, so a call presenting
any other number has no valid authorization and is rejected. This ONE change
closes all three residuals at once: cross-tenant caller-ID billing, the
note-only #106 bypass (a note-only member can't mint a nonce), and the
forged/omitted client_state (no nonce → rejected). Replay-safe (the RPC
recognises an already-authorized session's row) and burst-defended (a
subscription/cap re-check keyed on the authorized company). Suites: API 1414.

**D43 — comprehensive final audit found a CRITICAL + 3 majors, all fixed
(2026-07-12, migrations 20260712000600 reservation-atomicity in 000700).** A
full-engine Opus audit (not just the fixes) caught what the incremental rounds
missed:
- CRITICAL cross-tenant billing/DoS/injection via a FORGED inbound-family
  client_state: the nonce closed the OUTBOUND (oc_customer) path, but a member
  could ORIGINATE an outgoing WebRTC leg, forge a `bri`/`vmi`/untagged tag, and
  present a VICTIM tenant's number as `to`; the terminal handler derives tenant
  + billing from the tag + payload.to, so it billed the victim (in_browser
  seconds come from the attacker-controlled bri timestamp → ~$34k), pushed them
  over cap (DoS), and injected a conversation/missed-text into their inbox.
  Fix: a genuine inbound-family leg is ALWAYS Telnyx-direction 'incoming'; the
  terminal handler now drops any inbound-family leg that isn't, before billing/
  threading. Plus a 4h billable-seconds clamp (defense in depth).
- MAJOR outbound line-model race: /calls/browser claimed the line lock-free and
  created no row (the calls row lands at initiate), so two outbound calls — or
  an inbound during the authorize→initiate window — could both go live. Fix:
  api_claim_outbound_line claims the line + mints the authorization atomically
  under the same per-(company,number) lock the inbound claim uses; the
  authorization row doubles as a fresh reservation both busy checks now consult.
- MAJOR member stranded in dead air when the caller hangs up in the answer
  window (the member's active SIP leg was never torn down): hang it up.
- MAJOR web two-active-calls audio steal (a still-ringing outbound leg
  answering while the member is on a second call): the reducer now enforces a
  single active call structurally (demote the other to held) and the provider
  SDK-holds it. Suites: API 1415, web 1278.

**D43 — fix-verification round 2 found the direction gate MISSED the legacy
'forward' tag (still critical) + 2 majors, all fixed (2026-07-12, migration
20260712000800).** Verifying the previous fixes caught:
- CRITICAL: the direction gate covered in_browser/vm_inbound/inbound_untagged
  but NOT the legacy 'forward' tag (mctb_forward) — which is legitimately an
  OUTGOING leg, so direction can't catch it. A forged forward tag presenting a
  victim number as `from` still billed/injected/text-backed the victim. ROOT
  FIX: every leg reaching the terminal handler is now gated by an UNFORGEABLE
  server-side proof — inbound-family legs (tenant from payload.to; now
  including inbound_forwarded) require Telnyx-direction 'incoming'; tenant-
  from-`from` legs (forward, out_agent, out_customer) require a genuine
  server-created calls row (created at the authorized inbound-claim / outbound-
  authorize). forward + out_agent are dead so never have one; a forged
  out_customer was rejected at initiate so has none either. The three
  dispatched leg types (brm/brt/brc) never reach the terminal handler and have
  their own ledger checks. The whole leg surface is now closed.
- MAJOR: the line reservation was 'fresh' for 30s but the nonce lived 120s, so
  a dial landing 30-120s later found the line free → race. Fix:
  api_authorize_outbound_call re-runs the per-number line busy check under the
  per-(company,number) lock at initiate and refuses a call whose line went
  live meanwhile (lock order session→number, no cycle with the claim RPCs).
- MAJOR: the answer→bridge window had the same dead-air strand as the answer
  window — a bridge failure (caller OR member gone) now hangs up BOTH legs.
Suites: API 1416, web 1278.

**D43 — LAUNCH BLOCKER: the security header disabled the microphone (2026-07-12,
founder's first live call).** Every outbound call died instantly with a
"[contact] ended" toast; zero calls rows, zero `call.initiated` webhooks, zero
Telnyx CDRs — the call never left the browser. The whole calls stack (server
gates, nonce auth, line model, Telnyx connection) checked out; the failure was
one line UPSTREAM of all of it. The D8 hardening header
(`apps/web/src/lib/observability/security-headers.ts`), written before calling
existed ("deny features nothing uses"), set `Permissions-Policy: microphone=()`
— microphone disabled for our OWN origin. The @telnyx/webrtc SDK's
`getUserMedia({audio:true})` was refused at the policy layer
(`MEDIA_MICROPHONE_PERMISSION_DENIED`) BEFORE any SIP INVITE, so nothing ever
reached Telnyx. Symptom chain: mic blocked → SDK aborts peer-init → call
"ended" → the line reservation minted a beat earlier strands for 30s → the
NEXT click hits "This line is on another call" (the phantom the founder first
reported). Fix: `microphone=(self)` (first-party only; camera/geo/payment/usb
stay fully denied, mic denied to any embedded frame). Verified end-to-end on
prod: an outbound call to a real number recorded `outbound|answered`.
LESSON: a feature that needs a powerful browser API (mic/camera/geolocation)
must be co-designed with the Permissions-Policy — the softphone shipped without
anyone re-checking the D8 header, and no test/preview catches it (the mic can't
run in the screenshot harness; the header value was locked by a unit test that
asserted the OLD, mic-denying string).

**D43 — a denied mic prompt is now recoverable, not a dead end (same day).**
Follow-on hardening after the header fix: placing AND answering a call now runs
`getUserMedia` BEFORE reserving the line. A denial (a fresh Block, a
browser-remembered Block that throws with no prompt, or a missing device) throws
a `MicPermissionError` with an actionable message ("click the 🎤 in the address
bar → Allow") instead of a silent "ended", creates NO line reservation (so no
"on another call" phantom on retry), and never bills. Tracks are released
immediately; the SDK re-acquires with the granted permission (no second prompt).

**D43 — INBOUND calling fixed: two bugs, live-verified answered call (2026-07-12).**
Founder: "they called me, nothing popped up, went to voicemail, then 'this line
is on another call'." (1) LINE-WEDGE: `handleTerminalCallEvent` gated inbound-
family legs on `direction === 'incoming'`, but Telnyx OMITS `direction` on the
LATER events of an ANSWERED leg (the voicemail leg's call.hangup), so the hangup
that resolves the call was dropped → the calls row stuck outcome-null → line busy
4h → every SUBSEQUENT inbound call correctly skipped the ring → straight to
voicemail (outbound got "on another call"). FIX: gate inbound-family on the SAME
unforgeable calls-row-exists check the outbound legs use (a forgery has no
server-created row; the bri/vmi/in_browser legs all share the customer session
that holds it). (2) RING NEVER REACHED THE BROWSER: the ring dialed
`sip:<sip_username>@sip.telnyx.com` from the number's VOICE connection, but every
browser registers its credential/JWT on the WebRTC connection (webrtc.ts) — a
SIP-username INVITE only resolves to a registered client when it enters THAT
connection's realm, so the leg came back `state='failed'`. FIX (both halves
required): dial the ring FROM `TELNYX_WEBRTC_CONNECTION_ID` (inbound-ring.ts;
guard → voicemail if unset) + set `sip_uri_calling_preference:'internal'` on that
connection (the preference is read on the ORIGINATING connection; create-default
is null/disabled — see docs/deploy/04-telnyx.md). Diagnosed with a 3-angle +
adversarial-verify Workflow. Verified LIVE: inbound went failed→ringing→answered,
`outcome=answered`, 0 wedged rows. Also this wave: call-any-contact + a real
dialer (`/v1/calls/browser` takes conversation_id | contact_id | raw `to`; US/CA
NANP guard).

**D43 — softphone reliability + in-call UX round (2026-07-12).** Building on the
inbound fix, four increments (all `provider.tsx`-centred, device-verified per its
contract, tsc+eslint+suite green each): (a) AUTO-RECOVERY — the SDK self-reconnects
transient socket drops, but on exhaustion (long-backgrounded tab, network flap,
token expiry) nothing re-established it → the phone silently stopped RECEIVING
until reload; now `telnyx.socket.close`/`telnyx.error` + `visibilitychange`/`online`
rebuild the client (fresh token → fresh SIP registration) ONLY when down (never
disturbs a live call). (b) A "Ready / Connecting…" status chip on /calls — the
whole incident was invisible because nothing showed whether the browser was
registered. (c) OS notification on an inbound ring (backgrounded-tab members miss
the in-app call bar); permission rides the existing Web Push flow, never prompts.
(d) In-call DTMF keypad (`call.dtmf(digit)`) for phone-menu/IVR navigation.
LESSON (browser-as-phone): a WebRTC softphone only rings while a tab is OPEN +
its socket registered; "ring when closed" needs push-to-wake (Telnyx supports it
mobile-first) — a separate, larger piece, deferred.


## D44

**D44 — Native mobile apps are IN scope: Android (Material 3 Expressive) +
iOS 26 (Liquid Glass), epic #150 (2026-07-15/16).** Supersedes the MVP-era
"native apps are out of scope" lines above (§D-early, deliberately-not-built
list): the founder called web "not optimal for enterprise" and mandated full
native parity — calls, texts, settings, teams, invites, tasks, notifications,
auth, everything. Standing decisions:

- **Stack.** Android: Kotlin + Jetpack Compose, `MaterialExpressiveTheme`
  (material3 1.5.0-alpha24 — the Expressive APIs are internal in 1.4.0 stable),
  AGP 9.3 / compileSdk 37 / minSdk 28, no DI framework (one hand-rolled
  `AppGraph`). iOS: Swift 6 + SwiftUI, deployment target iOS 26 so Liquid
  Glass is native everywhere, XcodeGen (`project.yml`), SPM only. Both apps
  bundle Golos Text (OFL) and the calm-petrol G11 identity.
- **No auth SDKs.** Both clients speak GoTrue REST directly (4 endpoints) and
  hit /v1 with `Authorization: Bearer` + `X-Company-Id` — the API's existing
  contract, zero server changes. Sessions: DataStore (Android app sandbox) /
  Keychain (iOS). Refresh is single-flight with a stale-token force path (a
  401 on an unexpired-looking token still refreshes exactly once).
- **Wire models are decode-proof.** Server string enums stay strings with
  constant namespaces client-side (a lagging app must never crash on a new
  server value); every list is `{data, next_cursor}`; realtime payloads are
  ID-only → refetch; signed attachment URLs are minted per view, never cached.
- **Push.** One FCM HTTP v1 sender in the api Worker (#151) serves BOTH
  platforms (Android data-only messages, iOS via FCM's APNs bridge);
  `device_push_tokens` (cap 10/user, oldest-evict) mirrors push_subscriptions.
  iOS incoming-call wake is NOT FCM — it's Telnyx's own VoIP push credential
  (PushKit + CallKit, founder uploads the VoIP cert in the Telnyx portal);
  Android call wake rides our FCM `kind:'call'` + ring-me. Everything
  degrades to a logged no-op until the founder provisions Firebase
  (PRODUCTION.md §Firebase) — deploys stay green.
- **Store posture (BINDING).** The apps sell nothing: workspace creation +
  checkout stay on the web (the apps hand off to app.loonext.com in the
  EXTERNAL browser and say so honestly); billing portal/checkout links always
  open external Safari/Chrome, never a webview, and the apps contain no
  purchase language — the Spotify/reader posture, no IAP obligation.
- **Calls native = same plumbing as web.** `POST /v1/webrtc/token` mints the
  same Telnyx credential login token for the native SDKs (Android 3.5.0 via
  JitPack, iOS 4.1.0 via SPM); `client_state` must hit the wire VERBATIM —
  the adaptation lives at the SDK boundary and DIFFERS per platform: the
  ANDROID SDK base64-encodes what it's given (verified from bytecode — pass
  the decoded tag), while the iOS SDK passes clientState through unchanged
  (traced TxClient→InviteMessage on 4.x — identity adapter). Both round-trips
  unit-tested.
- **Parallel-agent dev discipline.** The epic was built by exclusive-file-
  partition agents (one dir tree per agent, shared files integrator-only,
  compile serialized through one Gradle daemon) — the same rule as parallel
  sessions on this tree; it held twice (waves of 6), zero merge conflicts.

## D45

**D45 — Missed-call notifications are push-only: the email leg is retired
(2026-07-17).** Founder, from live use: "email on every missed call and then to
every member... it's overdoing it, not sure if even needed." He's right — a
missed call already reaches the crew four ways (native FCM push, Web Push, the
bell feed, For You) and the CALLER gets the missed-call text-back, so a Resend
email to every email-enabled member per miss was pure noise and cost. The
email channel now belongs to the §8 inbound-message pipeline only (those keep
their opt-out footer + List-Unsubscribe semantics unchanged). The #106
number-access audience gate is unchanged and now observed at the
push-subscription lookup in tests. If a customer ever wants missed-call
emails back, that's a per-TYPE notification-prefs feature to design
deliberately — not a default.

## D46

**D46 — AI task enrichment is opt-in, suggestion-only, and cost-capped
(2026-07-23, #214).** A task can now carry a structured job address, and when a
teammate promotes a message to a task the app can infer that address + a due
date/time from the message text via Cloudflare Workers AI
(`@cf/meta/llama-3.2-1b-instruct`, the cheapest model). Binding posture:
- **Opt-in, default OFF, per enrichment.** `company_ai_settings` toggles (task
  address / due) gate the feature per company; nothing calls the AI until a
  company turns a specific enrichment on (it costs money and the model sees
  message text). Reads are member-visible, writes admin-only.
- **Suggestion, never a side effect.** Model output is DATA: parsed as strict
  JSON, schema-validated, rejected on ANY deviation. No tool use; the result
  only pre-fills a form the user reviews and edits before saving. The task text
  is fenced as untrusted data in the prompt (injection boundary), so even a
  fully hijacked model can at worst suggest a wrong address the user corrects.
- **Cost cap-and-drop (cost-protection mandate).** `POST /v1/tasks/enrich` never
  blocks task creation and degrades to "no enrichment" on every failure path:
  toggles off, no AI binding, per-company burst limit, a hard monthly cap
  (`company_ai_usage`, atomic `ai_enrich_reserve`) with a one-shot ops alert at
  80%, an 8s timeout, or malformed output. Reservation precedes the call so the
  cap can never be over-spent.
- **Provenance + fallback.** Address resolves text → linked contact's address →
  area-code inference, each surfaced with a provenance badge; a user edit marks
  it "manual". Session-cached per (company, message) so re-opening the composer
  reuses the result instead of spending another call. Parity across
  web / iOS / Android.

## D47

**D47 — D32 stands: no dedicated review feature, and none is needed
(2026-07-26, #322).** #229 proposed rebuilding the review-request flow that D32
deleted twice by explicit owner direction ("remove the Reviews section
completely, we don't need that"), whose schema is gone in two migrations
(`20260704060000_drop_claim_review_request.sql`,
`20260705010000_drop_google_review_link.sql`) and whose research framing is
already marked "[WITHDRAWN — removed by D32, do not build]" in
`docs/customer-gap-analysis.md` §6. Re-affirmed rather than amended, for three
reasons:

- **The original objection has strengthened, not weakened.** D32's stated
  reason was that a dedicated one-tap ask is a SECOND send path carrying its
  own suppression and quiet-hours plumbing for something a saved template
  already does. Since then the pre-send gate surface has grown — carrier-truth
  opt-out, the #226 consent ledger, #225 quiet hours, #292 recipient timezone —
  and every automated outbound path has to satisfy all of it. A second pipeline
  is more expensive today than it was when the decision was made, not less.
- **The gap closes without it.** Templates plus merge fields (#274) let an
  owner keep "Thanks for having us out — if you have a minute: <their link>" as
  a saved reply and send it from the thread that is already open. That is one
  tap through the ordinary compose gates, which is what D32 said the answer was.
- **Reversing a binding owner decision is the owner's call, not ours.** The
  research behind #229 is genuinely strong (SMS review asks outperform email,
  and reviews matter to a local trade). If the owner wants it back, this
  decision is the thing to amend — and the amendment should route through the
  shared send gate rather than reintroducing a bespoke path.

**Consequences.** #229 is closed as won't-do, citing this. #313 (post-job
satisfaction) is rescoped to an INTERNAL quality signal only — no public-review
path, no review-gating question — which is still worth building and is a
different issue from the one that was written.

## D48

**D48 — Workspace deletion is SCHEDULED erasure with immediate access loss, and
what the law makes us keep is anonymised rather than erased (2026-07-26,
#341).** `DELETE FROM companies` cannot work: 38 foreign keys point at that row
(25 `restrict`, 13 `cascade`), plus three Storage buckets, a Stripe customer, a
Telnyx number and every push registration. The decision the issue asked for,
made explicitly rather than left as an implementation detail:

- **Two phases, not one.** The customer's request is ONE transactional state
  change — the workspace is closed, every session is ended, the number is
  released, and it disappears from everybody's workspace list. The erasure
  itself then runs as a **resumable job with a recorded position**. This is
  forced, not chosen: external stores are not transactional, so a synchronous
  "delete now" across Storage + Stripe + Telnyx can fail halfway with no way
  back — which is exactly the partial-teardown hazard #341 identifies, and the
  worst outcome a deletion feature can have.
- **The window is 30 days, and it is reversible inside it.** A workspace
  deleted by mistake — a wrong click, a departing admin, a dispute between
  owners — is recoverable until the job runs. After it runs, nothing is.
- **Access ends at the request, not at the erasure.** The customer experiences
  deletion immediately. Nothing about the window leaves anyone able to read a
  message.
- **`opt_outs` survives deletion outright.** A STOP is the recipient's, not the
  workspace's: erasing it would let the same business, re-signed-up on the same
  number, text somebody who told them to stop. This is the one record where
  deleting the customer's data would harm a third party, and it stays.
- **Consent artifacts are anonymised, not erased.** SPEC §5 holds consent
  records and message history for three years (CASL). We keep the minimum that
  proves consent existed — the phone number, the timestamps, the source — and
  erase everything around it: names, emails, addresses, message bodies,
  attachments, voicemail audio.
- **The copy says all of it before the button.** What is erased, what is kept,
  why, for how long, and that it cannot be undone after the window. Honest
  consequence copy, in the same register as our honest failure copy — "deleted
  now" and "deleted in 30 days" are different promises and only one is true.

The ordered teardown across all 38 relationships and the external stores lives
in `docs/DELETION.md`. #341 also assumed R2 for attachments and voicemail
audio; those are Supabase Storage buckets (`attachments`, `mms-media`,
`voicemails`) and the document names them correctly.

---

## D49 — the destination clock is a ladder, and it never runs out of rungs (#292)

Quiet hours are destination-local (D4), inferred from the area code. Two things
were undecided, and both only bite when nobody is watching the send go out.

**A contact can carry a timezone, and we store only the correction.** Area codes
lie: a mobile number keeps its original code when its owner moves provinces, and
that gets more common every year. A dispatcher who knows a customer is in
Alberta can now say so.

What is stored is the OVERRIDE and nothing else. Storing the inferred value too
would look tidier and would rot: the NANP table gets corrected, and every
contact keeps the answer it was given the day it was created, with no way to
tell a stale copy from a deliberate choice. A null column means "ask the
inference", which is always current, and provenance falls out of it rather than
needing its own bookkeeping.

**When inference has no answer, fall back to the SHOP's clock, not to a
guess.** The case is narrow — a US/CA number on a non-geographic area code,
which passes the destination gate but has no region. There were three options:

- Treat it as in-hours. Fine for a human pressing send, who is choosing. For an
  automated path it means breaching a legal window and never knowing.
- Treat it as quiet. Safe and useless: the message never goes at all.
- Use the intersection of 8am–8pm across every US/CA zone. Defensible, and
  about four and a half hours a day once Hawaii and Newfoundland are both in
  it — a window so narrow it would bunch every deferred send into the same
  slice of the afternoon.

We use `companies.timezone`. A tradesperson's customers are overwhelmingly
local to the business — that is the entire premise of the product — so the shop
clock is a far better estimate than any of the above, and it is a value the
owner chose rather than one we invented. The resolver reports which rung it
landed on, so a screen can say "their area code doesn't say — using your
timezone" instead of stating a fact it does not have.

**Every automated path resolves at FIRE time, through the one resolver.** Not
at schedule time: a message queued at noon and sent at 11pm was resolved
against the wrong instant. The failure mode is silent — a path that simply
never asks produces a 3am text with no error anywhere — so the resolver is the
only implementation, the compose gate uses it too, and a test enumerates the
files allowed to decide quiet hours.

**Amendment, 2026-07-29 (#225 ask 5): the confirmation is a setting, and its
NAME is the load-bearing part.** A 24-hour emergency trade starts new
conversations at 2am as a matter of routine and lawfully, because the customer's
house is flooding. For them the confirmation fires on every job at the worst
possible moment, and a prompt that is always dismissed teaches people to dismiss
prompts — so `companies.quiet_hours_confirm_enabled` lets an admin switch it off,
defaulting TRUE so nobody's behaviour changes on deploy.

#225 called for a column named `quiet_hours_enabled`, and we deliberately did not
build that. The two names describe the same boolean and license completely
different things:

- `quiet_hours_confirm_enabled` — does a PERSON get asked before starting a
  conversation into a quiet destination.
- `quiet_hours_enabled` — reads, to the next author, as "this company has quiet
  hours off", which is a claim about every send.

#237 (appointment reminders) and #313 (post-job ratings) are queued, and both are
texts we ORIGINATE on our own clock to somebody who did not just contact us —
the first genuine quiet-hours exposure this product will have. Their author will
go looking for existing quiet-hours machinery. Under the second name they would
find a global off switch, gate on it, and a plumber who dismissed a dialog would
have silently authorised 3am reminders to their customers. Nobody would have
decided that, and nobody would have noticed.

So the licence is written into the name, and enforced the D79 way rather than by
comment: `quiet-hours-confirm.test.ts` enumerates every file allowed to READ the
column (compose, plus two transport-only files), and names the reply-exempt and
automated paths that must never acquire it. Four previous sessions on #225 each
left a comment asking for this; a test is what makes it hold.

**The audit event records the fact, not an attestation.** A send inside the quiet
window still writes `quiet_hours_confirmed` with the confirmation switched off,
because the send did happen at 11pm the customer's time and that is what an audit
asks about. Its payload now carries `confirmed`, so the record distinguishes a
confirmation somebody gave from a send nobody was asked about — storing the
latter as the former would be a fabricated attestation in the one place that must
never hold one. All three clients now read the line as "sent during this
customer's quiet hours" rather than "confirmed sending"; web always did, and the
two mobile clients were saying something that the switch makes false.

**What ask 5 did NOT unlock.** Hold-and-release (#225 ask 3) is still unbuilt,
and deliberately: no send path today originates contact, so a hold queue would be
a mechanism guarding nothing and dead code by the time anything needed it. The
window table (ask 4) and the published policy (`/legal/messaging` §6) are done.

---

## D50 — merge-to-ship: the release PR is the only thing that reaches production

**Reverses the continuous-deploy half of the previous model.** Until now `api`
and `web` deployed on every green CI on `main`, while `android` and `ios` shipped
by hand through store review. That was defensible on its own terms, and it left
one thing genuinely broken: a version tag meant two different things depending
on which app it named.

`api-v0.5.0` recorded something live in production. `android-v0.3.0` was
published as a GitHub Release for a binary that had never been built as a release
artifact, never signed, and never uploaded anywhere — the repo has no keystore,
no export options, no store credentials. One tag was a record; the other was an
intention, and from the outside they were indistinguishable.

**One rule now: merging the release PR is what ships.** Every commit to `main`
still runs the whole gate — SQL suites from zero, e2e golden paths, typecheck,
lint, unit tests, both Worker builds. What a green CI no longer does is deploy.
Production changes when the release PR merges, and at no other time, for all
four apps: `api` and `web` deploy themselves at that moment, `android` and `ios`
are archived and uploaded by hand at that moment. Same event, same tag, same
meaning.

**What this costs, said plainly.** Migrations now sit on `main` unapplied until
the next release merge. The window between "merged" and "live" grows from
minutes to however long the release cadence is — the founder's own rule is a
release every ~10 issues. Two consequences follow and neither is optional:

- **Expand/contract stops being a nicety.** A schema change and the code that
  needs it now ship together, which is safer, but a migration that assumes
  same-commit deployment of its code is no longer a thing anyone can write.
- **A batch of work reaches production at once.** A bad release is a bigger
  blast radius than a bad commit. `wrangler rollback` is still seconds, and
  `supabase db push` still is not — the migration guard in CI carries that
  weight exactly as before.

**The escape hatch is load-bearing, not a convenience.** A stretch of work typed
entirely `chore`/`docs`/`ci`/`test` produces no release PR at all, because those
types are hidden from the changelog by design. Without a manual door, such a
change could never reach production. `Deploy` therefore accepts a
`workflow_dispatch` with a required written reason, recorded on the run.

**Three workflow files, and `needs:` is what orders them.**

- `checks.yml` — the gate. Every pull request runs it, and `main.yml` CALLS the
  same file on every push to `main`, so a PR and a merge cannot be checked
  differently. It deploys nothing.
- `main.yml` — the only pipeline for `main`: `gate` → `release` → `ship`.
- `ship.yml` — production, all four apps, called only when the release PR
  merged.

This replaced four workflows chained by `workflow_run`, and the chain was the
problem rather than the count. `workflow_run` is a TRIGGER, not an ordering:
nothing guaranteed release-please had pushed its tags before the deploy looked
for them, so the deploy had to poll for tags and keep a marker ref to work out
what it had already shipped. A cancelled gate produced no deploy and no
complaint. And "did this ship?" could only be answered by opening three
different runs and correlating them by SHA.

On 2026-07-26 six commits in a row failed the gate and shipped nothing, for a
whole day, while every workflow page looked ordinary. `needs:` cannot do that:
`ship` runs after `release`, reads `releases_created` straight off it, and one
run page shows the whole story.

**The phone apps are built by the ship run.** Not uploaded — built, and attached
to the run. Release day is "download these two artifacts and upload them",
rather than "build them on your laptop first and hope the release
configuration still compiles". The build being part of the pipeline is what
catches a release-config break on release day instead of after it.

**Store upload is still manual, and that is the remaining gap.** Automating it
needs an Android keystore, a Play service account and an App Store Connect API
key — credentials only the founder can create. Until those exist, the mobile
half of "merge-to-ship" is a person following `docs/RELEASING.md` on release day
rather than a workflow. The tag no longer claims otherwise.

---

## D58 — inbound texts are an uncapped cost, deliberately and permanently (#449, 2026-07-28)

*(Renumbered from D50 by #353: two decisions were both numbered D50. The
merge-to-ship one above keeps the number; this one was the later insertion.
Note D5 already answers the ALLOWANCE question — "only outbound segments count
against the quota" — and is the decision to cite for that. This one is about
inbound being an uncappable COST, which is a different claim.)*

**Inbound segments cost us 1.0¢ each (#445 measured it; it was carried at
0.7¢ when this was written), are free to the customer, and have no
ceiling. There will not be one.** This sits beside D34's free storage as the
second deliberate unbounded cost in the product, and unlike D34 it is not even
a choice.

**Why a cap is impossible, not merely unwanted.** Two independent reasons, and
either alone is decisive:

1. **It is the product.** Refusing to receive a customer's texts is refusing
   the thing being sold. A crew whose customer texted them and got nothing has
   no product, whatever the invoice says.
2. **The money is already spent when we find out.** Telnyx receives the segment
   and bills us for it, *then* calls our webhook. By the first line of our code
   the cost is incurred. No gate, throttle or gate-shaped thing we could write
   changes that — the only lever that exists is suspending the number, which is
   a human abuse decision, not an automatic one.

Point 2 is the one that settles it, and it also answers #449's ask 3: a
**per-sender throttle cannot save money**. It could reduce what we spend
*downstream* of receipt — notifications, storage — but both of those already
have their own ceilings (#343, #121). Building it would add a mechanism that
protects nothing not already protected.

**What we do instead: make it visible.** `usage_alerts` gains an
`inbound_volume` arm on absolute segment tiers (2,500 / 5,000 / 10,000 /
25,000 / 50,000 — $25 to $500 of our money at 1.0¢), emailing the customer
and ops, blocking nothing. The storage-abuse shape from #121, for the same
reason: when a cost cannot be refused, the failure to avoid is not the cost, it
is the cost being invisible.

**Why not reuse the notification budget as the signal.** The #343 daily
notification cap correlates with floods and is not a cost control. It measures
attention: a flood into one already-active conversation claims almost no
notification budget while spending real money on segments. Using it as the
inbound cost signal would miss precisely the case worth catching, so
`inbound_volume` is its own metric with its own threshold.

**Distinguishing a flood from a busy day (#401).** The trigger is absolute —
$70 is $70 whether it was an attacker or a January freeze — but the ops email
carries the tenant's own trailing 30 days, which is what separates "ten times
normal" from "a hard week". A storm is many senders; abuse is usually one. The
alert gives a human what they need to tell those apart rather than guessing on
their behalf.

**What would change this decision:** nothing about the arithmetic. Only a
provider relationship where inbound is not billed on receipt, or a carrier-side
filter we can configure before delivery. Until one of those exists, this is the
shape.

---

## D51 — a plain-English opt-out is flagged, never acted on (#396, 2026-07-28)

**Since April 2025 an opt-out is binding however it is worded, not only as
STOP. We detect that now — and deliberately do not act on it.**

**The asymmetry that decides this.** An opt-out cannot be lifted by us by
design (#331, D3): only the contact texting START clears it, because the record
is theirs. So the two errors are not symmetric.

- A **missed** opt-out is a TCPA exposure, and leaves the thread looking exactly
  as it does today.
- A **wrong** opt-out would permanently silence a paying customer's real lead,
  with no way back for the customer, the crew, or us.

One is a risk we already carry. The other is unrecoverable and self-inflicted.
So the product **warns loudly and a human decides**: the thread carries
`opt_out_hint_at`, every composer on all three clients shows a destructive-toned
banner before anyone replies, and nothing changes the contact's state.

**Why it matters more here than in a single-operator tool**, which is the part
worth stating: the shared inbox is the product's whole point, and it is also
what makes the manual approach fail. The tech who reads *"stop texting me"* at
4pm is not the one who follows up at 9am, and until now nothing in the thread
said a word.

**Deterministic, not a model.** A classifier would need the AI gate, a cap, an
alert threshold, a timeout and the #389 disclosure question — and would answer
differently on different days at a compliance boundary. These are fixed phrases
people actually type. A regex table can be audited, quoted in a dispute, and
reasoned about by the person who has to defend it.

The false-POSITIVE list is as load-bearing as the matches: *"stop by the shop"*
is an invitation, and *"don't text me until after 5"* is a scheduling
instruction. A banner that fires on those teaches a crew to ignore the banner,
which would cost more than never having built it.

**A message that is exactly a carrier keyword is left alone** — Telnyx blocks it
and `stop_keyword` records it. Raising a second, weaker signal about a message
already handled would only dilute this one.

### Cross-channel opt-out, and the January 2027 date (#396 ask 4)

The FCC's requirement that **one opt-out applies to every channel** takes effect
**31 January 2027**. The codebase currently holds both postures:

- `offersCallInstead()` returns NO for an opted-out contact, reasoned as *"a
  STOP revokes consent to reach out at all rather than only to text"* — already
  ahead of the rule.
- The thread header's call button stays enabled, reasoned as *"voice consent is
  not SMS consent"* — defensible today, non-compliant from January 2027.

**Decision: the composer posture is the correct one and the header should
follow it, before 2027-01-31.** Not changed in this commit, because disabling a
call button is a product change of its own and belongs in a change that can be
reviewed as one — but it is recorded here as decided rather than open, so the
next person does not have to re-litigate it from two contradictory comments.
The new banner already declines to offer the call as a way around a request to
be left alone.

---

## D52 — a lead wakes the phone; a reply does not (#391, 2026-07-28)

**A first inbound on a new or reopened conversation goes at HIGH push
priority. Every other inbound stays NORMAL.**

**What was wrong.** `deliver.ts` said it plainly — *"these alerts are worth
delivering late, unlike a ring"* — and that was a fair reading when calls were
the urgent thing and messages were background. It was never revisited. A NORMAL
FCM message is **deferred during Doze**, and a phone in a pocket or on a truck
seat, screen off and not charging, **is** Doze. That is not an edge case for a
field crew; it is their working day. Meanwhile a reply inside five minutes
converts roughly 21× better than one at thirty. The window Doze holds the
message for and the window that decides whether the job is won are the same
window — except Doze's is longer.

So the notification that decides whether a plumber gets the job was flagged as
worth delivering late, in a product whose positioning is FIRST RESPONSE.

**Why the answer is not "send everything HIGH".** The counterweight is real and
it is why this is a decision rather than a bug fix:

- Google **rate-limits** apps that overuse high-priority FCM, and the penalty
  lands on exactly the messages you most need delivered.
- A crew that notices the app eating their battery turns notifications off or
  uninstalls. **A late notification is recoverable; a disabled one is not.**
- The tenth message in an active back-and-forth is not worth waking a device.

**The split, and where it comes from.** `thread_inbound_message` already knew
the difference and reported only a boolean: Rule 4 (reopened inside 30 days)
and Rule 5 (new conversation) are §8 triggers in their own right, while an
append fires under the 15-minute gate. It now returns `notify_reason`
(`new` | `reopened` | `append`) and the urgency follows it. No new plumbing, no
new heuristic — the database was already making this call.

Absent on an older database, the fallback is `append`, which is exactly
today's behaviour. The safe direction is never a fleet-wide jump to HIGH.

**Both platforms, by construction.** `apns-priority` derives from the same
`urgency` (10 immediate / 5 power-considerate), so iOS follows without a second
decision — asserted in a test that registers an Android and an iOS device and
checks both, because the two disagreeing about what a lead is worth is the
failure this would otherwise have.

**What this does not settle.** #452 asks who counts high-priority sends now
that more than one feature requests them; Google throttling is precisely the
silent degradation #387 describes, and nothing here measures it. And the
behaviour itself **cannot be verified from CI** — it needs a real device left
idle long enough to enter Doze, which is the founder-device check that #135
already tracks.

## D53 — the unassigned queue is self-serve, not owner-dispatched (#416)

**Decision.** Every member sees the unassigned queue on /for-you and can claim
from it. It is no longer owner/admin-only, and it is called **"Unassigned"**
rather than "Triage" on all three clients.

**The contradiction it resolves.** The company texted *every active member* the
moment a lead arrived unclaimed, and then showed the queue those texts pointed
at to owners and admins only. A tech got the page, opened the app, and the
screen the notification was about was not there. The notification audience and
the queue audience have to be the same set of people, and #416 makes them so by
widening the queue rather than by narrowing the page — a crew that stops being
told about new leads is a worse product than one where anyone can claim them.

**Why self-serve rather than dispatch.** D12's ICP is 1–10 field staff. There
is no dispatcher in that company; the owner is on a roof. #388 committed to a
five-minute first response, and a window that short does not survive waiting
for one specific person to wake up and hand work out. Anyone free claiming it
is the mechanism that actually meets the promise.

**What still gates.** `#106` number access. Unclaimed work on a number a member
is denied does not appear for them at all — not redacted, hidden. Their OWN
assigned task on such a number keeps its row with the title redacted (#417),
because hiding somebody's own job from them helps nobody, but unclaimed work
they cannot act on is only noise. `triage_tasks` carried NO number filter
before this, on the recorded grounds that "leads are always unrestricted" —
true only *because* the section was owner-only, so opening it up made that
filter load-bearing. It was added in the same migration.

**Deploy shape.** `p_is_lead` is retained on `api_for_you` and ignored, so the
migration and the Worker can ship in either order. Dropping the parameter is
the contract half and is filed separately; the route keeps deriving the flag
from the verified membership role, never the request, for as long as it sends
it at all.

## D54 — the escalation ladder that makes FIRST RESPONSE a mechanism (#388)

**Decision.** A clock starts when a new or reopened conversation takes its
first inbound. At **2 minutes** unanswered, the same people who got the first
alert are notified again. At **5 minutes**, an *assigned* thread widens to
everyone who can see it. Rung one ships **on**; rung two is **opt-in**.

**Why this existed to be built.** The brand is FIRST RESPONSE and nothing in
the product caused one. A single notification fired on a 15-minute debounce and
then the system went quiet — so inside the five-minute window the whole
positioning rests on, the debounce was actively *suppressing* the one nudge
that would have won the job.

**Why the ladder stops on an unassigned thread.** Rung two widens; on a thread
nobody has claimed, everyone was already told twice, so a third buzz reaches no
new person and carries no new fact. #244 is already open about every alert
waking everybody forever, and a crew that mutes the app loses far more leads
than this feature can win. The asymmetric defaults follow the same rule: rung
one re-alerts only people already told once, rung two reaches people who were
not, so only the second needs consent.

**Hard limits, none of them configurable.** Strictly inside business hours
(the same shared implementation the away reply and MCTB use — there is one
definition of "are we open" in this product). Push only, so the ladder is
outside the #343 email budget and can never spend a workspace's Resend
allowance on its least useful copy. `notification_prefs` is honoured at every
rung: a member who turned push off does not get it back through a side door.
A rung dropped by the hours gate is **not claimed**, so it survives the night
rather than being silently spent at 08:59.

**What stops the clock.** A human reply, claiming the thread, closing it, or
marking it spam. Reading it does not — opening a message at a red light is not
a response, and counting it as one would let the promise fail silently.

**The thing this uncovered: the ledger could not tell a robot from a person.**
`messages_outbound_actor` requires an actor on every outbound row, so the away
reply, MCTB and the emergency acknowledgment are all attributed to the company
**owner**. Nothing recorded that a machine wrote them. That is wrong well
beyond this feature — #239 would have clocked the away auto-reply as the first
response and reported an average no human produced. `messages.automated` now
exists, defaulting **false** so a forgotten path is recorded as human: a missed
nudge costs one lead, while an alarm firing after you have already replied
teaches the whole crew to mute the app.

**Cadence.** The only per-minute cron in the product. A five-minute scan cannot
express a two-minute rung, and rounding the reminder up to the deadline it
exists to beat would leave the feature named after a promise it no longer
keeps. The scan is a partial index over live clocks, so a quiet minute costs
one indexed lookup returning nothing.

## D55 — absences are a first-class failure, with one mechanism (#387)

**Posture.** Sentry answers *"what threw?"*. A whole class of this product's
failures never throws: the carrier accepts a message and drops it, Resend
accepts a request and the mailbox bounces it, a cron simply stops firing.
Nothing is raised, because the defining characteristic is that nothing
occurred — and silence is byte-for-byte identical to health.

For this product that is not ops hygiene. A plumber gets no error when their
texts stop arriving; the phone just stops buzzing, which is also what a slow
week looks like. Per #382 they cannot tell us either, so without this the
detection path is: we do not notice, and they cannot report it.

**One primitive, not nine detectors.** A declared expectation ("X should happen
at least every N minutes"), a recorded occurrence, an alert on absence.
Everything is a heartbeat — a cron records one by firing, a delivery channel
gets one from a probe or from its own send path. Same ledger, same alert path.
Nine bespoke detectors would have been nine new things that can themselves fail
silently, and the tenth instance of the pattern would arrive uncovered.

**Declaration is mandatory at the point of definition, enforced by the
compiler.** `CRON_JOBS` is keyed by `CronSchedule`, which is derived from the
`cron:` keys of `LIVENESS_EXPECTATIONS`. A trigger added to wrangler.jsonc
without declaring what its absence means does not typecheck. This is the same
structural move as `AiFeatureSpec.key` being typed to priced keys, and it is a
type rather than a test on purpose: a test can be deleted by whoever it annoys.
The reverse direction — an expectation for a cron that no longer exists — the
compiler cannot see, so that one is a test.

**The alert must be believable, which is mostly about staying quiet.** A key
never seen before is *seeded*, not alerted, so the first deploy does not
produce a wall of email about nothing. An overdue key shouts once and then not
again for six hours. A heartbeat during an outage ends it and says so, because
a founder told something broke and never told it recovered reads every later
alert against an unknown baseline. An out-of-order heartbeat cannot move the
clock backwards and manufacture a false alarm. Every one of these is about the
same thing: a channel that cries wolf is worse than no channel, because the
founder now believes they are covered.

**Recorded vs probed, and why the asymmetry is not sloppiness.** SMS is probed
from the messages table by the checker — a heartbeat write per text would put a
database round-trip on the hot path of every send to learn something one query
an hour answers. Email is recorded by `sendEmail` itself, because it is low
volume and *nothing anywhere records that an email was sent*, which is half of
why #386 can happen at all. The asymmetry is in how an occurrence is observed,
never in what it means.

**The checker rides an existing trigger.** A checker with its own schedule is
one more thing that can quietly stop. It runs on the 15-minute trigger, which
is itself watched by the ledger the checker reads — so if the checker stops,
its own absence is the alert.

**Per-job, not just per-schedule (#333).** A schedule firing is not the same as
its jobs working — the 15-minute trigger carries seven, and one throwing on its
first statement every run still lets the trigger's heartbeat land. So each job
records its own heartbeat, and **only on success**. That single choice makes
"broken every run since Tuesday" and "has not run at all" the same alert on the
same path, which is what #333 asked for as a separate capability. A transient
failure that recovers on the next run never reaches its grace window, so it
costs no noise. Both keys are kept: a dead trigger and a dead job have
different causes and different fixes, and losing the schedule-level signal
would hide the case where every job is fine and the trigger simply stopped.

**Work done, not just execution.** A re-reporter can run hourly, succeed
hourly, and still fail at the only thing it exists for: rows sit unreported,
every Stripe call errors, the loop catches and continues, and revenue quietly
goes unbilled behind two healthy heartbeats. The signal is a conjunction rather
than a count — healthy means *nothing was outstanding* **or** *something got
through*. Outstanding work with nothing reported is the one wrong shape, and
the only one that does not false-alarm on a platform with no traffic.

**The limit worth stating.** The checker cannot detect its own total failure.
It records a heartbeat like any other job, so an intermittently-broken checker
reports itself on its next good run — but one that never runs again takes the
whole mechanism down with it, silently. That is inherent to an internal probe
and is exactly the gap #242 (an external status page) exists to close.

**What this does not cover.** #359 (two SQL functions kept in agreement by a
test rather than by construction) and #342 (a spam suppression with no expiry)
share the symptom and not the mechanism; they need their own logic and are not
closed by this.

## D56 — a bounced address is one tenant's typo and everyone's problem (#386)

**Decision.** Delivery outcomes come back from Resend over a signed webhook. A
permanent bounce or a spam complaint **suppresses** the address, enforced inside
`sendEmail` so all eighteen send sites are covered by construction rather than
by convention. The domain's bounce and complaint rates are checked hourly and
alert to `OPS_ALERT_EMAIL`.

**Why it is urgent rather than merely incomplete.** One crew member mistypes an
address at invite, or a tech leaves and IT disables the mailbox. Every inbound-
text notification to it hard-bounces forever, and those bounces accumulate
against **our sending domain**, not against that customer. Mailbox providers
act on domain reputation, so one stale address in one workspace degrades
delivery for the entire book — and the first symptom is every customer's
notifications quietly landing in spam.

**Permanent suppresses, transient does not.** This is the load-bearing line. A
transient bounce is a full mailbox or a greylist — a bad week, not a dead
address — and suppressing on it would silence a real crew member permanently,
with no error anywhere and nothing for them to see. The permanence verdict is
the provider's call, not ours.

**A complaint is permanent and outranks everything.** It survives a clear, and
a member cannot undo it from the app: pressing a button in our own product is
not that person's consent to resume mail they reported as spam, and continuing
is the fastest route to a blocklist there is.

**The lookup fails open.** A database blip must not be why a customer never
learns their payment failed. Failing open costs a handful of bounces; failing
closed costs the message.

**Member-facing, on all three clients.** A hard bounce is otherwise invisible to
the person it belongs to — their notifications simply stop, which is
indistinguishable from a quiet week. They see the address, why, and a single
action when it is theirs to fix. The surface renders nothing when email works:
a false "we can't reach you" is worse than none, because it sends somebody to
fix an address that was never broken and teaches them to disbelieve the next
one.

**Evidence for the legal sends.** The export-ready email and the erasure receipt
store their Resend id, so a PIPEDA or Law 25 request is answered with a delivery
outcome rather than an accepted-id — which only ever proved we handed a message
to a queue.

**Found while building it.** The webhook sweeper dispatched `if telnyx … else
stripe`, so the moment a third provider joined the ledger its rows went to
Stripe's processor and would have replayed forever against a handler that could
never understand them. Now an explicit branch per provider, and a throw on an
unknown one.

**Verified against live DNS, and two real defects found** (recorded in
`docs/deploy/10-email-inbox.md`, both operator actions): the domain publishes
**no DMARC record at all**, and `RESEND_FROM` sends from the root domain whose
SPF does not authorize Resend — DKIM carries it alone.

## D57 — the public disclosure is generated from the code, not remembered (#389)

**The defect.** `/legal/subprocessors` described Cloudflare as "Application
hosting, CDN, and network security" touching "Request metadata (IP, headers);
no message content stored" — while the product was already sending whole
message threads, message text and voicemail audio to Cloudflare Workers AI. The
privacy policy said nothing at all about automated processing.

Nobody hid anything. `docs/DATA-INVENTORY.md` was accurate and thorough; it was
written for the Apple and Google store declarations, and it was updated when AI
shipped. The customer-facing page was not. Two documents kept in step by memory,
and memory lost.

**Why this is worse than a stale doc.** Our customers are controllers and we are
their processor: this page is the artifact they rely on to meet their own
obligations. A plumber telling a homeowner "my texting provider doesn't send
message content anywhere" was passing on a statement we knew to be inaccurate.
And the data is not the customer's either — a voicemail is the homeowner's
voice, a thread is the homeowner's words. Those people never agreed to anything
with us and cannot read our privacy page. Their only protection is that the
business they called was told the truth.

**The fix is structural, not editorial.** `packages/shared/src/ai-disclosure.ts`
holds what each AI feature sends and which model receives it. The marketing page
RENDERS that list, and a test in the API package asserts it covers exactly the
features in `AI_UNIT_COST_CENTS` — the typed registry every AI call is already
required to be declared in (#380) — and that the model strings equal the
constants the code actually calls. A new AI feature cannot ship without a public
disclosure, and a disclosure naming last quarter's model fails a test. Same move
as #377, #380 and #385: the guard lives where the thing is declared.

**Kept as one Cloudflare row.** Workers AI runs in the same account and network
boundary, so the inventory's argument against adding a second vendor is right.
That was always an argument about which vendors to list, never about what the
listed vendor's row says.

**Models are named.** Two are OpenAI's and one is Meta's. A customer reading
"Cloudflare — hosting, CDN, network security" would not conclude that their
customers' voicemails are transcribed by an OpenAI model. The Whisper fallback
is named too: it is a real model that real audio reaches, and a disclosure
listing only the happy path has a hole in it exactly when something has gone
wrong.

**On training, we quote rather than paraphrase.** Cloudflare's published Workers
AI policy is quoted verbatim, verified against their documentation on
2026-07-28, because "do you train on my data" is the first question every
customer asks and the answer has to be attributable to the party actually bound
by it.

**A second undisclosed vendor, found by the inventory's own rule.**
DATA-INVENTORY says every party it lists must also appear on
`/legal/subprocessors` — and **Firebase Cloud Messaging did not**. The push
preview carries the sender's name and a message excerpt, so that is message
content reaching a vendor the page never named. Google is now listed, with the
onward relay to Apple's push service stated.

## D59 — LOW_VOLUME is the right 10DLC tier, and the ceiling gets said out loud (#351)

**Decision.** Every tenant registers on `LOW_VOLUME` (or `SOLE_PROPRIETOR` for
a sole trader), and that stays. What changes is that the tier is a named,
typed decision with a documented ceiling instead of a string literal, and the
ceiling is disclosed to customers.

**Why the default is right.** D12's ICP is 1–10 field staff having
conversations, not campaigns. `LOW_VOLUME` skips secondary vetting entirely, so
a plumber is texting the same day instead of waiting on a review. Moving
everyone to a higher use case would mean heavier vetting and slower approvals
for the overwhelming majority who will never approach the ceiling.

**Why it still had to be fixed.** The customers who DO hit it are by definition
the best ones — the growing crews with the most traffic and the most to lose —
and they hit it blind, on their busiest day, with nothing to distinguish a
registration-tier ceiling from a bug or an outage. This product names every
other gate it applies; this was the one it could not name, because the number
existed nowhere in the codebase.

**The figures, dated and sourced** (`packages/shared/src/carrier-throughput.ts`,
verified 2026-07-28): `LOW_VOLUME` is 2,000 messages/day to T-Mobile per BRAND,
and 75 segments/minute on AT&T. `SOLE_PROPRIETOR` is 1,000/day. Neither can be
raised by vetting — the way up is a fresh registration on a higher tier, which
takes days.

**Reconciled against our own quotas.** Pro includes 2,500 outbound segments for
a MONTH, so an ordinary day is nowhere near a daily ceiling; even the per-period
hard cap of 25,000 averages ~830/day. The ceiling is reachable only by a large
batch sent in one go. That reconciliation is why the disclosure says "it
matters if you send a large batch in one day" rather than implying a limit
customers meet routinely — overstating it would frighten people away from a
product they will never strain.

**The staleness is a test, not a promise.** These are the carriers' numbers and
they move. `TEN_DLC_CEILINGS_RECHECK_AFTER` is six months out and a test fails
when it passes, which is #326's revisit trigger expressed as something that
cannot be quietly ignored. When it fails, the job is to re-read the carriers'
published rules and move both dates — not to push the date forward.

**And the ceiling is now watched, not merely disclosed (#457).** Naming the
number in the docs told customers it existed; it did not tell the one crew
actually approaching it today. `api_daily_outbound` counts a workspace's
outbound **segments** for the UTC day and
`apps/api/src/billing/carrier-ceiling.ts` warns at the same 80% fraction every
other alert arm uses.

Three choices in it are load-bearing:

- **Segments, not messages.** The carrier counts what it carries, so a
  300-character text is three against the ceiling and one row in our table.
  Counting rows would under-report by exactly the factor that matters for a
  crew sending long messages — the crew most likely to be near the ceiling.
- **The UTC day, not the customer's.** Carrier limits reset on UTC midnight, so
  a California crew sending hard on a Tuesday evening is already spending
  Wednesday's allowance. A local day would measure the wrong budget.
- **Hourly, deduped to once a day.** The only useful advice — spread the rest
  over tomorrow — expires the moment the ceiling is hit, so a nightly sweep
  would always arrive too late; but an hourly arm that re-warns until midnight
  reads as panic. The `usage_alerts` ledger keyed on the UTC day settles both.

The email says plainly that this is not a limit we can lift, because it is the
only cap in the product where that is true and the customer's instinct will be
to ask us to raise it.

## D60 — a dispute is recorded and reported, never acted on automatically (#422)

**Decision.** `charge.dispute.created/updated/closed` are handled. Each writes
to `billing_disputes`, stamps `companies.disputed_at`, writes an audit entry
when the company resolves, and emails the founder once — on the way in, with
the total cost. **Nothing is suspended automatically.**

**What was wrong.** The webhook handled seven event types and no dispute event
was among them; the endpoint was not even subscribed. Stripe leaves a
subscription `active` while one of its charges is disputed, our mirror copied
`active` faithfully, and the service kept running — accruing the $1.10 number
rental and the $10 10DLC campaign cost — for a customer who had told their bank
the charge was wrong. Nothing recorded that it happened.

**The arithmetic is the argument.** A disputed $29 costs $29 clawed back plus
Stripe's $15 dispute fee: **$44 out on a sale that nets $27.71**. One dispute
erases about a month and a half of that tenant's contribution while we keep
paying their carrier costs.

**Why it does not suspend.** A dispute is an accusation, not a verdict. Some
are a bank being clumsy or a spouse not recognising a line item. Cutting a
paying business off from their own customer conversations on the strength of an
accusation would be a worse mistake than the money — and it is not reversible
in the customer's eyes even when the dispute is later withdrawn. So the product
records, flags and reports, and a human decides. The flag is what makes that
decision possible; before this there was no way to make it at all.

**`disputed_at` is not a subscription status.** Mirroring a fiction into
`subscription_status` would break every consumer of that column, which reads it
as Stripe's truth. This is a separate fact about the same tenant, and it
**survives the dispute closing**: won or lost, they disputed a charge, and that
is what somebody wants to know months later.

**An unattributable dispute is more alarming, not less.** `company_id` is
nullable and the alert says so in capitals. A NOT NULL column would have meant
the strangest disputes — a charge we cannot match to any customer — are the
ones we silently drop. The audit entry is guarded on the company resolving,
because `audit_log.company_id` is NOT NULL and `recordAudit` swallows its own
failures: an unguarded call would have been a silent hole in exactly the log
this decision creates.

**Count, not rate.** At this customer count a rate has a denominator of a
handful and swings wildly on one event. Every single dispute is worth an email.
`api_dispute_health` reports count, cost and open-count over a rolling window
for when that changes.

**The deploy step that makes it real.** The three events must be ticked on the
Stripe endpoint by hand. The code ships either way; the subscription is what
makes it fire. `docs/deploy/03-stripe.md` says so in a callout.

---

## D61 — high-priority push is a budget, and the lead bucket is the one with a ceiling (#452, 2026-07-28)

**Decision.** Every HIGH-priority native push is counted, per company, per
local day, attributed to the feature that asked for it. `lead` and
`lead_chase` **share one daily ceiling**; `ring`, `call_end` and `emergency`
are counted and never capped. Past the ceiling a lead push **degrades to
NORMAL** — it is never dropped.

**Why it needed deciding.** FCM HIGH and APNs priority 10 wake a sleeping
phone, and they are rationed: Google throttles apps that overuse them, and the
throttling is applied **to the app**, so the penalty lands on exactly the
notifications that most needed to arrive. That is a cost centre denominated in
platform goodwill rather than dollars — which is why `ai/run.ts` can insist
every AI cost centre declare a cap before it spends, while this one went four
features deep with nothing counting it. D52 shipped the fifth and explicitly
left this open.

**Five callers, not two.** #452 counted the emergency keyword and the queued
#391. By the time it was implemented the real list was `lead`, `lead_chase`
(#388's ladder, which can add two more rungs per unanswered lead), `emergency`,
`ring` and `call_end`.

**What is metered is the DEVICE**, not the notification, because the device is
what the platforms count. A ten-person crew on two phones each is 20 sends per
lead, and a new conversation is unassigned, so a lead wakes the whole crew.
Web Push urgency is deliberately **not** metered: nobody rations RFC 8030
urgency, so degrading it would save nothing and cost a wake.

**Why the split is a shape argument, not a volume one.** `ring` and `call_end`
require a phone call to have actually happened, and a ring at NORMAL priority
is not a ring. `emergency` requires one of the four fixed words in
`EMERGENCY_KEYWORDS` — a constant, not the owner-configurable column #452
assumed, so the "an owner sets it to *help*" risk it worried about does not
exist. The two lead reasons are the only ones driven by **inbound text
volume**, which is the one input an outsider controls.

**One ceiling for both lead reasons, not one each.** They share the input, so
a flood drives both; two independent ceilings would let it spend the budget
twice over.

**Degrade, never drop.** This is the one cost centre where the #12
cap-and-drop posture is wrong. Dropping the alert loses the lead outright;
sending it NORMAL loses only the Doze wake. So the ceiling stops the *spend*
and never the *message* — and because of that, the number can be set
conservatively without risking a silent blackout.

**2000 device sends a day**, ops-overridable per company
(`companies.high_priority_push_limit`), deliberately **not** per plan: this
protects our standing with Google, which does not improve because a customer
pays more. It is ~30 unanswered new conversations a day for the largest crew
D12 describes — well past a real trades day, and still a hard bound on someone
blasting inbound texts to wake twenty phones at full priority each time.

**Fails open.** A metering failure returns "allowed" and reports to Sentry. The
uncapped reasons run on the live-call path, whose contract is that push weather
cannot break a call; and for the capped one, the bound shapes spend across days
rather than milliseconds, so being briefly unbounded during a database outage
is plainly better than degrading every lead in the country.

**Alerts go to ops, not the owner** — the #448 posture for per-dial fees. This
is our cost and there is nothing an owner could do about it. Warn at 80%, state
it once at 100%, one-shot under the ledger row's lock.

**How to answer the question.** `select api_high_priority_push_report(7);` —
per company, per reason, sends and degraded. That was #452's definition of
done.

---

## D62 — every one-way door is decided, not discovered (#390, 2026-07-28)

**Decision.** Any state transition a human can end up on the wrong side of must
have its inverse **decided when the transition is built**, and the decision
written down. Reversible-by-intent and irreversible-by-accident currently look
identical from outside, and that difference is only ever discovered by a
customer who is already stuck.

**The concrete question, in the definition of done.** Not "did you test the
undo" — a platitude nobody actions. The question is: **who is stuck if this
cannot be undone, and how do they get out?** If the answer is "nobody, by
design", say so and it is done. If the answer is a person, the return path is
part of the feature.

**Why it is a class and not a ticket.** Every one of these was built and tested
in the forward direction, because the forward direction *is* the feature.
Nobody writes "and then undo it" unless undo is the feature. But when the
states are *people* and *phone numbers*, a one-way door is a customer
permanently stuck. #383 was the founder hitting it with a workspace of one; in
a real crew it is a seasonal-labour bug, because trades hire back — a tech who
leaves in October and returns in April is the normal case.

**The audit (#390 ask 3), resolved. All five rows:**

| Forward | Return path | Verdict |
|---|---|---|
| Offboard a member (#276) | Re-invite | **Reversible.** Invite acceptance distinguishes an *active* membership from an offboarded one and reactivates, taking the role from THIS invite rather than the one they held before (`routes/team.ts:863-884`). Fixed in 4e91bf3 (#383). |
| Mark a number spam | Un-mark | **Reversible.** `routes/conversations.ts:462-468`; un-marking also clears the review watermark, so the next mark starts a fresh count rather than inheriting a confirmation about different messages (#342). |
| Close a workspace (#341) | Reopen inside grace | **Reversible in the database, not in the product.** `public.reopen_workspace(uuid)` exists with `too_late`/`not_closed` guards (`20260726000400_workspace_closure.sql:123-154`) and is asserted in `workspace_closure.test.sql` — but it has **no API route and no caller**, so the copy's promise ("contact us and we can undo it") is kept by a human running SQL against production. It also writes **no audit row**: `audit/log.ts:69` declares `workspace.reopened` with zero emitters. That is #404's thesis proven on a specific case, and it is tracked there rather than re-filed. |
| Cancel a subscription | Resubscribe | **Reversible.** Resubscribe-within-grace un-suspends the existing number instead of provisioning a new one, and the saga then skips because a non-released number exists (`webhooks/stripe.ts:511-519`). |
| Release a number | Re-add the same number | **Irreversible, correctly.** The number returns to the carrier's inventory and is not ours to reclaim. #413 owns telling a churning customer this plainly. |

**What stays one-way on purpose.** The ask is not "make everything reversible."
A **STOP can only be lifted by the customer who sent it** — that is not a
missing return path, it is the whole point ([[opt-out-carrier-truth]]). Workspace
purge after the D48 grace window is likewise deliberately final. Both are
decided, which is the entire distinction this decision draws.

## D63 — cancelling is owner-only; updating the card is not (#421)

**Decision.** The Stripe billing portal is split by role. An **owner** gets the
full portal, cancellation included. An **admin** gets the
`payment_method_update` flow and nothing else. The route stays admin-reachable;
what changed is what an admin can reach once inside.

**The asymmetry it fixes.** Closing the workspace is owner-gated and explicitly
destructive. Cancelling the subscription ends in the same place — `grace.ts`
releases the number 30 days later, and a released number goes back to carrier
inventory and is reassigned to another business (#413) — but it happened on
Stripe's domain and so was never gated. An admin could start an irreversible
clock ending with the company's phone number belonging to somebody else.

**Why not simply owner-gate the whole portal.** Admin-level billing is right
for the ordinary case: a bookkeeper or office manager updating an expiring card
should not have to be the owner, and forcing that through the single
untransferable owner role (#332) would be a worse failure than the one being
fixed. The issue framed the bundle as unsplittable inside Stripe's UI. It is
not — `flow_data.type = "payment_method_update"` lands the caller directly on
the card screen with no cancellation surface at all, and needs no account-level
portal configuration. A structural limit rather than a hidden button.

**The owner is told, once.** A portal cancellation arrives as
`customer.subscription.updated` with `cancel_at_period_end` newly true. That
used to start a grace countdown and tell nobody. The notice now fires on the
MOMENT of cancellation — compared against what we already mirrored, because
Stripe repeats that flag on every later update and an owner who gets the same
email every time a card is touched learns to ignore the one that mattered.

**The email explains what release means**, per #413: not "your subscription
ends" but that the number goes back to the carrier and is given to another
business, and that customers texting the number on their van will reach
somebody else. It says how to undo it, and it says that admins can manage
billing so it may not have been them.

**Audited with a null actor.** Stripe's hosted portal does not tell us which
member clicked. Recording the workspace owner would name somebody who may not
have done it, so the actor is the documented system-actor null and the record
says what happened rather than inventing who.

**Best-effort by construction.** The subscription mirror is the truth of the
account and must never fail because a courtesy email did — the notice, the
audit write and the owner lookup each swallow their own failures.

**Ask 5, honestly.** Five routes are owner-gated: releasing a number, cancelling
a port, the US enable-fee charge, cancelling text enablement, and closing the
workspace. Re-reading them for an admin-reachable path to the same outcome, the
subscription-cancellation path was the one hole, and it is the one closed here.
That is a re-read rather than a proof of exhaustiveness.

---

## D64 — a task promotes a source, and the source is a message OR a call (#356, amends D17)

**Decision.** Work can exist without a message. A task promotes a **source
event**: a message (as today) or an **answered call**. `tasks.message_id` stops
being `NOT NULL` and becomes one of exactly two anchors, enforced by a CHECK.

**What D17 actually protects, restated so it survives a second anchor type:**

> **Exactly one row owns the done-state of any given task, and the anchor
> determines which row. Never two.**

- **message-anchored** → `messages.done_at`, exactly as D17 specifies. Nothing
  about existing tasks changes.
- **call-anchored** → `tasks.done_at`, which exists *only* when `message_id` is
  null.

**Why the split rather than moving completion onto the task universally**, which
looks tidier and is wrong. **D14 is the floor: any message can be marked
Done/Not-done with no task entity at all.** So `messages.done_at` has a life
independent of tasks — it is a message-level affordance in the thread, and
removing a promotion leaves D14 archetype A behind. Put a done flag on the task
as well and a promoted message would have **two** flags for one piece of work,
which is precisely the drift D17 exists to prevent. For a call-anchored task no
message exists, so the task's own flag is the first and only one.

That makes the rule mechanical rather than a judgement call: *is there a
message? then it owns done. Is there not? then the task does.*

**Why not option 3 (keep the constraint and scope around it).** It has a real
case — this is a shared inbox, not field-service management, and "work comes
from a customer conversation" is a coherent boundary #287 argues hard for. But
we sell answering the phone *and* we sell tracking the work, and today those
two do not connect. **A job agreed on the phone is the most common way a trades
job is booked.** Option 3 would mean scoping #287, #237, #294 and #354 around a
hole in the product's own pitch, and telling a user to send a text they did not
want to send so the app will let them record work they already agreed to do.

**Why not option 2 (standalone tasks, completion always on the task).** It
rejects D17's reasoning rather than extending it, and it reintroduces the
two-flags problem above for every existing task. This decision deliberately
takes the narrowest widening that closes the gap.

**What this does NOT authorise.** A task with *no* source at all. "Order the
part, chase the supplier, do the annual inspection" — the ordinary crew work
#356 lists last — stays out of scope, and that is option 3's boundary being
kept where it is still right. Every task still promotes something that
happened with a customer. What changed is only that a phone call is now one of
the things that can have happened.

**Shape of the change**, so the implementation is not ambiguous:

```sql
alter table public.tasks alter column message_id drop not null;
alter table public.tasks add column source_call_id uuid references public.calls(id);
alter table public.tasks add column done_at timestamptz;   -- call-anchored only
alter table public.tasks add constraint tasks_one_anchor check (
  (message_id is not null and source_call_id is null  and done_at is null)
  or
  (message_id is null     and source_call_id is not null)
);
```

The `done_at is null` arm is the invariant made structural: a message-anchored
task **cannot** carry its own completion, so the two-flags state is unreachable
rather than merely discouraged. `tasks_message_uq` keeps its 1:1 meaning for
message anchors; a matching partial unique index gives calls the same.

**Client work this implies** (#338): "Make a task" appears on a call in the log
and on the call-completed timeline row, and the task detail renders a call as
its source where it renders a message today — web, Android and iOS.

---

## D65 — every external system gets an inbound-state row before it is integrated (#424)

**Decision.** A vendor is not integrated until we have written down, for each
state change it can impose on us: **can our schema express it, what tells us,
and who is told.** That table lives here, and a new vendor adds a row to it in
the same change that adds the API key.

**The gap this closes is modelling, not monitoring**, and #424 makes the
argument better than a summary can: every route in this API has a
`requireRole` line and a state transition somebody reasoned about, and all of
that covers **actions we take**. External systems do not use our routes. They
change facts about our customers — a subscription ends, money is clawed back, a
number moves, permission to send is withdrawn — and those facts arrive, if at
all, through a webhook we may not subscribe to, into a schema that may have no
column for them.

**Why it was systematically invisible: there was no artifact to review.** A
destructive route has a `requireRole("owner")` line a reader can question. A
destructive act executed by Stripe has no line anywhere in our codebase. Nobody
skipped a review; there was nothing to review. That is also why the four
instances spanned billing, telephony and registration rather than clustering in
one neglected corner — it was a category the design had no slot for.

**Distinct from D55/#387, and both are needed.** #387 is about **absence** — an
expected thing did not happen; the answer is a heartbeat. This is about
**foreign presence** — an unexpected thing happened, decided elsewhere; the
answer is inbound state coverage. A heartbeat would not catch a dispute; a
dispute handler would not catch a cron that stopped.

### The table, as of 2026-07-28

| System | It can impose | Can we express it? | What tells us | Who is told |
|---|---|---|---|---|
| Stripe | subscription cancelled | ✅ `cancel_at_period_end`, `canceled_at` | `customer.subscription.updated/deleted` | owner, at the moment of cancellation (#421) |
| Stripe | payment failed / action required | ✅ `subscription_status` + grace ledger | `invoice.payment_failed`, `invoice.payment_action_required` | owner + admins, laddered (§9) |
| Stripe | charge disputed | ✅ `billing_disputes` | `charge.dispute.created/updated/closed` | ops; never acted on automatically (D60) |
| Telnyx | number ported away | ✅ `number_port_outs` | `portout.*` | owner (#398) |
| Telnyx | 10DLC campaign suspended | ✅ `registration_status = 'suspended'` | `10dlc.campaign.update` + the daily poll | owner **and** ops (#423, D-note below) |
| Telnyx | account-level restriction | ❌ **no state** | nothing — discovered by a failing call | nobody; we found the CA ordering block by hitting it |
| Resend | address bounced / complained | ✅ `email_suppressions` + member email state | `email.bounced`, `email.complained` | the member whose address it is (#386) |
| Supabase | project paused, quota exceeded | ❌ **no state** | nothing | nobody |
| Cloudflare | Worker or account limit | ❌ **no state** | nothing | nobody |

**Four of the five instances #424 was filed about are now closed** — #421
(cancellation notice), #422 (disputes, D60), #398 (port-out), #423 (suspension).
That is the argument for writing the table down rather than for closing the
issue quietly: the instances were fixed one at a time, exactly as #424 warned,
and without this the fifth would have been found the same way.

### The three rows with ❌, said plainly

They are not oversights to fix today; they are known holes, and naming them is
the point of the exercise:

- **A Telnyx account-level restriction** is the one we have already hit — error
  10038 blocked Canadian number ordering, and we learned of it from a failing
  order rather than from any signal. It has no state and no notification. It is
  R2 in `docs/VENDOR-QUESTIONS.md`.
- **Supabase and Cloudflare** can both stop us serving entirely, and neither
  has a state or a signal here. The honest position is that we would learn from
  the product being down — which is the #242 status-page question, not this one.

### The rule for the next integration

Before an API key reaches `env.ts`:

1. **Enumerate** what the vendor can decide about us without asking.
2. **For each, check the schema can hold it.** #423 is the case that proves
   this matters most: the campaign vocabulary ran `draft → submitted → pending
   → approved | rejected`, every one a transition we initiated or awaited, so a
   carrier revocation was **not expressible** — and no amount of better
   observation would have helped until the schema could hold the answer.
3. **For each, name what tells us.** Where the answer is *nothing*, write that
   down here rather than leaving it undiscovered, and add the question to
   `docs/VENDOR-QUESTIONS.md` if a vendor could answer it.
4. **For each, name who is told and when.** Most of these are recoverable only
   while somebody is acting on them.

---

## D66 — revocation is checked on the request, not waited out on the token (#236, 2026-07-29)

**Decision.** Every authenticated request carries the GoTrue `session_id` claim
into the same database round trip that resolves company membership, and a
session marked revoked is a `401` on that request. Signing a device out also
deletes the push registrations that device made.

**What was actually broken.** #276 already ended a person's sessions on
offboarding: it deletes the GoTrue rows, so the refresh token has nothing to
refresh against. But the access token already in the phone's memory keeps
working until it expires — up to an hour. For that hour a departed tech's phone
reads and sends as the business, and the owner has been told the removal
happened. **The gap is not that access continues; it is that we report it as
over while it isn't.**

**Why the check is affordable per-request.** The obvious objection to checking
revocation on every call is the round trip, and the obvious dodge is a cache —
which reintroduces exactly the window we set out to close, just shorter. So
instead of adding a query we moved one: `companyContext()` already made a
`company_members` lookup on every /v1 request, and that select is now an RPC
that answers both questions. **One round trip before, one round trip after.**
There is no budget left to trade against correctness, so there is no
temptation to.

**The claim cannot be stripped.** `session_id` lives inside the signed access
token, so a caller cannot remove it to skip the check — its absence only ever
means a token minted before GoTrue emitted the claim. That is why an absent
claim is admitted rather than rejected: failing those closed would sign out
every existing customer to defend against something nobody can do.

**Push dies with the device, not with the person.** `device_push_tokens` and
`push_subscriptions` gained a `session_id`. Before this, the only available
granularity was "delete every registration this person has" — so "sign my old
tablet out" would have unsubscribed the laptop in front of them, and nobody
would have used it. This is the half of #236 that decides whether the feature
gets used at all: a revoked phone must stop showing the customer's message text
on its lock screen, and *only* that phone.

**A call in flight is left alone.** Revoking a session does not hang up. The
customer on the other end did nothing wrong, and stranding them mid-sentence to
make a security point is a worse outcome than a departing employee finishing
one call they are already on. The session cannot start another, which is the
part that matters.

**An owner sees the workspace, and sees less of it.** Self-service alone would
leave the only person who can act — the owner, who knows the tech quit —
depending on the person who left. So `GET /v1/members/sessions` exists, and it
returns which app, roughly where, and when last active: enough to recognise a
phone that has not been near the business in three weeks, and not enough to
read the crew's browsing setup. An admin cannot sign the **owner** out; that is
not a security control, it is a hostage situation.

---

## D67 — ownership moves by a decision the owner already made (#332, 2026-07-29)

**Decision.** Two paths, and both begin with the authenticated owner: they
**offer** ownership to a member who accepts, or they **nominate a backup** in
advance who can later claim it after a seven-day veto window. The
no-backup-and-unreachable case stays human-in-the-loop, written down in
`docs/OWNERSHIP.md` rather than coded.

**The property being protected is real, and stays.** "The owner row cannot be
demoted" is what stops an admin locking out the person who pays. The bug was
never that rule; it was that the rule had no counterpart, so a safety property
became a single point of failure at the human level. A two-person plumbing
company whose founder has a heart attack still has customers texting the
business line, and the surviving partner could answer messages but could not
lift the spending cap that had stopped their texting.

**Why the recovery half is a nomination and not a verification.** The issue
argued against itself better than any summary: every account-recovery mechanism
is an attack surface, and this one guards the role that controls spending and
phone numbers. A weak procedure is **worse than none**, because it converts
"call the founder" — slow, manual, and actually quite secure — into something
attackable at scale.

So we did not build a way to prove you deserve a stranger's business. We built
a way for the owner to say, in advance and while authenticated, *this person*.
That converts the hard problem into the easy one, and the workspace that
answers the prompt never needs Path 3 at all. The claim is not a bypass: the
claimant was chosen by the owner, the owner holds an instant veto for a week,
and **every member is told at the start rather than at the end** — the people
who know whether the owner is merely on holiday are the ones holding the alarm.

**Seven days, and why not another number.** Too short and an owner on a
two-week holiday loses their business to a disgruntled backup. Too long and a
grieving family waits a month to answer their own customers. Seven days is
about one full cycle of nobody answering the business phone.

**Two signals, never one, on Path 3.** Each accepted signal — control of the
payment method, of the ported number, of the business domain, or documentary
succession — is individually obtainable by a determined attacker. The pairing
is the security. And urgency is never a signal: every social-engineering
attempt on a procedure like this is urgent.

**The invariant that was missing.** Ownership lived in two places —
`companies.owner_user_id` and the `company_members` row — with nothing tying
them together, so two owner rows was expressible and so was an owner_user_id
pointing at a non-member. Both halves now have teeth: a partial unique index
makes a second owner row impossible, and `api_ownership_integrity()` is the
assertion that the two agree, checked after every operation in the SQL suite.
Nothing writes `owner_user_id` except `apply_ownership()`.

**An admin cannot cancel a claim they are not party to.** This one reads
backwards until you see it: letting any admin stop a claim would let one admin
keep a dead owner's workspace frozen forever. Only the owner (veto) and the
claimant (abandon) can end one.

---

## D68 — the severity floor is the security policy (#282, 2026-07-29)

**Decision.** Scanning runs on four ecosystems, and every one of them has an
explicit floor of **HIGH**. Two checks block a merge; everything else reports.
The owner of every finding is the founder, because there is nobody else.

| What | Where | Blocks? | Floor |
|---|---|---|---|
| Committed secret | `gitleaks` over full history, every push and PR | **yes** | any match |
| `.dev.vars` ignore rules | `scripts/check-ignored-secrets.sh` | **yes** | any break |
| New dependency with an advisory | `dependency-review-action` on PRs | **yes** | HIGH |
| Installed tree | `pnpm audit --prod`, PR + weekly | no | HIGH |
| Static analysis | CodeQL, default `security` suite | no | GitHub default |
| iOS SPM packages | `scripts/check-swift-advisories.mjs`, weekly | no | HIGH |
| Dependency updates | Dependabot, grouped, weekly/monthly | no | — |

**Response window.** CRITICAL: same day, and it may ship outside the release
train. HIGH: within seven days. MODERATE and below: batched into the next
Dependabot group, which is to say whenever it happens to arrive.

**Why the floor is the design, and not a compromise.** The issue argued
against itself correctly: the real risk for a solo maintainer is not too little
tooling, it is a scanner producing forty low-severity findings a week. That gets
muted inside a fortnight, and then the one that mattered is muted too. Coverage
that is not read is worse than no coverage, because it also produces the belief
that somebody is looking.

So the two things that BLOCK are the two with a near-zero false-positive rate —
a secret in the history, and a dependency the diff itself adds carrying a known
advisory. Everything else reports, and reports at a level where each finding is
worth the interruption.

**Why the whole TypeScript tree is analysed rather than the "security-sensitive
paths".** The tempting reading of "analyse auth, billing and webhooks" is a
`paths:` allowlist. It would be worse than useless: CodeQL's value is dataflow,
and the finding that matters is nearly always *attacker-controlled value enters
at a route and reaches a sink three files away*. Narrowing the analysed set
severs exactly those paths. The tuning lives in `paths-ignore` (test fixtures
mint fake credentials by the hundred) and in the floor.

**Why gitleaks runs as a binary and not as its action.**
`gitleaks-action` gates organization use behind a licence key. A security check
that switches itself off when a secret is missing is not a check.

**The gap that is named rather than hidden.** Dependabot's `swift` ecosystem
needs a `Package.swift` or a committed `Package.resolved`, and this project has
neither — the two SPM dependencies live in `apps/ios/project.yml` and are
resolved by Xcode at build time. Rather than leave the Swift surface unscanned
and unmentioned, `scripts/check-swift-advisories.mjs` reads those pins and asks
GitHub's advisory database directly, weekly. It produces no pull request, so it
is genuinely less than the other three ecosystems get. It is also the honest
version of what we have, written down in `.github/dependabot.yml` at the point
somebody would otherwise assume coverage.

**Related:** the 2026-07-12 full-history audit found zero real leaked secrets.
That was a good result and a **point-in-time manual sweep** — it is exactly the
thing this decision replaces with something that runs whether or not anybody
remembers.

---

## D69 — a second factor, and a way back that is not a bypass (#314, 2026-07-29)

**Decision.** TOTP only, self-serve, with ten single-use recovery codes issued
at enrolment. An owner may require it workspace-wide with a grace window they
choose. The genuinely locked-out case stays human, written down in
`docs/ACCOUNT-RECOVERY.md`. **SMS is never offered as a factor.**

**What a compromised account actually costs.** Not a data breach in the
ordinary sense: control of the business's identity with its own customers. An
attacker texting a homeowner *from the plumber's real number*, asking them to
re-send payment elsewhere, is a fraud that works — and the customer cannot
detect it, because the number is genuine.

**The recovery code removes the factor; it never elevates the session.** This
is the load-bearing decision. A code that granted `aal2` would turn *a stolen
password plus a stolen printout* into a silent full bypass. Removal is loud:
the account holder is emailed, and the next sign-in is password-only until they
enrol again. Ten wrong guesses locks the endpoint for an hour — correct codes
included, or the lock would be trivially skippable — and the lock is taken in
the same statement that consumes, so a race cannot spend attempts without
counting them.

**The grace deadline is fixed when it is set, and a later save cannot move
it.** Otherwise every settings save silently extends it and "you have until
Friday" stops meaning anything to the crew who were told it.

**`mfa_required` is its own error code.** Three clients route on it — to the
enrolment screen, not an error toast — and a message-sniffing client would
break the first time somebody edited the copy. Every route that gets a person
*out* of the gated state is company-exempt, because an enforcement gate with no
exit is an outage with a good reason attached.

**The recovery-codes screen cannot be dismissed by accident, on any client.**
Web hides the close button and disables the confirm until the codes are copied;
Android's and iOS's shared confirm surfaces both learned to hide their dismiss
button and their swipe/back gesture together. Somebody who enrols and closes
that screen has armed a lock and thrown away the spare key, and this product's
lock is their business phone line. **The friction is the feature.**

**No QR code on mobile.** A QR shown *on* the phone that would have to scan it
is useless. Both apps hand the `otpauth://` URI to whatever authenticator is
installed and fall back to a copyable secret.

**Not SMS, and this is the one place the choice is specifically ours.** We are a
texting company, so it is the obvious-looking option. SMS factors fall to SIM
swap, and our users' phone numbers are the most publicly-known thing about
their businesses.

**Passkeys are not here yet.** The SDK supports WebAuthn factors and they are
the better long-term answer for phone-first users; the issue's acceptance asks
for "a TOTP factor **or** a passkey", so TOTP satisfies it today and passkeys
are a follow-up rather than a silent omission.

---

## D70 — support edits get a dry run and a record, not a console (#404, 2026-07-29)

**Decision.** Four reviewed scripts under `scripts/ops/`, every one dry-run by
default and every one writing an `audit_log` row. No admin console.

**The issue's own devil's advocate settles the scope**, and it is right twice:
building a console for support volume we do not have is premature, AND the
safety half applies today. The reason is that the risk does not scale with
customer count — **it scales with the number of times somebody runs a manual
statement, and the worst outcome is available on the very first one.**

**The audit log was hardened against the wrong thing.** `update`, `delete` and
`truncate` are revoked from every role including `service_role`, so no route
and no stolen key can rewrite history. That protects against the application.
It did nothing about the console, because the console wrote nothing at all —
so the single most dangerous class of change we make (unreviewed, untested,
run once, against live data, on a Saturday because a customer is upset) was
the only one with no record that it happened. These scripts write the row the
app would have written: null actor, `platform-ops/<script>` agent.

**The audit write is never best-effort.** If the record fails, the script says
so loudly and tells the operator to write it by hand. A support edit that
silently failed to log would be worse than the ad-hoc SQL it replaced.

**Tenant filters are FILTERS, not checks.** Every script takes `--company` and
applies it inside the query, so a mistyped conversation id returns nothing
rather than returning somebody else's row for a human to act on. #347 makes
the case that tenant isolation is a convention across hundreds of query sites;
hand-written support SQL was the site with no review, no test and no types.

**And the promise now matches the mechanism.** The closure screen said "email
us and we can undo it" with no route, no script and no surface behind it.
There is one now — and it restores everything except the phone number, which
closing releases at Telnyx immediately and on purpose, because holding a number
costs us money for a workspace that asked to leave. The script reports that in
red-flag terms rather than quietly reopening, and the copy now names it in the
same sentence as the undo instead of two bullets apart.

**What stays by hand is written down** in `docs/OPERATIONS.md` rather than left
to be rediscovered: stuck port-ins, delivery investigations, and anything
touching money (which goes through Stripe's dashboard, with its own trail).

## D71 — a version floor is a weapon, and it is holstered by default (#339, 2026-07-29)

**Decision.** The server learns what every client is running, may **recommend**
an update freely, and may **require** one only under the rules below. The floor
ships NULL for all three platforms and stays there until a specific incident
justifies moving it.

**Why this needed a decision and not just a mechanism.** The issue's devil's
advocate states the cost plainly: blocking a plumber's business line because
they are two versions behind, while they are standing in a customer's basement,
is a worse outcome than most of the bugs it would protect them from. A
misconfigured floor locks out every user at once, with no way in to fix it —
from the customer's side, indistinguishable from us going out of business. So
the mechanism was built with the policy written first, which is the order the
issue asked for.

**What is always on, because it carries none of that risk:**

- Every client sends `X-App-Version` alongside the `X-Client` it already sent.
  Validated server-side against the same pattern as the column's CHECK; anything
  unparseable becomes NULL rather than an error, because a header must never be
  able to cost somebody their session.
- It rides `api_authorize_request` — the one RPC every /v1 request already makes
  — so knowing what everyone runs costs nothing per request.
- `scripts/ops/version-distribution.mjs` reports the adoption curve. "Everyone
  has the fix" is now a number instead of a hope.

**The soft prompt** (below `recommended_version`) is the default answer to
almost everything: dismissible, per-version so a click last week cannot swallow
next week's notice, and it always carries the server's own `message` rather than
copy invented in the client. An update demand nobody can explain reads as a
hijack.

**The floor** (below `minimum_version`) is governed by four rules, three of them
enforced mechanically by `scripts/ops/set-release-policy.mjs`:

1. **Security or genuine incompatibility only.** Never a feature, never a
   nice-to-have, never to reduce our support burden.
2. **A floor requires a `--message`.** Enforced. Somebody is losing access to
   their business phone; they are owed the reason on the same screen.
3. **Never raised to a build that has not landed.** Enforced: the setter refuses
   a `--minimum` newer than the currently recommended version. Recommend it,
   let it reach people, raise the floor on a later day.
4. **The blast radius is read before the write.** Enforced: the script prints
   how many live sessions the floor would block — counting sessions with NO
   reported version as blocked, because they are, and on day one they are most
   of them.

**Rollback is one command and no deploy:** `--clear --apply`, live within the
endpoint's five-minute cache. That is the entire reason the floor lives in the
database instead of the build. A floor baked into a client can only be lowered
by shipping a client, and the moment you need to lower it is the moment shipping
is the thing that is broken.

**Everything fails open.** `GET /app-release` is public (outside /v1, no JWT) —
the reason to demand an update may be that auth is broken in the old build, and
a gate only working clients can read is no gate. A missing row, an unknown
platform, a database outage, an unreadable version on either side: all resolve
to "ask nothing". The asymmetry is deliberate. A missed prompt costs one person
one week on an old build; a false block costs every customer their phone at once.

## D72 — flags are declared in code and valued in the database (#283, 2026-07-29)

**Decision.** Every feature flag is declared in `apps/api/src/flags/registry.ts`
with a default, an owner and a removal date. The database can only **override**
that declaration. Evaluation is at runtime, cached ten seconds in the isolate.

**Why the split, and not just a table.** A flag system is a new shared
dependency on the read path of every risky subsystem. If an empty table, a bad
row or an unreachable database could switch a feature off, it would have
recreated the total blast radius it exists to shrink — with more moving parts.
So the code carries the default and the table carries only deltas: a kill switch
defaults ON, and a database outage leaves the product working.

**Why not env vars.** `BILLING_WRITES_DISABLED` was the entire operational
surface before this, and it is set at deploy time. A flag that needs a deploy to
flip is a constant with extra steps — and the deploy path is unavailable exactly
when it is most needed. We have lived this: the launch-blocking calls outage was
our own `Permissions-Policy: microphone=()`, one header shipped to everyone, and
the fix required another trip through CI.

**Precedence**, most specific first: per-workspace override → internal cohort →
percentage bucket → global switch → code default. The override wins in both
directions, which is what makes "ship to the founder's workspace first" — the
cheapest QA available to us — expressible at all.

**Buckets are stable.** A company's position for a given flag is
`md5(key + company)`, so it never moves. A workspace that flapped in and out of
a 10% rollout would watch a feature appear and disappear mid-task, which is
worse than never having it; and hashing the key too means two different 10%
rollouts do not land on the same unlucky tenth of the customer base.

**Four kill switches**, exactly the subsystems the issue names — AI, calls,
realtime, outbound send — each at its single choke point. `kill:calls` refuses
the WebRTC **token** rather than tearing down live calls: the customer on the
other end did nothing wrong, and hanging up on them to contain our incident
would be its own outage. `kill:realtime` is the one that cannot be enforced
server-side, because clients hold their own Supabase token and open their own
socket; it travels on `GET /v1/me` and an old build ignores it. That is an
accepted limit, and #339's version reporting is how we find out how many such
builds are left.

**Hygiene is enforced, not encouraged.** `removeBy` is required and CI fails
once the date passes. Permanent flags are how a codebase becomes untestable, and
the combinatorial explosion is a real cost. Kill switches carry far dates and
are reviewed rather than expired, because their job is to exist unused.

**`docs/ROLLBACK.md` answers the migration question**, which is the sharpest
edge: `supabase db push` runs before `wrangler deploy`, so a bad Worker's
migration is already live. An additive migration means roll the code back and
leave the schema. A removing or narrowing one means you cannot roll back at all
and must roll forward — which is why expand and contract are two deploys, never
one.

## D73 — a number is judged against itself, and 'watch' is ours alone (#235, 2026-07-29)

**Decision.** Every active number is assessed daily against **its own** trailing
28-day baseline. Two states above healthy: `watch` (internal only) and
`degraded` (the only state a customer ever sees).

**Why against itself and not a fleet threshold.** A plumber texting the same 200
regulars has a different natural delivery rate than a roofer cold-quoting. One
shared threshold would flag one of them forever and never flag the other, which
is the worst of both failures at once.

**Why two states.** The hard part of this feature is not detection, it is **not
crying wolf**. At our size a number sends a few dozen texts a week, so three
failures is an ordinary Tuesday. A system that called that "your number has been
flagged as spam" would cost us the account over a false alarm — and the one time
it was real, nobody would believe it. So `watch` exists to make us look before
we are sure, and `api_number_health` flattens it to `healthy` server-side so a
client cannot leak it even by accident.

**Three signals, any one sufficient:** a 15-point fall from the number's own
baseline; an absolute 70% floor when there is no baseline (a **recycled** number
arrives pre-poisoned with no history); and **replies collapsing while delivery
still reads fine** — the tell for silent filtering, where the carrier accepts,
bills, and drops. No delivery-rate check catches that third one, which is
exactly why it is in.

**Only transitions are announced**, including recoveries. A known-bad number
that mailed us every morning would train somebody to ignore the mailbox, and a
recovery is the only evidence a remediation actually worked.

**The customer copy never says "spam" or "flagged."** We know delivery fell; we
do not know which vendor labelled it or whether one did. It also promises no
self-serve fix, because remediation is registry paperwork that takes days and
needs the customer's real business identity — a button implying otherwise would
be a lie about the timeline. `docs/NUMBER-REPUTATION.md` is the runbook.

**The read fails open and silent.** `loadNumberHealth` decorates the numbers
list, which the composer's "text from" picker reads. A reputation lookup has no
business being able to stop somebody texting a customer, so any failure returns
an empty map and no banner.

## D74 — RPO up to 24 hours, RTO 4 hours (#249, 2026-07-29; RPO corrected 2026-07-29)

> **CORRECTED the same day, and the correction is the point of the issue.**
> This decision set **RPO 5 minutes** on the reasoning below — that it "is what
> Supabase PITR's WAL granularity gives us". **PITR is not enabled on
> production.** Verified 2026-07-29 against the Supabase Management API
> (`scripts/ops/verify-backup-posture.mjs`): `pitr_enabled: false`, with 8 daily
> physical backups and the newest 18.1 hours old at the time of checking.
>
> **The real RPO is up to 24 hours**, and that is the number for a customer or a
> security questionnaire. `docs/DISASTER-RECOVERY.md` §1 and §2 now carry it.
>
> This is #249's own complaint arriving one level up. The issue was filed because
> we had a backup plan and no evidence it worked; this decision then asserted a
> platform capability nobody had checked, and the document even told the reader to
> "assume the worst case: daily backups only, RPO of 24 hours" until somebody
> did — advice that turned out to describe reality exactly.
>
> It did not need the dashboard visit it was waiting on. The Management API
> answers it read-only with a token CI already holds, so the check is a script
> that **exits non-zero while PITR is off** rather than a chore nobody schedules.
>
> **RTO 4 hours stands**, and so does everything below about the four stores that
> do not roll back. **Enabling PITR is a paid add-on and a founder decision** — it
> is the one change that would make 5 minutes true.

**Decision, as it stands.** **RPO up to 24 hours. RTO 4 hours.** Both are
commitments about Postgres. Neither covers the reconciliation of the five other
stores.

**Decision as originally recorded, kept visible because the correction is the
point of the issue:** RPO 5 minutes. That figure is superseded and must not be
quoted anywhere — see the correction at the top of this entry. It is left in the
text rather than deleted so the *reasoning* that produced a wrong number stays
readable; anybody scanning for the number itself should take the line above.

**Why these numbers.** The RPO is not a preference — it is what Supabase PITR's
WAL granularity gives us, so choosing anything tighter would be a wish. *(This is
the reasoning the correction above overturns: the premise was true about PITR and
false about us.)* The RTO
is deliberately much longer than the restore takes: the measured data path is
**2.1 seconds** for the current schema (66 tables, 154 functions, every per-table
row count verified — `scripts/ops/backup-drill.mjs`, drilled 2026-07-29). Four
hours is what *discovering, deciding and reconciling* costs. An RTO set to the
restore time would be a number that has never survived contact with an incident.

**Why they had to be written down at all.** Without them there is no way to say
whether any given recovery was acceptable — which means there is no way to argue
about whether the current arrangement is good enough, and so nobody ever does.

**What the drill proves and what it does not.** It proves the logical path: the
dump restores, no constraint or extension bites only on reload, nothing is
silently dropped. It is **not** a PITR drill — restoring Supabase's own backup
into a fresh project is a dashboard action with a cost, and only the founder can
perform it. It is also moot while PITR is off: there is no point-in-time backup to
restore.

That was described here as "the one open item on #249", which was never accurate
and is now clearly not. What remains open, as of 2026-07-30:

1. **Enabling PITR**, and then drilling a restore into a fresh project. A paid
   add-on and a founder decision.
2. **An independent, off-Supabase copy** — where it lives, who holds the key, how
   long it is kept. Also a founder decision (§6). Note the concentration is worse
   than this entry originally implied: there is no R2, so the database, all four
   object buckets and the backups are all one account.
3. **A storage-backend inventory tool.** After a restore, every object-reclamation
   RPC we have provably reports nothing, because all four reason from
   `storage.objects` — a table that rolls back with the database while the bytes
   do not. `DISASTER-RECOVERY.md` §4 states the gap instead of naming a job that
   would return zero.

**Postgres is not all our state**, and the five others are reconciled, never
restored: **Supabase Storage** — not R2, which this product does not use — across
four buckets (`attachments`, `mms-media`, `voicemails`, `exports`), where the
metadata half *does* roll back;
Durable Object call state (turn off `kill:calls` *before* restoring — a DB
restore under live DOs is undefined behaviour); Stripe (the drift is money, and we
would not know in whose favour); Telnyx numbers (a row claiming a number we no
longer hold looks healthy and fails every send); and Telnyx **10DLC registrations
and in-flight ports**, which the first version of this entry omitted and which are
the two items measured in weeks and paid for per attempt.

**And "each has an existing reconcile job" was the most misleading sentence in
this entry.** Auditing every claim in the runbook against the code (#249,
2026-07-30) found that most of the named jobs cannot see post-restore drift: the
storage RPCs all reason from a metadata table that rolls back, the subscription
job examines a narrower set of companies than it appears to and has no on-demand
trigger, `job:sweep-stale-calls` never touches a Durable Object, and the dangerous
direction of number drift has no tool at all. Naming a job that will report zero
is worse than naming none, because it gets ticked off. The runbook now says which
jobs work, which provably do not, and where the gap is unclosed.

**A defect that audit turned up, and it was not in the document.** `kill:calls`
promises to stop calls "being placed or accepted" and was enforced at exactly one
place — the WebRTC token mint. A Telnyx JWT lives up to 24 hours, so any softphone
holding one kept placing calls through `POST /v1/calls/browser` after the switch
was thrown. Both this runbook's containment step and any real incident response
were relying on a switch that did not contain. Now gated at both routes, with a
test that enumerates the enforcement points from the filesystem so the pair cannot
silently become one again.

**The concentration risk is stated, not solved.** Everything lives in one vendor
account, so account-level loss takes the backups with the data. Where an
independent copy lives, who holds the key, and its retention are founder
decisions with cost and custody implications — inventing them in a document would
be exactly the unverified instruction this work exists to replace.

## D75 — one token model for pages a customer's customer opens (#335, 2026-07-29)

**Decision.** One shared primitive (`public_links` + `apps/api/src/public-links/`)
for every page opened without an account. **One token, one object, one purpose.**

**Why decide before building the features.** The issue's devil's advocate is
right that speculative infrastructure fits its first real consumer badly — and
also right that this is not an objection to *deciding*. Four queued features need
this (#224 pay, #287 quotes, #245 calendar, #232 widget); built independently
they arrive as four token schemes, four expiry policies and four sets of security
assumptions. What is built here is the security substrate only: minting,
resolving, revoking, rate limiting, and the failure page. No feature behaviour,
so there is nothing for the first consumer to fit badly.

**Why the bar is higher here than anywhere else in the product.** THE PERSON
EXPOSED IS NOT OUR USER. A homeowner's address, phone number, job details and
payment amount behind a guessable URL is a breach involving somebody who never
agreed to anything with us and has no relationship with us at all. Every choice
below follows from that sentence.

**The model:**

- **256 bits, base64url, not a UUID.** A v4 UUID has 122 bits and a recognisable
  shape. These URLs live in SMS logs, browser history and third-party calendar
  servers. base64url rather than hex because a link that wraps in a text message
  is a link a homeowner mistrusts.
- **Only the SHA-256 hash is stored.** The plaintext is returned once, at mint,
  and never again — not to support, not to a query. A leaked backup or a log line
  then discloses nothing usable. This is what makes keeping an access log safe.
- **Purpose is stored and checked, never inferred from the route.** A token
  minted to VIEW a quote cannot be replayed against the route that ACCEPTS it.
  Without this, one leaked view link accepts the quote.
- **Expiry is NOT NULL.** A link with no expiry is the failure this exists to
  prevent, and making it representable would guarantee somebody creates one.
- **Revocation is always individual.** `max_uses: 1` kills a payment link on
  payment; revoke-by-subject is "this quote is withdrawn" in one call. The ICS
  feed (#245) is the awkward case the issue names — long-lived by nature, pasted
  into third-party servers — and individual rotation is the only control that
  fits it.
- **One failure page for every failure.** Expired, revoked, spent, wrong purpose,
  never existed: identical response. A holder who can tell them apart has been
  handed an oracle.
- **Fails CLOSED.** Unlike almost every other read in this codebase, an
  unreachable database here returns "not available" rather than degrading
  politely. It must never hand out access it could not verify.

**The surface is guarded in one place** (`publicLinkGuard`), so the first
consumer cannot skip a control and the fourth cannot do it differently:
IP-keyed rate limiting (there is no account to key on — that is the point),
`X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` unconditionally,
`Cache-Control: no-store, private`, and `Referrer-Policy: no-referrer`.
`noarchive`/`nosnippet` matter as much as `noindex`: a snippet is where the
customer's name would appear.

**Privacy posture.** Never anything in the URL but the opaque token. The access
log records outcome and **country** — never the token, never the address. A run
of unresolved tokens is the only trace an enumeration attempt would leave, since
these routes sit outside every gate that protects `/v1`; but storing an address
to protect somebody would be its own harm. Access rows are diagnostics, pruned
at 30 days.

## D76 — single-carrier risk is accepted deliberately, with the seam cut and the recovery time named (#241, 2026-07-29)

**Decision.** We continue on Telnyx alone. We do **not** fund real failover now.
What we do instead is make the second carrier *possible*: the messaging seam is
cut, vendor error codes no longer reach business logic, and the parts that would
be a rewrite are written down rather than discovered later.

**Why not failover.** A second live carrier means a second registration
pipeline, a second inventory, a second set of webhooks and signature schemes,
and — for voice — a second SDK embedded in three clients. At current revenue
that is a large slice of the build budget spent on an outage that has not
happened, while real customer-facing gaps stay open. Silence would not be
defensible; this is the deliberate version.

**The accepted recovery times**, so "accepted risk" means something:

| Failure | Recovery | Time |
|---|---|---|
| Telnyx messaging outage | Wait it out. `kill:outbound-send` (#283) stops the retry storm and the bill in ~10s | **Their RTO, not ours** |
| Telnyx voice outage | Calling is down. Texting is unaffected — the two paths share no runtime | **Their RTO** |
| Account-level messaging block | Port numbers to a second carrier | **Weeks.** Porting is carrier-paced and there is no way to make it faster |
| Account-level number-ordering block | Already live (10038, Canada). Buy from a second provider | **Days**, once an account exists |

The third row is the one that should make somebody uncomfortable, and it is
stated plainly for that reason: an account-standing decision by one vendor would
take our product off the air for weeks. We are accepting that, today, knowingly.

**What was actually built** (the part that is not a document):

- `packages/shared/src/carrier-failure.ts` — our failure taxonomy. The Telnyx
  code map is the **only** place a vendor code appears in a decision; a second
  provider adds a map beside it.
- `messages.error_reason` — classified once at the edge, persisted, and read by
  all three clients. They previously each hardcoded `"40300"`, so a carrier
  change would have required shipping three apps (weeks, per #339).
- An unmapped code is `unknown` and **never** `opt_out` — the one reason with a
  legal meaning, where a wrong guess takes somebody's number out of service.

**What was deliberately NOT abstracted.** Call control. The DO's identity model,
command set, event vocabulary and ordering guarantees are shaped by Telnyx Call
Control; a markup-based provider (Twilio's TwiML) inverts control flow entirely.
Hiding that behind an interface would look portable right up until somebody
tried it, which is the most expensive kind of wrong.
`docs/CARRIER-PORTABILITY.md` §1 says so in detail.

**Amendment, 2026-07-29 — the comparison is costed, and the second carrier is
named: Bandwidth.** This decision originally ended by saying someone had to ask
for quotes. That conflated two different things. A *negotiated* rate does need a
sales conversation; **list prices are published**, and reading them off the
vendors' own pages is verification, not assertion. Done: every figure in
`docs/CARRIER-PORTABILITY.md` §3.2 is sourced and dated, and lives in
`apps/api/src/billing/carrier-list-prices.ts` with a recheck date a test fails on.

The comparison changed the answer in a way the structural table alone could not:

- **Carrier surcharges are pass-through and therefore cancel out** of a vendor
  comparison. Only the base rate is the vendor's own. Comparing all-in rates —
  the intuitive thing — would have overstated how similar the vendors are.
- **Bandwidth is messaging-cost-neutral** ($0.0040 base, identical to Telnyx) and
  command-based, so §1's seam fits and its voice rewrite is the smaller one.
- **Twilio costs +0.43¢ per outbound segment** (2.08× the base): +$2.15/mo per
  fully-used Starter tenant against $29 of revenue, +$10.75 per Pro against $79.
  On voice it is worse — 2.25¢ per forwarded minute versus Bandwidth's 1.55¢.

So: **Bandwidth is the designated second carrier, Twilio is break-glass.** That
is a decision we could not make before and can make now, and it means an
account-level block is answered by executing a named plan instead of starting an
evaluation.

**A finding worth keeping.** Both published alternatives price a forwarded minute
*above* the 1.2¢/min our cost model assumes (1.55¢ and 2.25¢). That figure is
incumbent-shaped, so a voice migration is a repricing as well as a rewrite, and
`VOICE_OVERAGE_CENTS_PER_MINUTE` moves with it. A test asserts the inequality
still holds, so a vendor repricing under us surfaces as a failing suite.

**What genuinely remains external** is one thing, and it does not block the
choice above: a **negotiated** rate. List price is enough to pick a direction,
not to sign. (The Canadian-registration unknown that sat here was answered the
same day — #379, R3: there is no CA→CA registration on any network, and the real
Canadian risk is carrier filtering of long codes, mitigated by toll-free (#329).
That makes a vendor's toll-free story part of this comparison too.) The urgent
driver is still not redundancy: our headline market is gated by a Telnyx account
restriction today, and every alternative sells Canadian numbers.

## D77 — default retention per data class, and why the default is years (#284, 2026-07-29)

**Decision.** Written defaults, published, per data class. Nothing is deleted by
this decision alone — it establishes the numbers so the enforcement job, the
workspace control and the legal hold in #284 have something to enforce.

| Class | Default | Why this number |
|---|---|---|
| **Messages and conversations** | **7 years** after last activity | The trade's dispute cycle, not a privacy instinct. See below |
| **Attachments** (job photos) | Same as their message | A photo is evidence of the same job the texts describe; splitting them would leave a thread referencing pictures that no longer exist |
| **Call records** (who called, when, outcome) | **7 years** | Same dispute logic. It is metadata, and it is small |
| **Voicemail audio** | **1 year** | The sharpest asymmetry here. It is somebody's actual voice recorded in their home, carries full breach cost, and its business value is almost entirely in the first weeks |
| **Voicemail transcripts** | **7 years** | The words are what a dispute needs. Keeping the text while dropping the audio preserves the value and sheds the liability |
| **Audit log** | **12 months** (#231, unchanged) | Stated separately on purpose — it is the record of who did what to the data above, and answers a different question |
| **Opt-outs** | **Never** | Belongs to the person who sent the STOP, not the business that received it |
| **Consent records** | **3 years**, stripped | CASL requires the record; names and message contents are already removed |

**Why seven years, when the privacy instinct says months.** The issue's devil's
advocate is right and it decided this: *"a contractor in a warranty dispute over
a two-year-old job needs those texts, and the moment they discover we deleted
them, we have caused the harm we were trying to prevent."*

Seven years is not arbitrary — it is the outer edge of the contractor liability
and warranty window in most of the provinces and states we serve, and it matches
the business-record retention their accountant already assumes. A shorter
default would be us imposing our compliance preference on their legal exposure.

**Voicemail audio is the one exception, and the reasoning is worth keeping.**
Every other class gets long retention because deleting it destroys evidence.
Audio is different: the transcript preserves what was *said*, so the dispute
value survives, while the recording — a person's voice, in their house — is the
single item on this list with the highest breach cost and the steepest drop in
usefulness. Keeping the words and dropping the sound is the trade that costs the
customer nothing.

**A conservative default with a shorter option available**, never the reverse.
Shortening is the workspace's choice, warned before anything is destroyed, and
the change itself is an audit-log entry (#284). Users must never discover a
retention policy by losing something.

**Not yet built:** enforcement, the workspace control, and legal hold. This
decision is the part that had to come first — "forever" was a decision we made
by not making one, and the enforcement job is unwritable until somebody has said
what the numbers are.

## D78 — the AI-receptionist economics, measured; the bet itself is still open (#397/#367, 2026-07-29)

**This is not the decision #397 asks for.** It is the arithmetic that decision
needs, moved out of the "somebody should research this" column. #397's asks 1, 3
and 4 are a strategy call, a price and a sequence, and all three were resting on
one asserted figure: *"$16–$30/mo in raw model cost"* for a 200-minute
contractor. Its own closing comment said that figure *"should be measured before
it is planned against."* It now is — `apps/api/src/billing/voice-ai-costs.ts`,
sourced and dated, with a recheck a test fails on.

**The measured cost of a receptionist minute is 6.8¢**, from the vendor we are
already on (telnyx.com/pricing/conversational-ai, read 2026-07-29):

| Component | ¢/min | What it covers |
|---|---|---|
| Voice engine | 5.0 | Orchestration — turn-taking, barge-in, tools, knowledge retrieval — **plus STT and TTS**, one rate |
| LLM | 0.6 | On Telnyx GPUs, published $0.003–$0.006/min; the **top** is carried |
| Telephony | 1.2 | Our own measured voice minute, not their $0.0032 floor |

**What that changes, and what it does not.** #397's reference contractor (100
calls averaging two minutes) costs **$13.60/mo**, below the asserted $16 floor.
So the issue's stronger claim — that the cost *"equals or exceeds our entire $29
plan revenue"* — is **false**. It is **47%** of it.

The conclusion that claim was supporting is **unaffected, and now measured
rather than assumed**: 47% of ARPU cannot be given away inside a $29 plan, so a
receptionist is necessarily a metered paid module (#12), exactly as #397 says.
The premise was wrong and the answer was right, which is worth recording as
precisely as the correction itself.

**Why Telnyx and not a pipeline we assemble.** Workers AI can do the pieces for
almost nothing (Whisper $0.0005/audio-min, melotts $0.0002/audio-min), and that
arithmetic is what makes a build look tempting. It is not the honest comparison:
a receptionist is a **realtime conversation**, and turn-taking, barge-in and
interruption handling are the product — not the transcription. Telnyx sells that
layer against our existing account, and D76 already established the calls runtime
is Telnyx-shaped. The priced path is the one we could actually ship.

**The caps this hands the cost-protection mandate**, which a metered voice module
cannot ship without:

| Monthly revenue | Break-even minutes |
|---|---|
| $10 (the instinct ask 3 warns about) | **148** — under water inside the reference contractor's own 200 |
| $29 (if ever bundled) | 426 |
| $49 | 720 |
| $79 | 1,161 |

**Recommended posture, for the founder to confirm or decline.** Price the module
at **$49–$79/mo**. At the reference usage that is a **72–82% gross margin**, it
undercuts the category's $199 floor by more than 2×, and it is 2–3× our current
ARPU. Ask 3's stated trap is real and the numbers now show it: at $10 the module
loses money on the very contractor it was sized for.

**What is still genuinely open, and it is a bet rather than a task.** Whether to
build it at all (#367). #397's own devil's advocate is the argument to beat —
*"a solo founder building a voice AI product to defend a texting product is how
focus dies"* — and it deserves a deliberate yes or a deliberate no. **Ask 2, the
insurance, is bought either way**: port-out notices alert on `pending` (#398) and
`job:call-silence` catches one workspace going quiet against its own history
(41ebba6). Nothing further is buildable without placing the bet, which is why
this entry stops at the recommendation.

## D79 — one resolver, enumerated deciders, resolved at fire time (#412, 2026-07-29)

**Decision.** An invariant that must hold across more than one call site gets this
shape, or records why it does not:

1. **One resolver**, declared in its own file as the only one. A single
   implementation to be right, rather than two to keep in agreement.
2. **A test that enumerates who may decide**, derived from the filesystem or the
   schema rather than hand-listed. Becoming a decider then requires editing a list
   somebody reviews, so a new path cannot skip the check silently.
3. **Resolve at fire time**, not at schedule time, whenever the answer can change
   between the two.

**The reference implementation is D49** (`messaging/destination-clock.ts`, #292),
which argued all three for quiet hours and whose test names the one file allowed
to decide.

**Why this is a rule and not a preference.** #412 found **six** open issues asking
for this shape independently, none of them knowing it already existed — the
alternative to naming it was not "no document", it was six divergent
implementations of one idea. All six have since been resolved, several *by*
applying it, which is the evidence rather than the counter-argument.

**Point 2 is the half that decays without a test**, and it is the half most often
skipped. `runPreSendGates` was already a single choke point for opt-out by
argument — *"every send path funnels through this function"* — but nothing stopped
the next send path from not funnelling. That gap is what #331 was about.

**Instances now in the tree**, so the next person can copy a real one:

| Guard | What it enumerates |
|---|---|
| `api messaging/destination-clock.test.ts` | The one file allowed to decide quiet hours |
| `api messaging/send-paths.test.ts` | Every send path, and which pre-send shape it is (#225) |
| `web lib/auth/app-routes-registered.test.ts` | Every `(app)` and `(auth)` route, from the filesystem (#133/#258) |
| `supabase/tests/number_access_surfaces.test.sql` | Every read surface filtering on number access (#368) |
| `api db-scope.test.ts` + `tenant_scope.test.sql` | Every tenant table, in both languages (#347) |
| `api flags/flags-roster.test.ts` | Every kill switch, against the ops script and the runbook (#283) |
| `api billing/carrier-list-prices.test.ts` | External figures, with a recheck date a test fails on (#241) |

**The freshness variant is the same idea applied to facts rather than code
paths**: a dated constant plus a `RECHECK_AFTER` a test fails on, so an external
number cannot rot silently (`carrier-list-prices.ts`, `voice-ai-costs.ts`,
`compare/verification.ts`, `carrier-throughput.ts`). #403 exists because that date
was once a string literal, which guaranteed the assertion could never fail.

**Where it does NOT apply, recorded so the rule is not cargo-culted.** An
invariant with exactly one call site does not need a roster; the roster's value is
catching the *second* one. And a resolver whose answer cannot change between
schedule and fire time does not need point 3 — D49 needs it because DST moves.

---

## D80 — an unwind has to leave the milder residue, and something has to sweep it (#263)

Three defects in one bug, and they are the same mistake seen from three angles:
work that can half-happen, with nothing downstream that notices.

**A sweeper that covers one bucket is not a sweeper.** `api_orphan_attachment_objects`
and `api_ghost_attachment_rows` (#15) both hardcode `bucket_id = 'attachments'`.
Message media lives in `mms-media` against `message_attachments`, so for as long
as picture messaging has existed, a crashed MMS send has been able to leave an
object that no read path could reach, no accounting counted (`mms_bytes` sums
ROWS), and no pass would ever reclaim. Billed forever, findable by nobody. Both
directions of media could produce it, since inbound stores its own copy the same
upload-then-insert way. **A cleanup path that is deliberately best-effort — and
this one is, because a cleanup error must not mask the send failure the caller is
already reporting — is only honest if something else sweeps what it drops.**

**When an unwind can be interrupted, choose which residue it leaves.** The
outbound cleanup removed objects first, then rows, which is the wrong order. Both
residues are recoverable now, but they are not equally bad:

- an object with no row is invisible, unaccounted bytes;
- a ROW with no object is worse twice over — `api_storage_usage` sums rows, so it
  over-reports what the customer is storing, and the retry path mints a signed URL
  for it that Telnyx fetches a 404 from, failing the send for a reason nobody can
  see.

Rows are deleted first now. The principle generalises: an interruptible unwind has
a best and a worst stopping point, and the order is a decision, not an accident.

**Make the bad intermediate state unrepresentable before you make it
recoverable.** The old loop uploaded and inserted per item, so a transient error
on item N committed rows for 0..N-1 — a partial media set. One batched insert
makes the row set all-or-nothing at the database, so callers no longer handle a
partial set: it cannot occur. That is worth more than any amount of downstream
tolerance for it.

**A retry may not quietly send something different from what was authored.** The
retry rebuilt its media from whatever rows survived and returned 200, so a send
whose third photo never persisted went out as a two-photo message with a
clean-looking thread. `messages.media_count` records what the send was created
with, written BEFORE the first upload so it survives every failure in the media
path, and the retry refuses on a shortfall. The bytes are genuinely gone — the API
never keeps the original payload — so refusing and saying so is the only honest
answer available. Null skips the check, which is every text message and every row
predating the column, so nothing historical became un-retryable.

**What could not be closed, stated plainly.** A crash in the instant between the
gate RPC's insert and the `media_count` write leaves a message that meant to carry
media with no record that it did. Closing it needs the count inside the gate
transaction, which means a new parameter on `gate_outbound_send` — and since
Postgres cannot add one in place, that means duplicating 182 lines of plpgsql into
a second migration and living with two copies of the send gate. A microsecond
window is the cheaper thing to accept than a permanently forked gate function,
and this paragraph exists so the next person does not have to re-derive that.

**And the client half.** Both mobile clients caught the 409 and replaced the
server's sentence with "This message can't be retried." That was fine while a 409
meant one thing. It now also means "only 1 of your 3 photos was saved, write it
again and re-attach them", so a hardcoded line threw away the only actionable part.
Web had always shown the server message; the two mobile clients now do too. **A
client that overwrites a server's error copy is making a bet that the server will
never have anything more specific to say.**

---

## D63 — a feature is done when the things that describe it know about it (#438, 2026-07-29)

**Decision.** For any customer-visible change, the definition of done includes ONE
more question, and it is one question on purpose:

> **Does anything outside the app need to know about this?**

If the answer is no, that is a complete answer and it is done. If the answer is yes,
`docs/DESCRIPTIVE-SURFACES.md` has the nine-row list of what "outside the app"
means, and most features touch two or three rows.

**Why one question and not a form.** #438 argues its own case against itself, and
the objection is right: a checklist that adds friction to every release gets skipped
and becomes theatre. A single question survives a busy Friday. A form does not, and a
skipped form is worse than no form because it manufactures the belief that the step
happened.

**Why it is a class and not a ticket.** Over roughly twenty audit iterations the
implementation was right almost every time — number access on push, the outbound-leg
gate, insert-before-call durability, Sentry PII scrubbing, quiet hours through one
resolver. **Almost every real defect found in that stretch was in an artifact that
describes the product, not in the product:**

| | The drift |
|---|---|
| #389 | the subprocessors page said Cloudflare receives "no message content" after Workers AI shipped |
| #434 | `llms.txt` said the AI features were off by default; all four ship on |
| #436 | a blog post advised opt-out handling, in one of two posts carrying the same claim |
| #437 | "live in minutes" in sixteen places, one of them under a post warning against same-day promises |
| #403 | a comparison test pinned to a literal date, freezing the claim it should expire |

Six surfaces, one cause: **"done" meant the code works on all three clients**, and
the artifacts were maintained by whoever happened to remember. That is why the drift
clusters *after* big shipments — calling shipped and `llms.txt` was updated; AI
shipped three weeks later and it was not. Nobody was careless. No step fired.

**The expensive part is who finds it.** A code defect is found by a test, a customer,
or an error. A description defect is found by a prospect who quietly buys something
else, by a regulator, or by a lawyer reading our own blog back to us. And it worsens
as the product improves: every feature that ships without touching these surfaces
widens the gap between what we built and what anyone can discover we built.

**Two mechanisms, because a question alone is not enough.**

- **Where a claim is a number, read it from the source that enforces it.**
  `llms-txt.test.ts` reads the AI monthly caps out of the API constants; it caught
  two of three wrong while being written. `activation.ts` holds the activation claim
  with a test that sweeps the marketing tree for the retired phrasing.
- **Where two documents state the same fact to different audiences, bind them with a
  test.** `subprocessors/inventory-agreement.test.ts` fails if a third party is named
  on one of `DATA-INVENTORY.md` / the public subprocessors page and not the other, or
  if either stops disclosing Workers AI. That is the #389 divergence made
  unrepeatable, rather than fixed once.

**Prefer a default that is true everywhere over per-surface overrides.** #437's CTA
and #385's price both drifted because the qualified version lived in one place and
the unqualified one travelled. A default that is true everywhere needs no
maintenance; a default that is wrong somewhere plus overrides wherever anybody
noticed is the mechanism of drift, not a fix for it.

**And when a description is wrong, which direction matters.** `llms.txt` understated
what the product does with message text. Overstating a limit is a documentation
error; understating what you do with customer data is a different thing. When in
doubt, describe the product as doing more with the data and less for the customer
than you think, and let the correction be the flattering one.


---

## D81 — the keep-or-kill number for Lou, chosen before the data (#431, 2026-07-29)

`ai/run.ts` was a good spend gate and nothing else. Every AI feature declared a cap,
an alert threshold, a timeout and an opt-in before it could spend, and
`ai_usage_reserve` recorded the reservation per company per feature per month. So
*"what did Lou cost this tenant?"* had a precise answer and *"was it worth it?"* had
none — for the one feature in this product whose output is explicitly **optional**.

### The measurement

**Three counters on the same ledger row as the spend**, never one rate.
`company_ai_usage` gains `outcome_used_count` / `outcome_edited_count` /
`outcome_discarded_count`. Same row, deliberately: cost and value are then physically
inseparable and no surface can show one without the other.

**Three, not one, because #431's own devil's advocate is right.** A discard can mean
the draft was wrong or that the crew member wanted to say something more personal,
which is the product working as intended. An edit can mean 80% right and time saved
or 20% right and time lost. Collapsing them into an "acceptance rate" destroys the
distinction that makes the number worth reading, so no function anywhere computes a
ratio — `api_ai_value_report` returns counts and both denominators.

**Through the authed API, not client analytics.** #431 suggests the enum-only PostHog
contract, which fits the shape exactly. But client telemetry is unreliable here — ad
blockers eat it, and the Sentry tunnel that would have fixed the same problem was
declined. A keep-or-kill decision must not be biased by *which* customers block
trackers.

**No message content, ever.** The recorded value is one of three enum strings.

### What the numbers mean, per feature

| Feature | used | edited | discarded |
|---|---|---|---|
| **reply drafting** | sent as written | sent after changes | shown and not used |
| **task enrichment** | kept as filled in | corrected first | cleared |
| **voicemail transcript** | *unobservable* | *not editable* | listened anyway |

The transcript row is the interesting one. #431 names its negative signal — "played
the audio anyway" — and that is fully visible **server-side**, because
`GET /v1/calls/:id/voicemail` is the only way to obtain playable audio. So it is
recorded there, once, identically for all three clients, with no client code at all.

The positive case is a person **not** doing something. Observing it client-side means
inferring "read the words and moved on" from view-disposal timing, and on the list
screens Android and iOS use, a row disposes when you scroll past it — the inference
would count *scrolled by* as *read and satisfied*. Three platforms each guessing
differently is worse than one honest absence, so that label is null and the usage
screen prints no line for it rather than a zero. **A null label means unobservable,
not "none yet".**

### The threshold, set now (#431 ask 5)

> *"A number chosen before the data arrives is a decision; one chosen after is a
> rationalisation."*

Judged on **reply drafting**, over a full month with at least **200 outcomes
recorded** across at least **five** workspaces — below that it is one crew's habits,
not a signal.

- **Keep and invest** if `used + edited` is **at least 40%** of outcomes recorded,
  **and** `used` alone is at least **15%**. Two thresholds because they answer
  different questions: the first is "did it help", the second is "was it ever right
  first time". A feature that is always edited and never sent as written is a typing
  aid, which is worth less than it costs.
- **Keep, unchanged, no further AI investment** between **20% and 40%**. It helps
  some crews; it is not evidence for a larger bet.
- **Turn it off by default** below **20%** — the feature stays available to anyone
  who switches it on, but stops spending for everyone who never asked.

**And the bet this gates.** #367/#397 (an AI receptionist) is the largest AI
commitment available to us, and its case rests on AI output being good enough for
customers to rely on. Reply drafting failing to clear 40% is evidence against that
premise from our own product, with our own customers, at a cost of nothing. Shipping
the bigger bet before reading this number is betting twice on an untested premise.

**What would make me wrong.** The rate is a proxy and a noisy one. If drafting lands
between 20% and 40% while the crews who *do* use it are demonstrably faster to first
response (#388's five-minute window is the metric that actually pays), the threshold
is measuring the wrong thing and should be replaced by that — but only by *that*, and
only stated in advance, or it is a rationalisation again.

---

## D82 — capture a prospect lawfully, and keep the opt-out off the global list (#312, 2026-07-30)

#312's remaining item had been left open as "a founder decision about whether we run
marketing email". All three obligations it named are real — an unsubscribe
mechanism, record-keeping that outlives the message, and a lawful basis to
maintain — and all three are **engineering**. Building them commits nobody to
sending a campaign; it makes capture lawful and reversible, which is the only state
from which the decision to send is even available. So it is built.

### The offer, and where doctrine put it

`CONVERSION.md` §7 is binding and bans "no chat-widget pop-up, no modal on load"
and "no competing CTAs". §2 permits exactly one thing: a secondary action that is
"visually quieter". That settles the shape without a taste argument: **an inline
band under the comparison ledger, an outlined pill against the primary cobalt
fill.** Exit-intent is the most intrusive version of this available and would have
meant building the machinery §7 forbids using.

The offer is "we will email you this table so you can forward it", because #403
made those numbers sourced and dated and the person reading them is often not the
person who signs off. **Nothing is gated** — the whole table is on the page above
it, so this is a convenience, never a wall.

### The decision that matters: the opt-out does NOT go in `email_suppressions`

My first draft put it there, reasoning that one list every send already consults
means an unsubscribe can never be forgotten. That would have been a serious bug.

`email_suppressions` (#386) is **global and has no purpose column**, and `sendEmail`
consults it on every send in the product. An unsubscribe written there would also
have stopped that person's **payment-failure notice, their security email and every
inbound-text alert**. For a prospect who later became a customer, unsubscribing from
a comparison email would silently have broken their billing mail. Opting out of
commercial mail has never meant opting out of the messages that keep an account
working.

So **`marketing_contacts` is the list**, and `unsubscribed_at` on it is the opt-out.
A commercial send may only go to an address with a live row, which makes the absence
of a row the safe default: nothing has to remember a negative, and retention can
delete an unsubscribed row without any risk of resurrecting them. Bounces and
complaints still stop commercial mail for free, because every send goes through the
same transport that already filters the global list.

The two lists meet at exactly one point: **a complaint blocks a new capture.**
Somebody who reported us as spam has not asked to hear from us again because a
checkbox got ticked. A hard bounce does not block — that is usually a typo, and the
person retyping their address is the fix. Same principle as an SMS opt-out only the
customer can lift, applied where the customer's act is unambiguous and withheld
where it is not.

### Three smaller decisions worth keeping

**The consent record is the WORDS, not just the fact.** `consent_text` snapshots
what was shown, because marketing copy changes and a record pointing at today's
wording is not evidence about last year's. The server stores **its own** constant
and ignores anything the client sends: a client that could supply the wording could
record any agreement it liked. A test binds the two strings across the boundary.

**The commercial send fails CLOSED where the transport fails open.** `sendEmail`'s
suppression lookup deliberately sends anyway if the database is unreachable, and
that is right for transactional mail — "a database blip must not be the reason a
customer never learns their payment failed". It inverts here: mailing somebody who
unsubscribed costs a compliance breach, not mailing them costs a table they can read
on the website.

**The mailing address is ONE fact in `packages/shared`, not a Worker env var.**
`MAILING_ADDRESS` was already an explicit null awaiting ops, with every identity
surface written to render honestly without it. I first added a separate
`MARKETING_POSTAL_ADDRESS` secret and removed it again: holding the same fact twice
lets the two disagree — set one and the legal pages show an address while the email
refuses to send; set the other and the email carries an address the pages say we do
not have. Both are silent inconsistencies on a compliance-adjacent surface, which is
the class of bug worth designing out rather than commenting about.

**Until ops fills it in, the send is off and says so.** The capture, the consent
record and the unsubscribe all work; `POST /marketing/comparison` reports
`sent: false` and the form says "we are not sending marketing email yet" rather than
promising an inbox arrival. Inventing an address would put a false statement in a
compliance footer, where a missing one is a feature switched off.

### What is still a founder decision, honestly

Whether to ever **send** anything beyond the requested comparison. That is a
business decision about running a marketing programme, and it now has working
machinery behind it instead of a blocker in front of it.

---

## D83 — cite a job or a step, never a line (#442, 2026-07-30)

`docs/deploy/` set an unusually good standard: *"each fact cites its `file:line`.
Nothing is invented."* Citing the source is the right instinct and it is why those
documents are trustworthy at all. **Citing a LINE is the fragile half**, and it
broke inside a single day: renaming `ci.yml`/`deploy.yml` to `checks.yml`/`ship.yml`
turned **36 citations across 8 documents** into precise-looking pointers at files
that no longer existed.

**Decision.** A citation names the file plus a **job or step name**:

```
`.github/workflows/ship.yml` → the `backend` job's "Push database migrations" step
```

**Why that is strictly better, not just different.** A line number moves on every
ordinary edit, so the citation is wrong far more often than the thing it points at
changes. A step name moves only when somebody renames the step — and at that moment
the citation reads as *wrong*, which a reader can act on, rather than silently
resolving to an unrelated line, which they cannot.

**The reason this was worth doing now rather than later.** The person who renamed
the files knows which line went where today and will not in December. It is the one
kind of backlog item where waiting makes the work strictly harder rather than just
later.

### What is guarded, and what deliberately is not

`scripts/check-doc-citations.mjs` (CI, beside the migration and env-reference
guards) asserts that **every cited repository path resolves**. Paths only.

**Not line numbers**, and not content. A guard that failed whenever a cited line
moved would fire on every ordinary edit, and the thing people do with a guard that
cries wolf is delete the citation it complains about — so it would destroy the
practice it was meant to protect. Checking existence catches the rename class,
which is the class that actually happened.

**Not the anchor prose either.** Verifying that a named step exists is tempting and
is the line-number mistake in a new costume: it would couple the docs to a step's
exact wording, which is the thing that is allowed to change. The file half is
mechanical and worth enforcing; the anchor half is prose a human reads.

### The one legitimate reason to cite a path that is gone

A document recording work already **done** may cite files the work itself deleted —
`V4-REDO-PLAN.md` names two components its own purge removed. Those documents carry
a visible `COMPLETED` or `SUPERSEDED` banner and the guard skips them.

Marked in the document rather than in an allow-list inside the script, deliberately:
an ignore list is invisible to the person reading the doc, "add it to the ignore
list" is how a guard stops guarding, and a reader of a historical plan genuinely
needs to know its citations describe the past.

**The guard earned itself on first run**, finding two stale citations in
`V4-REDO-PLAN.md` that #442 had not counted — which is the argument for it over a
one-time sweep.

---

## D84 — derive the sets, interpolate the numbers, author the prose (#451, 2026-07-30)

Two files described this product to machines and only one could go stale.
`sitemap.ts` derives from `BLOG_POSTS`, so publishing a post cannot leave it behind.
`public/llms.txt` was a static asset typed by hand, and per #434 it drifted within a
fortnight: current through the calls feature, with **zero** mentions of AI,
transcripts, mentions or Lou a fortnight after all four shipped to three clients.
Same repo, same audience, ten lines apart in the same directory. The only
difference was that one was generated.

`llms.txt` is now `app/llms.txt/route.ts`, built by
`lib/marketing/llms-txt.ts`. But **not all of it is generated**, and the split is
the decision worth recording — it is by KIND of fact, not by section:

**DERIVED — the enumerable sets.** Every blog post comes from `BLOG_POSTS`, so
publishing one updates the file with no human step. Every URL comes from
`LIVE_ROUTES`, so a route rename cannot leave a dead link. The old file summarised
the guides in one sentence; it now lists all twelve by title and URL, which is
better for the audience *and* impossible to forget.

**INTERPOLATED — the numbers**, read from `PLAN_PRICING` and
`US_REGISTRATION_FEE_DOLLARS` inside sentences a person wrote. A price change
updates the prose without anybody rewriting it, and templating whole sentences to
achieve the same thing would have produced robotic copy for no gain.

**Only where a digit reads naturally, though.** Interpolating "Two numbers on Pro"
produced "2 numbers on Pro", which is worse copy — and a sentence that spells a
number out needs rewording if the number changes anyway. Reverted to the authored
word; the Pricing section states the same count as a digit and *is* interpolated, so
the fact is still derived somewhere.

**AUTHORED — the prose, byte for byte.** #451 is explicit that the honest-omissions
voice ("No phone menus, queues, or call-center features") is the file's best feature
and a judgement rather than data, so generating it would cost the thing worth
keeping. Verified by diffing the built output against the file it replaced: the 78
authored lines are identical.

**Page descriptions stay authored too**, which was a judgement call the issue did not
ask for. A bare derived link is worse for the reader than a line saying why to open
it, so `PAGE_NOTES` pairs every `LIVE_ROUTES` key with a description **or an explicit
`null` and a reason**. It is exhaustive by TYPE, so adding a route fails to compile
until somebody decides. That immediately surfaced two live routes the hand-typed
version had silently omitted — the acceptable-use and cookies pages.

### What a test still has to cover, and why that is not a failure of the design

The AI monthly caps live in the API Worker and the web app cannot import across that
boundary, so `llms-txt.test.ts` reads them out of the API source. That is the seam,
it is stated in the module header, and it is the assertion that caught two of three
caps wrong while #434 was being closed.

**More generally: derivation beats a test for facts that exist as data, and a test
is the only option for facts that do not.** A test tells you the file is wrong;
derivation means it cannot be. But a test can only assert what it knows to look for,
which is why #434 happened at all — nothing knew `llms.txt` should mention a feature
that had just shipped. Deriving the enumerable sets is what closes that hole; the
remaining tests cover the numbers.

---

## D85 — realtime topics stay company-wide, and that is an accepted exposure (#349, 2026-07-30)

Every broadcast goes to one topic per company. #106 makes access **per number**. So a
member denied a number still receives every id-only event for conversations on it.

**What leaks, stated precisely, because "no content leaks" is true and insufficient:**
that a conversation with a given id exists, every time it sends or receives, the
direction, and therefore the volume and rhythm of that line. A subcontractor
excluded from the main line can watch its traffic. **What does not leak:** any
message content, name or number — the refetch is correctly gated and a denied member
gets nothing back from the API.

### The finding that decided it: naive per-number topics would be WORSE

The obvious fix is `company:{id}:number:{id}`, and reaching for it without changing
anything else would have *reduced* security while appearing to increase it.

Joining a topic is authorized **in SQL** today, by `is_company_topic_member` on the
`realtime.messages` policy, and it works by matching `company:{company_id}`
**exactly**. Add a per-number topic and either:

- the policy is not extended, so the join is **denied** and realtime silently stops
  working; or
- the policy is extended to keep checking only company membership, in which case
  **any member may join any number's topic** — a boundary that looks like one and
  enforces nothing. That is strictly worse than today, where the coarse topic at
  least honestly matches what it checks.

Making it a real boundary needs the effective-access rule in SQL, callable from the
policy. **That rule lives in TypeScript** (`resolveNumberAccess`: the owner/admin
override, then user > role > all specificity). Reimplementing it in SQL for the
policy would create **a second implementation of a security rule** — the drift class
D79 exists to prevent, on the worst possible surface.

### Decision

**Topics stay company-wide for now, and the exposure is accepted and recorded.**
Not because per-number topics are wrong — they are the right end state — but because
the honest prerequisite is consolidating effective access into **one SQL-callable
resolver** that both the Worker and the policy use. That is a security refactor in
its own right and doing it inside a topic-granularity change would hide it.

SPEC §8 is corrected to match: it said clients refetch "so authorization stays in one
place", which is true of content and invited exactly the wrong assumption about the
topic. It now states plainly that joining is authorized at company granularity,
reading at per-number granularity, and that `company:{id}` is a delivery channel
rather than an access boundary.

### The accepted risk, with its trigger

| | |
|---|---|
| **Exposure** | Existence, direction and timing of conversations on numbers a member is denied. Ids and timestamps only. |
| **Bound** | One company. No content, no contact details, no cross-tenant reach — the topic is per company and that check is real. |
| **Why accepted** | Most workspaces have one number and no exclusions. Closing it properly requires the resolver consolidation above; closing it improperly makes it worse. |
| **Trigger to revisit** | **Whichever comes first:** (a) #348 ships explicit exclusion as a first-class feature, because that is the point customers start relying on a boundary the transport does not enforce; (b) a customer uses per-number access to separate genuinely distinct parties (a subcontractor, two branches); (c) a security questionnaire asks how realtime is scoped (#285) — the answer must be this entry, not an improvisation. |
| **Not a trigger** | Volume. This is a correctness boundary, not a scale problem, and waiting for it to get busy is not a plan. |

**Two consequences worth naming rather than leaving implied.** The client is trusted
to discard events it must not act on, and that trust is placed in three
separately-implemented clients that have drifted before. And every member's
connection carries every event in the company, which is fan-out we pay for and
battery the phones spend on events they will throw away.

**The implementation is scoped and filed as #480** so the resolver consolidation is
reviewed as the security change it is, rather than as a side effect of a
performance one.

### RETIRED, 2026-07-30 (#484) — the exposure is closed, not still accepted

The risk table above is history. It is kept rather than deleted because a security
questionnaire asking "how is realtime scoped" (trigger (c)) deserves the reasoning
and not just the current answer, and because the finding that decided it — that a
naive per-number topic would have been *worse* — is the part worth not relearning.

What actually happened, in the order it had to happen:

1. The resolver consolidation landed (#480), so effective access is one
   SQL-callable rule rather than a second implementation in the topic policy.
2. Both topics were published to at once — the expand half — which closed nothing
   on its own and was never meant to.
3. All three clients adopted the per-number topic, and the three ways one could
   *silently* lose a per-number channel were fixed first (#484): iOS never
   re-joining a refused channel, Android dropping a reconnect edge, and a failed
   bootstrap number-list read on web and iOS. Contracting over those would have
   converted each into an inbox that stops updating behind a healthy-looking
   socket — a worse failure than the leak, because it is invisible.
4. The company send was deleted (`20260730070000_contract_step.sql`).

**`company:{id}` is now a delivery channel for genuinely company-wide events only**
— `registration.updated`, `read.notifications`, `access.changed`,
`number_set.changed` — plus one deliberate fallback: `call.updated` for a call whose
number was deleted, which has no number to be scoped to and, because
`number_access.phone_number_id` cascades, no surviving restriction to honour. A leak
requires a restriction.

Both consequences named above are gone with it. The clients are no longer trusted to
discard events they must not act on, because they no longer receive them; and a
member's connection now carries only the numbers they can reach, which is the
fan-out and the battery back.

`number_scoped_topics.test.sql` is what keeps this true: NT-1 fails if the company
topic reappears for a number-scoped event, and NT-4 fails if the fallback is
removed by someone tidying up.

---

## D86 — a released number leaves entirely, and carries nothing with it (#316, 2026-07-30)

A released number does not stop being that business's number in the world. Old
customers keep texting it — it is saved in their phones, printed on an invoice, and
in three years of search results — and eventually a stranger receives those
messages. #316 asked for four things. Two were already true, one was satisfied by
#413, and one rests on a premise about our architecture that turns out to be wrong.

### The release posture, documented

| | What happens |
|---|---|
| **At the carrier** | `DELETE /v2/phone_numbers/{id}`. The number leaves our Telnyx account entirely. A `source='hosted'` row instead cancels the hosted-messaging order, since voice never left the owner's carrier. |
| **The row** | Retained forever (SPEC §6), marked `released`, so a release is auditable. **Two rows for one E.164 is therefore normal**, not a data error, and anything reading `phone_numbers` by number alone must expect more than one. |
| **History** | Kept, and readable if the departing customer signs back in. Nothing is deleted on release; deletion is workspace closure's job, on its own 30-day clock. |
| **Inbound during grace** | **Stored, never dropped.** `thread_inbound_message` has no subscription gate, so a message arriving in the 30-day window threads normally and is there when they sign in. |
| **Outbound during grace** | **Blocked.** `subscription_status <> 'active'` fails the send gate, so a suspended workspace cannot text. |
| **After release** | Inbound stops reaching us at all — the number is not ours. |

**Inbound-stored/outbound-blocked is the right asymmetry and worth stating as a
decision rather than leaving as an implementation detail.** Dropping inbound would
lose a customer's message to satisfy a billing state they had no part in; allowing
outbound would let a cancelled workspace keep operating. The party who did nothing
wrong is the one texting in.

### There is no pool, so there is nothing to quarantine

#316 asks that "numbers returning to our pool are quarantined before reissue". **We
have no pool.** Release deletes the number at Telnyx and it returns to *their*
inventory; we cannot hold, age, or refuse to re-sell it, because we do not have it.
Aging before reissue is the carrier's control.

That does not make the concern imaginary — a number we later buy for a new customer
may arrive pre-loaded with someone else's history in the world, which is the demand
side of the same problem and why #235 wants reputation screening at handout. But the
mitigation lives at acquisition, not at release, and framing it as a quarantine we
could implement would have produced a feature that cannot exist.

### Nothing crosses owners, and now a test says so

Every piece of state #316 worried about is keyed on `company_id`, so a reissued
number cannot carry it:

- **`opt_outs` is unique on `(company_id, phone_e164)`.** This is the sharp one. Were
  it keyed on the number, a reissued number would arrive **pre-broken**: the new
  owner could not see the suppression, and because only the customer may lift an
  opt-out, could not clear it either. Every message to that person would vanish
  silently.
- **Conversations, messages and contacts** are all company-scoped, and the old
  conversation points at the old `phone_numbers` row.

All of that is true today, so `supabase/tests/number_reissue.test.sql` passes on
first run. **That is the point.** It exists to fail if a future migration ever keys
any of this on the phone number — the exact shape of the bug, and one nobody would
notice until a stranger's message appeared in a customer's inbox.

### What the departing customer is told

Satisfied by #413, shipped the same day: the day-15 and day-27 notices now say the
number goes back to the phone company and can be given to another business, day 27
names porting out with a concrete date, and the public deletion page and in-app
closure card say the same. The one thing we deliberately do **not** claim is that the
number *has* been reassigned — we release it to Telnyx and have no way to know when
or to whom, so every sentence says "can be".

### The off-ramp is a product, and it is filed separately

#316's ask 3 — a forwarding or auto-reply period pointing customers at the
business's new number — is genuinely valuable and is not a documentation change. It
needs the departing customer to opt in and supply a forwarding target, it collides
with the outbound gate above, and us auto-replying on behalf of a business that has
left is a message we would be originating. That deserves its own design rather than
a paragraph here.

## D87 — a signed URL says whether the browser may RENDER the bytes (#317, 2026-07-30)

This product is a conduit between a business and members of the public who are
strangers to it. Anyone who knows the number can send a file, because the number is
printed on a truck. We store it, sign it, and hand it to a tech's phone and the
office manager's laptop — so if the file is malicious, we are the delivery
mechanism and the customer's antivirus names us.

The type gates already refuse the wrong file *type*: `assertAllowedType` plus a
magic-byte check that catches a script uploaded as a PDF. What they cannot refuse is
a malicious file of an **allowed** type, and the allow-list necessarily includes the
formats that carry payloads — PDF, and the OpenXML/ODF family, which are ZIP
containers. #317 asked for content scanning. Scanning needs a subprocessor decision
that is not ours to make unilaterally; this is the half that ships without one.

### The rule

`apps/api/src/storage/disposition.ts` is the only place that decides. Inline is the
narrow case:

- **Allow-listed images stay inline.** The thread renders a photo of a broken
  furnace with `<img src>`, and forcing a download would replace the product's most
  common interaction with a file-save dialog. They are also the lower-risk half:
  **SVG is not in the allow-list**, and SVG is the format that actually executes in
  a document context. A JPEG goes to the browser's image decoder, not its parser.
- **Our own voicemail audio stays inline**, or the play button on three clients
  becomes a save dialog. The type there is not a stranger's claim about an upload —
  it is the constant `inbound-ring.ts` stored the recording with.
- **Everything else downloads**, including an absent or unrecognised type. The
  default is the safe one, so a format nobody has thought about yet gets the right
  answer without an edit.

### Why it is one function and a filesystem-derived test

The bug was not that the rule was wrong — there was no rule. Five call sites mint
signed URLs and each had an implicit, undocumented, silently different answer; four
of them were "whatever the browser feels like", including the media gallery, which
is the surface that hands out inbound MMS files from strangers. So the rule is one
resolver (D79's shape), and `apps/api/src/storage/disposition.test.ts` walks the
source tree for `createSignedUrl` and fails if a site neither uses the resolver nor
appears in a declared-exception list with a reason. There is one exception today:
outbound MMS media in `apps/api/src/messaging/media.ts`, fetched by Telnyx and the
carrier and never by a browser.

### What was verified, because the claim depends on it

`download` is not a field in the sign request — supabase-js appends it to the
returned URL as a query parameter, and Storage turns that into the response header.
That was checked against a real Storage server in both directions: with the
parameter the response carries `Content-Disposition: attachment`, without it there
is no disposition header at all. Had it been cosmetic, this change would have bought
nothing and #317 would have needed a proxy route of our own.

One consequence worth naming: the web document chip already showed a download icon
and an `aria-label` of "Download", and set `<a download>` — which browsers **ignore
for cross-origin URLs**, and a Storage URL is cross-origin. So a PDF opened in a tab
while the UI said it would download. The server now keeps the promise the interface
was already making.

### What #317 still wants

Content scanning (its criteria 1, 2 and 4) is a subprocessor decision. Narrowing the
document allow-list is the other suggestion in the issue and has no evidence behind
it yet: production holds four attachment rows, one `image/jpeg` and one
`application/pdf`, so any narrowing today would be a guess about which formats
customers send.

### The inbound path checked nothing, and dropped files in silence

Found while shipping the above. Two things were true of inbound MMS media, which
is the surface #317 calls uncontrolled — anyone who knows the number can reach it,
no signup and no relationship required.

**It stored whatever type the carrier declared.** The uploaded-attachment route has
re-derived the type from the leading bytes since D19 ("never trusting the
client-declared type"); this path took the content-type header from a carrier CDN
relaying whatever the sender's phone claimed. A renamed `.exe` arriving as
`image/jpeg` was stored as an image, and the gallery serves images inline. It now
runs the same `bytesMatchDeclaredType` gate. That gate deliberately accepts bytes
with no distinctive magic — most audio and video — because refusing a customer's
voice note for want of a signature is the silent-drop failure, not a defence.

**Wiring that gate in exposed a bug in the sniffer.** An AMR file's magic number is
`#!AMR\n` (RFC 4867 §5), and the shebang branch read that as a script. Latent while
it lasted — nothing called the sniffer on inbound media — and live the moment the
check was wired in, at which point every voice note a customer sent would have been
refused as an executable. The four RFC headers are now matched exactly, ahead of
the executable branch and narrow enough that the exception cannot itself become the
way past it.

**And every refusal was a `console.warn`.** Four paths (unsupported type, too
large, empty, too many items) dropped a customer's file with no record a person
could see, so the crew saw a text with no picture and concluded the customer forgot
to attach one. All four, plus the new one, now write a `media_refused` conversation
event, and the thread renders a line in the attachment's place on all three
clients. A conversation event rather than a status column because there is no row to
put a status on — the point is that we declined to create one.

The line ends in what to DO about it, which is the only part a crew between jobs can
act on: the reasons a customer can fix say so, and the one they cannot does not send
them back to try the same file again. The copy is hand-ported into three languages,
so `apps/web/src/components/thread/media-refused-parity.test.ts` reads all three
sources and fails if a sentence is reworded in one place — the #273 failure, where
web and mobile showed two different histories for one conversation, found by nobody
until a customer noticed.

Writing the event is best-effort and swallows its own failure: a message must never
be lost over a note about its attachment. That makes the SQL assertion
(`supabase/tests/messaging.test.sql` R9) the only thing that would ever notice a
broken enum, which is why it exists.

## D88 — effective number access has one implementation, and it is in SQL (#480, 2026-07-30)

#106 made access per number. The rule — a `user` row beats a `role` row beats an
`all` row, a ruled number that matches nobody is hidden, an un-ruled number is
open, and owners and admins are never locked out — lived in TypeScript, and the
#106 migration said so plainly: "enforced in the Worker, not here."

That was fine until something in the database needed the same answer. D85 accepted
that realtime topics are `company:{company_id}`, so a member denied a number still
receives every id-only event for conversations on it. The fix is a per-number
topic, and joining a topic is authorized by an RLS predicate — which cannot call
TypeScript. The choice was to write the rule a second time in SQL for the policy,
or to move it. Two implementations of one security decision is the drift class D79
exists to prevent, on the worst surface in the product.

### It was not two implementations. It was six.

`number-access-surfaces.test.ts` (#368) had already counted eleven — seven in SQL,
four in TypeScript — and deliberately left the TypeScript ones alone, arguing that
folding working implementations together risks introducing the bug it prevents.
Reasonable at the time. Consolidating them found that three of the four were not
just readers but full re-applications of the precedence, each with its own
owner/admin override, and each deciding something a customer would notice:

- `listConversationViewers` — **who gets told** about a customer's message.
- `callRuntime.memberEligible` — **whose phone rings** on an inbound call.
- `liveCalls.eligibleTarget` and the transfer-target list — **who a live call may
  be handed to**.

Plus `resolveNumberAccess` itself and `levelFromRules` underneath it. Any of the
six could have drifted from the other five and the failure would have been silent
in the permissive direction, which is the direction nobody reports.

### The shape

Three functions, one rule:

- `member_number_levels(user, company)` — every RESTRICTED number for one caller.
  **The only place the precedence is written.** The Worker calls it once per
  request, exactly as before.
- `member_number_level(user, number)` — one number, for the RLS policy. A thin
  lookup into the plural; it computes nothing.
- `number_member_levels(number)` — the rule asked backwards, for the three paths
  that need it that way. Returns the level rather than a filtered list, because
  the three want different cuts: the notification audience wants everyone not
  hidden, the ring and transfer paths want `text` only.

A non-member gets explicit `none` rows for every number rather than an empty set.
Empty means "nothing is restricted", which is the right answer for an owner and
the exact opposite for a stranger — and the singular's absent-means-`text` default
would have turned that into a hole.

### What stayed in TypeScript, and why that is not a seventh copy

`buildNumberAccessView` turns the resolver's rows into the deny list the routes
use. That is not the rule; it is how the Worker READS the rule — omission means
visible, and only `none` hides while `note` does not. It is exported so
`premises.test.ts` can assert it without a database.

### The topic policy is a real boundary now

`is_company_topic_member` authorizes `company:{id}` as before, and
`company:{id}:number:{n}` only when `member_number_level` is not `none`. The uuid
is validated with a regex before it is cast, because a cast of arbitrary text
RAISES and this runs inside an RLS predicate — a client joining
`company:{id}:number:garbage` would otherwise get a database error instead of a
refusal.

### The guard is stronger than a roster of readers

`number-access-surfaces.test.ts` now asserts two things. Only the CRUD route may
read `number_access` directly. And `principal_kind` — the rule's fingerprint —
appears in no production TypeScript at all, because without that second check a
future author can reintroduce the rule without touching the table: read the rows
through an RPC, rank them in TypeScript, and the reader roster stays green while
there are two implementations again.

It scans code rather than file text. Its first run flagged the comment explaining
why the token is gone, and a check that fires on its own prose gets its roster
widened until it guards nothing.

### Every fixture now names the outcome, not the rules

Around thirty test fixtures described raw rule rows and let the TypeScript resolve
them. They now state what the resolver says. That is the point: a fixture that
re-derives the rule is another implementation of it, and the one place the
precedence is asserted is `supabase/tests/member_number_level.test.sql`, against
the implementation that decides. The `numbers` route's in-memory fake gets the
same treatment — implementing the precedence inside a test double would have been
the seventh copy.

### Still open on #480

The per-number topic is now *authorizable* and nothing publishes to it yet. Moving
the eight number-scoped broadcasts and the three client subscriptions is the rest
of that issue, including one real design question: `calls.phone_number_id` is
NULLABLE, so a call whose number was deleted has no per-number topic to go to.
Falling back to the company topic quietly reopens the leak for exactly the rows
most likely to be interesting.

### D88 addendum — the per-number topic is published to, and revocation announces itself

#480 step 4, same day. Two things were settled by looking rather than deciding.

**The nullable number is not a compromise.** `call.updated` fires for a call whose
number was deleted, and #480 warned that a company-topic fallback "quietly reopens
the leak for exactly the rows most likely to be interesting". Two foreign keys
answer it: `number_access.phone_number_id` is `on delete cascade` and
`calls.phone_number_id` is `on delete set null`. A call with a null number is a
call whose access rule was deleted along with the number, so there is no
restriction left to honour — a leak requires a restriction. Dropping the event
would lose a state update to protect nothing.

**Realtime authorization is a join-time handshake.** The `realtime.messages`
policy is evaluated on `phx_join`, and again on a live channel only when a
refreshed JWT is pushed (`setAuth`, roughly hourly). It is never evaluated per
broadcast. So revoking a member's access does NOT drop their subscription: they
keep receiving that number's events for up to an hour — a boundary the product
would believe it was enforcing and would not be.

`broadcast_number_access_changed` closes that. Any change to `number_access`
announces itself on the COMPANY topic, which every member may already join so the
announcement needs no new authorization, and the clients re-derive their
subscriptions. The payload is the company id and nothing else: naming the number
or the member would broadcast the shape of the restriction to everyone on the
topic. A client cannot tell whether it was the subject — it just asks again, and
the answer is authoritative.

**This is the expand half and it closes no leak yet.** Eight events now publish to
BOTH the company topic and `company:{id}:number:{n}`. Removing the company send is
what closes D85's leak, and it cannot happen in the same change: two of the three
clients are store-distributed, so a user who has not updated would simply stop
receiving realtime. The sequence is expand → clients adopt → contract, and the
contract step is one statement inside `broadcast_number_scoped` rather than eight
edits across six trigger functions. That is the only reason the helper exists.

**Addendum, 2026-07-30 (#484): the contract step has landed** —
`20260730070000_contract_step.sql`. There is one boundary now, not two
granularities in transition, and D85's accepted risk is retired above.

The store-distribution constraint was discharged rather than waived, and it is
worth recording *how*, because "we decided it was fine" is not a reason anyone can
check later. Three facts, none of them a judgement call: nothing is distributed —
`ship.yml` builds the Android and iOS artifacts and attaches them to the run, and
names store upload as a credentials gap it cannot close; the expand half had not
reached production either, because Ship runs only when the release PR merges, so
expand and contract land in the same release and no client ever sees one without
the other; and web is served fresh, with #484's bootstrap retry now re-deriving the
topic key after a failed `/v1/me` instead of leaving it empty for the life of the
page.

If a mobile build ever does ship ahead of a schema change, the gate is
`app_release_policy` and its version floor (#339) — a mechanism that already exists
and tells old builds to update. Building a second adoption gate for this one
migration would have been a machine to answer a question that had three facts and
no ambiguity.

Two events stay company-wide because scoping them would scope the wrong object:
`registration.updated` (unique per `(company_id, kind)`, and it authorizes every
number the company has) and `read.notifications` (one watermark per person across
all numbers).

## D89 — the receptionist asks; it does not converse (#367/#397, extends D46, 2026-07-30)

**Decision.** We answer with AI at **depth (1) only**: the voicemail greeting asks
the caller what the problem is and where, discloses that a machine writes the
answer down, and the transcript is then broken out into four fields the crew can
scan. Opt-in, off by default. **Depths (2) and (3) — qualify-and-route, and book
the job — are declined for now**, deliberately rather than by omission, and D78's
$49–79 price stands as the price *if* that bet is ever placed.

#367 asked for a decision and not a build, and said which depth was reachable:
*"Only (1) is buildable on what exists today."* That was true, and it is what
shipped.

**Why (1) is not a consolation prize.** The category's pitch is that 27% of calls
go unanswered and the business never learns what they were about. Depth (1)
answers the second half of that completely, and it does it without a dialogue
tree, without a promise, and without a per-minute meter. A voicemail that opens
with the problem and the address is a better voicemail whether or not anything
reads it afterwards — which means **most of the value here is in the greeting,
and the greeting is copy**. No model, no cost, no failure mode. The extraction is
the smaller half riding on top.

**The arithmetic is why the halves are split that way.** D78 measured a realtime
receptionist at 6.8¢/minute: one two-minute call costs 13.6¢. Depth (1) costs
0.02¢ per voicemail, on a transcript we had already bought — **about 700× less
per call**, and less for a whole tenant for a whole month than a single realtime
call. That is the entire reason this needs no metered module, no new price, and
no founder decision about a bet. `AI_UNIT_COST_CENTS.voicemail_intake` and the
500/month cap put it inside the existing envelope; the whole AI surface now
maxes out at $2.05 per tenant per month, asserted by a test.

**Extraction, never judgement, and the schema is the enforcement.** #367's
strongest objection is the one to beat: *"An AI that mishandles an emergency is
worse than voicemail."* So the model is never asked whether a call is urgent.
There is no urgency field, no severity field, no recommendation field — not
suppressed in a prompt, **absent from the schema**, so a model that volunteers
one has it dropped by the parser (a test pins exactly that). Every stored value
is a phrase the caller said out loud. The model cannot be wrong about a field
without also being wrong about what words were in the recording, and nothing
downstream acts on any of them.

**The disclosure is in the first breath, and it does not lie.** #367's acceptance
is that every caller is told. Note what the greeting does NOT say: not "you are
speaking to an assistant", because they are not — they are leaving a recording,
and a machine reads it afterwards. Claiming a conversation that is not happening,
to a stranger, to make the feature sound better, is the one thing this greeting
cannot do. It says an automated assistant writes the message down, which is
true. A test asserts the sentence survives composition behind a 500-character
owner-authored greeting, because the disclosure is the part that must never be
the bit that gets truncated.

**Failing to voicemail is not a path here, it is the resting state.** Everything
downstream of the greeting runs AFTER the recording is stored, threaded and
playable. There is no failure of this feature that costs a customer a message:
the worst case is the product as it was yesterday, behind a better question.
The greeting itself is resolved once, at initiation, and a settings read that
fails answers false — a stranger is holding the line, and a bad moment in a
settings table must not stop the phone ringing or promise a reading nobody
agreed to.

**Off by default, and it is the only AI feature in the product that is.** D46
made AI help default-on, and that is defensible for every other feature because
each produces a suggestion a MEMBER reviews before a customer sees anything.
This one changes the words a STRANGER hears, spoken in the business's name.
Turning that on for somebody without asking would be deciding how their company
answers the phone. The default is therefore a decision, recorded here, and
carried identically by the column, `DEFAULT_AI_SETTINGS`, the public disclosure
row, and iOS's `@Default<DefaultFalse>` — which is the inverse of every other
field on that struct, on purpose.

**Provenance, because PORTAL-UX §3.1 applies to this more than to anything.**
The block carries the Lou mark and the words "From the voicemail", and it sits
directly above the transcript it was read out of. That ordering is the design:
the transcript is the record, this is the shortcut, and a shortcut printed after
the thing it shortens is not one. It also makes the claim checkable — a person
can read four fields and the source they came from in one glance, which is the
opposite of the black box #367 warned an AI conversation would be.

**What this does NOT decide.** #397's asks 1, 3 and 4 remain the founder's:
whether to treat the realtime receptionist as a decision with a deadline, what
to price it at, and whether to make that bet at all. #397's devil's advocate is
still the argument to beat — *"a solo founder building a voice AI product to
defend a texting product is how focus dies"* — and depth (1) is specifically the
answer that does not require beating it. The insurance was already bought
either way: port-out notices alert on `pending` (#398) and `job:call-silence`
catches one workspace going quiet against its own history (41ebba6).

**Found on the way, and worth recording because it is the same failure twice.**
The public sub-processors page said suggested replies were **off** by default
while the column has defaulted to **on** since 20260724090000, and said "two of
those models are published by OpenAI and one by Meta" after a second Meta model
had shipped. Both are #389 happening again: a fact about the data, kept in step
with the data by memory. Both are now derived — `defaultOn` is asserted against
the settings the gate actually reads, and the vendor sentence and feature count
are computed from the disclosure list rather than written beside it.

## D90 — "done" is per capability, and the clients are named (#338, 2026-07-30)

**Decision.** A user-visible capability is not done until **web, Android and iOS
are each either implemented or explicitly recorded as not applicable, with the
reason**. "Not applicable" is a perfectly good answer. Silence is not.

Enforced by two things, both deliberately small: a `Clients` checklist in
`.github/ISSUE_TEMPLATE/capability.md`, and `scripts/check-client-parity.mjs`
in CI beside the migration, env-reference and citation guards.

**Why a rule rather than more care.** #198 closed as done with iOS never
implemented (#337) — the third instance of one class, after a **35-gap parity
audit had already been run and paid for**, and after the #257–#273 defect batch
that is largely one fix ported to one client (#268 is titled *"iOS fix never
ported"*). The structural cause is that done was defined per pull request rather
than per capability: a change lands, tests pass, the issue closes, and whether
the other two clients received it was nobody's checked responsibility. Every
instance was caught later by a person noticing, or by a sweep.

**iOS is the one that goes missing**, and not by coincidence. Swift compiles
only in Mobile CI, so iOS work ships compile-checked and visually unverified —
the platform most likely to be skipped and the least likely for anyone to
notice.

**The check is a directory diff, and that is the point.** #337 was found in
seconds by listing two directories side by side. The mechanism is:

1. Every feature directory on every client must appear in `SURFACES`.
2. Every `SURFACES` entry must say, for each client, where it lives **or why it
   is absent**.

**Rule 1 is the load-bearing half.** Adding `apps/ios/Loonext/Features/Whatever`
fails CI until somebody registers it — and registering it is exactly the moment
they have to answer "what do web and Android do about this?". The question gets
asked when the code is written rather than when an audit is commissioned
eighteen months later.

**What it cannot do**, stated so nobody trusts it further than it deserves: it
proves somebody *decided*, not that a capability is *implemented*. A directory
can exist and be empty. That is the honest ceiling of a directory diff, and it
still catches the entire class that has actually bitten us — a whole surface
missing from a client.

**The noise problem is why the registry has reasons rather than names.** A raw
three-way diff reports web's `billing/`, `numbers/`, `porting/`, `registration/`
and `invites/` as gaps; on mobile every one is a section inside Settings. iOS
has `Push/` because APNs is a platform concern. Thirteen of the twenty-three
registered surfaces are deliberate asymmetries, and a check that flagged them
would be ignored within a week — which #338 names as the exact failure mode this
backlog keeps warning about. So an absence without a written reason is itself a
failure.

**Deliberately NOT built:** a governance process, a matrix document, or a
required label. #338's own devil's advocate is right that *"process invented in
a backlog usually decays before it pays for itself"*, and the honest test is
whether it is cheaper than the alternative. The alternative here is measurable:
a 35-gap audit, a 17-issue defect batch, and #337, all re-discovering work
already known to be needed. A checklist and a directory diff are cheaper than
one of those, once.

Blank issues stay enabled (`.github/ISSUE_TEMPLATE/config.yml`): a server
change, a document fix or an Android-only IME bug has one surface, and forcing
those through a three-client checklist is how the checklist becomes ceremony.

## D91 — "read-only" is a role, not a number level (#348/#315, 2026-07-30)

**Decision.** `number_access.level` stays a three-value ladder — `text`, `note`,
`none` — and **no `read`-without-notes level is added**. A read-only observer is
expressed by #315's forthcoming read-only ROLE, which composes with per-number
access rather than duplicating it.

#348 asks for this jointly with #315 *"so the product has one meaning for the
term"*, and that phrase is the whole decision: the two candidates sit at
**different grains**, and shipping both would give the product two different
things called read-only.

**The grains, stated plainly.** `number_access.level` answers *"may this person
speak to customers on THIS LINE"* — a fact about a phone number. Whether somebody
may write in the crew's internal record at all is a fact about **the person's
standing in the crew**, and it does not vary by line. An accountant is read-only
everywhere or nowhere; there is no coherent workspace in which they may add
internal notes on the plumbing number and not the roofing one.

**So a per-number `read` level would be a rule that decays.** It would have to be
set on every number, and re-set every time a number is bought — and the failure
mode of forgetting is the observer silently gaining a voice in the crew's
internal record on the newest line. A property of a person, enforced per object,
is a property that goes wrong the moment a new object appears.

**What it would have cost, for a case #348 itself calls narrow.** The `('text',
'note')` CHECK, the precedence resolver and its explanation vocabulary, three
clients' copy, the composer banner, the dial-target filter and the call push
audience — every one of them, to express something the role axis expresses once.

**What #315 inherits from this.** Its read-only role means *no writes anywhere*,
and per-number access continues to decide **which** numbers that person can see
at all. The two compose: a read-only member restricted to one number sees that
number and writes nothing. #315's own devil's advocate warns that *"permission
systems are where small products go to become enterprise software"* — one axis
per question is how that is avoided, and adding a fourth level here would have
been the first step in the other direction.

**What this closes.** #348's third scope item, by deciding against it with the
reason rather than leaving the level list open. The other two items shipped:
`member_number_access_explained` and the owner-facing screen on all three
clients (#348's first), and the note-only composer banner now naming the calls
consequence as well as the texting one (#348's second).

## D92 — job state is a tag on the conversation, not a column on the task (#361, ratifies PORTAL-UX §7, 2026-07-30)

**Decision.** Task workflow state is **option 2** of #361: the product has ONE
model of where a job stands, and it is the pre-seeded pipeline tags on the
conversation. Advancing a job is a tag PATCH; the Pipeline/board is a grouped
**view** over `GET /v1/conversations` filtered by tag — pure UI, **off by
default**. **No `task_status` column is added.**

**This ratifies rather than decides.** `docs/PORTAL-UX.md` §7 already states it
as binding build direction. What was missing is the record: D25 and `TASKS.md`
T9 still read as though the question is open, so a reader met two documents
saying *"deferred, do not build"* and one saying *"here is how it works"* —
#323's forward-only supersession problem, on a schema question.

**T9's richer status is SUPERSEDED, not deferred**, and the difference is the
point. "Deferred" invites somebody to revisit it and add the very column
PORTAL-UX routes around. T9's own reason for caution was that a richer status
*"reintroduces a stored non-`done` status distinct from message completion"* —
the dual-source-of-truth hazard D17 exists to prevent. Option 2 does not
resolve that hazard; it **avoids needing to**. Nothing about D17's derived
completion is disturbed, and D25's instruction not to build a stored
multi-status column ahead of the decision is honoured literally and
permanently.

**Why not the two-column status quo (#361's option 3), which its own devil's
advocate favoured.** Because the inconsistency was the real complaint: we
already sell a four-state workflow through the seeded tags, and
`/for/plumbers` markets the ritual built on them. Two states on tasks plus four
on conversations is two notions of "where is this job", neither aware of the
other. Choosing option 3 would have meant either retracting the marketing or
keeping the contradiction.

**And "off by default" answers the restraint objection** that made option 3
attractive. D14's restraint rule is cited across these documents for good
reason, and a four-person crew is not made to adopt a pipeline — the workspaces
that want stages get them, and the rest see a list. That was the objection #361
could not resolve, and the spec had already resolved it.

**Made jointly with #356, as #361 required.** #356 closed as **D64** — a task
promotes a message OR a call — so the anchoring half is settled. Status and
anchoring were the same question about the same object, and both are now
answered: what a task hangs off (D64), and where job state lives (here). Neither
is a half-design waiting for the other.

**What this raises rather than settles.** #354 gets stronger from the same
paragraph, not weaker. Four seeded tags any member can rename are now the job
spine — load-bearing for the board and for the marketed Monday-morning ritual —
with no protection and no saved view. That is #354's argument, and this decision
is the reason to take it seriously.
