-- #284 / D77 — let a workspace choose a shorter window than the default.
--
-- D77 set the defaults and explained why they are years: a contractor in a
-- warranty dispute over a two-year-old job needs those texts. But that is the
-- right DEFAULT, not the right answer for everybody — some customers want less
-- kept, and offering it is cheap trust.
--
-- ---------------------------------------------------------------------------
-- SHORTER ONLY, AND THE BOUND IS THE POINT.
--
-- A workspace may reduce retention, never extend it. Extending would let a
-- customer opt into an indefinite-retention posture we have just published a
-- policy against, and it would make our own privacy page untrue for whoever
-- chose it.
--
-- The floor is 90 days. Below that the product stops being what it is: a
-- shared inbox whose value is the history, and a thread that empties while a
-- job is still running is a bug from the customer's side however clearly it
-- was configured.
--
-- ---------------------------------------------------------------------------
-- NOTHING HERE DELETES ANYTHING.
--
-- This stores a preference. The enforcement job is deliberately last (#284),
-- because it is the only piece that can destroy something, and it should be
-- written against numbers that already exist and a suspend that already works.

alter table public.companies
  add column if not exists retention_days int
    check (retention_days is null or retention_days between 90 and 2555),
  add column if not exists retention_changed_at timestamptz,
  add column if not exists retention_changed_by uuid references auth.users(id) on delete set null;

comment on column public.companies.retention_days is
  '#284/D77: workspace-chosen retention for messages, conversations, '
  'attachments and call records. NULL = the D77 default (7 years / 2555 days). '
  'Bounded 90..2555: shorter only, and never below the point where a shared '
  'inbox stops being one.';

/**
 * Set or clear the workspace's retention choice.
 *
 * Returns the effective window either way, so a caller never has to know
 * whether NULL means "default" or "unset" — one number, always.
 */
create or replace function public.api_set_retention(
  p_company_id uuid,
  p_days       int default null,
  p_actor      uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_default int := 2555;  -- D77: 7 years.
  v_row     public.companies%rowtype;
begin
  if p_days is not null and (p_days < 90 or p_days > v_default) then
    raise exception
      'api_set_retention: retention must be between 90 and % days. A workspace '
      'may shorten its window, never extend it past the published default.',
      v_default;
  end if;

  update public.companies
     set retention_days       = p_days,
         retention_changed_at = now(),
         retention_changed_by = p_actor
   where id = p_company_id
  returning * into v_row;

  if not found then
    raise exception 'api_set_retention: no company %', p_company_id;
  end if;

  return jsonb_build_object(
    'company_id', v_row.id,
    'retention_days', coalesce(v_row.retention_days, v_default),
    'is_default', v_row.retention_days is null,
    'changed_at', v_row.retention_changed_at
  );
end;
$$;

/**
 * The effective window for a workspace, in days.
 *
 * One definition, so the enforcement job, the export and whatever tells the
 * customer cannot disagree about a number that decides what gets destroyed.
 */
create or replace function public.effective_retention_days(p_company_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select retention_days from public.companies where id = p_company_id),
    2555
  );
$$;

revoke all on function public.api_set_retention(uuid, int, uuid)
  from public, anon, authenticated;
grant execute on function public.api_set_retention(uuid, int, uuid) to service_role;

revoke all on function public.effective_retention_days(uuid)
  from public, anon, authenticated;
grant execute on function public.effective_retention_days(uuid) to service_role;
