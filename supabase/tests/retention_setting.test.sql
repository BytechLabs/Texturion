-- [#284/D77] Workspace retention choice — assertion suite for
-- supabase/migrations/20260730001000_retention_setting.sql.
--
-- The bound is the whole feature. A workspace may shorten its window; letting
-- it EXTEND would opt a customer into the indefinite-retention posture D77
-- exists to end, and would make our own published privacy page untrue for
-- whoever chose it.
--
-- One transaction, rolled back. Fixtures use a 'da' id prefix... 'cb' here, to
-- stay clear of number_reputation's.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('cb000000-0000-4000-8000-00000000000a'::uuid, 'ret-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('cb000000-0000-4000-8000-0000000000c1'::uuid, 'Retention Co',
   'cb000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

do $$
declare
  v_result jsonb;
begin
  -- Unset means the D77 default, and the caller is told the number rather than
  -- having to know that NULL means seven years.
  if public.effective_retention_days('cb000000-0000-4000-8000-0000000000c1'::uuid) is distinct from 2555 then
    raise exception 'an unset workspace must resolve to the D77 default';
  end if;

  -- Shortening is the point of the feature.
  v_result := public.api_set_retention(
    'cb000000-0000-4000-8000-0000000000c1'::uuid, 365, null
  );
  if (v_result->>'retention_days')::int is distinct from 365 then
    raise exception 'shortening did not take: %', v_result::text;
  end if;
  if (v_result->>'is_default')::boolean then
    raise exception 'a chosen window must not report as the default';
  end if;

  -- EXTENDING past the published default is refused. This is the bound that
  -- keeps the privacy page true for every workspace.
  begin
    perform public.api_set_retention(
      'cb000000-0000-4000-8000-0000000000c1'::uuid, 3650, null
    );
    raise exception 'extending past the default must be refused';
  exception
    when others then
      if sqlerrm not like '%never extend it%' then raise; end if;
  end;

  -- And below the floor, where a shared inbox stops being one.
  begin
    perform public.api_set_retention(
      'cb000000-0000-4000-8000-0000000000c1'::uuid, 7, null
    );
    raise exception 'a 7-day window must be refused';
  exception
    when others then
      if sqlerrm not like '%between 90 and%' then raise; end if;
  end;

  -- Clearing returns to the default.
  v_result := public.api_set_retention(
    'cb000000-0000-4000-8000-0000000000c1'::uuid, null, null
  );
  if not (v_result->>'is_default')::boolean
     or (v_result->>'retention_days')::int is distinct from 2555 then
    raise exception 'clearing must return to the D77 default: %', v_result::text;
  end if;
end $$;

-- The column constraint holds for a hand-written UPDATE too, which is when a
-- retention number is most likely to be typed by somebody in a hurry.
do $$
begin
  begin
    update public.companies set retention_days = 5
     where id = 'cb000000-0000-4000-8000-0000000000c1'::uuid;
    raise exception 'the CHECK must refuse an out-of-bounds direct update';
  exception
    when check_violation then null;  -- expected
  end;
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.api_set_retention(uuid, int, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.effective_retention_days(uuid)', 'execute')
  then
    raise exception 'retention functions must not be reachable by anon/authenticated';
  end if;
end $$;

rollback;
