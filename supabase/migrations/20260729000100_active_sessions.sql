-- ===========================================================================
-- [#236] Active sessions and devices.
--
-- #276 already ends a person's sessions when they are offboarded: it deletes
-- the GoTrue rows, so the refresh token has nothing to refresh against. What
-- it CANNOT do is end the access token already in the phone's memory — that
-- one keeps working until it expires, up to an hour later. For an hour after
-- "you are removed", a departed tech's phone still reads and sends as the
-- business. That hour is the bug.
--
-- Nor could anybody SEE any of this. There was no answer to "what is signed
-- in right now", so an owner had no way to notice the phone that walked out
-- the door, and a person had no way to spot a sign-in that was not theirs.
--
-- ---------------------------------------------------------------------------
-- WHY A MIRROR TABLE
--
-- `auth.sessions` is GoTrue's, and it holds only what GoTrue happens to have
-- written at sign-in: a user agent and an IP. It cannot answer "which app",
-- "still active five minutes ago?", "who killed this and why". And it is in
-- the `auth` schema, so nothing reaches it without a definer function anyway.
--
-- So we keep our own row per session, keyed on the `session_id` claim that
-- rides inside every Supabase access token. Two things follow, and they are
-- the whole point:
--
--   1. REVOCATION LANDS ON THE NEXT REQUEST. The middleware already makes one
--      round trip per request to resolve company membership. That same call
--      now also reads this row, so a revoked session fails its very next API
--      call — no waiting out the token, no extra latency.
--
--   2. THE PUSH TOKEN DIES WITH THE SESSION. `device_push_tokens` and
--      `push_subscriptions` gain a session_id, so revoking one device stops
--      the customer's message text appearing on THAT phone's lock screen
--      while leaving the owner's own laptop alone. Previously the only
--      granularity was "delete every device this person has".
--
-- The claim is inside a signed token, so a caller cannot strip it to dodge
-- the check. A token minted before this shipped simply has no row here yet;
-- the first request creates one (see the backfill at the bottom, which seeds
-- every session that already exists).
-- ===========================================================================

create table if not exists public.user_sessions (
  -- The `session_id` claim from the Supabase access token — GoTrue's
  -- auth.sessions.id. Not a fresh key of our own: the whole mechanism is that
  -- a request can look itself up by what its own token says.
  session_id    uuid primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- Which app, from the X-Client header. 'unknown' covers a client that
  -- predates the header (it is added to all three at the same time, but an
  -- un-updated mobile build can outlive a deploy by weeks).
  client        text not null default 'unknown'
                  check (client in ('web', 'android', 'ios', 'unknown')),
  user_agent    text,
  -- Approximate location, from Cloudflare's request geo — NOT from a lookup
  -- against the IP GoTrue stored. We already have this for free on every
  -- request, it is fresher (it follows the device), and it keeps us from
  -- storing a raw IP address for a purpose that only ever needed a city.
  ip_country    text,
  ip_region     text,
  ip_city       text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users(id) on delete set null,
  revoke_reason text check (revoke_reason in (
    'self',            -- the person killed this one device
    'sign_out_all',    -- the person signed out everywhere
    'admin',           -- an owner/admin killed somebody else's session
    'member_removed',  -- offboarding (#276)
    'account_deleted'  -- account deletion (#346)
  ))
);

comment on table public.user_sessions is
  '#236: one row per Supabase auth session, keyed on the token''s session_id claim. Read on every authenticated request so a revocation takes effect on the next call rather than when the access token expires.';

-- The sessions list, newest activity first, per person.
create index if not exists user_sessions_user_idx
  on public.user_sessions (user_id, last_seen_at desc);

-- Deny-by-default (20260701000300_rls.sql posture): anon/authenticated have no
-- grants, so RLS with no policies exposes nothing over PostgREST. The Worker
-- reaches it through the definer functions below.
alter table public.user_sessions enable row level security;

-- ---------------------------------------------------------------------------
-- Push rows learn which session registered them.
--
-- Nullable, and it stays nullable: a token registered before this shipped has
-- no session to point at, and forcing one would mean deleting live
-- registrations to add a column. Those legacy rows keep the old behaviour
-- (they die with the person, not with one device) until the app re-registers,
-- which every app does on its next cold start.
-- ---------------------------------------------------------------------------
alter table public.device_push_tokens
  add column if not exists session_id uuid
    references public.user_sessions(session_id) on delete cascade;
alter table public.push_subscriptions
  add column if not exists session_id uuid
    references public.user_sessions(session_id) on delete cascade;

create index if not exists device_push_tokens_session_idx
  on public.device_push_tokens (session_id) where session_id is not null;
create index if not exists push_subscriptions_session_idx
  on public.push_subscriptions (session_id) where session_id is not null;

-- ---------------------------------------------------------------------------
-- THE HOT PATH: one round trip that authorizes the request and records the
-- session in the same breath.
--
-- Called from auth/company.ts for EVERY /v1 request. It replaces the
-- `company_members` select that middleware already made, so the session check
-- costs no extra round trip — which is the only reason it can afford to be
-- per-request rather than cached, and being per-request is the whole promise
-- ("takes effect on the next request").
--
-- p_company_id is null on the company-exempt routes (GET /v1/me, invite
-- accept, device-push-token registration...); the session half still runs,
-- because those routes are exactly where a revoked device would otherwise
-- keep breathing.
--
-- The last_seen write is throttled to a couple of minutes so a busy client
-- polling the inbox does not turn every read into a write.
-- ---------------------------------------------------------------------------
create or replace function public.api_authorize_request(
  p_user_id    uuid,
  p_session_id uuid,
  p_company_id uuid    default null,
  p_client     text    default null,
  p_user_agent text    default null,
  p_country    text    default null,
  p_region     text    default null,
  p_city       text    default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client    text;
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

  if p_session_id is not null then
    select s.revoked_at, s.last_seen_at into v_revoked, v_seen
      from public.user_sessions s
     where s.session_id = p_session_id;

    if not found then
      -- First sight of this session. `on conflict do nothing` because two
      -- requests from the same fresh sign-in can race here.
      insert into public.user_sessions (
        session_id, user_id, client, user_agent, ip_country, ip_region, ip_city
      ) values (
        p_session_id, p_user_id, v_client, p_user_agent, p_country, p_region, p_city
      )
      on conflict (session_id) do nothing;
      -- Only a row we actually inserted counts as a new device, so a race
      -- cannot produce two "new sign-in" emails for one sign-in.
      v_new := found;
    elsif v_revoked is null and v_seen < now() - interval '2 minutes' then
      update public.user_sessions s
         set last_seen_at = now(),
             client       = case when v_client = 'unknown' then s.client else v_client end,
             user_agent   = coalesce(p_user_agent, s.user_agent),
             ip_country   = coalesce(p_country, s.ip_country),
             ip_region    = coalesce(p_region, s.ip_region),
             ip_city      = coalesce(p_city, s.ip_city)
       where s.session_id = p_session_id;
    end if;
  end if;

  if v_revoked is not null then
    -- Short-circuit: a revoked session gets no membership answer at all, so a
    -- caller cannot learn anything about the workspace from the 401.
    return jsonb_build_object('session_revoked', true, 'session_new', false, 'member', null);
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
    'member', v_member
  );
end $$;

revoke execute on function public.api_authorize_request(
  uuid, uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.api_authorize_request(
  uuid, uuid, uuid, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- The list. One person's sessions, or a whole workspace's.
--
-- Joins GoTrue so the list is HONEST rather than optimistic: a session the
-- person ended from the app itself (GoTrue deletes the row, we never hear
-- about it) must not sit in the list looking alive. `revoked_at is null AND
-- the GoTrue row still exists` is the definition of live, and only live rows
-- come back.
-- ---------------------------------------------------------------------------
create or replace function public.api_list_user_sessions(
  p_user_ids uuid[],
  p_limit    int default 200
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.last_seen_at desc), '[]'::jsonb)
    from (
      select s.session_id,
             s.user_id,
             s.client,
             s.user_agent,
             s.ip_country,
             s.ip_region,
             s.ip_city,
             s.first_seen_at,
             s.last_seen_at,
             -- GoTrue's own view of when the session started. Ours can be
             -- later (the backfill stamped first_seen_at at migration time).
             a.created_at as signed_in_at
        from public.user_sessions s
        join auth.sessions a on a.id = s.session_id
       where s.user_id = any(p_user_ids)
         and s.revoked_at is null
       order by s.last_seen_at desc
       limit greatest(p_limit, 1)
    ) t
$$;

revoke execute on function public.api_list_user_sessions(uuid[], int)
  from public, anon, authenticated;
grant execute on function public.api_list_user_sessions(uuid[], int) to service_role;

-- ---------------------------------------------------------------------------
-- Revocation, in one place, for every caller: sign out one device, sign out
-- everywhere, offboard a member, delete an account.
--
--   p_session_ids  null = every session this person has
--   p_except       a session to spare — "everywhere ELSE", so signing out
--                  everywhere does not sign you out of the browser you are
--                  looking at
--
-- Three things happen together, and all three matter:
--   * our row is marked revoked, which is what the middleware reads (the
--     "next request" half);
--   * the GoTrue row goes, so the refresh token has nothing to refresh
--     against (the "cannot come back" half);
--   * the push registrations tied to those sessions go, so a revoked phone
--     stops receiving customer message text in a notification (the sharpest
--     part of #236).
--
-- Deliberately NOT touched: calls in flight. A live call is a leg between the
-- carrier and a person, and the customer on the other end did nothing wrong —
-- hanging up on them to make a security point would strand the caller
-- mid-sentence. The session cannot start another one, which is the part that
-- matters.
-- ---------------------------------------------------------------------------
create or replace function public.api_revoke_sessions(
  p_user_id     uuid,
  p_session_ids uuid[] default null,
  p_except      uuid   default null,
  p_actor       uuid   default null,
  p_reason      text   default 'self'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_targets uuid[];
  v_devices int := 0;
  v_subs    int := 0;
  v_n       int := 0;
  v_whole   boolean := (p_session_ids is null and p_except is null);
begin
  if p_user_id is null then
    raise exception 'api_revoke_sessions: p_user_id is required';
  end if;

  -- Resolve targets against OUR table first, so a caller can only ever revoke
  -- sessions belonging to the user they named.
  select coalesce(array_agg(s.session_id), '{}'::uuid[])
    into v_targets
    from public.user_sessions s
   where s.user_id = p_user_id
     and s.revoked_at is null
     and (p_session_ids is null or s.session_id = any(p_session_ids))
     and (p_except is null or s.session_id <> p_except);

  -- A session GoTrue knows about that we have never seen (minted before this
  -- shipped, never used since) still has to die on a sign-out-everywhere.
  -- Adopt those rows so the mark lands on them too.
  if p_session_ids is null then
    insert into public.user_sessions (session_id, user_id, client, user_agent, first_seen_at, last_seen_at)
    select a.id, a.user_id, 'unknown', a.user_agent, a.created_at, coalesce(a.refreshed_at, a.created_at)
      from auth.sessions a
     where a.user_id = p_user_id
       and (p_except is null or a.id <> p_except)
       and not exists (select 1 from public.user_sessions s where s.session_id = a.id)
    on conflict (session_id) do nothing;

    select coalesce(array_agg(s.session_id), '{}'::uuid[])
      into v_targets
      from public.user_sessions s
     where s.user_id = p_user_id
       and s.revoked_at is null
       and (p_except is null or s.session_id <> p_except);
  end if;

  if array_length(v_targets, 1) is null then
    return jsonb_build_object('sessions', 0, 'devices', 0);
  end if;

  update public.user_sessions s
     set revoked_at = now(), revoked_by = p_actor, revoke_reason = p_reason
   where s.session_id = any(v_targets);
  get diagnostics v_n = row_count;

  -- The device stops being reachable. Legacy rows with no session_id are only
  -- swept when the whole person is being revoked — otherwise "sign out my old
  -- tablet" would silently unsubscribe the laptop in front of them.
  with gone as (
    delete from public.device_push_tokens d
     where d.session_id = any(v_targets)
        or (v_whole and d.user_id = p_user_id)
    returning 1
  ) select count(*) into v_devices from gone;
  with gone as (
    delete from public.push_subscriptions p
     where p.session_id = any(v_targets)
        or (v_whole and p.user_id = p_user_id)
    returning 1
  ) select count(*) into v_subs from gone;

  delete from auth.sessions a where a.id = any(v_targets);
  -- refresh_tokens cascade from sessions in GoTrue's schema; delete them
  -- explicitly too, since older rows can predate the session FK (those carry
  -- no session_id, so they are only reachable when the whole person is being
  -- revoked — never when one device is).
  delete from auth.refresh_tokens r
   where r.user_id = p_user_id::text
     and ((v_whole and r.session_id is null)
          or r.session_id = any(v_targets));

  return jsonb_build_object('sessions', v_n, 'devices', v_devices + v_subs);
end $$;

revoke execute on function public.api_revoke_sessions(uuid, uuid[], uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.api_revoke_sessions(uuid, uuid[], uuid, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- #276's entry point keeps its name and its signature — team.ts and
-- delete_account both call it — but it now goes through the machinery above,
-- so an offboarded member's phone fails its NEXT request instead of its next
-- hour, and loses push in the same statement.
-- ---------------------------------------------------------------------------
create or replace function public.api_revoke_user_sessions(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_user_id is null then
    raise exception 'api_revoke_user_sessions: p_user_id is required';
  end if;
  v_result := public.api_revoke_sessions(
    p_user_id => p_user_id,
    p_session_ids => null,
    p_except => null,
    p_actor => null,
    p_reason => 'member_removed'
  );
  return (v_result ->> 'sessions')::int;
end $$;

revoke execute on function public.api_revoke_user_sessions(uuid)
  from public, anon, authenticated;
grant execute on function public.api_revoke_user_sessions(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The reaper. A revoked or dead session row is evidence for exactly as long
-- as somebody might look at it; after that it is a row that grows forever.
-- Runs from the same daily maintenance cron as the other prunes.
-- ---------------------------------------------------------------------------
create or replace function public.api_prune_user_sessions(p_before timestamptz)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted int;
begin
  delete from public.user_sessions s
   where s.last_seen_at < p_before
     and (s.revoked_at is not null
          or not exists (select 1 from auth.sessions a where a.id = s.session_id));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke execute on function public.api_prune_user_sessions(timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_prune_user_sessions(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Backfill: every session that exists right now.
--
-- Without this, the first request from an already-signed-in device would
-- create its row and report it as a NEW DEVICE SIGN-IN — an email to every
-- customer, about themselves, on deploy day. Seeding first.
-- ---------------------------------------------------------------------------
insert into public.user_sessions (
  session_id, user_id, client, user_agent, first_seen_at, last_seen_at
)
select a.id, a.user_id, 'unknown', a.user_agent, a.created_at,
       coalesce(a.refreshed_at, a.updated_at, a.created_at)
  from auth.sessions a
on conflict (session_id) do nothing;
