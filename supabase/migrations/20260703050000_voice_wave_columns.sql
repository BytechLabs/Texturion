-- FEATURE-GAPS BUILD-NOW voice wave — schema for missed-call text-back (Step 1)
-- and keep-your-number text-enablement (Step 0b/keep). A NEW migration; never
-- edits a shipped one (D7/D14).
--
-- Three clusters, all additive (nullable/defaulted columns + one new lookup
-- table), so no policy or grant changes: companies/phone_numbers both have RLS
-- enabled deny-by-default with NO anon/authenticated grants (20260701000300),
-- and the service_role sb_secret_ table-level DML grant (20260701030000)
-- already covers every column. New columns and the new table therefore need no
-- additional grant beyond the table-level grant re-issued below for the new
-- table (mirrors 20260701030000 exactly).

-- ---------------------------------------------------------------------------
-- 1. Voice enablement on the per-company number (Step 1a — provisioning).
-- ---------------------------------------------------------------------------
-- A shipped number is SMS-only (the number order used filter[features]=sms and
-- attached only a messaging_profile_id). To RECEIVE CALLS the number needs a
-- Telnyx voice Call-Control application bound to it. These columns track that
-- binding so enabling voice is idempotent and never touches the SMS path.
--
-- voice_connection_id: the Telnyx Call-Control application id (a.k.a. voice
--   "connection") bound to the number's voice settings. NULL = voice not yet
--   enabled (the shipped SMS-only state). Set once by the enable-voice path.
-- voice_enabled: convenience flag, true once the number's voice settings point
--   at our Call-Control app. Distinct from voice_connection_id being non-null
--   only in that a re-enable is a no-op when already true (idempotency guard).
alter table public.phone_numbers
  add column voice_connection_id text,
  add column voice_enabled       boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. Missed-call text-back settings (Step 1b — company-level).
-- ---------------------------------------------------------------------------
-- mctb_enabled: master toggle. Default FALSE — inert until the owner turns it
--   on AND authors a message (the send path requires a non-empty message).
-- mctb_message: the OWNER-AUTHORED booking-forward SMS sent when a call is
--   MISSED. Merge-fields ({first_name}/{business_name}) apply at send time.
--   Nullable; an unauthored message never fires (checked in the send path).
-- forward_to_cell: optional E.164 cell the inbound call is first DIALED to
--   (with a timeout + Answering Machine Detection). "Missed" is computed from
--   that dial's result. NULL = do not forward; the call is treated as missed
--   immediately (no human to answer live), so the text-back still fires.
alter table public.companies
  add column mctb_enabled    boolean not null default false,
  add column mctb_message    text,
  add column forward_to_cell text;

-- E.164 shape guard for forward_to_cell (US/CA +1 followed by a valid NANP
-- number: leading area-code and exchange digits 2-9). App-layer PATCH also
-- validates against the NANP table; this is the storage-level backstop. NULL
-- allowed (the default: no forwarding).
alter table public.companies
  add constraint companies_forward_to_cell_e164 check (
    forward_to_cell is null or forward_to_cell ~ '^\+1[2-9]\d{2}[2-9]\d{6}$'
  );

-- ---------------------------------------------------------------------------
-- 3. Text-enablement orders for keep-your-number (landline hosted-SMS path).
-- ---------------------------------------------------------------------------
-- The port-in path already exists (D16 / port_requests). The OTHER keep-your-
-- number path is TEXT-ENABLING a number the owner keeps on their existing voice
-- carrier — a Telnyx "hosted messaging" / number-enablement order that adds SMS
-- to a landline/VoIP number WITHOUT moving voice. This table mirrors Telnyx's
-- messaging_hosted_number_orders lifecycle so the state machine is honest about
-- the multi-day carrier review.
--
-- Status mirrors Telnyx hosted-order status.value (verified enum) plus a local
-- terminal 'cancelled':
--   pending   — order created, awaiting carrier LOA verification
--   action-required — Telnyx needs the signed LOA / bill uploaded
--   in-progress — carrier is provisioning SMS on the number
--   completed — SMS is live on the number (texting works)
--   failed    — carrier rejected (fixable → resubmit)
--   cancelled — local terminal (owner abandoned)
create type text_enablement_status as enum (
  'pending',
  'action-required',
  'in-progress',
  'completed',
  'failed',
  'cancelled'
);

create table public.text_enablement_orders (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references public.companies(id) on delete restrict,
  -- The phone_numbers row this order text-enables (source='hosted'); one order
  -- per number row. The saga inserts the phone_numbers row first (like the
  -- provisioned/ported paths) then this order.
  phone_number_id           uuid not null references public.phone_numbers(id) on delete restrict,
  phone_e164                text not null,
  country                   text not null check (country in ('US','CA')),
  -- Idempotency backstop (mirrors provisioning_key on phone_numbers): the
  -- request Idempotency-Key (client UUID) makes a double-tap converge.
  provisioning_key          text not null,
  -- Telnyx messaging_hosted_number_order id, persisted immediately after create
  -- (crash-after-order protection, same discipline as telnyx_order_id).
  telnyx_hosted_order_id    text,
  -- The Telnyx hosted-number id inside the order (needed to poll enablement).
  telnyx_hosted_number_id   text,
  -- LOA / bill document ids (Telnyx POST /v2/documents), like the port path.
  telnyx_loa_document_id    text,
  telnyx_bill_document_id   text,
  status                    text_enablement_status not null default 'pending',
  last_error                text,
  attempts                  int not null default 0,
  completed_at              timestamptz,
  cancelled_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index text_enablement_orders_provkey_uq
  on public.text_enablement_orders (provisioning_key);
create unique index text_enablement_orders_number_uq
  on public.text_enablement_orders (phone_number_id);
create index text_enablement_orders_company_idx
  on public.text_enablement_orders (company_id, status);

-- moddatetime trigger to match every mutable table (D7).
create trigger text_enablement_orders_set_updated_at
  before update on public.text_enablement_orders
  for each row execute function extensions.moddatetime(updated_at);

-- RLS: deny-by-default, no anon/authenticated grants (SPEC §6). The Worker uses
-- the service_role sb_secret_ key. Mirror 20260701000300_rls.sql +
-- 20260701030000_service_role_grants.sql for the new table exactly.
alter table public.text_enablement_orders enable row level security;
grant select, insert, update, delete on public.text_enablement_orders to service_role;
