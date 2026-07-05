-- #12 modular plan builder. "Not every customer needs everything" — the base
-- plan covers texting + one US number + US 10DLC, and everything else becomes a
-- toggleable module a company opts into. This table is the per-company
-- enablement record; gating (send/forward/provision checks) and checkout wire
-- to it in follow-ups. A row present with disabled_at IS NULL = enabled.
--
-- GRANDFATHERING: this is purely additive, but the gating that follows must not
-- silently strip a capability a live customer already uses. So we seed the
-- modules each existing company is already exercising — MMS for everyone (MMS
-- send is unrestricted today), voice for anyone with a forward number set, and
-- the Canada region for CA companies — so nothing changes for them when the
-- gates land. extra_storage is never seeded (it's net-new capacity).

create table public.company_modules (
  company_id  uuid not null references public.companies(id) on delete cascade,
  module      text not null check (module in
                ('mms', 'voice', 'extra_storage', 'regions_ca')),
  enabled_at  timestamptz not null default now(),
  disabled_at timestamptz,                        -- non-null = turned off, kept for history
  primary key (company_id, module)
);

-- Service-role only (like the rest of the billing substrate); the rls.sql
-- default-privilege revoke already strips anon/authenticated from new tables.
alter table public.company_modules enable row level security;

-- Grandfather live capabilities so the eventual gates are no-ops for them.
insert into public.company_modules (company_id, module)
  select id, 'mms' from public.companies where deleted_at is null
  on conflict do nothing;

insert into public.company_modules (company_id, module)
  select id, 'voice' from public.companies
   where deleted_at is null and forward_to_cell is not null
  on conflict do nothing;

insert into public.company_modules (company_id, module)
  select id, 'regions_ca' from public.companies
   where deleted_at is null and country = 'CA'
  on conflict do nothing;
