-- #339 — what version everyone is running, and the ability to ask them to move.
--
-- Grepping all three clients for version negotiation returned exactly one
-- match: Android showing its own version to the user. Nothing was sent, known
-- or enforced. So a fixed bug stays broken on the phone that has it, a security
-- fix cannot be required, and a mobile release has no adoption curve — we could
-- not answer "does everyone have the fix?" with anything but a hope.
--
-- Two pieces, and they are deliberately separate:
--
--   1. OBSERVATION. `user_sessions.app_version`, written by the same
--      `api_authorize_request` round trip that already records which app and
--      roughly where. No new write path, no new request cost, and the
--      distribution falls out of a table that already exists.
--   2. POLICY. `app_release_policy`, one row per platform, read by a PUBLIC
--      endpoint. A floor that lives in a build cannot be lowered without
--      shipping a build — which is the exact failure it exists to fix.
--
-- The dangerous half is the floor, and D71 governs it. This migration ships
-- with every floor NULL: the mechanism exists, and enforcement is off until
-- somebody decides otherwise, in writing.

-- ---------------------------------------------------------------------------
-- 1. What version each session is running.
-- ---------------------------------------------------------------------------

alter table public.user_sessions
  add column if not exists app_version text
    check (app_version is null or app_version ~ '^[0-9]{1,4}(\.[0-9]{1,4}){0,3}$');

comment on column public.user_sessions.app_version is
  '#339: the client build behind this session, from X-App-Version. NULL for a '
  'build that predates the header — which is most of them on day one, and is '
  'itself the number worth watching as it falls.';

-- Distribution is asked "per platform, among sessions seen recently", so the
-- index leads with what is filtered and carries what is grouped.
create index if not exists user_sessions_version_idx
  on public.user_sessions (client, app_version)
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- 2. The release policy: what we ask for, and what we insist on.
-- ---------------------------------------------------------------------------

create table if not exists public.app_release_policy (
  platform            text primary key check (platform in ('web', 'android', 'ios')),
  -- Below this, the client says an update is available. Dismissible, costs
  -- nobody anything, and covers essentially every real case.
  recommended_version text check (recommended_version is null or
                        recommended_version ~ '^[0-9]{1,4}(\.[0-9]{1,4}){0,3}$'),
  -- Below this, the client stops. This takes somebody's business phone away
  -- until they act, so it stays NULL until a specific incident justifies it
  -- (D71) and it is set by an ops script that makes the blast radius visible
  -- BEFORE the write.
  minimum_version     text check (minimum_version is null or
                        minimum_version ~ '^[0-9]{1,4}(\.[0-9]{1,4}){0,3}$'),
  -- Why, in the customer's words. Shown on both the prompt and the block: an
  -- update demand with no reason reads as an ad for our own convenience.
  message             text,
  -- Where the update lives. Per-platform because the answer differs (a store
  -- listing, a reload) and hardcoding three URLs in three clients means three
  -- releases to fix a typo.
  update_url          text,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id) on delete set null
);

comment on table public.app_release_policy is
  '#339/D71: per-platform update policy, read by the PUBLIC GET /app-release. '
  'Server-controlled so a floor can be lowered without shipping a build.';

-- The floor and the ask cannot cross. Catching it here rather than in the
-- setter means it holds for a hand-written UPDATE at 3am too, which is when a
-- floor is most likely to be typed by hand.
alter table public.app_release_policy
  drop constraint if exists app_release_policy_floor_not_above_ask;

-- ---------------------------------------------------------------------------
-- 3. Comparing versions, in SQL, once.
--
-- The clients each need this too and each will hand-port it. Here it exists so
-- the constraint and the ops script agree with them, and so "is 1.10.0 newer
-- than 1.9.0" is answered by padded integer segments rather than by a string
-- compare, which says no.
-- ---------------------------------------------------------------------------

create or replace function public.version_key(p_version text)
returns int[]
language sql
immutable
set search_path = ''
as $$
  select case
    when p_version is null or p_version !~ '^[0-9]{1,4}(\.[0-9]{1,4}){0,3}$' then null
    else (
      select array[
        coalesce(parts[1]::int, 0),
        coalesce(parts[2]::int, 0),
        coalesce(parts[3]::int, 0),
        coalesce(parts[4]::int, 0)
      ]
      from (select string_to_array(p_version, '.') as parts) s
    )
  end;
$$;

comment on function public.version_key(text) is
  '#339: a version as four comparable integers. NULL for anything unparseable, '
  'so a malformed version can never accidentally compare as newer.';

alter table public.app_release_policy
  add constraint app_release_policy_floor_not_above_ask
  check (
    minimum_version is null
    or recommended_version is null
    or public.version_key(minimum_version) <= public.version_key(recommended_version)
  );

-- Seed one row per platform with everything NULL: the mechanism is live and
-- says nothing, which is the correct posture on day one.
insert into public.app_release_policy (platform)
values ('web'), ('android'), ('ios')
on conflict (platform) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Reading the policy. PUBLIC on purpose.
--
-- The endpoint that carries "you must update" cannot require a working
-- session, because the reason for the demand may BE that sessions are broken
-- in the old build (#268 signs the user out on a transient refresh failure).
-- An update gate reachable only by clients that do not need it is not a gate.
--
-- Nothing here is sensitive: it is three version strings and a store URL,
-- which every copy of the app would learn on first launch anyway.
-- ---------------------------------------------------------------------------

create or replace function public.api_app_release_policy(p_platform text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object(
       'platform', p.platform,
       'recommended_version', p.recommended_version,
       'minimum_version', p.minimum_version,
       'message', p.message,
       'update_url', p.update_url
     )
     from public.app_release_policy p
     where p.platform = p_platform),
    -- An unknown platform gets a well-formed answer with no demands rather
    -- than an error: a client that cannot parse the response must never be a
    -- client that blocks itself.
    jsonb_build_object(
      'platform', p_platform,
      'recommended_version', null,
      'minimum_version', null,
      'message', null,
      'update_url', null
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. Setting the policy, with the blast radius attached.
--
-- Returns how many live sessions the new floor would block, computed against
-- the same table the clients report into. The number is the point: raising a
-- floor is a decision about people, and the ops script prints this before it
-- is asked to confirm.
-- ---------------------------------------------------------------------------

create or replace function public.api_set_release_policy(
  p_platform    text,
  p_recommended text default null,
  p_minimum     text default null,
  p_message     text default null,
  p_update_url  text default null,
  p_actor       uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blocked int;
  v_total   int;
begin
  if p_platform not in ('web', 'android', 'ios') then
    raise exception 'api_set_release_policy: unknown platform %', p_platform;
  end if;

  update public.app_release_policy p
     set recommended_version = p_recommended,
         minimum_version     = p_minimum,
         message             = p_message,
         update_url          = p_update_url,
         updated_at          = now(),
         updated_by          = p_actor
   where p.platform = p_platform;

  select
    count(*) filter (
      where p_minimum is not null
        and (s.app_version is null
             or public.version_key(s.app_version) < public.version_key(p_minimum))
    ),
    count(*)
    into v_blocked, v_total
    from public.user_sessions s
   where s.client = p_platform
     and s.revoked_at is null
     and s.last_seen_at > now() - interval '30 days';

  return jsonb_build_object(
    'platform', p_platform,
    'blocked_sessions', v_blocked,
    'active_sessions', v_total
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The adoption curve.
--
-- "Everyone has the fix" becomes a statement of fact, per platform, over the
-- sessions seen in the window. NULL versions are reported as their own bucket
-- rather than dropped — the un-upgraded population is exactly what this is for.
-- ---------------------------------------------------------------------------

create or replace function public.api_version_distribution(p_days int default 30)
returns table (
  platform  text,
  version   text,
  sessions  bigint,
  users     bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.client as platform,
    s.app_version as version,
    count(*) as sessions,
    count(distinct s.user_id) as users
  from public.user_sessions s
  where s.revoked_at is null
    and s.last_seen_at > now() - make_interval(days => greatest(p_days, 1))
  group by s.client, s.app_version
  order by s.client, public.version_key(s.app_version) desc nulls last;
$$;

-- ---------------------------------------------------------------------------
-- Grants. `api_app_release_policy` is reachable by anon BECAUSE the endpoint
-- serving it is public — see §4. Everything that WRITES stays service_role.
-- ---------------------------------------------------------------------------

revoke all on function public.version_key(text) from public, anon, authenticated;
grant execute on function public.version_key(text) to service_role;

revoke all on function public.api_app_release_policy(text) from public, anon, authenticated;
grant execute on function public.api_app_release_policy(text) to service_role;

revoke all on function public.api_set_release_policy(text, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.api_set_release_policy(text, text, text, text, text, uuid)
  to service_role;

revoke all on function public.api_version_distribution(int) from public, anon, authenticated;
grant execute on function public.api_version_distribution(int) to service_role;

alter table public.app_release_policy enable row level security;
revoke all on table public.app_release_policy from public, anon, authenticated;
grant select, insert, update on table public.app_release_policy to service_role;

-- ---------------------------------------------------------------------------
-- 7. Record the version on the round trip that already runs.
--
-- `api_authorize_request` is the one RPC every /v1 request makes (#236). The
-- version rides it rather than taking a write of its own, so observing what
-- everyone runs costs nothing per request — and it inherits the same
-- two-minute throttle, which is well inside the time it takes somebody to
-- install an update.
--
-- Replaced in full rather than patched: the signature gains a parameter, and a
-- default keeps every existing caller (and any request in flight during the
-- deploy) working unchanged.
-- ---------------------------------------------------------------------------

-- DROP FIRST. `create or replace` does not replace a function whose argument
-- LIST differs — it creates an overload. With the new parameter defaulted, an
-- eight-argument call then matches both and Postgres refuses it as ambiguous
-- ("function ... is not unique"), which would have taken down authorization for
-- every request the moment this deployed. The old signature has to go.
drop function if exists public.api_authorize_request(
  uuid, uuid, uuid, text, text, text, text, text
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

  return jsonb_build_object(
    'session_revoked', false,
    'session_new', v_new,
    'member', v_member,
    -- #314: the workspace's MFA posture rides the same answer. Null when no
    -- company was named — there is no workspace policy to apply to a route
    -- that is not scoped to one.
    'mfa', case when p_company_id is null then null
                else public.company_mfa_posture(p_company_id) end
  );
end;
$$;

revoke all on function public.api_authorize_request(uuid, uuid, uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.api_authorize_request(uuid, uuid, uuid, text, text, text, text, text, text)
  to service_role;
