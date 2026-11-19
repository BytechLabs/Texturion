alter table public.company_members
  add column mfa_policy_notice_for timestamptz,
  add column mfa_policy_reminder_for timestamptz;

-- Existing policies can still send an upcoming reminder.
update public.company_members m
set mfa_policy_notice_for = c.mfa_required_at
from public.companies c
where c.id = m.company_id and c.mfa_required_at is not null;

create or replace function public.api_set_company_mfa(
  p_company_id uuid,
  p_actor uuid,
  p_required boolean,
  p_grace_days int default 14
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_required_at timestamptz;
  v_grace_until timestamptz;
begin
  select owner_user_id, mfa_required_at, mfa_grace_until
  into v_owner, v_required_at, v_grace_until
  from public.companies where id = p_company_id and deleted_at is null
  for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_owner is distinct from p_actor then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if not p_required then
    update public.companies
    set mfa_required_at = null, mfa_grace_until = null, updated_at = now()
    where id = p_company_id;
    return jsonb_build_object('outcome', 'off');
  end if;
  if v_required_at is not null then
    return jsonb_build_object('outcome', 'on', 'grace_until', v_grace_until);
  end if;

  v_grace_until := now() + make_interval(days => greatest(p_grace_days, 0));
  update public.companies
  set mfa_required_at = now(), mfa_grace_until = v_grace_until, updated_at = now()
  where id = p_company_id;
  return jsonb_build_object('outcome', 'on', 'grace_until', v_grace_until, 'changed', true);
end;
$$;

create or replace function public.claim_workspace_mfa_notices(
  p_now timestamptz,
  p_company_id uuid default null
) returns table (
  member_id uuid,
  required_at timestamptz,
  grace_until timestamptz,
  kind text,
  email text,
  workspace_name text,
  locale text,
  timezone text
)
language sql
security definer
set search_path = ''
as $$
  with due as (
    select m.id, c.mfa_required_at, c.mfa_grace_until, c.name, c.locale, c.timezone,
      u.email::text,
      case when m.created_at <= c.mfa_required_at
        and m.mfa_policy_notice_for is distinct from c.mfa_required_at
        then 'enabled'
        else 'reminder'
      end as kind
    from public.companies c
    join public.company_members m on m.company_id = c.id
    join auth.users u on u.id = m.user_id
    where c.deleted_at is null and m.deactivated_at is null
      and u.email is not null and u.email_confirmed_at is not null
      and c.mfa_required_at <= p_now
      and (p_company_id is null or c.id = p_company_id)
      and (
        (m.created_at <= c.mfa_required_at and m.mfa_policy_notice_for is distinct from c.mfa_required_at)
        or (
          p_company_id is null
          and c.mfa_grace_until > p_now and c.mfa_grace_until <= p_now + interval '48 hours'
          and m.mfa_policy_reminder_for is distinct from c.mfa_required_at
          and not public.user_has_verified_mfa(m.user_id)
        )
      )
    order by c.mfa_grace_until nulls last, c.mfa_required_at, m.id
    limit 30
    for update of m skip locked
  )
  update public.company_members m
  set mfa_policy_notice_for = case
        when due.kind = 'enabled' then due.mfa_required_at else m.mfa_policy_notice_for end,
      mfa_policy_reminder_for = case
        when due.kind = 'reminder' then due.mfa_required_at else m.mfa_policy_reminder_for end
  from due
  where m.id = due.id
  returning m.id, due.mfa_required_at, due.mfa_grace_until, due.kind,
    due.email, due.name, due.locale, due.timezone;
$$;

create or replace function public.release_workspace_mfa_notice(
  p_member_id uuid,
  p_required_at timestamptz,
  p_kind text
) returns void
language sql
security definer
set search_path = ''
as $$
  update public.company_members
  set mfa_policy_notice_for = case when p_kind = 'enabled' then null else mfa_policy_notice_for end,
      mfa_policy_reminder_for = case when p_kind = 'reminder' then null else mfa_policy_reminder_for end
  where id = p_member_id
    and (
      (p_kind = 'enabled' and mfa_policy_notice_for = p_required_at)
      or (p_kind = 'reminder' and mfa_policy_reminder_for = p_required_at)
    );
$$;

create or replace function public.workspace_mfa_progress(p_company_id uuid, p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enrolled', public.user_has_verified_mfa(p_user_id),
    'grace_until', c.mfa_grace_until,
    'team', case when c.owner_user_id = p_user_id then (
      select jsonb_build_object(
        'enrolled', count(*) filter (where public.user_has_verified_mfa(m.user_id)),
        'total', count(*)
      )
      from public.company_members m
      where m.company_id = c.id and m.deactivated_at is null
    ) end
  )
  from public.companies c
  join public.company_members viewer on viewer.company_id = c.id and viewer.user_id = p_user_id
  where c.id = p_company_id and c.deleted_at is null and c.mfa_required_at is not null
    and viewer.deactivated_at is null;
$$;

revoke all on function public.claim_workspace_mfa_notices(timestamptz, uuid),
  public.release_workspace_mfa_notice(uuid, timestamptz, text),
  public.workspace_mfa_progress(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.claim_workspace_mfa_notices(timestamptz, uuid),
  public.release_workspace_mfa_notice(uuid, timestamptz, text),
  public.workspace_mfa_progress(uuid, uuid)
to service_role;
