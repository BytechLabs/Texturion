# JobText — Number Porting (Port-In) Build Spec

**Status: authoritative for the porting feature.** Implements decision **D16** in `docs/DECISIONS.md`.
This spec adds **number transfer (port-in)** — a business brings its existing US/Canada number to
JobText instead of getting a new one — to the paid-first onboarding, the per-company messaging
profile, and the 10DLC registration model already built (SPEC v2 §4.1–§4.4). It **reuses** the
provisioning saga and the registration state machine; it does not fork them.

Every Telnyx call below is pinned to the verified porting research (Telnyx Porting API v2). Where the
research left a shape uncertain it is flagged **(verify in build)** inline. Dates: authored 2026-07-02.

---

## 0. The one-paragraph mental model

Paid-first is unchanged: **pay → `checkout.session.completed` (paid) webhook → provisioning branch**.
For a port, that same webhook starts a **port saga** (parallel to the new-number saga) instead of
buying a number. The saga **creates the Telnyx porting order as a `draft`** (reusing the per-company
messaging profile + the collected port data) but does **NOT** confirm it — confirmation is a distinct
post-payment step that is **hard-gated on the LOA + invoice being attached** (§3.5 / §4 P5 / §6). The
customer uploads those documents (only possible post-payment, §3.2) and then triggers `POST /:id/submit`,
which confirms the order. The number stays **live on the old carrier** until the **FOC (Firm Order Commitment)
cutover date**; JobText texting on it works only after **messaging** finishes porting (a step separate
from voice). We create the per-company messaging profile up front, submit 10DLC brand+campaign at
payment time (so the campaign is **approved before** cutover — the load-bearing sequencing rule), and
gate all texting on the ported number until its messaging port is `ported` AND (for US) the campaign is
`approved`. The port is **free** (US + CA), so no fee or Stripe line item; the $29 US registration fee
applies exactly as today.

---

## 1. Port state machine (the spine of the feature)

`port_requests.status` mirrors Telnyx's **real** porting-order statuses (verified enum) plus one
terminal local state (`cancelled`). Telnyx exposes `status.value`:

```
draft → in-process → submitted → foc-date-confirmed → (activation-in-progress) → ported
                        │
                        └→ exception  ──(fix & resubmit)──> submitted
any non-terminal ───────────────────────────────────────> cancel-pending → cancelled
```

Two **orthogonal** sub-tracks run under a single port order and each has its own field:

- **Voice/order track** — `status` above. `ported` means **voice** cut over (calls route to Telnyx).
  `activation-in-progress` is a V2-only transitional value between `foc-date-confirmed` and `ported`.
- **Messaging track** — `messaging_port_status`: `not_applicable → pending → activating → ported | exception`.
  Messaging is **separate from voice** and must be explicitly enabled (§4). `ported` here is what
  unlocks JobText texting. Track via the `porting_order.messaging_changed` webhook.

**Readiness rule (the gate JobText cares about):** a ported number is usable for JobText inbound/outbound
only when `messaging_port_status = 'ported'`. Voice-`ported`-but-messaging-not-`ported` is the ~10% of
numbers that take an extra 1–2 business days; the UI says so plainly (§8).

**Timeline expectations (verified, shown honestly):** US local simple port ~ up to 7 business days
(FastPort-eligible often 1–4 days); Canadian local ~1–7 business days; ~90% of US/CA local numbers
activate SMS within ~10 minutes of voice reaching `ported`, the rest within 1–2 business days. The
number stays on the losing carrier until the FOC date. Telnyx processes ports Mon–Fri 9am–5pm CT.

**How this composes with the two existing state machines:**

| Machine | Owns | Lives in |
|---|---|---|
| Port state machine (new) | number *readiness* (is the number live on Telnyx with messaging?) | `port_requests.status` + `messaging_port_status` |
| Provisioning saga (reused) | messaging profile (S1) + the `phone_numbers` row + release/suspend | `phone_numbers.status` |
| Registration state machine (reused, unchanged) | US-send *eligibility* (brand+campaign approval, R1–R4) | `messaging_registrations` |

The send gate for a ported US number = `messaging_port_status='ported'` **AND** campaign `approved`
(§7 gate order). For a ported CA number with `us_texting_enabled=false`: just
`messaging_port_status='ported'`.

---

## 2. Schema

New migration (never edit existing ones — SPEC §12/D14 rule). All conventions from SPEC §6 apply:
`uuid` PKs, explicit FKs `ON DELETE RESTRICT`, `moddatetime` on mutable tables, deny-by-default RLS,
Worker uses the `sb_secret_` key (BYPASSRLS) and authorizes itself.

### 2.1 Enums

```sql
-- Mirrors Telnyx porting_order status.value (verified enum) + local 'cancelled' terminal.
create type port_status as enum (
  'draft',                 -- local: collecting data / documents, before Telnyx submit
  'in-process',            -- submitted to Telnyx, awaiting hand-off to losing carrier
  'submitted',             -- losing carrier received it (responds in ~36–48 business hours)
  'exception',             -- losing carrier rejected (data mismatch, LOA illegible, …) — fixable
  'foc-date-confirmed',    -- carrier confirmed the port + the FOC date/time
  'activation-in-progress',-- V2 transitional between foc-date-confirmed and ported
  'ported',                -- VOICE complete; calls route to Telnyx (SMS may lag — see messaging_port_status)
  'cancel-pending',
  'cancelled'
);

-- Telnyx messaging_port_status (verified).
create type port_messaging_status as enum (
  'not_applicable',        -- messaging enablement not set (should never happen for us; we always enable)
  'pending',               -- messaging enabled but FOC not yet reached
  'activating',            -- voice ported; Telnyx verifying messaging activation
  'ported',                -- messaging live on Telnyx  → JobText texting works
  'exception'              -- messaging failed to auto-port; Telnyx escalating with losing carrier
);

-- Source of a phone_numbers row.
create type number_source as enum ('provisioned', 'ported');
```

### 2.2 `port_requests`

One row per port order (one number per order in MVP — we never batch-port; simplest LOA/status story).

```sql
create table public.port_requests (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id) on delete restrict,
  -- The phone_numbers row this port fulfils (created source='ported', status='provisioning').
  phone_number_id        uuid not null references public.phone_numbers(id) on delete restrict,

  phone_e164             text not null,                 -- the number being ported, +E.164
  country                text not null check (country in ('US','CA')),

  -- Telnyx handles.
  telnyx_porting_order_id text,                         -- POST /v2/porting_orders → id (UUID)
  telnyx_loa_document_id  text,                         -- POST /v2/documents (loa)     → id (UUID)
  telnyx_invoice_document_id text,                      -- POST /v2/documents (invoice) → id (UUID)

  -- Losing-carrier account data (end_user.admin, §3.3). PII: see policy note below.
  entity_name            text not null,                 -- account holder / business legal name on the bill
  auth_person_name       text not null,                 -- authorized signer on the LOA
  billing_phone_number   text,                          -- BTN if different from the ported number
  account_number         text not null,                 -- losing-carrier account number
  pin_passcode           text,                          -- port-out PIN / passcode (wireless often requires)
  is_wireless            boolean not null default false,-- mobile ports may need PIN + last-4 SSN (verify in build)

  -- Service address on file with the losing carrier (end_user.location, §3.3).
  service_street         text not null,
  service_extended       text,                          -- suite/unit
  service_locality       text not null,                 -- city
  service_admin_area     text not null,                 -- USPS state / CA province code
  service_postal_code    text not null,

  -- Requested cutover.
  foc_datetime_requested timestamptz,                   -- activation_settings.foc_datetime_requested
  foc_date               timestamptz,                   -- FOC date/time carrier CONFIRMED. Source:
                                                         -- GET porting order → activation_settings.
                                                         -- foc_datetime_actual (the status_changed
                                                         -- webhook only signals the transition; it does
                                                         -- NOT carry the date).

  -- Status mirrors (§1).
  status                 port_status not null default 'draft',
  messaging_port_status  port_messaging_status not null default 'not_applicable',

  rejection_reason       text,                          -- exception detail, human-readable
  submission_count       int not null default 0,        -- increments each Telnyx submit/resubmit
  wants_bridge_number    boolean not null default false,-- D16 opt-in "tide-me-over" number
  bridge_number_id       uuid references public.phone_numbers(id) on delete set null,

  submitted_at           timestamptz,
  ported_at              timestamptz,                    -- messaging_port_status → 'ported'
  cancelled_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- One live port per number per company (a cancelled port can be retried with a fresh row).
create unique index port_requests_active_uq on public.port_requests (company_id, phone_e164)
  where status <> 'cancelled';
create unique index port_requests_telnyx_uq on public.port_requests (telnyx_porting_order_id)
  where telnyx_porting_order_id is not null;              -- webhook lookup + idempotency
create index port_requests_open_idx on public.port_requests (status)
  where status not in ('ported','cancelled');             -- reconciliation cron work-set
create index port_requests_company_idx on public.port_requests (company_id);
```

`moddatetime` trigger on `port_requests` (SPEC §6). RLS **enabled, deny-by-default, no grants** — the
Worker reads/writes with the `sb_secret_` key like every other table.

**PII policy (SPEC §10, extended):** `account_number` and `pin_passcode` are **losing-carrier
credentials**, not customer PII we telemeter — they never reach Sentry/PostHog (the D8 `beforeSend`
redaction already strips bodies; add these column names to the never-log list). `pin_passcode` is
stored because Telnyx requires it in the order payload and a rejected port must be re-submittable
without re-collecting it; it is written **once** and never returned in any `/v1` response body (the
`GET` serializer omits `pin_passcode` and `account_number`, returning only a boolean "on file"). LOA
and invoice live in Telnyx (`/v2/documents`), not in Supabase Storage — we keep only the returned
document UUIDs. **No full SSN/SIN is ever collected** (consistent with §10; wireless last-4 is
**verify in build** — only collect if the portability check flags the number as wireless, and store
last-4 only, mirroring the sole-prop `ein` rule).

### 2.3 `phone_numbers` additions

Two columns on the existing table (new migration; nullable/defaulted for safe migration):

```sql
alter table public.phone_numbers
  add column source          number_source not null default 'provisioned',
  add column porting_status  port_status;                -- NULL for provisioned numbers;
                                                         -- mirrors port_requests.status for ported ones
```

- `source='ported'` rows are created by the port saga (§4) with `status='provisioning'` and
  `porting_status='draft'`. The row **stays `provisioning`** (so it is invisible to the inbox/composer
  as a live number) until the messaging port completes, at which point the port saga flips it to
  `active` (§4, step P6). This reuses the exact `phone_numbers.status` semantics the send/threading
  paths already respect — no send path needs to learn about porting.
- `phone_numbers.provisioning_key` for a port row = the checkout session id (initial) or the request
  `Idempotency-Key` (Pro 2nd number / post-signup port) — same idempotency backstop as provisioning.
- The partial-unique `phone_numbers_e164_uq (WHERE status <> 'released')` already prevents two live
  rows for the same E.164 — a ported number and a provisioned one can't collide.

**Bridge number** (opt-in, D16): a normal `source='provisioned'` row created by the **existing**
provisioning saga, linked via `port_requests.bridge_number_id`. It is a fully independent number the
owner releases (or keeps on Pro) after cutover; nothing special in schema beyond the FK.

---

## 3. Telnyx Porting API calls (exact, verified)

All calls go through the existing `telnyxRequest()` client (`apps/api/src/telnyx/client.ts`) — bearer
auth, `{ data: ... }` unwrap, `TelnyxApiError` with `.codes`/`.status`. Base `https://api.telnyx.com`.
Documents upload is **multipart**, the one shape the current JSON client doesn't cover — add a small
`telnyxUpload()` sibling (§3.2).

### 3.1 Portability check (pre-payment allowed; read-only, free, no commitment)

The **only** Telnyx porting call permitted before payment. Verifies the number can be ported and
surfaces jurisdiction document requirements.

```
POST /v2/portability_checks
body: { "phone_numbers": ["+13035550000"] }
→ 200 { data: [ { phone_number, portable, not_portable_reason, phone_number_type,
                  messaging_capable, fast_portable, carrier_name, record_type } ] }
```

**Path pinned (verified 2026-07):** the endpoint is the **top-level** `POST /v2/portability_checks` —
confirmed against the Telnyx API reference, the porting quickstart, and the "Automating Ports With
Programmatic API" help article, all of which show `POST https://api.telnyx.com/v2/portability_checks`
with body `{ "phone_numbers": [...] }`. It is **not** nested under `/v2/porting/…`. Response gives
per-number portability (`portable` boolean + `not_portable_reason`) plus `phone_number_type`,
`messaging_capable`, and `fast_portable` (FastPort eligibility). **(verify in build — response schema
only)** confirm the exact response field set against the live API reference; treat portability as
"portable = the number appears eligible and is US/CA local." Reject toll-free and non-US/CA in the
wizard (§6, D16 scope).

### 3.2 Upload LOA + invoice (post-payment, multipart)

```
POST https://api.telnyx.com/v2/documents            (multipart/form-data)
fields: file=<binary>, document_type='loa'          → 201 { data: { id: "<uuid>" } }
POST https://api.telnyx.com/v2/documents            (multipart/form-data)
fields: file=<binary>, document_type='invoice'      → 201 { data: { id: "<uuid>" } }
```

Store the returned UUIDs in `telnyx_loa_document_id` / `telnyx_invoice_document_id`. **Two distinct
Telnyx surfaces, not a choice (verified):**
1. **Primary attach — the porting-order PATCH `documents` object (§3.4).** The port-in quickstart shows
   the LOA and invoice attached by referencing their stored-document UUIDs in a top-level
   `documents: { "loa": "<uuid>", "invoice": "<uuid>" }` object on `PATCH /v2/porting_orders/{id}`. This
   is the required LOA+invoice attach and is what §3.4/P4 does.
2. **`POST /v2/porting_orders/{id}/additional_documents`** is a *separate* endpoint for attaching **extra**
   documents an agent requests **later** (e.g. a supplemental bill after an `exception`), by posting
   `{ document_id, document_type }` objects. It supplements — it does not replace — the `documents` PATCH.

Requirements (verified): **LOA** must be wet- or e-signed within the last **90 days**, list **all** numbers
on the order, carry the end-user name and the **SERVICE** address (not billing). **Invoice** must be **< 30
days** old. Telnyx provides a downloadable **Canadian LOA template** (Canadian carriers generally won't
share CSRs); the wizard links it for CA ports.

`telnyxUpload(env, { path:'/v2/documents', file, filename, contentType, fields:{document_type} })` —
uses `FormData`/`Blob` (Workers-native), bearer header, no `Content-Type` override (let fetch set the
multipart boundary).

### 3.3 Create the porting order (post-payment)

```
POST /v2/porting_orders
body: { "phone_numbers": ["+13035550000"] }          -- ONLY required field at create (verified)
→ 201 { data: { id: "<uuid>", status: { value:"draft", details:[...] } } }
```

Persist `telnyx_porting_order_id` **immediately** (crash-after-create protection, mirroring the number
saga's persist-order-id-first rule). `customer_reference` and everything else are optional at create and
set by the PATCH below.

### 3.4 Fill the order (PATCH — end user, address, FOC, messaging, docs)

One `PATCH /v2/porting_orders/{id}` populates everything (verified field names):

```
PATCH /v2/porting_orders/{telnyx_porting_order_id}
body: {
  "customer_reference": "<company_id>",
  "end_user": {
    "admin": {
      "entity_name":          "<entity_name>",
      "auth_person_name":     "<auth_person_name>",
      "billing_phone_number": "<billing_phone_number|phone_e164>",
      "account_number":       "<account_number>",
      "pin_passcode":         "<pin_passcode>",
      "tax_identifier":       "<EIN/BN if applicable>",     -- optional
      "business_identifier":  "<if applicable>"             -- optional
    },
    "location": {
      "street_address":      "<service_street>",
      "extended_address":    "<service_extended>",
      "locality":            "<service_locality>",
      "administrative_area": "<service_admin_area>",        -- USPS state / CA province
      "postal_code":         "<service_postal_code>",
      "country_code":        "US" | "CA"
    }
  },
  "activation_settings": {
    "foc_datetime_requested": "<foc_datetime_requested ISO8601>"
  },
  "phone_number_configuration": {
    "messaging_profile_id": "<companies.telnyx_messaging_profile_id>",   -- NOTE the exact field name
    "connection_id":        "<optional>",
    "tags":                 ["jobtext","company:<company_id>"]
  },
  "messaging": { "enable_messaging": true },                -- SMS is SEPARATE; must be explicit
  "documents": {
    "loa":     "<telnyx_loa_document_id>",
    "invoice": "<telnyx_invoice_document_id>"
  }
}
```

- `phone_number_configuration.messaging_profile_id` is the **per-company** profile
  (`companies.telnyx_messaging_profile_id`) — the same isolation D2 requires. The field is
  `messaging_profile_id` (**not** `message_profile_id`).
- `messaging.enable_messaging: true` (with `phone_number_configuration.messaging_profile_id`) is
  **required** to port SMS and is only settable while the order is in `draft`, `in-process`, or `exception`
  (verified). We set it in this initial PATCH (draft), and — because a carrier rejection can drop the
  messaging sub-order — we **idempotently re-set it in every resubmit PATCH too** (the resubmit runs while
  the order is in `exception`, which is in-window; see §6 resubmit + §5.1). Treat "PATCH the order" as
  **always** carrying `messaging.enable_messaging=true` + the `messaging_profile_id`, whether it is the
  first submission or a fix-and-resubmit — never assume enablement persists across a rejection.
- `activation_settings.foc_datetime_requested` is the *requested* FOC; the carrier confirms an actual
  FOC date which arrives on the status webhook and lands in `port_requests.foc_date`.

### 3.5 Submit / confirm the order

After the PATCH validates, submit the order to move `draft → in-process`.

```
POST /v2/porting_orders/{id}/actions/confirm          -- moves the draft into processing
```

**Confirm is HARD-GATED on documents (§4 P5, §6).** We NEVER call this action unless BOTH the LOA and the
invoice are attached to the row (`telnyx_loa_document_id` **AND** `telnyx_invoice_document_id`) — an order
confirmed with no documents is rejected by the carrier, so `POST /:id/submit` and `POST /:id/resubmit`
(and `submitPortRequest` itself) reject with the §7 `conflict` code when either document is missing.
`startPortSaga` deliberately stops at `draft` and never confirms; confirmation is the distinct post-payment
step the customer triggers after uploading the LOA + invoice. Until submitted, a draft auto-deletes after
**30 days** (verified) — our reconciliation cron re-drives stuck drafts (creating the order, and confirming
once documents are present) well before then; a draft still missing documents is left at rest for the
customer, not force-confirmed.

### 3.6 Poll / get one order (reconciliation + on-demand)

```
GET /v2/porting_orders/{id}                            → { data: { status:{value,details},
                                                                    activation_settings:{
                                                                      foc_datetime_requested,
                                                                      foc_datetime_actual }, ... } }
```

Authoritative read for the daily reconciliation cron (§5.2), for the `GET /v1/port-requests/:id`
detail refresh, and — per §5.1 — for reading the **confirmed** FOC on the `foc-date-confirmed`
transition (`data.activation_settings.foc_datetime_actual`; `foc_datetime_requested` is the value we
sent). Map `data.status.value` → `port_requests.status` (identity mapping — the enum matches).
`messaging_port_status` comes from the messaging webhook; **(verify in build)** whether the GET order
body also carries a messaging status field to poll (if it does, the cron reads it too; if not, the
`porting_order.messaging_changed` webhook + a `GET` on the messaging sub-resource is the source).

### 3.7 Enable/attach messaging + 10DLC on completion (reuses R3)

When messaging reaches `ported` the number is a normal Telnyx-owned number on our messaging profile.
Assign it to the **already-approved** campaign identically to a purchased number (SPEC §4.4 R3):

```
-- profile is already set via the port order's messaging_profile_id, but the
-- assignment call is the same one the provisioning path uses:
POST /v2/10dlc/phoneNumberCampaign { "phoneNumber": "+1...", "campaignId": "<campaignId>" }
```

This is literally `assignNumbersToCampaign()` in `registration.ts` — no new code, the port saga calls it
once the number row is `active` and has a `number_e164`. The `10dlc.phone_number.update` webhook confirms
`ADDED` / records `FAILED` into the existing `numberAssignments` ledger, and `retryCampaignAssignments()`
re-runs failures. **Load-bearing sequencing (verified):** the campaign must be **approved before** the
port completes, and the **losing carrier must remove the number from ITS 10DLC campaign** or assignment
fails — we surface an assignment `FAILED` here as an actionable message telling the owner to have their
old provider release the number from its campaign (§8 copy).

### 3.8 Cancel a port

```
POST /v2/porting_orders/{id}/actions/cancel           -- draft/in-process → cancel-pending → cancelled
                                                         (verify in build: exact action path)
```

Used only if the owner abandons a port pre-completion (e.g. decides to keep the old carrier). Sets
`port_requests.status='cancel-pending'` then `cancelled` on webhook/poll; the linked
`phone_numbers` row is released/marked `released` (it never went live).

---

## 4. The port saga (reuses provisioning saga; new module `apps/api/src/telnyx/porting.ts`)

Structurally identical to the provisioning saga in `provisioning.ts`: a `phone_numbers` row is inserted
**first** with a unique `provisioning_key`, every step is independently retryable, and a daily cron
resumes stuck rows. It does **not** throw for step failures — failures land on `port_requests` as
`exception`/error for the cron, and only infrastructure failures propagate so the webhook ledger retries.

**Entry point** (called from the paid `checkout.session.completed` handler, parallel to
`provisionCompanyNumber()`; and from `POST /v1/port-requests` for a post-signup port on an active
subscription):

```
startPortSaga(env, { companyId, portRequestId, provisioningKey })
```

**Create-draft-then-complete (the load-bearing gating rule).** `startPortSaga` runs **P1–P4 only** and
**STOPS at a Telnyx `draft`** — it does **NOT** auto-confirm. Confirmation is a **distinct post-payment
completion step** (`submitPortRequest`, P5) that is **hard-gated on both the LOA and the invoice being
attached** to the row (`telnyx_loa_document_id` **AND** `telnyx_invoice_document_id` present). A
draft-without-documents is therefore a **valid resting state awaiting the customer**, not an error — the
customer (now on an active subscription) uploads the LOA + invoice via `PUT /:id/documents`, then
`POST /:id/submit` confirms. This is what stops the order from ever being confirmed with no documents (the
carrier would reject that). The LOA/invoice can only be uploaded post-payment (§3.2 / D16), so confirmation
is inherently a post-payment step — honest paid-first, and honest that a port takes days.

Steps:

```
P1. Ensure messaging profile  — reuse ensureMessagingProfile() from provisioning.ts (S1). One
    per company; created here if the company doesn't have one yet (a port-only signup still needs it).

P2. Create porting order      — POST /v2/porting_orders { phone_numbers:[phone_e164] };
    persist telnyx_porting_order_id IMMEDIATELY (crash-after-create protection). status stays 'draft'.
    Idempotent: if the row already has telnyx_porting_order_id, skip to P4.

P3. Upload documents          — POST /v2/documents (loa), POST /v2/documents (invoice); persist the
    two returned UUIDs. Done via PUT /:id/documents (post-payment, §3.2) — NOT inside startPortSaga.
    Idempotent: skip a doc whose UUID is already stored.

P4. PATCH the order           — end_user.admin + end_user.location + activation_settings.foc_datetime_
    requested + phone_number_configuration.messaging_profile_id + messaging.enable_messaging=true +
    documents.loa/invoice  (§3.4). Idempotent (PATCH is declarative — re-applying is safe). The
    documents object carries whatever UUIDs are on the row so far (possibly none, during onboarding
    before the customer uploads them); P5's confirm-time re-PATCH re-attaches them once present. The
    SAME PATCH is re-issued by the fix-and-resubmit path (§6 resubmit, §5.1 exception): it MUST re-send
    messaging.enable_messaging=true + messaging_profile_id every time (a rejection can drop the messaging
    sub-order; exception is in-window), so messaging enablement is idempotently re-applied on every
    submit, not only the initial draft PATCH.

    *** startPortSaga stops here, at a Telnyx `draft`. It NEVER confirms. ***

P5. Submit/confirm            — the DISTINCT post-payment completion step (submitPortRequest), driven by
    POST /:id/submit (draft) or POST /:id/resubmit (exception). HARD-GATED: reject (§7 `conflict`) unless
    BOTH telnyx_loa_document_id AND telnyx_invoice_document_id are on the row. When gated open: re-PATCH
    (P4, docs now attached) then POST /v2/porting_orders/{id}/actions/confirm (§3.5). status→'in-process';
    submitted_at=now; submission_count++; messaging_port_status not_applicable→pending; §9 "submitted" email.
    From here the port is with Telnyx/carriers; webhooks + the daily cron drive the rest.

--- asynchronous, days–weeks later, driven by webhooks (§5.1) / cron (§5.2) ---

P6. On messaging_port_status → 'ported' (porting_order.messaging_changed):
    a. flip the phone_numbers row: status 'provisioning' → 'active', number_e164 = phone_e164,
       telnyx_phone_number_id = (lookupOwnedNumber(phone_e164) — the number is now Telnyx-owned).
    b. assignNumbersToCampaign() (§3.7 / R3) — assign to the approved campaign.
    c. port_requests.ported_at = now.
    d. Resend email "Your number is live on JobText" (owner + admins); PostHog `port_completed`.
    e. if wants_bridge_number and a bridge exists: email nudging the owner they can now release it.
```

**Failure handling** (mirrors `recordProvisionFailure`): a step error sets `port_requests.rejection_reason`
+ Sentry event; the row is left in a resumable status; the daily cron retries with backoff up to a bounded
attempt count. A **carrier rejection** is different from a step error — it arrives as a Telnyx
`exception` status via webhook, not a thrown error, and routes to the fix-and-resubmit UX (§6/§8), not a
silent retry.

**Reuse map (do NOT duplicate):**

| Need | Reused symbol (existing) |
|---|---|
| messaging profile (P1) | `ensureMessagingProfile()` — `provisioning.ts` |
| resolve Telnyx phone-number id after cutover (P6a) | `lookupOwnedNumber()` — `provisioning.ts` |
| 10DLC assignment (P6b) | `assignNumbersToCampaign()` — `registration.ts` |
| brand+campaign submission (at payment) | `submitRegistration()` — `registration.ts`, unchanged |
| send gate | `getSendGates()` — `registration.ts`, unchanged (number readiness is enforced by `phone_numbers.status` staying `provisioning`) |
| suspend/release on cancel | `suspendCompanyNumbers()` / `releaseNumberRow()` — `provisioning.ts` |

---

## 5. Webhooks + reconciliation cron

### 5.1 Port webhook handling (extends the single `/webhooks/telnyx` route)

Port-in webhooks (verified events): `porting_order.status_changed`, `porting_order.messaging_changed`,
`porting_order.new_comment`, plus `porting_order.split` / `porting_order.deleted` / `loa_updated`. They
arrive on the **same** `POST /webhooks/telnyx` route and follow the **same** verify → ledger → ack →
`waitUntil` → cron-sweep pipeline (SPEC §7/§8).

**Exact integration point (do NOT touch the route file).** The `/webhooks/telnyx` route
(`apps/api/src/webhooks/telnyx.ts`) does not branch on event types itself — it verifies, ledgers, acks,
and hands the event to `dispatchTelnyxEvent()` in `apps/api/src/messaging/dispatch.ts`. That single
dispatcher is the real integration point, and it is shared by both the live `waitUntil` path and the §11
webhook sweeper (`sweepWebhookEvents` in `apps/api/src/messaging/crons.ts` replays Telnyx rows through the
exact same `dispatchTelnyxEvent`). Today it branches only on `message.received`,
`message.sent`/`message.finalized`, and `eventType.startsWith('10dlc.')`; any `porting_order.*` event
currently falls through to its final "unknown event_type → acked no-op" return and is silently swallowed —
so the async half of the port saga is dead until a branch is added here.

**The edit:** in `dispatchTelnyxEvent`, import `handlePortingEvent` from `../telnyx/porting` and add, before
the final no-op return:

```ts
if (eventType.startsWith("porting_order.")) return handlePortingEvent(env, event);
```

Because the sweeper re-drives ledgered rows through this same dispatcher, this one branch also makes the
webhook sweeper replay any missed `porting_order.*` event automatically — no route-file change and no
separate sweeper change is needed. Unknown event types remain acked and ignored, exactly as today.

New handler `handlePortingEvent(env, event)` (module `porting.ts`), dispatching on `data.event_type`:

- **`porting_order.status_changed`** — look up the row by `telnyx_porting_order_id`
  (`port_requests_telnyx_uq`); if none, ack no-op (out-of-order/foreign). Map
  `payload.status.value` → `port_requests.status` (identity map, §1). **The `status_changed` payload does
  NOT carry the FOC date** — the verified payload is only
  `{ id, customer_reference, status:{value,details}, support_key, updated_at, webhook_url }`, with no
  `activation_settings` object. So on `foc-date-confirmed` do **not** read the FOC from the webhook body:
  issue the §3.6 reconciliation read `GET /v2/porting_orders/{id}` and store
  `data.activation_settings.foc_datetime_actual` (the CONFIRMED FOC) into `port_requests.foc_date`. The
  webhook only signals the transition; the date lives on the order resource. On `exception`, store
  `rejection_reason` from `payload.status.details` (flatten like `formatReasons()` in `registration.ts`;
  the `details` codes include `ACCOUNT_NUMBER_MISMATCH`, `AUTH_PERSON_MISMATCH`, `ENTITY_NAME_MISMATCH`,
  `LOCATION_MISMATCH`, `PASSCODE_PIN_INVALID`, `FOC_REJECTED`, …) and send the
  rejection/fix email (owner+admins). The `exception` state is the fix-and-resubmit entry point (§6): the
  resubmit re-runs the §3.4 PATCH **with `messaging.enable_messaging=true` + `messaging_profile_id`
  re-sent** (exception is in-window; a rejection can have dropped the messaging sub-order), then
  re-confirms (§3.5) — messaging enablement is never assumed to persist across the rejection. On
  `cancelled`, release the linked `phone_numbers` row. Transitions
  are **guarded** by an allowed-transition table (like `ALLOWED_TRANSITIONS` in `registration.ts`) so
  duplicate/out-of-order deliveries and the webhook/cron overlap are harmless no-ops and each email fires
  once.

- **`porting_order.messaging_changed`** — map `payload.messaging_port_status` →
  `port_requests.messaging_port_status`. On `ported`, run **P6** (flip number → active, assign to
  campaign, stamp `ported_at`, email, PostHog). On `exception`, store the reason and email the owner
  (messaging failed to auto-port; Telnyx's Messaging Ops team is escalating with the losing carrier to
  release the NetNumber ID — **this is genuinely no customer action; verified**: Telnyx states "you don't
  need to contact your previous provider yourself," and most US/CA local exceptions resolve within 1–2
  business days). Idempotent: P6 is a no-op if the number row is already `active` (guard on
  `phone_numbers.status`). **A messaging exception can gate texting for days** (the number is voice-ported
  but not yet active), and the webhook that finally flips `exception → ported` can be missed — so recovery
  must not depend on the webhook alone: the §5.2 cron re-GETs porting orders stuck at
  `messaging_port_status='exception'` and, on the reconciled transition to `ported`, runs P6 itself (the
  same guarded, idempotent P6). Do **not** conflate this with a **10DLC assignment `FAILED`** (§3.7,
  event `10dlc.phone_number.update`): THAT is the case where the losing carrier must remove the number
  from its own carrier campaign, and it surfaces the actionable §9 "10DLC assignment failed" copy — a
  different event on a different track.

- **`porting_order.new_comment`** — surface the comment text on the port detail UI (Telnyx/carrier notes
  during processing) and email the owner if the comment requests action. Store as
  `rejection_reason`/a comments field **(verify in build:** whether comments warrant their own column;
  MVP can fold an actionable comment into `rejection_reason` when status is `exception`).

- **`porting_order.split` / `.deleted` / `loa_updated`** — MVP: log + Sentry breadcrumb + let the daily
  cron reconcile from `GET /v2/porting_orders/{id}`. (`split` shouldn't occur — we port one number per
  order.)

### 5.2 Reconciliation cron (new; §11 addition)

Mirrors the **registration poller** exactly (webhooks primary, cron authoritative fallback, D2 pattern):

| Cron | Schedule | Work | Idempotency |
|---|---|---|---|
| **Port reconcile & resume** | `0 13 * * *` (daily; can share the 13:00 slot with the registration poller or run `10 13 * * *`) | Work-set is **every `port_requests` row not fully done** — i.e. `status NOT IN ('ported','cancelled')` **OR** `messaging_port_status NOT IN ('ported','not_applicable')` (a voice-`ported` row whose messaging is still `pending`/`activating`/`exception` is NOT terminal and must stay in the set). For each: (1a) if the row is a `draft` with **no** `telnyx_porting_order_id` past a resume threshold → resume `startPortSaga` to create the draft (it does NOT confirm); (1b) if the row is a `draft` **with** an order id **and both documents attached** but never confirmed (missed confirm / crash after upload) → drive the documents-gated `submitPortRequest` — a `draft` still missing a document is a **valid resting state** (awaiting the customer's LOA + invoice) and is left untouched, never force-confirmed; (2) else `GET /v2/porting_orders/{id}` and apply any missed `status` transition via the guarded transition applier (also refreshing `activation_settings.foc_datetime_actual` → `foc_date`); (3) reconcile `messaging_port_status` from the same GET — **including rows stuck at `exception`**: on the reconciled transition `exception`/`activating` → `ported`, run **P6** (the webhook-missed path; P6 is idempotent), so a messaging exception is recovered by the cron even if no `messaging_changed` webhook arrives; (4) re-run `assignNumbersToCampaign()` for ported numbers whose campaign assignment ledger shows `failed`. Note assignment (P6b) only runs at/after messaging `ported`, so a row stuck at messaging `exception` cannot be unblocked by step (4) alone — step (3) is what drives it to `ported` and fires P6. | Guarded transitions (one-way); saga steps skip completed work (persisted order/doc ids); P6 no-ops on already-`active` rows; emails keyed to transitions |

**Orphan-scan exclusion (required edit to `reconcileNumbers` in `provisioning.ts`).** The orphan scan in
`reconcileNumbers` builds `knownE164`/`knownIds` from `phone_numbers` rows and pages ALL
`GET /v2/phone_numbers`, flagging (Sentry) any Telnyx-owned number no row knows. A `source='ported'` row
is `status='provisioning'` with `number_e164=NULL` **and** `telnyx_phone_number_id=NULL` right up until
P6a — so it contributes **nothing** to `knownE164`/`knownIds`. The instant voice ports, the number becomes
Telnyx-owned and appears in the listing with a real id that no row knows → `orphansFlagged++` → an operator
page — on **every single port**, for the whole 1–2 business-day voice-ported-but-messaging-pending window.
This is a guaranteed false-alarm storm, not an edge case.

Fix: before flagging an owned number as an orphan, skip it when it matches an open/recent port. Concretely,
`reconcileNumbers` must additionally query `port_requests` and load the `phone_e164` of every row whose
`status <> 'cancelled'` into a `Set` (`portingE164`), then in the orphan loop
`if (owned.phone_number && portingE164.has(owned.phone_number)) continue;` **before** the `orphansFlagged++`.
(Equivalently, match on `owned.customer_reference === company_id` for such rows — but the E.164 match is the
tighter, per-number check.) Call this out as a required edit to `provisioning.ts` (it introduces a
`port_requests` read into an otherwise `phone_numbers`-only function), and add a test that a
voice-ported-but-messaging-pending number does **not** page. Once P6a adopts the number (row → `active`
with `number_e164`/`telnyx_phone_number_id`), it is known through the normal `knownE164`/`knownIds` path and
the port-requests exclusion is moot.

---

## 6. API routes (SPEC §7 conventions: `/v1`, JWT + `X-Company-Id`, stable error codes)

Roles: **O**=owner, **A**=admin, **M**=member. All error codes are the existing §7 set — **no new
codes** (a port that can't be created because the subscription isn't active returns the existing
`subscription_inactive`; a bad state transition returns `conflict`; a rejected portability check or bad
document returns `validation_failed`).

| Method & path | Role | Purpose / shape |
|---|---|---|
| `POST /v1/port-requests/check` | O/A | Portability check (pre-payment allowed). `{ phone_e164 }` → `{ portable: boolean, country, is_wireless, reason? }`. Rejects toll-free / non-US/CA with `validation_failed`. Wraps §3.1. No commitment, no DB write. |
| `POST /v1/port-requests` | O/A | Create a port request (collect data). Body: the `port_requests` intake fields (§2.2) + `wants_bridge_number?`, `foc_datetime_requested?`, `ssn_sin_last4?` (wireless only — see below). Requires `Idempotency-Key`. **Runs the §3.1 portability check as part of create:** rejects a Telnyx-reported non-portable number with `validation_failed` + the `not_portable_reason`, and sets `is_wireless` from the check's `phone_number_type`. **Wireless numbers require `ssn_sin_last4` (last-4 of the account holder's SSN/SIN) AND `pin_passcode`** (`validation_failed` if either is missing); we store ONLY the last-4 (§2.2 / SPEC §10) — never for a landline. **Onboarding path:** allowed while `subscription_status='incomplete'` — writes the `port_requests` row (`status='draft'`) + the `phone_numbers` row (`source='ported'`, `status='provisioning'`) and **defers the Telnyx order to the paid webhook** (paid-first, D16). **Post-signup path:** requires `active` subscription (else `subscription_inactive`); starts `startPortSaga` immediately in `waitUntil` (which CREATES the draft order but does NOT confirm). 409 `conflict` if a non-cancelled port already exists for the number, or if a sole-prop company already has a non-released number. |
| `GET /v1/port-requests` | M | List the company's ports with status + messaging_port_status + foc_date (cursor list per §10). Serializer **omits `pin_passcode`/`account_number`/`ssn_sin_last4`** (returns `has_pin`, `has_account_number`, `has_ssn_sin_last4` booleans). |
| `GET /v1/port-requests/:id` | M | One port: full state machine position, foc_date, rejection_reason, submission_count, bridge linkage, document-on-file booleans. Refreshes from `GET /v2/porting_orders/{id}` opportunistically. |
| `PUT /v1/port-requests/:id` | O/A | Edit port data while `draft` or `exception` (the fix-and-resubmit form). Re-upload LOA/invoice. `validation_failed` if the port is past the editable window (submitted/foc-confirmed/ported). |
| `PUT /v1/port-requests/:id/documents` | O/A | Upload LOA + invoice (multipart) to Telnyx `POST /v2/documents`, storing the returned UUIDs on the row. **Blocked until the subscription is `active`** (`subscription_inactive`) — documents are a post-payment, Telnyx-committing action (§3.2 / D16). Editable window only (draft/exception). |
| `POST /v1/port-requests/:id/submit` | O/A | **The post-payment completion step (§3.5 / §4 P5).** Confirms a `draft` port whose order the saga already created, once the customer has uploaded the LOA + invoice. **HARD-GATED: 409 `conflict` if either document is missing** (never confirm an order with no documents). 409 `conflict` if the port is not `draft`. Re-PATCHes (docs now attached) then confirms; `status: draft → in-process`, `submission_count++`. |
| `POST /v1/port-requests/:id/resubmit` | O/A | Fix-and-resubmit after an `exception`: re-run the PATCH (§3.4) with corrected data + docs, **including `messaging.enable_messaging=true` + `phone_number_configuration.messaging_profile_id` re-sent every time** (the order is in `exception`, which is in-window; a carrier rejection can reset the messaging sub-order, so the resubmit PATCH is the last chance to re-enable it — never assume enablement carried over from the draft PATCH), then re-confirm (§3.5). **Documents-gated like submit: 409 `conflict` if the LOA or invoice is missing.** `status: exception → in-process`, `submission_count++`. Port-in is **free** so there is no charge. 409 `conflict` if status is not `exception`. |
| `POST /v1/port-requests/:id/cancel` | O | Abandon a pre-completion port (§3.8). `→ cancel-pending`; releases the linked `phone_numbers` row on completion. 409 `conflict` if already `ported`/`cancelled`. |

**Gate order for `POST /v1/port-requests` (post-signup path)** mirrors the send/provision gate style:
membership (O/A) → subscription `active` → number is US/CA local & portable (portability check runs here,
setting `is_wireless`; a wireless number additionally requires `ssn_sin_last4` + `pin_passcode`) → no
existing non-cancelled port for the number → sole-prop cap → insert `port_requests` + `phone_numbers`
rows (idempotent on `provisioning_key`) → `waitUntil(startPortSaga)` (creates the draft order; the
customer later uploads documents and calls `POST /:id/submit` to confirm).

**Composer/inbox:** a `source='ported'` number that is still `provisioning` is simply **not a sendable
number** — the send path already rejects non-`active` numbers with `conflict` ("not ready to send yet"),
**not** `registration_pending` (that per-destination gate is only reached once the number is `active`; see
§7). No send-path change is needed; the per-destination registration gate (`getSendGates`) is unchanged.

---

## 7. Send-gate composition (no new gate code)

The existing send pipeline (SPEC §7 `POST /v1/messages/send`, `POST /v1/conversations`) already gates on:
`membership → subscription active → US/CA area code → per-destination registration gate → opt-out → cap →
rate limit`. Porting slots in **without a new gate**. The two things that must be true to send from a
ported US number are enforced by **two independent, differently-scoped mechanisms** — do not describe them
as a single fused gate:

- **Number readiness (per-NUMBER)** is enforced by `phone_numbers.status`, in the send path, before the
  registration gate is ever consulted. A ported number is `status='provisioning'` (with `number_e164=NULL`)
  until P6 flips it to `active`. While it is not `active`, the send path rejects it outright: `compose.ts`
  returns the existing `conflict` error ("This number is not ready to send yet.") — it does **NOT** surface
  `registration_pending` for a still-porting number, because control never reaches the registration gate
  for a non-`active` sending number. So during the port window the ported number is simply non-sendable,
  regardless of campaign state.
- **US-send eligibility (per-COMPANY)** is the existing `getSendGates().usApproved` (campaign `approved`,
  not deactivated), keyed on the company's campaign row — it has **no awareness of which number is
  sending**. This matters during the window because a company can simultaneously hold an `active`
  opt-in bridge number (`source='provisioned'`) and a still-provisioning ported number:
  `getSendGates().usApproved` may already be `true` (campaign approved for the company) — correct for the
  bridge, and harmless for the ported number, which is blocked by `status != 'active'` above, not by this
  gate.
- **Ordering, therefore:** only **after** P6 flips the ported number to `active` does a US-bound send from
  it reach the per-destination registration gate; from that point `registration_pending` applies exactly as
  for a new number (and because 10DLC is submitted at payment time, the campaign is typically already
  `approved`, so it is send-ready the moment messaging ports; if a fast port beats vetting, CA-bound sends
  work immediately and US-bound sends show `registration_pending` until approval). **Net effect for a
  ported US number: non-sendable (`conflict`) until `status='active'`, then — and only then — governed by
  the per-company `usApproved` gate (`registration_pending` until the campaign is `approved`).** The code
  enforces `status='active'` (per-number) AND campaign `approved` (per-company) as two separate checks in
  sequence; it does not tie "US approved" to the specific ported number.

---

## 8. Onboarding branch + Settings UI

### 8.1 Onboarding fork (amends SPEC §4.1)

After `POST /v1/companies`, the wizard presents **"How do you want your business number?"**:

- **"Get a new number"** (default) → existing area-code picker → existing flow, unchanged.
- **"Bring my existing number"** → the **port wizard**:
  1. **Number + portability check** — enter the number → `POST /v1/port-requests/check`. Green "Yes, this
     number can move to JobText" or a plain rejection (toll-free / not US/CA / not portable) with the
     fallback offer to get a new number instead. **No commitment yet.**
  2. **Who's your current carrier & account** — `entity_name`, `auth_person_name`, `account_number`,
     `pin_passcode` (label: "port-out PIN / passcode — your current carrier can give you this"),
     `billing_phone_number` if different.
  3. **Service address on file** — the address the losing carrier has (not billing) — with the explicit
     note that a mismatch is the #1 rejection cause.
  4. **LOA + recent bill** — upload a signed LOA (link the Telnyx **Canadian LOA template** for CA) and a
     bill **< 30 days old**. Plain requirements shown: signed within 90 days, lists the number, service
     address.
  5. **Timing + the honest window** — requested FOC date (optional) and the **expectation copy** (§9),
     shown before payment.
  6. **Tide-me-over? (opt-in, default OFF)** — checkbox: "Give me a temporary JobText number to text from
     while my number transfers. You can release it once your number arrives." → sets
     `wants_bridge_number`.
  7. The registration wizard (§4.1 step 3) runs as normal for US / CA-with-US-texting companies — brand +
     campaign draft — because a ported US number needs 10DLC just like a new one.

Then checkout (§4.1 step 4) — **paid-first, unchanged**. The `checkout.session.completed` webhook starts
the **port saga** (§4) instead of the provisioning saga — which **creates the Telnyx porting order as a
`draft`** but does NOT confirm it. After payment the customer uploads the LOA + invoice (step 4 above,
now unblocked via `PUT /:id/documents`) and confirms via `POST /:id/submit` (documents-gated). The webhook
additionally provisions the bridge number via the normal saga if `wants_bridge_number`. Registration
(§4.4) is submitted at the same webhook, as
today — guaranteeing the campaign is approved before the FOC cutover.

**Checkout page copy for a port (shown before payment, replaces the §4.1 new-number checkout copy):**

> "Bringing your number over usually takes a few business days to about two weeks (US) — Canada is often
> faster. Your number keeps working on your current carrier the whole time and switches to JobText on the
> transfer date. Texting through JobText starts once the switch completes — we'll show you exactly where
> it is and email you at each step. Receiving and sending on JobText works the moment the transfer
> finishes; texting US numbers also needs carrier registration (typically 3–7 business days), which we
> start now so it's ready by the time your number arrives."

### 8.2 Settings → Numbers port-status UI (state machine rendered plainly)

A port card renders the §1 state machine as a 4-step human tracker (not the raw Telnyx enum). Live via
the existing Realtime broadcast on `phone_numbers`/(new) `port_requests` updates (add a
`port.updated {port_request_id, status, messaging_port_status}` broadcast trigger mirroring the
`registration.updated` trigger in SPEC §8):

| Tracker step | Backing state | Owner-facing meaning |
|---|---|---|
| 1. Submitted | `draft` / `in-process` / `submitted` | "We've sent the transfer request to your current carrier." |
| 2. Date confirmed | `foc-date-confirmed` / `activation-in-progress` | "Your carrier confirmed the switch-over date: **{foc_date}**." |
| 3. Number switched | `ported` (voice) + `messaging_port_status` `pending`/`activating` | "Your number moved to JobText — turning on texting now." |
| 4. Texting live | `messaging_port_status='ported'` (→ number `active`) | "Done — text your customers from JobText." |
| ⚠ Needs a fix | `exception` / `messaging_port_status='exception'` | rejection_reason + "Fix and resubmit" button → `PUT` + `resubmit` |

The card also shows the **bridge number** (if any) with a "Release temporary number" action once step 4
is reached, and, for a 10DLC assignment `FAILED`, the specific "ask your old provider to remove this
number from their texting campaign" guidance (§3.7).

---

## 9. Customer-facing copy per port state (honest, exact strings)

Dashboard/settings banners and emails. Tone matches the existing §4.4 registration copy — plain, no
false urgency, no "instant."

| State | Copy |
|---|---|
| Portability check OK (pre-pay) | "Good news — {number} can move to JobText. It'll keep working on your current carrier until the switch-over date." |
| Portability check fails | "We can't transfer {number} to JobText — {reason}. You can start with a new local number instead, and forward your old one for now." |
| Submitted (`in-process`/`submitted`) | "Transfer in progress. We've sent the request to your current carrier — they usually respond within a couple of business days. Your number still works on your old carrier for now." |
| Exception (fixable) | "Your carrier flagged something on the transfer: {rejection_reason}. Fix it and resubmit — it usually takes a couple of minutes, and there's no fee to try again." + **Fix and resubmit** |
| FOC confirmed | "Locked in. Your number switches to JobText on **{foc_date}**. Nothing works differently until then; we'll email you when it switches." |
| Number switched, messaging activating | "Your number moved to JobText. We're turning on texting now — usually about 10 minutes, occasionally a business day or two. We'll email you the moment it's ready." |
| Messaging exception | "Your number moved over, but texting is taking a bit longer — your old provider hasn't released the texting routing yet. We're escalating with the carrier on your behalf; this usually clears within a business day or two and there's nothing you need to do." (Verified: Telnyx's Messaging Ops team auto-escalates the NetNumber-ID release; the customer does NOT contact the old provider here. Contrast the "10DLC assignment failed post-port" row below, which IS customer-actionable — a different failure.) |
| Texting live (`ported`) | "🎉 Your number is live on JobText — text your customers straight from here." |
| 10DLC assignment failed post-port | "One more step: ask your previous texting provider to remove {number} from their carrier campaign, then we'll finish connecting it. We'll retry automatically once they do." |
| US registration still pending at cutover | (existing §4.4 banner) "US texting activates in ~3–7 business days (carrier approval). Receiving texts and texting Canadian numbers already work." |
| Bridge number available | "Your temporary number {bridge} is ready so you can text today. When your real number finishes transferring, you can release the temporary one." |

**Email triggers** (owner + active admins, bypassing `notification_prefs` like other operational emails,
SPEC §8): submitted, FOC confirmed, messaging live (port completed), exception/needs-fix, messaging
exception. Reuse the Resend `sendEmail` + `billingRecipients` path in `provisioning.ts`/`registration.ts`.

---

## 10. Marketing copy change (forwarding-workaround → real porting)

Replace the current call-forwarding-workaround answer with the honest porting story. Files:

- **`docs/marketing/COPY.md` §H12** — the FAQ answer at "**Q: What's my number — and can I keep the one
  that's on my trucks and my Google listing?**" (currently: "today it can't take over your existing
  number — number porting is on our list… **forward your existing number**…"). **New answer:**
  > "Yes — bring the number your customers already know. When you sign up, choose **Bring my number**,
  > tell us your current carrier details, and upload a recent bill. Your number keeps working on your
  > current carrier while it transfers — usually a few business days to about two weeks in the US, often
  > faster in Canada — and switches to JobText on the transfer date. Texting through JobText starts the
  > moment the switch finishes, and we show you exactly where the transfer is the whole way. Prefer to
  > start texting today? Grab a new local number now and transfer your old one alongside it. Transfers are
  > free."

- **`docs/marketing/BLUEPRINT.md`** — the FAQ note (lines ~550–556) that says the objection "is answered
  with the real workaround… forward your existing number" and the out-of-scope framing (the "'not yet' on
  porting" line, ~1028) → update to: porting is a **shipped** capability answered with the real transfer
  flow (keeps its top-of-FAQ placement); the honesty rule is retained (state the multi-day/week window
  and old-carrier-until-switch reality; no "instant port" claim).

- **Business-number feature page + compare pages** — add a real **"Bring your number"** capability line
  ("Keep the number on your trucks — transfer it to JobText, free") replacing any "new number only" /
  "porting coming soon" language. The compare tables (`docs/marketing/BLUEPRINT.md` competitor rows) gain
  a "bring your existing number" row where relevant.

- Remove porting from the **out-of-scope / fast-follow** framing in marketing docs (it now ships). No
  change to the "why US takes about a week," Canada, photos, overages, or "30-day number grace" answers.

---

## 11. Build order (slots into SPEC §12 after step 7 "Registration state machine")

1. **Schema migration** — `port_status`/`port_messaging_status`/`number_source` enums, `port_requests`
   table (+ RLS/moddatetime/indexes), `phone_numbers.source`/`porting_status` columns, `port.updated`
   broadcast trigger. ✅ migration applies; RLS + constraint tests pass.
2. **`telnyxUpload()` + portability check** — multipart documents client; `POST /v1/port-requests/check`.
   ✅ a real number returns portable; toll-free/non-US-CA rejected.
3. **Port saga `porting.ts`** — P1–P4 (`startPortSaga`, create draft, do NOT confirm) + P5
   (`submitPortRequest`, the documents-gated confirm), reusing `ensureMessagingProfile`; wired into the
   paid `checkout.session.completed` handler parallel to `provisionCompanyNumber`, and into `POST
   /v1/port-requests`. ✅ paid webhook creates the DRAFT order once under duplicate delivery
   (provisioning_key idempotency) and never confirms without documents; crash between create and PATCH is
   healed by the cron; confirm rejects (§7 `conflict`) unless BOTH LOA + invoice are attached.
4. **Port webhooks + reconciliation cron** — wire `handlePortingEvent` into the shared dispatcher, NOT
   the route: add `if (eventType.startsWith('porting_order.')) return handlePortingEvent(env, event);`
   (import from `../telnyx/porting`) to `dispatchTelnyxEvent` in `apps/api/src/messaging/dispatch.ts`,
   before its final no-op return — this covers both the live `waitUntil` path and the §11 webhook sweeper
   (`crons.ts`) with one change. Handle `porting_order.status_changed`/`messaging_changed`/`new_comment`,
   guarded transitions, P6 completion, daily reconcile cron, orphan-scan exclusion for open ports.
   ✅ simulated status/messaging transitions drive the tracker + P6 flips the number to active and assigns
   the campaign; ✅ a `porting_order.*` row left unprocessed replays through the sweeper and reaches
   `handlePortingEvent`.
5. **Port API routes** — create/get/list/edit/documents/submit/resubmit/cancel with roles + existing error
   codes; pin/account/ssn_sin_last4 serializer omission. Create runs the §3.1 portability check (sets
   `is_wireless`, requires `ssn_sin_last4` + PIN when wireless, rejects non-portable). `POST /:id/submit`
   and `/:id/resubmit` are documents-gated (409 `conflict` if LOA/invoice missing). ✅ wireless number
   flagged + last-4 required; non-portable rejected; landline path unchanged; confirm rejects without
   documents and succeeds with both; sole-prop cap enforced.
6. **Onboarding fork + Settings port UI** — the wizard branch, checkout port copy, the 4-step tracker
   (Realtime-live), bridge-number opt-in + release action. ✅ full port path from signup→pay→submitted→
   (simulated) foc→ported→texting-live renders without refresh on a 375px viewport.
7. **Marketing copy flip** — §10 edits. ✅ FAQ, feature page, compare pages show real porting; no
   "instant"/"coming soon" language remains.

---

## 12. Open items flagged "verify in build" (do not guess at build time)

- **§3.1** portability-check **response schema** only. The path is **pinned**:
  `POST /v2/portability_checks` (top-level — verified against the Telnyx API reference, the porting
  quickstart, and the "Automating Ports With Programmatic API" help article, all of which show
  `POST https://api.telnyx.com/v2/portability_checks`). It is NOT nested under `/v2/porting/`. Confirm
  only the per-number response fields (`portable`, `not_portable_reason`, `phone_number_type`,
  `messaging_capable`, `fast_portable`, `carrier_name`) at build.
- **§3.8** exact cancel **action** path on `porting_orders` (§3.5 submit is now pinned to
  `POST /v2/porting_orders/{id}/actions/confirm`, verified in the quickstart).
- **§3.6** whether `GET /v2/porting_orders/{id}` returns a messaging status field (poll) or the messaging
  track is webhook-only + a sub-resource GET. (The messaging-porting docs indicate `messaging_port_status`
  IS present on the GET porting-order body, so the cron can poll it; confirm the exact key at build.)
- **§2.2** wireless-port extra requirements (PIN + last-4 SSN) — **RESOLVED / implemented.** The `POST
  /v1/port-requests` create route runs the §3.1 portability check, sets `is_wireless` from
  `phone_number_type` (`mobile`/`wireless`), and — when wireless — requires `ssn_sin_last4` **and**
  `pin_passcode` (`validation_failed` otherwise). Only the last-4 is stored (the DB `ssn_sin_last4` CHECK
  enforces exactly 4 digits); the full SSN/SIN is never collected, and the serializer returns only the
  `has_ssn_sin_last4` boolean (SPEC §10). Landline ports collect neither. **(verify in build — response
  schema only:** confirm the exact `phone_number_type` token Telnyx returns for wireless numbers.)

Everything else in this spec is pinned to the verified Telnyx Porting API research: create body requires
only `phone_numbers`; `end_user.admin`/`end_user.location` field names; `activation_settings.foc_datetime_
requested`; `phone_number_configuration.messaging_profile_id`; `messaging.enable_messaging=true` (draft/
in-process/exception only); `documents.loa`/`documents.invoice` via `POST /v2/documents`; the
`draft→in-process→submitted→exception→foc-date-confirmed→(activation-in-progress)→ported` +
`cancel-pending/cancelled` status enum; `messaging_port_status` `pending→activating→ported|exception`;
the `porting_order.*` webhook events; R3 assignment via `POST /v2/10dlc/phoneNumberCampaign`; port-in is
free for US + CA; the campaign-approved-before-port and losing-carrier-campaign-removal sequencing.

---

## Verification corrections (BUILD MUST APPLY — from the adversarial audit)

1. **(major) Export the reused provisioning helpers.** The §4 reuse map calls
   `ensureMessagingProfile()` and `lookupOwnedNumber()` from the new porting module, but both are
   currently module-private in `apps/api/src/telnyx/provisioning.ts` (no `export`). The build MUST add
   `export` to both (a required edit to provisioning.ts, exactly like the already-noted `reconcileNumbers`
   orphan-scan edit) — OR expose a thin exported wrapper. Do NOT duplicate the logic. (`suspendCompanyNumbers`
   and `releaseNumberRow` are already exported.)
2. **(minor) Port-only signup still collects `requested_area_code`.** `companies.requested_area_code` is
   NOT NULL (SPEC §6) and `ensureMessagingProfile` reads the company row, so the §8.1 "bring my existing
   number" fork must still capture or default `requested_area_code` at `POST /v1/companies` (it's simply
   unused for a port that buys no new inventory).
3. **(minor) Send-path rejection copy is path-specific.** A non-active (still `provisioning`) ported number
   is rejected with `conflict` on BOTH send paths, but with different strings: compose (`POST /v1/conversations`)
   says "not ready to send yet"; `POST /v1/messages/send` + retry say "conversation's number is still
   provisioning." The load-bearing guarantee holds on both (control never reaches the registration gate for a
   non-active sending number); don't treat one string as universal.
4. **(minor) `messaging_port_status` is pollable via GET.** Pin §3.6/§12: the `messaging` object on
   `GET /v2/porting_orders/{id}` carries `messaging_port_status` (`not_applicable|pending|activating|ported|
   exception`), so the §5.2 reconcile cron can poll it (confirm only the exact JSON key at build).
5. **(minor) Telnyx event catalog is intentionally non-exhaustive.** `porting_order.sharing_token_expired`
   exists in Telnyx's catalog but never fires for API-created single-number ports (no share-token flow), so it
   falls through to the acked no-op; the §5.1 handled set is deliberately not the full catalog.
