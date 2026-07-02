-- SPEC §6 — Tables & indexes (D7, D8).
-- Conventions: uuid PKs via gen_random_uuid(); FKs declared explicitly with
-- ON DELETE RESTRICT by default (CASCADE only on join/child tables noted);
-- updated_at maintained by moddatetime (triggers in a later migration);
-- customer-facing money in integer cents, provider COGS in numeric dollars.
-- Companies are never hard-deleted; contacts and companies soft-delete via
-- deleted_at; messages, usage_events, opt_outs are append-only.

-- Synced from auth.users by trigger (see triggers migration).
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
  email       extensions.citext not null,
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
                                                        -- submission, §4.4). SSN/SIN: last-4 only, ever.
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
create index contacts_name_trgm  on public.contacts using gin (name extensions.gin_trgm_ops);
create index contacts_phone_trgm on public.contacts using gin (phone_e164 extensions.gin_trgm_ops);

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
-- Pre-seeded per company at creation: 'Quote sent', 'Scheduled', 'Won', 'Lost' (D7)
-- — done by the API at company creation, not by migration.

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
