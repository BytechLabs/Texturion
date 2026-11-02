-- A deleted account's token is refused with a 401, not a 500.
--
-- A deleted user's access token stays valid until it expires (up to an hour).
-- The first request on it reached `api_authorize_request`, found no
-- `user_sessions` row (the delete had cascaded it away) and tried to record the
-- session, which broke the foreign key to `auth.users` and surfaced as a 500.
--
-- The function now looks for the user before it records a session and answers
-- `session_revoked`, the same answer a signed-out device gets, which the API
-- already turns into a 401. Nothing else about the function changes.

create or replace function public.api_authorize_request(
  p_user_id     uuid,
  p_session_id  uuid,
  p_company_id  uuid    default null,
  p_client      text    default null,
  p_user_agent  text    default null,
  p_country     text    default null,
  p_region      text    default null,
  p_city        text    default null,
  p_app_version text    default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client    text;
  v_version   text;
  v_revoked   timestamptz;
  v_seen      timestamptz;
  v_new       boolean := false;
  v_member    jsonb   := null;
  v_mfa       jsonb   := null;
begin
  if p_user_id is null then
    raise exception 'api_authorize_request: p_user_id is required';
  end if;

  v_client := coalesce(nullif(p_client, ''), 'unknown');
  if v_client not in ('web', 'android', 'ios') then
    v_client := 'unknown';
  end if;

  -- A header is attacker-controlled and this column feeds a CHECK. Anything
  -- unparseable becomes NULL — "we do not know" — rather than failing the
  -- request, because a malformed version must never cost somebody their
  -- session.
  v_version := nullif(p_app_version, '');
  if v_version is not null and v_version !~ '^[0-9]{1,4}(\.[0-9]{1,4}){0,3}$' then
    v_version := null;
  end if;

  if p_session_id is not null then
    select s.revoked_at, s.last_seen_at into v_revoked, v_seen
      from public.user_sessions s
     where s.session_id = p_session_id;

    if not found then
      if not exists (select 1 from auth.users u where u.id = p_user_id) then
        return jsonb_build_object('session_revoked', true, 'session_new', false,
                                  'member', null, 'mfa', null);
      end if;

      insert into public.user_sessions (
        session_id, user_id, client, user_agent, ip_country, ip_region, ip_city,
        app_version
      ) values (
        p_session_id, p_user_id, v_client, p_user_agent, p_country, p_region, p_city,
        v_version
      )
      on conflict (session_id) do nothing;
      v_new := found;
    elsif v_revoked is null and v_seen < now() - interval '2 minutes' then
      update public.user_sessions s
         set last_seen_at = now(),
             client       = case when v_client = 'unknown' then s.client else v_client end,
             user_agent   = coalesce(p_user_agent, s.user_agent),
             ip_country   = coalesce(p_country, s.ip_country),
             ip_region    = coalesce(p_region, s.ip_region),
             ip_city      = coalesce(p_city, s.ip_city),
             -- coalesce, so a request that omits the header does not erase a
             -- version we already learned. An UPGRADE overwrites, which is the
             -- direction that matters: the adoption curve has to be able to move.
             app_version  = coalesce(v_version, s.app_version)
       where s.session_id = p_session_id;
    end if;
  end if;

  if v_revoked is not null then
    return jsonb_build_object('session_revoked', true, 'session_new', false,
                              'member', null, 'mfa', null);
  end if;

  if p_company_id is not null then
    select jsonb_build_object('id', m.id, 'role', m.role) into v_member
      from public.company_members m
     where m.company_id = p_company_id
       and m.user_id = p_user_id
       and m.deactivated_at is null
     limit 1;
  end if;

  -- #314 the workspace's posture; #496 the person's. Computed together because
  -- the caller applies them together, and skipped entirely when no company was
  -- named: those routes are the ones that get somebody OUT of an MFA state
  -- (recovery, the factor list, signing a lost device out), and a gate with no
  -- exit is an outage with a good reason attached.
  if p_company_id is not null then
    v_mfa := public.company_mfa_posture(p_company_id)
             || jsonb_build_object(
                  'enrolled', public.user_has_verified_mfa(p_user_id));
  end if;

  return jsonb_build_object(
    'session_revoked', false,
    'session_new', v_new,
    'member', v_member,
    'mfa', v_mfa
  );
end $$;

comment on function public.api_authorize_request(
  uuid, uuid, uuid, text, text, text, text, text, text
) is
  'The one authorization round trip per /v1 request (#236): session validity, '
  'membership, and the MFA posture of both the workspace (#314) and the user '
  '(#496). A token whose user no longer exists reads as revoked.';

-- A recreated function regains PUBLIC execute unless it is revoked first.
revoke execute on function public.api_authorize_request(
  uuid, uuid, uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.api_authorize_request(
  uuid, uuid, uuid, text, text, text, text, text, text
) to service_role;
