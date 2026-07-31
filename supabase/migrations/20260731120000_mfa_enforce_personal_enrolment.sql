-- #496 — "When 2fa is enabled it should be used everywhere??? I am able to
-- login without any 2fa codes even though 2fa is enabled."
--
-- Correct, and the reason is a gap in #314 rather than a bug in it. #314 built
-- two halves and only wired one to enforcement:
--
--   * ENROLMENT is personal and happens against GoTrue directly. It gives the
--     user a factor. GoTrue signs a password login in at `aal1` and expects the
--     APPLICATION to demand the second factor; nothing in GoTrue refuses the
--     session on its own.
--   * ENFORCEMENT was a WORKSPACE policy (`mfa_required_at` + a grace window),
--     checked in `api_authorize_request`.
--
-- So somebody who turned 2FA on for themselves, in a workspace whose owner had
-- not turned on the policy, got a factor and no consequence: password alone
-- opened the whole product, forever. The security control was real and the
-- switch that armed it belonged to somebody else.
--
-- THE RULE THIS ESTABLISHES: enrolling a factor is itself the demand. If a user
-- holds a verified factor, their session must be `aal2` — no workspace policy,
-- no grace window, no owner involved. That is what every product means by
-- "two-factor is on", it is what the person who enrolled believes they bought,
-- and it is the only reading under which the toggle is not decorative.
--
-- The workspace policy keeps its separate meaning: it makes enrolment
-- MANDATORY for a crew, with a grace window to do it in. The two now compose —
-- the policy decides who must enrol, and enrolment decides who must challenge.
--
-- WHY HERE. The check has to run on every request, so it has to be free. It
-- rides the one RPC every /v1 request already makes; a `listFactors` call to
-- GoTrue per request would have added an HTTP hop to the hot path of the whole
-- API. `auth.mfa_factors` is a plain table and this function is already
-- security definer, so it costs one indexed lookup on a key that exists
-- (`factor_id_created_at_idx` leads with user_id).

-- ---------------------------------------------------------------------------
-- Does this user hold a verified second factor?
--
-- Its own function so the fact is readable in one place and testable without
-- standing up a request, mirroring `company_mfa_posture`.
--
-- `status = 'verified'` and not merely present: an enrolment that was started
-- and abandoned leaves an `unverified` row, and treating that as a demand
-- would lock somebody out on the strength of a screen they backed out of.
-- ---------------------------------------------------------------------------
create or replace function public.user_has_verified_mfa(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.mfa_factors f
     where f.user_id = p_user_id
       and f.status = 'verified'
  )
$$;

comment on function public.user_has_verified_mfa(uuid) is
  '#496: whether this user holds a verified MFA factor. Enrolment is the '
  'demand — a user with a factor must reach aal2 regardless of any workspace '
  'policy.';

revoke execute on function public.user_has_verified_mfa(uuid)
  from public, anon, authenticated;
grant execute on function public.user_has_verified_mfa(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The posture, now including the person as well as the workspace.
--
-- `enrolled` is reported for the USER and is therefore independent of the
-- company — which is why it is added to `api_authorize_request` below rather
-- than to `company_mfa_posture`, whose whole subject is one workspace.
-- ---------------------------------------------------------------------------

drop function if exists public.api_authorize_request(
  uuid, uuid, uuid, text, text, text, text, text, text
);

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
  '(#496).';

revoke execute on function public.api_authorize_request(
  uuid, uuid, uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.api_authorize_request(
  uuid, uuid, uuid, text, text, text, text, text, text
) to service_role;
