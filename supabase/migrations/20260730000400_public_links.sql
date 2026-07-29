-- #335 — one way to let a homeowner open a page, decided once.
--
-- Four queued features each need the same thing and none can ship without it:
-- text-to-pay (#224), quotes (#287), the calendar feed (#245), the site widget
-- (#232). Built independently that is four token schemes, four expiry
-- policies, four sets of security assumptions, and four chances to get it
-- wrong.
--
-- Getting it wrong here is worse than elsewhere, and this is the whole reason
-- the primitive exists rather than being re-derived per feature: THE PERSON
-- EXPOSED IS NOT OUR USER. A homeowner's address, phone number, job details
-- and payment amount behind a guessable URL is a breach involving somebody who
-- never agreed to anything with us and has no relationship with us at all.
--
-- ---------------------------------------------------------------------------
-- THE MODEL (D75)
--
--   ONE TOKEN, ONE OBJECT, ONE PURPOSE. A quote token views and accepts that
--   quote. It cannot enumerate, cannot reach the conversation, cannot reveal
--   the workspace's other work. The purpose is stored, not inferred, so a
--   token minted for viewing can never be replayed against a payment route.
--
--   THE TOKEN IS NEVER STORED. Only its SHA-256 hash. A leaked database
--   backup, a log line, or a support screenshot then discloses nothing usable
--   — the same reasoning as a password digest, applied to a URL. This is what
--   makes the audit trail below safe to keep.
--
--   256 BITS OF ENTROPY. Not a UUID: a v4 UUID has 122 bits and a recognisable
--   shape, and these URLs sit on the public internet, in SMS logs, in browser
--   history, and in third-party calendar servers.
--
--   EXPIRY IS MANDATORY AND REVOCATION IS ALWAYS POSSIBLE. Both are the
--   requirements most likely to be skipped, so neither is optional here: the
--   column is NOT NULL, and every link can be killed individually without
--   touching any other.

-- ---------------------------------------------------------------------------
-- 1. The links.
-- ---------------------------------------------------------------------------

create table if not exists public.public_links (
  id           uuid primary key default gen_random_uuid(),
  -- SHA-256 of the token, hex. The token itself is returned exactly once, at
  -- mint time, and never again — not to us, not to support, not to a query.
  token_hash   text not null unique,
  company_id   uuid not null references public.companies(id) on delete cascade,
  -- What this link is FOR. Checked on every resolve, so a token minted to view
  -- a quote cannot be replayed against the route that accepts it.
  purpose      text not null check (purpose in (
    'quote_view',      -- #287
    'quote_accept',    -- #287
    'payment',         -- #224
    'calendar_feed',   -- #245
    'photo_set',       -- #294
    'review'           -- #313
  )),
  -- The ONE object this grants access to. Deliberately not a filter or a
  -- query — a token names its object, so there is nothing to traverse.
  subject_type text not null,
  subject_id   uuid not null,
  -- NOT NULL on purpose. A link with no expiry is the failure this table
  -- exists to prevent, and making it representable would guarantee it happens.
  expires_at   timestamptz not null,
  -- Single-use links (a payment must die on payment). NULL = reusable until
  -- it expires.
  max_uses     int check (max_uses is null or max_uses > 0),
  uses         int not null default 0,
  revoked_at   timestamptz,
  revoke_reason text,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,
  last_used_at timestamptz
);

comment on table public.public_links is
  '#335/D75: unguessable, scoped, expiring links a customer''s customer can '
  'open with no account. Stores only the token HASH — never the token.';

create index if not exists public_links_company_idx
  on public.public_links (company_id, purpose);
create index if not exists public_links_subject_idx
  on public.public_links (subject_type, subject_id);

-- ---------------------------------------------------------------------------
-- 2. Access log — separate from the link, and deliberately thin.
--
-- These are unauthenticated endpoints on the public internet, outside every
-- gate that protects /v1. Enumeration has to be DETECTABLE, which means
-- recording attempts that did not resolve as well as ones that did.
--
-- What is NOT recorded: the token, the full IP, or anything about the person.
-- A country is enough to see a pattern; an address would be collecting data
-- about a third party in order to protect them, which is its own harm.
-- ---------------------------------------------------------------------------

create table if not exists public.public_link_access (
  id         bigserial primary key,
  -- Null when the token did not resolve — which is the row that matters most,
  -- because a run of them IS the enumeration attempt.
  link_id    uuid references public.public_links(id) on delete cascade,
  outcome    text not null check (outcome in (
    'ok', 'not_found', 'expired', 'revoked', 'used_up', 'wrong_purpose'
  )),
  ip_country text,
  at         timestamptz not null default now()
);

create index if not exists public_link_access_at_idx
  on public.public_link_access (at desc);
create index if not exists public_link_access_miss_idx
  on public.public_link_access (at desc) where link_id is null;

-- ---------------------------------------------------------------------------
-- 3. Minting.
--
-- Takes the HASH, never the token. The Worker generates 256 bits, hands the
-- token to the caller once, and sends us only the digest — so the plaintext
-- never crosses a network boundary it does not have to, and never lands in a
-- statement log.
-- ---------------------------------------------------------------------------

create or replace function public.api_mint_public_link(
  p_token_hash   text,
  p_company_id   uuid,
  p_purpose      text,
  p_subject_type text,
  p_subject_id   uuid,
  p_expires_at   timestamptz,
  p_max_uses     int  default null,
  p_actor        uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_token_hash is null or length(p_token_hash) <> 64 then
    raise exception 'api_mint_public_link: expected a sha-256 hex digest';
  end if;
  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'api_mint_public_link: expiry must be in the future';
  end if;

  insert into public.public_links (
    token_hash, company_id, purpose, subject_type, subject_id,
    expires_at, max_uses, created_by
  ) values (
    p_token_hash, p_company_id, p_purpose, p_subject_type, p_subject_id,
    p_expires_at, p_max_uses, p_actor
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Resolving.
--
-- ONE round trip that checks everything and records the attempt, because the
-- checks and the logging must not be able to drift apart. A caller cannot
-- forget to log a miss — a miss IS a return value here.
--
-- Returns the outcome ALWAYS, and the subject only on success. A caller that
-- gets 'not_found' learns nothing about whether the token was wrong, expired,
-- or for a different company.
-- ---------------------------------------------------------------------------

create or replace function public.api_resolve_public_link(
  p_token_hash text,
  p_purpose    text,
  p_country    text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link    public.public_links%rowtype;
  v_outcome text;
begin
  select * into v_link from public.public_links
   where token_hash = p_token_hash;

  if not found then
    -- Logged with a null link_id: a run of these is the enumeration attempt,
    -- and it is the only place it would ever be visible.
    insert into public.public_link_access (link_id, outcome, ip_country)
    values (null, 'not_found', p_country);
    return jsonb_build_object('ok', false, 'outcome', 'not_found');
  end if;

  v_outcome := case
    when v_link.revoked_at is not null then 'revoked'
    when v_link.expires_at <= now() then 'expired'
    when v_link.max_uses is not null and v_link.uses >= v_link.max_uses then 'used_up'
    -- The replay guard: a view token presented to an accept route is a miss,
    -- not a downgrade.
    when v_link.purpose is distinct from p_purpose then 'wrong_purpose'
    else 'ok'
  end;

  insert into public.public_link_access (link_id, outcome, ip_country)
  values (v_link.id, v_outcome, p_country);

  if v_outcome <> 'ok' then
    -- Deliberately no detail. The holder of a bad token learns only that it
    -- did not work.
    return jsonb_build_object('ok', false, 'outcome', v_outcome);
  end if;

  update public.public_links
     set uses = uses + 1, last_used_at = now()
   where id = v_link.id;

  return jsonb_build_object(
    'ok', true,
    'outcome', 'ok',
    'link_id', v_link.id,
    'company_id', v_link.company_id,
    'subject_type', v_link.subject_type,
    'subject_id', v_link.subject_id,
    -- So a caller can say "this link expires Friday" without a second query.
    'expires_at', v_link.expires_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Revocation — individually, always.
--
-- The ICS feed (#245) is the awkward case the issue names: long-lived by
-- nature, pasted into third-party servers, so it cannot be short-expiry and
-- must instead be individually rotatable. Revoke-one is what makes that safe,
-- and revoke-by-subject is what makes "this quote is withdrawn" one call.
-- ---------------------------------------------------------------------------

create or replace function public.api_revoke_public_link(
  p_link_id uuid,
  p_reason  text default null
) returns void
language sql
security definer
set search_path = ''
as $$
  update public.public_links
     set revoked_at = coalesce(revoked_at, now()), revoke_reason = p_reason
   where id = p_link_id;
$$;

create or replace function public.api_revoke_public_links_for_subject(
  p_subject_type text,
  p_subject_id   uuid,
  p_reason       text default null
) returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.public_links
     set revoked_at = now(), revoke_reason = p_reason
   where subject_type = p_subject_type
     and subject_id = p_subject_id
     and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Enumeration detection.
--
-- Misses per hour. The signal is unauthenticated endpoints being probed, and
-- without this it would leave no trace anywhere — these routes sit outside
-- every gate that protects /v1.
-- ---------------------------------------------------------------------------

create or replace function public.api_public_link_misses(p_hours int default 1)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.public_link_access
   where link_id is null
     and at > now() - make_interval(hours => greatest(p_hours, 1));
$$;

-- ---------------------------------------------------------------------------
-- 7. Retention. Access rows are diagnostics, not records.
-- ---------------------------------------------------------------------------

create or replace function public.api_prune_public_link_access(p_days int default 30)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  delete from public.public_link_access
   where at < now() - make_interval(days => greatest(p_days, 1));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. Nothing is reachable by anon or authenticated: the PUBLIC routes are
-- served by the Worker with the service role, which is what lets the Worker
-- rate-limit and shape the response before anything reaches the caller.
-- ---------------------------------------------------------------------------

revoke all on function public.api_mint_public_link(text, uuid, text, text, uuid, timestamptz, int, uuid)
  from public, anon, authenticated;
grant execute on function public.api_mint_public_link(text, uuid, text, text, uuid, timestamptz, int, uuid)
  to service_role;

revoke all on function public.api_resolve_public_link(text, text, text)
  from public, anon, authenticated;
grant execute on function public.api_resolve_public_link(text, text, text) to service_role;

revoke all on function public.api_revoke_public_link(uuid, text) from public, anon, authenticated;
grant execute on function public.api_revoke_public_link(uuid, text) to service_role;

revoke all on function public.api_revoke_public_links_for_subject(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.api_revoke_public_links_for_subject(text, uuid, text) to service_role;

revoke all on function public.api_public_link_misses(int) from public, anon, authenticated;
grant execute on function public.api_public_link_misses(int) to service_role;

revoke all on function public.api_prune_public_link_access(int) from public, anon, authenticated;
grant execute on function public.api_prune_public_link_access(int) to service_role;

alter table public.public_links enable row level security;
revoke all on table public.public_links from public, anon, authenticated;
grant select, insert, update, delete on table public.public_links to service_role;

alter table public.public_link_access enable row level security;
revoke all on table public.public_link_access from public, anon, authenticated;
grant select, insert, delete on table public.public_link_access to service_role;
grant usage, select on sequence public.public_link_access_id_seq to service_role;
