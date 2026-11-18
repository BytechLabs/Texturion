alter table public.companies
  add column invite_attempts_at timestamptz[] not null default '{}';

create index invites_recent_revocations_idx on public.invites (company_id, email, revoked_at)
  where revoked_at is not null;

create or replace function public.api_create_invite(
  p_company_id uuid,
  p_invited_by uuid,
  p_email text,
  p_role public.member_role,
  p_note text,
  p_plan text,
  p_seats integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_plan text;
  v_active integer;
  v_pending integer;
  v_attempts timestamptz[];
  v_invite public.invites%rowtype;
  v_previous_expiration timestamptz;
begin
  select plan::text, invite_attempts_at into v_plan, v_attempts
  from public.companies
  where id = p_company_id and deleted_at is null
  for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_plan is distinct from p_plan then
    return jsonb_build_object('outcome', 'plan_changed');
  end if;

  select * into v_invite from public.invites
  where company_id = p_company_id and email operator(extensions.=) p_email::extensions.citext
    and accepted_at is null and revoked_at is null
  for update;

  if v_invite.id is not null and v_invite.expires_at > v_now then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  if exists (
    select 1 from public.invites
    where company_id = p_company_id and email operator(extensions.=) p_email::extensions.citext
      and revoked_at > v_now - interval '10 minutes'
  ) then
    return jsonb_build_object('outcome', 'revoke_cooldown');
  end if;

  select array(select stamp from unnest(v_attempts) as stamp where stamp > v_now - interval '24 hours')
    into v_attempts;
  if cardinality(v_attempts) >= 3 * p_seats then
    return jsonb_build_object('outcome', 'daily_limit');
  end if;

  -- One snapshot includes both counts even when an invite is being accepted.
  select (
    select count(*) from public.company_members
    where company_id = p_company_id and deactivated_at is null
  ), (
    select count(*) from public.invites
    where company_id = p_company_id and accepted_at is null and revoked_at is null
      and expires_at > v_now
  ) into v_active, v_pending;

  if v_active + v_pending >= p_seats then
    return jsonb_build_object('outcome', 'seat_limit', 'active', v_active, 'pending', v_pending);
  end if;

  if v_invite.id is null then
    insert into public.invites (company_id, invited_by, email, role, note)
    values (p_company_id, p_invited_by, p_email::extensions.citext, p_role, p_note)
    returning * into v_invite;
  else
    v_previous_expiration := v_invite.expires_at;
    update public.invites
    set invited_by = p_invited_by, role = p_role, note = p_note, expires_at = v_now + interval '7 days'
    where id = v_invite.id
    returning * into v_invite;
  end if;

  update public.companies
  set invite_attempts_at = array_append(v_attempts, v_now)
  where id = p_company_id;

  return jsonb_build_object(
    'outcome', 'created',
    'invite', jsonb_build_object(
      'id', v_invite.id,
      'company_id', v_invite.company_id,
      'email', v_invite.email,
      'role', v_invite.role,
      'invited_by', v_invite.invited_by,
      'expires_at', v_invite.expires_at,
      'accepted_at', v_invite.accepted_at,
      'revoked_at', v_invite.revoked_at,
      'created_at', v_invite.created_at,
      'note', v_invite.note
    ),
    'previous_expiration', v_previous_expiration
  );
end;
$$;

revoke all on function public.api_create_invite(uuid, uuid, text, public.member_role, text, text, integer)
from public, anon, authenticated;
grant execute on function public.api_create_invite(uuid, uuid, text, public.member_role, text, text, integer)
to service_role;
