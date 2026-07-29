-- [#335] Public links — assertion suite for
-- supabase/migrations/20260730000400_public_links.sql.
--
-- Every assertion here is a security property, because the person a mistake
-- exposes is not our user and never agreed to anything with us. What is pinned:
-- a link cannot outlive its expiry, cannot be replayed for a different purpose,
-- cannot be spent twice, and a miss is always recorded — because a run of
-- misses is the only trace an enumeration attempt would leave.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/public_links.test.sql
--
-- One transaction, rolled back. Fixtures use an 'ea' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

delete from public.public_link_access;
delete from public.public_links;

insert into auth.users (id, email) values
  ('ea000000-0000-4000-8000-00000000000a'::uuid, 'links-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('ea000000-0000-4000-8000-0000000000c1'::uuid, 'Links Co',
   'ea000000-0000-4000-8000-00000000000a'::uuid, 'CA', '416', now());

-- 64 hex characters, the shape the Worker sends.
create or replace function pg_temp.h(p_seed text) returns text
language sql as $$ select encode(sha256(p_seed::bytea), 'hex') $$;

-- ---------------------------------------------------------------------------
-- A link cannot be minted without a future expiry.
-- ---------------------------------------------------------------------------

do $$
begin
  begin
    perform public.api_mint_public_link(
      pg_temp.h('no-expiry'), 'ea000000-0000-4000-8000-0000000000c1'::uuid,
      'quote_view', 'quote', 'ea000000-0000-4000-8000-0000000000f1'::uuid,
      now() - interval '1 day'
    );
    raise exception 'a link expiring in the past must be refused';
  exception
    when others then
      if sqlerrm not like '%expiry must be in the future%' then raise; end if;
  end;

  -- And the digest shape is checked, so a caller cannot store a plaintext
  -- token by passing one where a hash belongs.
  begin
    perform public.api_mint_public_link(
      'not-a-digest', 'ea000000-0000-4000-8000-0000000000c1'::uuid,
      'quote_view', 'quote', 'ea000000-0000-4000-8000-0000000000f1'::uuid,
      now() + interval '1 day'
    );
    raise exception 'a non-digest token_hash must be refused';
  exception
    when others then
      if sqlerrm not like '%sha-256 hex digest%' then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- The happy path, and the purpose check.
-- ---------------------------------------------------------------------------

do $$
declare
  v_result jsonb;
begin
  perform public.api_mint_public_link(
    pg_temp.h('quote-1'), 'ea000000-0000-4000-8000-0000000000c1'::uuid,
    'quote_view', 'quote', 'ea000000-0000-4000-8000-0000000000f1'::uuid,
    now() + interval '30 days'
  );

  v_result := public.api_resolve_public_link(pg_temp.h('quote-1'), 'quote_view', 'CA');
  if not (v_result->>'ok')::boolean then
    raise exception 'a valid token must resolve, got %', v_result::text;
  end if;
  if v_result->>'subject_id' <> 'ea000000-0000-4000-8000-0000000000f1' then
    raise exception 'the subject must come back';
  end if;

  -- THE replay guard: a token minted to VIEW must not work on the route that
  -- ACCEPTS. Without this, one leaked view link accepts the quote.
  v_result := public.api_resolve_public_link(pg_temp.h('quote-1'), 'quote_accept', 'CA');
  if (v_result->>'ok')::boolean then
    raise exception 'a view token must not resolve for accept';
  end if;
  if v_result->>'outcome' <> 'wrong_purpose' then
    raise exception 'expected wrong_purpose, got %', v_result->>'outcome';
  end if;
  -- And it must not leak the subject on the way out.
  if v_result ? 'subject_id' then
    raise exception 'a failed resolve must not return the subject';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Expiry, revocation, and single use.
-- ---------------------------------------------------------------------------

do $$
declare
  v_result jsonb;
  v_id     uuid;
begin
  -- Expired.
  perform public.api_mint_public_link(
    pg_temp.h('old'), 'ea000000-0000-4000-8000-0000000000c1'::uuid,
    'quote_view', 'quote', 'ea000000-0000-4000-8000-0000000000f2'::uuid,
    now() + interval '1 minute'
  );
  update public.public_links set expires_at = now() - interval '1 minute'
   where token_hash = pg_temp.h('old');
  v_result := public.api_resolve_public_link(pg_temp.h('old'), 'quote_view');
  if v_result->>'outcome' <> 'expired' then
    raise exception 'an expired link must not resolve, got %', v_result->>'outcome';
  end if;

  -- Revoked individually. This is what makes a long-lived ICS feed (#245) safe:
  -- it cannot be short-expiry, so rotation is the only control that fits.
  v_id := public.api_mint_public_link(
    pg_temp.h('feed'), 'ea000000-0000-4000-8000-0000000000c1'::uuid,
    'calendar_feed', 'member', 'ea000000-0000-4000-8000-0000000000f3'::uuid,
    now() + interval '365 days'
  );
  perform public.api_revoke_public_link(v_id, 'rotated');
  v_result := public.api_resolve_public_link(pg_temp.h('feed'), 'calendar_feed');
  if v_result->>'outcome' <> 'revoked' then
    raise exception 'a revoked link must not resolve, got %', v_result->>'outcome';
  end if;

  -- Single use: a payment link must die ON payment, not after it.
  perform public.api_mint_public_link(
    pg_temp.h('pay'), 'ea000000-0000-4000-8000-0000000000c1'::uuid,
    'payment', 'invoice', 'ea000000-0000-4000-8000-0000000000f4'::uuid,
    now() + interval '7 days', 1
  );
  v_result := public.api_resolve_public_link(pg_temp.h('pay'), 'payment');
  if not (v_result->>'ok')::boolean then
    raise exception 'the first use of a single-use link must work';
  end if;
  v_result := public.api_resolve_public_link(pg_temp.h('pay'), 'payment');
  if v_result->>'outcome' <> 'used_up' then
    raise exception 'the second use must be refused, got %', v_result->>'outcome';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Revoking every link to one object — "this quote is withdrawn".
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
begin
  perform public.api_mint_public_link(
    pg_temp.h('q2-view'), 'ea000000-0000-4000-8000-0000000000c1'::uuid,
    'quote_view', 'quote', 'ea000000-0000-4000-8000-0000000000f5'::uuid,
    now() + interval '30 days'
  );
  perform public.api_mint_public_link(
    pg_temp.h('q2-accept'), 'ea000000-0000-4000-8000-0000000000c1'::uuid,
    'quote_accept', 'quote', 'ea000000-0000-4000-8000-0000000000f5'::uuid,
    now() + interval '30 days'
  );

  v_count := public.api_revoke_public_links_for_subject(
    'quote', 'ea000000-0000-4000-8000-0000000000f5'::uuid, 'withdrawn'
  );
  if v_count <> 2 then
    raise exception 'expected both links to the quote revoked, got %', v_count;
  end if;

  if (public.api_resolve_public_link(pg_temp.h('q2-view'), 'quote_view') ->> 'ok')::boolean then
    raise exception 'a withdrawn quote''s view link must stop working';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Enumeration leaves a trace. This is the only place it ever would.
-- ---------------------------------------------------------------------------

do $$
declare
  v_misses int;
begin
  for i in 1..5 loop
    perform public.api_resolve_public_link(pg_temp.h('guess-' || i), 'quote_view', 'RU');
  end loop;

  v_misses := public.api_public_link_misses(1);
  if v_misses < 5 then
    raise exception
      'unresolved tokens must be recorded — a run of them IS the enumeration '
      'attempt, and these routes sit outside every gate that protects /v1. Got %',
      v_misses;
  end if;

  -- The miss rows carry no link, by construction: there was nothing to link to.
  if exists (
    select 1 from public.public_link_access
     where outcome = 'not_found' and link_id is not null
  ) then
    raise exception 'a not_found row cannot reference a link';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The plaintext token is never stored, in any column.
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad int;
begin
  -- Every stored hash must look like a digest. A plaintext token that slipped
  -- into this column would be 43 base64url characters, not 64 hex.
  select count(*) into v_bad from public.public_links
   where token_hash !~ '^[0-9a-f]{64}$';
  if v_bad > 0 then
    raise exception '% row(s) hold something that is not a sha-256 digest', v_bad;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Grants: nothing here is reachable by anon or authenticated. The PUBLIC routes
-- are served by the Worker with the service role, which is what lets it
-- rate-limit and shape the response before anything reaches the caller.
-- ---------------------------------------------------------------------------

do $$
declare
  v_leak text;
begin
  select string_agg(p.proname, ', ') into v_leak
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'api_mint_public_link', 'api_resolve_public_link', 'api_revoke_public_link',
       'api_revoke_public_links_for_subject', 'api_public_link_misses',
       'api_prune_public_link_access'
     )
     and (
       has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute')
     );
  if v_leak is not null then
    raise exception 'these must not be reachable by anon/authenticated: %', v_leak;
  end if;
end $$;

rollback;
