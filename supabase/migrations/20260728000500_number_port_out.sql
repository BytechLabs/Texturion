-- #398: nothing noticed a number leaving.
--
-- We handle porting a number IN (`porting_order.*`, PORTING.md §5.1) and have
-- no concept of one going OUT. When a customer ports away, the row stays
-- active/assigned/billable, texts and calls simply stop arriving — an absence,
-- which per #387 is the one thing we cannot detect — and we keep charging for
-- a number we no longer control until somebody complains.
--
-- Three problems, and the third is the reason this is not merely tidy:
--   1. A port-out IS churn, executed, days before the cancellation. That gap is
--      the only window where the relationship is recoverable.
--   2. We bill for a service we stopped providing.
--   3. Port-out fraud is how a business phone number is stolen. Every text a
--      homeowner sends — addresses, gate codes, when nobody is home — goes to
--      whoever holds the number. Our product reported nothing wrong.
--
-- `ported_out` is its own status rather than reusing `released`. Released is a
-- number WE gave up (the grace/release job). Ported out is the customer, or
-- someone pretending to be them, taking it. They need different handling and
-- read completely differently in an incident.
alter type public.number_status add value if not exists 'ported_out';

-- When the port completed (or was first seen), so billing and support can both
-- answer "since when" without reading the audit log.
alter table public.phone_numbers
  add column if not exists ported_out_at timestamptz;

comment on column public.phone_numbers.ported_out_at is
  '#398: when this number left our Telnyx account via a port-out. Set from the '
  'portout.status_changed webhook; NULL for every other status.';

-- One row per port-out we have seen, so a replayed webhook cannot alert twice
-- and "has anyone tried to take this number before" is answerable. Keyed on the
-- Telnyx port-out id + status, because the interesting alert fires on PENDING
-- (the only window where an unauthorised port can still be stopped) and again
-- on the terminal status.
create table if not exists public.number_port_outs (
  portout_id   text        not null,
  status       text        not null,
  company_id   uuid        references public.companies(id) on delete set null,
  phone_e164   text        not null,
  carrier_name text,
  foc_date     timestamptz,
  seen_at      timestamptz not null default now(),
  primary key (portout_id, status, phone_e164)
);

alter table public.number_port_outs enable row level security;
-- Deny by default: only the service role (the API) reads or writes these.

create index if not exists number_port_outs_company_idx
  on public.number_port_outs (company_id, seen_at desc);

-- Claim ONE (portout, status, number) so a webhook replay is a no-op rather
-- than a second 3am alert. Returns true only for the caller that inserted.
create or replace function public.claim_port_out_notice(
  p_portout_id   text,
  p_status       text,
  p_phone_e164   text,
  p_company_id   uuid,
  p_carrier_name text,
  p_foc_date     timestamptz
) returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with claimed as (
    insert into public.number_port_outs
      (portout_id, status, phone_e164, company_id, carrier_name, foc_date)
    values
      (p_portout_id, p_status, p_phone_e164, p_company_id, p_carrier_name, p_foc_date)
    on conflict (portout_id, status, phone_e164) do nothing
    returning 1
  )
  select exists (select 1 from claimed)
$$;

revoke execute on function public.claim_port_out_notice(text, text, text, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_port_out_notice(text, text, text, uuid, text, timestamptz)
  to service_role;
