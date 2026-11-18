alter table public.companies
  add column pending_plan public.plan_id,
  add column pending_plan_effective_at timestamptz,
  add column pending_plan_schedule_id text,
  add column pending_plan_seat_limit integer,
  add column pending_plan_number_limit integer,
  add constraint companies_pending_plan_complete check (
    (pending_plan is null and pending_plan_effective_at is null and pending_plan_schedule_id is null
      and pending_plan_seat_limit is null and pending_plan_number_limit is null)
    or
    (pending_plan is not null and pending_plan_effective_at is not null and pending_plan_schedule_id is not null
      and pending_plan_seat_limit > 0 and pending_plan_number_limit > 0
      and pending_plan_seat_limit is not null and pending_plan_number_limit is not null)
  );

create or replace function public.api_record_pending_downgrade(
  p_company_id uuid,
  p_subscription_id text,
  p_schedule_id text,
  p_effective_at timestamptz,
  p_seats int,
  p_numbers int,
  p_check_capacity boolean default true
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company public.companies%rowtype;
  v_seats int;
  v_numbers int;
begin
  select * into v_company from public.companies
  where id = p_company_id and stripe_subscription_id = p_subscription_id and deleted_at is null
  for update;
  if not found or v_company.plan is distinct from 'pro' then
    return 'not_applicable';
  end if;
  if p_check_capacity then
    select (
      select count(*) from public.company_members
      where company_id = p_company_id and deactivated_at is null
    ) + (
      select count(*) from public.invites
      where company_id = p_company_id and accepted_at is null and revoked_at is null and expires_at > now()
    ), (
      select count(*) from public.phone_numbers
      where company_id = p_company_id and status <> 'released'
    ) into v_seats, v_numbers;
    if v_seats > p_seats then
      return 'seat_limit';
    end if;
    if v_numbers > p_numbers then
      return 'number_limit';
    end if;
  end if;
  if v_company.pending_plan_schedule_id = p_schedule_id
    and v_company.pending_plan_effective_at = p_effective_at then
    return 'scheduled';
  end if;

  update public.companies set
    pending_plan = 'starter',
    pending_plan_effective_at = p_effective_at,
    pending_plan_schedule_id = p_schedule_id,
    pending_plan_seat_limit = p_seats,
    pending_plan_number_limit = p_numbers
  where id = p_company_id;
  return 'scheduled';
end;
$$;

create or replace function public.guard_pending_plan_invite_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int;
  v_count int;
begin
  if new.expires_at <= now() or new.accepted_at is not null or new.revoked_at is not null then
    return new;
  end if;

  select pending_plan_seat_limit into v_limit from public.companies
  where id = new.company_id for update;
  if v_limit is null then
    return new;
  end if;

  select (
    select count(*) from public.company_members
    where company_id = new.company_id and deactivated_at is null
  ) + (
    select count(*) from public.invites
    where company_id = new.company_id and id <> new.id and accepted_at is null
      and revoked_at is null and expires_at > now()
  ) into v_count;
  if v_count >= v_limit then
    raise exception 'Pending plan seat limit reached' using errcode = 'P8801';
  end if;
  return new;
end;
$$;

create or replace function public.guard_pending_plan_number_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int;
  v_count int;
begin
  if new.status = 'released' or (tg_op = 'UPDATE' and old.status <> 'released') then
    return new;
  end if;

  select pending_plan_number_limit into v_limit from public.companies
  where id = new.company_id for update;
  if v_limit is null then
    return new;
  end if;

  select count(*) into v_count from public.phone_numbers
  where company_id = new.company_id and id <> new.id and status <> 'released';
  if v_count >= v_limit then
    raise exception 'Pending plan number limit reached' using errcode = 'P8802';
  end if;
  return new;
end;
$$;

create trigger pending_plan_invite_capacity
  before insert or update of expires_at on public.invites
  for each row execute function public.guard_pending_plan_invite_capacity();

create trigger pending_plan_number_capacity
  before insert or update of status on public.phone_numbers
  for each row execute function public.guard_pending_plan_number_capacity();

revoke all on function public.api_record_pending_downgrade(uuid, text, text, timestamptz, int, int, boolean),
  public.guard_pending_plan_invite_capacity(), public.guard_pending_plan_number_capacity()
from public, anon, authenticated;
grant execute on function public.api_record_pending_downgrade(uuid, text, text, timestamptz, int, int, boolean)
to service_role;

create or replace function public.anonymize_purged_workspace(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.companies
     where id = p_company_id and deleted_at is not null
       and purge_after is not null and purge_after <= now()
  ) then
    raise exception 'anonymize_purged_workspace: % is not past its purge window', p_company_id;
  end if;

  update public.companies
     set name = 'Closed workspace',
         stripe_customer_id = null,
         stripe_subscription_id = null,
         pending_plan = null,
         pending_plan_effective_at = null,
         pending_plan_schedule_id = null,
         pending_plan_seat_limit = null,
         pending_plan_number_limit = null,
         telnyx_messaging_profile_id = null,
         chosen_number_e164 = null,
         away_message = null,
         mctb_message = null,
         voicemail_greeting = null,
         cnam_display_name = null,
         emergency_message = null,
         emergency_keywords = null,
         offramp_message = null,
         signup_source = null,
         signup_landing_path = null,
         signup_first_touch = null,
         business_hours = '{}'::jsonb,
         business_hours_exceptions = '[]'::jsonb,
         purge_receipt_email = null,
         purged_at = now()
   where id = p_company_id;

  return jsonb_build_object('outcome', 'anonymized');
end $$;
