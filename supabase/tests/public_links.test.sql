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
  if v_result->>'subject_id' is distinct from 'ea000000-0000-4000-8000-0000000000f1' then
    raise exception 'the subject must come back';
  end if;

  -- THE replay guard: a token minted to VIEW must not work on the route that
  -- ACCEPTS. Without this, one leaked view link accepts the quote.
  v_result := public.api_resolve_public_link(pg_temp.h('quote-1'), 'quote_accept', 'CA');
  if (v_result->>'ok')::boolean then
    raise exception 'a view token must not resolve for accept';
  end if;
  if v_result->>'outcome' is distinct from 'wrong_purpose' then
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
  if v_result->>'outcome' is distinct from 'expired' then
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
  if v_result->>'outcome' is distinct from 'revoked' then
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
  if v_result->>'outcome' is distinct from 'used_up' then
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

  -- #571: another workspace passing the same subject id revokes NOTHING. Asserted
  -- before the real revoke so a pass cannot be an accident of ordering — if the
  -- predicate were missing, this call would revoke both links and the real one
  -- below would then find zero and fail for the wrong reason.
  v_count := public.api_revoke_public_links_for_subject(
    'ea000000-0000-4000-8000-0000000000c9'::uuid,
    'quote', 'ea000000-0000-4000-8000-0000000000f5'::uuid, 'not yours'
  );
  if v_count is distinct from 0 then
    raise exception
      'a foreign workspace revoked % of another workspace''s live links', v_count;
  end if;

  if not (public.api_resolve_public_link(pg_temp.h('q2-view'), 'quote_view') ->> 'ok')::boolean then
    raise exception 'the customer''s link must still work after a foreign revoke';
  end if;

  v_count := public.api_revoke_public_links_for_subject(
    'ea000000-0000-4000-8000-0000000000c1'::uuid,
    'quote', 'ea000000-0000-4000-8000-0000000000f5'::uuid, 'withdrawn'
  );
  if v_count is distinct from 2 then
    raise exception 'expected both links to the quote revoked, got %', v_count;
  end if;

  if (public.api_resolve_public_link(pg_temp.h('q2-view'), 'quote_view') ->> 'ok')::boolean then
    raise exception 'a withdrawn quote''s view link must stop working';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- #571: the unscoped signature is GONE, not merely unused.
--
-- `create or replace` cannot add a parameter, so the fix had to drop and
-- recreate. If a later migration ever restores the three-argument form, it would
-- be granted to service_role and callable — and every caller that forgot the
-- company id would silently get the old behaviour back.
-- ---------------------------------------------------------------------------

do $$
declare
  v_args text[];
begin
  select array_agg(pg_get_function_identity_arguments(p.oid) order by p.oid)
    into v_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'api_revoke_public_links_for_subject';

  if array_length(v_args, 1) is distinct from 1 then
    raise exception
      'expected exactly one revoke-by-subject function, found %: %',
      coalesce(array_length(v_args, 1), 0), v_args;
  end if;

  if v_args[1] is distinct from
     'p_company_id uuid, p_subject_type text, p_subject_id uuid, p_reason text'
  then
    raise exception 'revoke-by-subject signature changed: %', v_args[1];
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
       'api_prune_public_link_access', 'api_issue_quote_decision_link',
       'api_record_quote_decision', 'api_undo_quote_acceptance'
     )
     and (
       has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute')
     );
  if v_leak is not null then
    raise exception 'these must not be reachable by anon/authenticated: %', v_leak;
  end if;
end $$;

do $$
declare
  v_company uuid := 'ea000000-0000-4000-8000-0000000000c1';
  v_task uuid;
  v_link uuid;
begin
  insert into public.tasks (company_id, title, created_by_user_id)
  values (v_company, 'Photo job', 'ea000000-0000-4000-8000-00000000000a')
  returning id into v_task;
  v_link := public.api_mint_public_link(
    pg_temp.h('photos-trash'), v_company, 'photo_set', 'task_photos', v_task, now() + interval '1 day'
  );

  update public.tasks set deleted_at = now(), trashed_with_conversation_at = now() where id = v_task;
  if exists (select 1 from public.public_links where id = v_link and revoked_at is not null) then
    raise exception 'Trashing a conversation revoked a link needed after restore';
  end if;

  update public.tasks set deleted_at = null, trashed_with_conversation_at = null where id = v_task;
  update public.tasks set deleted_at = now() where id = v_task;
  if not exists (select 1 from public.public_links where id = v_link and revoked_at is not null) then
    raise exception 'Deleting a task did not revoke its photo link';
  end if;
end $$;

do $quote_decisions$
declare
  tenant uuid := 'ea000000-0000-4000-8000-0000000000c1';
  owner uuid := 'ea000000-0000-4000-8000-00000000000a';
  customer uuid;
  line uuid;
  thread uuid;
  offer uuid;
  view_id uuid;
  acceptance uuid;
  decline uuid;
begin
  insert into public.contacts (company_id, phone_e164)
  values (tenant, '+14165550172') returning id into customer;
  insert into public.phone_numbers (company_id, number_e164, status, country, provisioning_key, telnyx_phone_number_id)
  values (tenant, '+14165550173', 'active', 'CA', 'quote-decision-test', 'quote-decision-provider')
  returning id into line;
  insert into public.conversations (company_id, contact_id, phone_number_id, status)
  values (tenant, customer, line, 'open') returning id into thread;
  insert into public.quotes (company_id, conversation_id, contact_id, status, expires_at, amount_cents, currency, description)
  values (tenant, thread, customer, 'sent', now() + interval '1 day', 28000, 'cad', 'Replace the fixture')
  returning id into offer;

  view_id := public.api_mint_public_link(pg_temp.h('decision-view'), tenant,
    'quote_view', 'quote', offer, now() + interval '1 day');
  if public.api_issue_quote_decision_link(view_id, pg_temp.h('accept-v1'), 'quote_accept', 1) <> 'ready'
    or public.api_issue_quote_decision_link(view_id, pg_temp.h('decline-v1'), 'quote_decline', 1) <> 'ready' then
    raise exception 'Could not issue the first decision credentials';
  end if;
  acceptance := (public.api_resolve_public_link(pg_temp.h('accept-v1'), 'quote_accept', 'CA')->>'link_id')::uuid;
  if not public.api_record_quote_decision(tenant, offer, 'accepted', null, acceptance, 'Camille', null, 'CA') then
    raise exception 'First acceptance failed';
  end if;
  if public.api_record_quote_decision(tenant, offer, 'accepted', null, acceptance, 'Camille', null, 'CA') then
    raise exception 'The quote accepted a second time';
  end if;
  if (select count(*) from public.conversation_events
      where conversation_id = thread and type = 'quote_accepted' and payload->>'ip_country' = 'CA') <> 1 then
    raise exception 'Acceptance must record one event and country';
  end if;
  if not public.api_undo_quote_acceptance(tenant, offer, owner) then
    raise exception 'The owner could not undo acceptance';
  end if;
  if public.api_record_quote_decision(tenant, offer, 'accepted', null, acceptance, 'Camille', null, 'CA')
    or public.api_issue_quote_decision_link(view_id, pg_temp.h('decline-v1'), 'quote_decline', 1) <> 'unavailable'
    or public.api_issue_quote_decision_link(view_id, pg_temp.h('decline-v2'), 'quote_decline', 2) <> 'ready' then
    raise exception 'Undo must invalidate the previous credentials';
  end if;
  decline := (public.api_resolve_public_link(pg_temp.h('decline-v2'), 'quote_decline', 'CA')->>'link_id')::uuid;
  update public.conversations set deleted_at = now() where id = thread;
  if public.api_record_quote_decision(tenant, offer, 'declined', null, decline, null, null, 'CA') then
    raise exception 'A trashed quote cannot be declined';
  end if;
  update public.conversations set deleted_at = null where id = thread;
  if not public.api_record_quote_decision(tenant, offer, 'declined', null, decline, null, null, 'CA') then
    raise exception 'The restored quote should accept the scoped decline';
  end if;
end $quote_decisions$;

rollback;
