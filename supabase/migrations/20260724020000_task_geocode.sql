-- Task-address geocoding (#214 follow-up / founder-flagged Map bug).
--
-- The Map view (D25) plotted every task at its CONTACT's geocoded address,
-- ignoring the task's OWN structured address (addr_* columns, added by #214 task
-- enrichment). So a task whose message named "CN Tower, Toronto" showed at the
-- contact's Calgary pin. Mirror the contacts geocode pipeline for tasks: cache
-- lat/lng on the row, geocoded ONCE from the task address via the same free,
-- rate-limited Nominatim path, so the Map can prefer the task's location.
--
-- Same status vocabulary + partial-index pattern as contacts
-- (20260702060000): pending (needs geocoding) → ok | failed | no_address.
alter table public.tasks
  add column lat            double precision,
  add column lng            double precision,
  add column geocoded_at    timestamptz,
  add column geocode_status text not null default 'no_address'
    check (geocode_status in ('pending', 'ok', 'failed', 'no_address'));

-- Backfill: existing tasks WITH an address need a first geocode attempt; the
-- rest stay 'no_address' (nothing to place). Keeps the pending work-set to the
-- address-bearing tasks only.
update public.tasks
   set geocode_status = 'pending'
 where coalesce(addr_street, addr_unit, addr_city, addr_state,
                addr_postal_code, addr_country) is not null;

-- The geocode cron's work-set: address-bearing tasks still needing an attempt.
-- Partial so it stays tiny as rows settle to a terminal status; done tasks are
-- still map-relevant so they are NOT excluded here.
create index tasks_geocode_pending_idx on public.tasks (company_id, created_at)
  where geocode_status in ('pending', 'failed');

-- Keep geocode_status in lock-step with the address across EVERY write path
-- (create_task RPC, the enrichment save, plain updates) without recreating any
-- RPC: a BEFORE trigger re-queues the row whenever the address columns change,
-- and clears the cached coordinate so a stale pin never outlives its address.
-- The geocode cron's own writes (lat/lng/geocode_status/geocoded_at, address
-- untouched) fall through the `is distinct from` guard, so 'ok' is never reset.
create or replace function public.tasks_geocode_status_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.addr_street      is distinct from old.addr_street
     or new.addr_unit        is distinct from old.addr_unit
     or new.addr_city        is distinct from old.addr_city
     or new.addr_state       is distinct from old.addr_state
     or new.addr_postal_code is distinct from old.addr_postal_code
     or new.addr_country     is distinct from old.addr_country
  then
    if coalesce(new.addr_street, new.addr_unit, new.addr_city, new.addr_state,
                new.addr_postal_code, new.addr_country) is not null then
      new.geocode_status := 'pending';
    else
      new.geocode_status := 'no_address';
    end if;
    new.lat := null;
    new.lng := null;
    new.geocoded_at := null;
  end if;
  return new;
end;
$$;

create trigger tasks_geocode_status_sync
  before insert or update on public.tasks
  for each row execute function public.tasks_geocode_status_sync();
