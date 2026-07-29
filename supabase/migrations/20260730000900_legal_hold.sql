-- #284 — legal hold, before enforcement rather than after.
--
-- D77 set the retention numbers. The job that acts on them is not built yet,
-- and this lands first ON PURPOSE: an enforcement job with no suspend is a
-- compliance problem of its own. The first workspace under dispute would need
-- somebody disabling a cron by hand, at exactly the wrong moment, under exactly
-- the pressure that makes mistakes.
--
-- ---------------------------------------------------------------------------
-- IT SUSPENDS DELETION, NOT THE PRODUCT.
--
-- A workspace on hold keeps working in every respect. Nothing about the
-- customer's experience changes; the only difference is that scheduled
-- destruction does not happen. A hold that degraded the product would be a
-- punishment for being in a dispute, and would make us reluctant to set one.
--
-- ---------------------------------------------------------------------------
-- WHY A COLUMN AND A FUNCTION RATHER THAN JUST A COLUMN.
--
-- `is_on_legal_hold()` exists so every retention path asks the SAME question in
-- the same words. A future job that inlines `legal_hold_at is null` will drift
-- the first time the rule gains a nuance — and the failure mode is silent
-- destruction of the one workspace that most needed the data kept.

alter table public.companies
  add column if not exists legal_hold_at timestamptz,
  add column if not exists legal_hold_reason text,
  add column if not exists legal_hold_by uuid references auth.users(id) on delete set null;

comment on column public.companies.legal_hold_at is
  '#284/D77: when set, NO retention job may delete this workspace''s data. '
  'Suspends destruction only — the product is unaffected.';

-- Partial: holds are rare, and the question asked of this column is almost
-- always "is anybody on hold at all".
create index if not exists companies_legal_hold_idx
  on public.companies (id) where legal_hold_at is not null;

/**
 * The one question every retention path asks.
 *
 * Kept as a function so the rule has a single definition. A job that inlines
 * the check works today and drifts tomorrow, and drift here means deleting the
 * data of a workspace under investigation.
 */
create or replace function public.is_on_legal_hold(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.companies
     where id = p_company_id and legal_hold_at is not null
  );
$$;

/**
 * Place or lift a hold.
 *
 * A reason is REQUIRED to place one. A hold with no stated cause cannot be
 * reviewed, cannot be lifted with confidence, and is indistinguishable at a
 * glance from a mistake — and holds are exactly the thing nobody wants to lift
 * on a guess.
 */
create or replace function public.api_set_legal_hold(
  p_company_id uuid,
  p_on         boolean,
  p_reason     text default null,
  p_actor      uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.companies%rowtype;
begin
  if p_on and (p_reason is null or length(trim(p_reason)) = 0) then
    raise exception
      'api_set_legal_hold: a reason is required to place a hold — a hold '
      'nobody can explain is a hold nobody will dare lift';
  end if;

  update public.companies
     set legal_hold_at     = case when p_on then coalesce(legal_hold_at, now()) end,
         legal_hold_reason = case when p_on then p_reason end,
         legal_hold_by     = case when p_on then p_actor end
   where id = p_company_id
  returning * into v_row;

  if not found then
    raise exception 'api_set_legal_hold: no company %', p_company_id;
  end if;

  return jsonb_build_object(
    'company_id', v_row.id,
    'on_hold', v_row.legal_hold_at is not null,
    'since', v_row.legal_hold_at,
    'reason', v_row.legal_hold_reason
  );
end;
$$;

revoke all on function public.is_on_legal_hold(uuid) from public, anon, authenticated;
grant execute on function public.is_on_legal_hold(uuid) to service_role;

revoke all on function public.api_set_legal_hold(uuid, boolean, text, uuid)
  from public, anon, authenticated;
grant execute on function public.api_set_legal_hold(uuid, boolean, text, uuid) to service_role;

