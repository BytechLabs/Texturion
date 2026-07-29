-- [#284] Legal hold — assertion suite for
-- supabase/migrations/20260730000900_legal_hold.sql.
--
-- A hold is the one control whose failure is unrecoverable. Everything else
-- here can be retried; data destroyed under a hold cannot be brought back, and
-- the workspace it happens to is by definition the one in a dispute.
--
-- One transaction, rolled back. Fixtures use a 'ca' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('ca000000-0000-4000-8000-00000000000a'::uuid, 'hold-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('ca000000-0000-4000-8000-0000000000c1'::uuid, 'Disputed Co',
   'ca000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

do $$
declare
  v_result jsonb;
begin
  -- A hold with no stated cause cannot be reviewed and cannot be lifted with
  -- confidence, so it cannot be placed.
  begin
    perform public.api_set_legal_hold(
      'ca000000-0000-4000-8000-0000000000c1'::uuid, true, null, null
    );
    raise exception 'a hold with no reason must be refused';
  exception
    when others then
      if sqlerrm not like '%reason is required%' then raise; end if;
  end;

  -- Whitespace is not a reason either.
  begin
    perform public.api_set_legal_hold(
      'ca000000-0000-4000-8000-0000000000c1'::uuid, true, '   ', null
    );
    raise exception 'a whitespace reason must be refused';
  exception
    when others then
      if sqlerrm not like '%reason is required%' then raise; end if;
  end;

  v_result := public.api_set_legal_hold(
    'ca000000-0000-4000-8000-0000000000c1'::uuid, true, 'warranty dispute', null
  );
  if not (v_result->>'on_hold')::boolean then
    raise exception 'the hold did not take';
  end if;

  if not public.is_on_legal_hold('ca000000-0000-4000-8000-0000000000c1'::uuid) then
    raise exception 'is_on_legal_hold disagrees with the row it reads';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Placing a hold twice must not move the clock. "Since when" is the first
-- question anybody asks about a hold, and re-running the script must not
-- rewrite the answer.
-- ---------------------------------------------------------------------------

do $$
declare
  v_first  timestamptz;
  v_second timestamptz;
begin
  select legal_hold_at into v_first from public.companies
   where id = 'ca000000-0000-4000-8000-0000000000c1'::uuid;

  perform pg_sleep(0.01);
  perform public.api_set_legal_hold(
    'ca000000-0000-4000-8000-0000000000c1'::uuid, true, 'still disputed', null
  );

  select legal_hold_at into v_second from public.companies
   where id = 'ca000000-0000-4000-8000-0000000000c1'::uuid;
  if v_second is distinct from v_first then
    raise exception 'placing a hold twice moved the since-date';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A held workspace is invisible to the purge sweep, even when overdue.
-- ---------------------------------------------------------------------------

do $$
declare
  v_eligible int;
begin
  update public.companies
     set deleted_at = now() - interval '40 days',
         purge_after = now() - interval '10 days'
   where id = 'ca000000-0000-4000-8000-0000000000c1'::uuid;

  -- The exact predicate the sweep uses (apps/api/src/workspace/purge.ts).
  select count(*) into v_eligible from public.companies
   where purge_after is not null
     and purge_after <= now()
     and purged_at is null
     and legal_hold_at is null
     and id = 'ca000000-0000-4000-8000-0000000000c1'::uuid;

  if v_eligible <> 0 then
    raise exception
      'a workspace under legal hold was eligible for purge — this is the '
      'failure that cannot be undone';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Lifting restores eligibility, and clears the reason with it.
-- ---------------------------------------------------------------------------

do $$
declare
  v_eligible int;
  v_reason   text;
begin
  perform public.api_set_legal_hold(
    'ca000000-0000-4000-8000-0000000000c1'::uuid, false, null, null
  );

  select count(*) into v_eligible from public.companies
   where purge_after <= now() and purged_at is null and legal_hold_at is null
     and id = 'ca000000-0000-4000-8000-0000000000c1'::uuid;
  if v_eligible <> 1 then
    raise exception 'lifting the hold must restore purge eligibility';
  end if;

  select legal_hold_reason into v_reason from public.companies
   where id = 'ca000000-0000-4000-8000-0000000000c1'::uuid;
  if v_reason is not null then
    raise exception 'a lifted hold must not leave its reason behind';
  end if;
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.api_set_legal_hold(uuid, boolean, text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.is_on_legal_hold(uuid)', 'execute')
  then
    raise exception 'legal-hold functions must not be reachable by anon/authenticated';
  end if;
end $$;

rollback;
