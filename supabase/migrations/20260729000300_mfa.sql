-- ===========================================================================
-- [#314] A second factor, and the recovery that makes it safe to turn on.
--
-- A compromised member account is not a data breach in the ordinary sense. It
-- is control of the business's identity with its own customers: every
-- conversation, every contact with an address, and the ability to text a
-- homeowner FROM THE PLUMBER'S REAL NUMBER asking them to re-send payment
-- somewhere else. The customer has no way to detect that, because the number
-- is genuine.
--
-- ---------------------------------------------------------------------------
-- WHAT LIVES HERE, AND WHAT DELIBERATELY DOES NOT
--
-- Enrolment and verification are Supabase's (`auth.mfa.enroll` / `.challenge`
-- / `.verify`), done by the client against GoTrue directly. That is the D8
-- boundary — the Worker never brokers login — and it is also the right call
-- on the merits: the cryptography is not the work here, the product surface
-- and the enforcement model are.
--
-- So this migration owns the three things GoTrue does not give us:
--
--   1. RECOVERY CODES. Supabase issues none, and the issue is right that
--      "the real risk is lockout, not friction". A contractor who loses their
--      phone and cannot get into the app has lost their business phone line
--      and will rightly blame us. Codes are mandatory at enrolment.
--
--   2. OWNER ENFORCEMENT WITH A GRACE WINDOW. An owner can require MFA for
--      the workspace. Enforcement that starts the instant it is switched on
--      is how a security feature becomes an outage mid-shift.
--
--   3. A BRUTE-FORCE FLOOR on recovery. A code that removes the factor IS a
--      bypass if it can be guessed, so consumption is rate-limited in the
--      same statement that consumes.
--
-- NOT SMS, ever, and this is the one place the choice is ours specifically:
-- we are a texting company, so it is the obvious-looking option — and SMS
-- factors fall to SIM swap, while our users' phone numbers are the most
-- publicly-known thing about their businesses. Recommending it would be
-- indefensible for us in particular.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Recovery codes. Hashed, single-use, replaced as a set.
--
-- Stored as SHA-256 hex of the plaintext. They are shown to the person exactly
-- once, at enrolment, and never again — a code we could still display is a
-- code an attacker with our database could display too, which would make the
-- whole factor decorative.
-- ---------------------------------------------------------------------------
create table if not exists public.mfa_recovery_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  code_hash  text not null,
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, code_hash)
);

comment on table public.mfa_recovery_codes is
  '#314: single-use MFA recovery codes, SHA-256 hashed. Burning one removes the factor; it never elevates a session.';

create index if not exists mfa_recovery_codes_user_idx
  on public.mfa_recovery_codes (user_id) where used_at is null;

alter table public.mfa_recovery_codes enable row level security;

-- ---------------------------------------------------------------------------
-- Failed recovery attempts, per person.
--
-- Ten codes of real entropy are not guessable, but "not guessable" is a claim
-- about the codes and this is a claim about the endpoint. An attacker who has
-- the password and is grinding recovery codes is trying to turn a stolen
-- password into an MFA bypass, which is the single worst outcome this feature
-- can have.
-- ---------------------------------------------------------------------------
create table if not exists public.mfa_recovery_attempts (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  failures   int not null default 0,
  first_at   timestamptz not null default now(),
  locked_until timestamptz
);

alter table public.mfa_recovery_attempts enable row level security;

-- ---------------------------------------------------------------------------
-- Owner enforcement.
--
-- `mfa_required_at` is when the owner switched it on; `mfa_grace_until` is
-- when it starts to bite. Two columns rather than one because the grace is a
-- promise made to the crew at the moment of switching, and recomputing it from
-- a duration later would let a config change move a deadline people were told.
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists mfa_required_at timestamptz,
  add column if not exists mfa_grace_until timestamptz;

comment on column public.companies.mfa_grace_until is
  '#314: when workspace MFA enforcement begins. Fixed at the moment the owner switches it on, so the deadline the crew was told cannot move.';

-- ---------------------------------------------------------------------------
-- Replace a person's recovery codes with a fresh set.
--
-- Whole-set replacement, never append: issuing a second batch has to invalidate
-- the first, or a code screenshotted a year ago still works and the count the
-- screen shows is a lie.
-- ---------------------------------------------------------------------------
create or replace function public.api_mfa_set_recovery_codes(
  p_user_id uuid,
  p_hashes  text[]
) returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if p_user_id is null or coalesce(array_length(p_hashes, 1), 0) = 0 then
    raise exception 'api_mfa_set_recovery_codes: a user and at least one code are required';
  end if;

  delete from public.mfa_recovery_codes where user_id = p_user_id;
  insert into public.mfa_recovery_codes (user_id, code_hash)
  select p_user_id, h from unnest(p_hashes) h;
  get diagnostics v_n = row_count;

  -- A fresh set clears the failure counter: the person has just proved control
  -- of the account by enrolling, and carrying a lockout across that would
  -- punish somebody for having been attacked.
  delete from public.mfa_recovery_attempts where user_id = p_user_id;
  return v_n;
end $$;

revoke execute on function public.api_mfa_set_recovery_codes(uuid, text[])
  from public, anon, authenticated;
grant execute on function public.api_mfa_set_recovery_codes(uuid, text[])
  to service_role;

-- ---------------------------------------------------------------------------
-- Burn one code. The rate limit and the consumption are the same statement,
-- so a race cannot spend attempts without counting them or count without
-- spending.
--
-- Outcomes: 'ok' | 'no_match' | 'locked'.
-- ---------------------------------------------------------------------------
create or replace function public.api_mfa_consume_recovery_code(
  p_user_id uuid,
  p_hash    text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Ten wrong guesses buys an hour. Low enough to make grinding pointless,
  -- high enough that a person working through a drawer of old printouts is
  -- not locked out of their own business.
  c_max_failures constant int := 10;
  c_lockout constant interval := interval '1 hour';
  v_locked timestamptz;
  v_id uuid;
begin
  select locked_until into v_locked
    from public.mfa_recovery_attempts where user_id = p_user_id for update;
  if v_locked is not null and v_locked > now() then
    return jsonb_build_object('outcome', 'locked', 'until', v_locked);
  end if;

  update public.mfa_recovery_codes
     set used_at = now()
   where user_id = p_user_id
     and code_hash = p_hash
     and used_at is null
  returning id into v_id;

  if v_id is null then
    insert into public.mfa_recovery_attempts as a (user_id, failures, first_at)
    values (p_user_id, 1, now())
    on conflict (user_id) do update
      set failures = a.failures + 1,
          locked_until = case
            when a.failures + 1 >= c_max_failures then now() + c_lockout
            else a.locked_until
          end;
    return jsonb_build_object('outcome', 'no_match');
  end if;

  delete from public.mfa_recovery_attempts where user_id = p_user_id;
  return jsonb_build_object(
    'outcome', 'ok',
    'remaining', (select count(*) from public.mfa_recovery_codes
                   where user_id = p_user_id and used_at is null)
  );
end $$;

revoke execute on function public.api_mfa_consume_recovery_code(uuid, text)
  from public, anon, authenticated;
grant execute on function public.api_mfa_consume_recovery_code(uuid, text)
  to service_role;

create or replace function public.api_mfa_recovery_remaining(p_user_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.mfa_recovery_codes
   where user_id = p_user_id and used_at is null
$$;

revoke execute on function public.api_mfa_recovery_remaining(uuid)
  from public, anon, authenticated;
grant execute on function public.api_mfa_recovery_remaining(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The owner turns workspace enforcement on or off.
--
-- Turning it ON fixes the grace deadline once. Turning it OFF clears both, so
-- a later re-enable starts a fresh window rather than resurrecting a deadline
-- that passed while the setting was off.
-- ---------------------------------------------------------------------------
create or replace function public.api_set_company_mfa(
  p_company_id uuid,
  p_actor      uuid,
  p_required   boolean,
  p_grace_days int default 14
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_grace timestamptz;
begin
  select c.owner_user_id into v_owner from public.companies c where c.id = p_company_id;
  if v_owner is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_owner <> p_actor then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  if not p_required then
    update public.companies
       set mfa_required_at = null, mfa_grace_until = null, updated_at = now()
     where id = p_company_id;
    return jsonb_build_object('outcome', 'off');
  end if;

  -- Already on: leave the existing deadline alone. Re-saving the setting must
  -- not silently extend a window the crew is already working against.
  select mfa_grace_until into v_grace from public.companies where id = p_company_id;
  if v_grace is not null then
    return jsonb_build_object('outcome', 'on', 'grace_until', v_grace);
  end if;

  v_grace := now() + (greatest(p_grace_days, 0) || ' days')::interval;
  update public.companies
     set mfa_required_at = now(), mfa_grace_until = v_grace, updated_at = now()
   where id = p_company_id;
  return jsonb_build_object('outcome', 'on', 'grace_until', v_grace);
end $$;

revoke execute on function public.api_set_company_mfa(uuid, uuid, boolean, int)
  from public, anon, authenticated;
grant execute on function public.api_set_company_mfa(uuid, uuid, boolean, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- Enforcement, folded into the per-request authorization call.
--
-- Returns the workspace's MFA posture so `api_authorize_request` can decide
-- in the round trip it already makes. Kept as its own function so the policy
-- is readable in one place rather than buried in the middle of another.
--
-- `enforcing` is the only field that gates anything, and it is deliberately
-- false until the grace deadline passes.
-- ---------------------------------------------------------------------------
create or replace function public.company_mfa_posture(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'required', c.mfa_required_at is not null,
    'grace_until', c.mfa_grace_until,
    'enforcing', c.mfa_required_at is not null
                 and c.mfa_grace_until is not null
                 and c.mfa_grace_until <= now())
    from public.companies c
   where c.id = p_company_id
$$;

revoke execute on function public.company_mfa_posture(uuid)
  from public, anon, authenticated;
grant execute on function public.company_mfa_posture(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The authorization call learns about MFA.
--
-- Same single round trip as #236 — the posture rides along rather than costing
-- a second query, which is what keeps a per-request check affordable.
--
-- It REPORTS; it does not refuse. The decision to 403 belongs in the Worker,
-- where the caller's `aal` claim is (it lives in the token, not the database),
-- and where the company-exempt routes are known — a member being told to
-- enrol must still be able to reach the enrolment surface.
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
      insert into public.user_sessions (
        session_id, user_id, client, user_agent, ip_country, ip_region, ip_city
      ) values (
        p_session_id, p_user_id, v_client, p_user_agent, p_country, p_region, p_city
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
             ip_city      = coalesce(p_city, s.ip_city)
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
    -- Null when no company was named: there is no workspace policy to apply
    -- to a route that is not scoped to one.
    'mfa', case when p_company_id is null then null
                else public.company_mfa_posture(p_company_id) end
  );
end $$;

revoke execute on function public.api_authorize_request(
  uuid, uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.api_authorize_request(
  uuid, uuid, uuid, text, text, text, text, text) to service_role;
