-- D16 / PORTING.md §2 — Number porting (port-in) schema.
--
-- Adds the port-in feature to the paid-first onboarding + per-company messaging
-- profile + 10DLC model already built. This migration is PURELY schema; the port
-- saga, routes, webhooks, and reconcile cron live in apps/api (integration track).
--
-- Conventions kept from SPEC §6 / the existing migrations (never edit old ones):
--   * uuid PKs via gen_random_uuid()
--   * FKs declared explicitly, ON DELETE RESTRICT by default (one deliberate
--     ON DELETE SET NULL on the optional bridge-number link)
--   * moddatetime updated_at on the mutable table
--   * deny-by-default RLS: RLS enabled, NO anon/authenticated grants/policies —
--     the Worker reads/writes with the sb_secret_ (service_role) key. service_role
--     DML is auto-granted by the ALTER DEFAULT PRIVILEGES in
--     20260701030000_service_role_grants.sql (postgres-created future tables).
--   * IDs-only Broadcast-from-Database trigger into private topic company:{id}.
--
-- Every enum value below mirrors Telnyx's REAL, verified Porting API v2 statuses
-- (PORTING.md §1/§2.1); the sole local addition is the terminal 'cancelled'.

-- ---------------------------------------------------------------------------
-- Enums (PORTING.md §2.1).
-- ---------------------------------------------------------------------------

-- Mirrors Telnyx porting_order status.value (verified) + local 'cancelled'.
create type port_status as enum (
  'draft',                  -- local: collecting data / documents, before Telnyx submit
  'in-process',             -- submitted to Telnyx, awaiting hand-off to losing carrier
  'submitted',              -- losing carrier received it
  'exception',              -- losing carrier rejected (fixable — fix & resubmit)
  'foc-date-confirmed',     -- carrier confirmed the port + the FOC date/time
  'activation-in-progress', -- V2 transitional between foc-date-confirmed and ported
  'ported',                 -- VOICE complete (SMS may lag — see messaging_port_status)
  'cancel-pending',
  'cancelled'               -- local terminal state
);

-- Telnyx messaging_port_status (verified — pollable on GET porting order).
create type port_messaging_status as enum (
  'not_applicable',         -- messaging enablement not set (we always enable)
  'pending',                -- messaging enabled but FOC not yet reached
  'activating',             -- voice ported; Telnyx verifying messaging activation
  'ported',                 -- messaging live on Telnyx → JobText texting works
  'exception'               -- messaging failed to auto-port; Telnyx escalating
);

-- Source of a phone_numbers row (provisioned = new number saga; ported = port saga).
create type number_source as enum ('provisioned', 'ported');

-- ---------------------------------------------------------------------------
-- port_requests (PORTING.md §2.2). One row per port order (one number per order
-- in MVP — never batch-port). Mirrors the two orthogonal sub-tracks (§1):
--   status                → voice/order track (Telnyx status.value, identity map)
--   messaging_port_status → messaging track (separate; 'ported' unlocks texting)
-- ---------------------------------------------------------------------------

create table public.port_requests (
  id                         uuid primary key default gen_random_uuid(),
  company_id                 uuid not null references public.companies(id) on delete restrict,
  -- The phone_numbers row this port fulfils (created source='ported',
  -- status='provisioning'). RESTRICT: the port is meaningless without its number.
  phone_number_id            uuid not null references public.phone_numbers(id) on delete restrict,

  phone_e164                 text not null,                 -- number being ported, +E.164
  country                    text not null check (country in ('US','CA')),

  -- Telnyx handles (persisted immediately on create — crash-after-create safety).
  telnyx_porting_order_id    text,                          -- POST /v2/porting_orders → id
  telnyx_loa_document_id     text,                          -- POST /v2/documents (loa)     → id
  telnyx_invoice_document_id text,                          -- POST /v2/documents (invoice) → id

  -- Losing-carrier account data (end_user.admin, §3.3). PII policy note below:
  -- account_number + pin_passcode are CARRIER CREDENTIALS, never telemetered,
  -- never returned in an API response body (serializer returns booleans only).
  entity_name                text not null,                 -- account holder / business legal name
  auth_person_name           text not null,                 -- authorized signer on the LOA
  billing_phone_number       text,                          -- BTN if different from ported number
  account_number             text not null,                 -- losing-carrier account number (credential)
  pin_passcode               text,                          -- port-out PIN / passcode (credential)
  is_wireless                boolean not null default false, -- wireless ports may need PIN + last-4 SSN/SIN
  -- SSN/SIN policy (§2.2 / SPEC §10): NEVER store the full value. Only the last-4
  -- of a wireless port's SSN/SIN, mirroring the sole-prop `ein` last-4 rule. The
  -- CHECK makes storing anything longer than 4 chars impossible at the DB layer.
  ssn_sin_last4              text check (ssn_sin_last4 is null or ssn_sin_last4 ~ '^[0-9]{4}$'),

  -- Service address on file with the losing carrier (end_user.location, §3.3).
  service_street             text not null,
  service_extended           text,                          -- suite/unit
  service_locality           text not null,                 -- city
  service_admin_area         text not null,                 -- USPS state / CA province code
  service_postal_code        text not null,

  -- Requested vs. confirmed cutover (§3.6: confirmed FOC is fetched from the
  -- order resource, NOT the status_changed webhook body).
  foc_datetime_requested     timestamptz,                   -- activation_settings.foc_datetime_requested
  foc_date                   timestamptz,                   -- CONFIRMED FOC (foc_datetime_actual)

  -- Status mirrors (§1). Defaults are the pre-submit local state.
  status                     port_status not null default 'draft',
  messaging_port_status      port_messaging_status not null default 'not_applicable',

  rejection_reason           text,                          -- exception detail, human-readable
  submission_count           int not null default 0,        -- increments each Telnyx submit/resubmit
  wants_bridge_number        boolean not null default false, -- D16 opt-in "tide-me-over" number
  -- Bridge number is a normal source='provisioned' row from the existing saga.
  -- SET NULL (not RESTRICT): releasing the bridge number must not be blocked by
  -- this back-reference — the bridge is independent of the port's lifecycle.
  bridge_number_id           uuid references public.phone_numbers(id) on delete set null,

  submitted_at               timestamptz,
  ported_at                  timestamptz,                   -- messaging_port_status → 'ported'
  cancelled_at               timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

-- One live port per number per company (a cancelled port can be retried with a
-- fresh row — the partial predicate excludes cancelled rows).
create unique index port_requests_active_uq on public.port_requests (company_id, phone_e164)
  where status <> 'cancelled';
-- Webhook lookup + idempotency: at most one row per Telnyx porting order id.
create unique index port_requests_telnyx_uq on public.port_requests (telnyx_porting_order_id)
  where telnyx_porting_order_id is not null;
-- Reconciliation cron work-set: rows whose VOICE track is not yet terminal.
-- (The cron additionally re-checks rows whose messaging track is non-terminal;
-- it filters on both columns in SQL — this index covers the voice half.)
create index port_requests_open_idx on public.port_requests (status)
  where status not in ('ported','cancelled');
create index port_requests_company_idx on public.port_requests (company_id);

-- moddatetime updated_at (SPEC §6) — same signature the 13 existing tables use.
create trigger set_updated_at before update on public.port_requests
  for each row execute function extensions.moddatetime(updated_at);

-- Deny-by-default RLS (SPEC §6 / D8): enabled, no policies, no anon/authenticated
-- grants. service_role DML is covered by the ALTER DEFAULT PRIVILEGES in
-- 20260701030000_service_role_grants.sql (this table is postgres-created).
alter table public.port_requests enable row level security;

-- ---------------------------------------------------------------------------
-- phone_numbers additions (PORTING.md §2.3). Nullable/defaulted for safe
-- migration of existing rows: every existing number is source='provisioned'
-- with porting_status NULL.
-- ---------------------------------------------------------------------------

alter table public.phone_numbers
  add column source         number_source not null default 'provisioned',
  -- NULL for provisioned numbers; mirrors port_requests.status for ported ones.
  add column porting_status port_status;

-- A ported row must carry a porting_status; a provisioned row must not
-- (keeps the source/porting_status pair coherent — the send path reads neither,
-- but the invariant prevents nonsense states the port saga would choke on).
alter table public.phone_numbers
  add constraint phone_numbers_porting_status_consistency
  check ((source = 'ported') = (porting_status is not null));

-- ---------------------------------------------------------------------------
-- port.updated Broadcast-from-Database trigger (PORTING.md §8.2). Mirrors the
-- number.updated / registration.updated triggers (20260701000400): IDs-only
-- payload into the private topic company:{company_id}, so the Settings → Numbers
-- port tracker renders live without a refetch of the sensitive columns.
-- ---------------------------------------------------------------------------

create or replace function public.broadcast_port_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(
    jsonb_build_object('port_request_id', new.id,
                       'status', new.status,
                       'messaging_port_status', new.messaging_port_status),
    'port.updated', 'company:' || new.company_id::text, true);
  return null;
end $$;

create trigger port_requests_broadcast after insert or update on public.port_requests
  for each row execute function public.broadcast_port_change();
