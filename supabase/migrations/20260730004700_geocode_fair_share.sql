-- #440 — a switcher imports 2,000 contacts and the Map stays empty for two days.
--
-- THE ORDERING WAS THE WORST PART, and it is worse than the issue describes. Both
-- backfills scanned `order by created_at asc` across every tenant, so the OLDEST
-- pending rows in the whole system went first. A workspace that imported today has
-- the NEWEST rows, which means it queued behind every other tenant's backlog — the
-- exact opposite of what the moment needs. One large established address book with
-- a trickle of failures could hold a brand-new workspace at the back of the line
-- indefinitely.
--
-- FAIR SHARE, NOT A DIFFERENT SORT. Flipping to `desc` would starve old rows
-- forever, which is the same bug pointed the other way. So the queue takes at most
-- `p_per_company` rows from each company per run and rotates: every workspace with
-- work pending makes progress on every run, and no workspace can monopolise a run
-- by having the most rows.
--
-- Among companies, the ones with the FEWEST pending rows go first. That reads
-- backwards until you think about who is watching: a workspace with 30 addresses
-- left finishes this run and its Map is done, while one with 1,900 was always going
-- to take several runs either way. Serving the nearly-finished first converts more
-- customers from "waiting" to "working" per run, at no cost to the others.
--
-- WHY THIS IS THE FIX THAT COSTS THE UPSTREAM SERVICE NOTHING. Nominatim's policy
-- caps the RATE (1 req/s), which the caller already honours and which this does not
-- touch. Reordering a queue changes who benefits from the same number of requests.
-- Per #428 — where leaning harder on an OSM courtesy service is exactly the mistake
-- being corrected — an ordering change is strictly preferable to asking the service
-- for more.
--
-- Two functions rather than one generic: `contacts` and `tasks` carry the address on
-- different columns (a composed `address` text vs the `addr_*` set), and a shared
-- one would need a table name parameter — dynamic SQL in a security-definer function
-- reachable from a cron, for the sake of thirty duplicated lines. Not worth it.

/**
 * Contacts still needing a geocode, fair-shared across companies.
 *
 * Mirrors the cron's own predicates exactly: an address present, not soft-deleted,
 * and a status the cron re-attempts ('pending' or 'failed'). If those drift apart
 * the cron silently geocodes a different set than the queue reports, so
 * `geocode_fair_share.test.sql` asserts the two agree.
 */
create or replace function public.api_geocode_contact_queue(
  p_limit       int,
  p_per_company int
) returns table (id uuid, address text)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select c.id,
           c.address,
           c.company_id,
           row_number() over (
             partition by c.company_id
             order by c.created_at, c.id
           ) as seat,
           count(*) over (partition by c.company_id) as company_pending
    from public.contacts c
    where c.deleted_at is null
      and c.address is not null
      and c.geocode_status in ('pending', 'failed')
  )
  select ranked.id, ranked.address
  from ranked
  where ranked.seat <= greatest(p_per_company, 1)
  -- Fewest-pending company first (they finish soonest), then oldest row.
  order by ranked.company_pending, ranked.company_id, ranked.seat
  limit greatest(p_limit, 0)
$$;

revoke execute on function public.api_geocode_contact_queue(int, int)
  from public, anon, authenticated;
grant execute on function public.api_geocode_contact_queue(int, int)
  to service_role;

/** The same fair share for task addresses (#440 ask 5 — identical exposure). */
create or replace function public.api_geocode_task_queue(
  p_limit       int,
  p_per_company int
) returns table (
  id uuid,
  addr_street text,
  addr_unit text,
  addr_city text,
  addr_state text,
  addr_postal_code text,
  addr_country text
)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select t.id,
           t.addr_street, t.addr_unit, t.addr_city,
           t.addr_state, t.addr_postal_code, t.addr_country,
           t.company_id,
           row_number() over (
             partition by t.company_id
             order by t.created_at, t.id
           ) as seat,
           count(*) over (partition by t.company_id) as company_pending
    from public.tasks t
    where t.deleted_at is null
      and t.geocode_status in ('pending', 'failed')
      and (
        t.addr_street is not null
        or t.addr_city is not null
        or t.addr_postal_code is not null
      )
  )
  select ranked.id,
         ranked.addr_street, ranked.addr_unit, ranked.addr_city,
         ranked.addr_state, ranked.addr_postal_code, ranked.addr_country
  from ranked
  where ranked.seat <= greatest(p_per_company, 1)
  order by ranked.company_pending, ranked.company_id, ranked.seat
  limit greatest(p_limit, 0)
$$;

revoke execute on function public.api_geocode_task_queue(int, int)
  from public, anon, authenticated;
grant execute on function public.api_geocode_task_queue(int, int)
  to service_role;

/**
 * #440 asks 1 and 2 — how far along a workspace's Map is.
 *
 * The customer-facing half, and the reason the issue exists: an empty Map with
 * nothing saying why reads as a broken feature rather than a busy one. This gives
 * the Map a sentence it can say.
 *
 * `located` and `pending` are counted separately from `no_address` on purpose. A
 * contact with no address is not waiting for anything, and folding it into a
 * "1,240 of 2,000" would make a number that never reaches its total — which is
 * worse than no number, because it looks stuck forever.
 */
create or replace function public.api_geocode_progress(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'contacts_located', coalesce(sum(case when c.geocode_status = 'ok' then 1 else 0 end), 0),
    'contacts_pending', coalesce(sum(
      case when c.geocode_status in ('pending', 'failed') then 1 else 0 end), 0),
    'contacts_without_address', coalesce(sum(
      case when c.geocode_status = 'no_address' or c.address is null then 1 else 0 end), 0)
  )
  from public.contacts c
  where c.company_id = p_company_id
    and c.deleted_at is null
$$;

revoke execute on function public.api_geocode_progress(uuid)
  from public, anon, authenticated;
grant execute on function public.api_geocode_progress(uuid)
  to service_role;

comment on function public.api_geocode_progress is
  'Per-workspace Map geocoding progress (#440): located / still pending / no address to locate. Counted separately so a "N of M" never includes rows that will never be located, which would look permanently stuck.';
