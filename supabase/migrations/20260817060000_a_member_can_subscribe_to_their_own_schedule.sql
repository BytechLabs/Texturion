-- #245 — a member's scheduled work, in the calendar they already use.
--
-- ## Why a feed before a sync
--
-- The issue asks for two-way Google and Microsoft sync as the real deliverable
-- and says to ship a read-only ICS feed FIRST, because it is "a fraction of the
-- work of full sync and captures most of the value". It is also the fallback
-- for every calendar app we will never build a connector for — Apple Calendar,
-- Fastmail, Thunderbird, whatever the bookkeeper's spouse uses.
--
-- ## Why the token is its own table rather than a public_link
--
-- `public_links` mints one-shot, expiring, single-subject tokens for a quote or
-- a payment page. A calendar feed is the opposite of all three: it is long-
-- lived, it is fetched forever (Google polls every few hours, Apple more often),
-- and its subject is "this person's schedule" rather than one row. Squeezing it
-- into that table would mean either an expiry nobody wants or a purpose that
-- means something different from every other purpose there.
--
-- ## The security shape, which the issue states plainly
--
-- "An ICS URL is a bearer token in a query string that gets pasted into
-- third-party apps — it needs to be per-member, revocable, rotatable, and
-- scoped to only what that member may already see."
--
-- All four are structural here rather than conventions:
--
-- * PER-MEMBER: the row carries (user_id, company_id) and the feed resolves the
--   reader from the token alone. A member of two workspaces gets two tokens,
--   because their schedules are two different things and revoking one must not
--   touch the other.
-- * REVOCABLE: `revoked_at`, checked on resolve. A revoked token answers
--   exactly as a token that never existed.
-- * ROTATABLE: rotation is a revoke plus a mint, so the old URL dies the moment
--   the new one is issued. One live token per member per workspace is enforced
--   by a partial unique index rather than by the API remembering to.
-- * SCOPED: the feed reads what the MEMBER may see, applying #106 number access
--   at read time rather than freezing it into the token. A member who loses
--   access to a line stops seeing its work on their phone's calendar at the
--   next poll, without anybody re-issuing anything.
--
-- Only the HASH is stored, like every other bearer credential here. A leaked
-- database backup must not hand somebody a working calendar subscription.

create table if not exists public.calendar_feed_tokens (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- SHA-256 of the token, hex. Never the token.
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  -- Observability rather than policy: an owner asking "is this actually being
  -- used" should not have to guess, and a feed nothing has fetched in months is
  -- a candidate for revoking.
  last_read_at timestamptz
);

-- One LIVE token per member per workspace. Rotation revokes then mints, so the
-- index is what makes "the old URL stops working" true by construction rather
-- than by the API remembering to revoke first.
create unique index if not exists calendar_feed_tokens_live_uq
  on public.calendar_feed_tokens (company_id, user_id)
  where revoked_at is null;

-- The lookup the feed does on every poll, which is the hot path.
create index if not exists calendar_feed_tokens_hash_idx
  on public.calendar_feed_tokens (token_hash)
  where revoked_at is null;

alter table public.calendar_feed_tokens enable row level security;

-- Deny-by-default, matching the posture of every table here: RLS on, zero
-- grants to anon/authenticated, service_role only. The Worker is the only
-- reader, and it resolves a token that arrives with no session at all.
revoke all on public.calendar_feed_tokens from public, anon, authenticated;
grant all on public.calendar_feed_tokens to service_role;

comment on table public.calendar_feed_tokens is
  '#245: per-member ICS subscription credentials. Hash only; revocable and rotatable.';

-- ---------------------------------------------------------------------------
-- Mint, replacing whatever the member had.
--
-- ONE STATEMENT for revoke-then-insert, because a rotation that revoked and
-- then failed to mint would leave a member with no feed and no error to explain
-- it — and the partial unique index would reject the insert anyway if the
-- revoke had not committed first.
-- ---------------------------------------------------------------------------
create or replace function public.api_mint_calendar_feed_token(
  p_company_id uuid,
  p_user_id    uuid,
  p_token_hash text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.calendar_feed_tokens
     set revoked_at = now()
   where company_id = p_company_id
     and user_id = p_user_id
     and revoked_at is null;

  insert into public.calendar_feed_tokens (company_id, user_id, token_hash)
  values (p_company_id, p_user_id, p_token_hash)
  returning id into v_id;

  return v_id;
end $$;

revoke execute on function public.api_mint_calendar_feed_token(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.api_mint_calendar_feed_token(uuid, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Resolve a presented token to its reader.
--
-- Returns the (company, user) or nothing. NOTHING is the answer for every
-- failure — revoked, never existed, malformed — because the difference between
-- them is information the holder of a bad token has not earned.
--
-- Stamps `last_read_at` in the same statement, so the observability costs no
-- extra round trip on a path polled every few minutes by every subscriber.
-- ---------------------------------------------------------------------------
create or replace function public.api_resolve_calendar_feed_token(
  p_token_hash text
) returns table (company_id uuid, user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.calendar_feed_tokens t
     set last_read_at = now()
   where t.token_hash = p_token_hash
     and t.revoked_at is null
  returning t.company_id, t.user_id;
end $$;

revoke execute on function public.api_resolve_calendar_feed_token(text)
  from public, anon, authenticated;
grant execute on function public.api_resolve_calendar_feed_token(text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Revoke, without minting a replacement.
--
-- Separate from rotation on purpose: "stop this URL working" and "give me a new
-- URL" are different intentions, and a member who pasted their feed somewhere
-- they regret wants the first one without being handed a second secret to look
-- after.
-- ---------------------------------------------------------------------------
create or replace function public.api_revoke_calendar_feed_token(
  p_company_id uuid,
  p_user_id    uuid
) returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.calendar_feed_tokens
     set revoked_at = now()
   where company_id = p_company_id
     and user_id = p_user_id
     and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke execute on function public.api_revoke_calendar_feed_token(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_revoke_calendar_feed_token(uuid, uuid)
  to service_role;
