-- D142: the rig's database texts and dials only the partition's own numbers,
-- and production's database behaves exactly as it did before the gate.
--
-- Each gated write (an outbound `messages` row, an
-- `outbound_call_authorizations` row, the greeting-capture `audit_log` row) is
-- checked on both databases. The gate runs on every database, so RG-1 and
-- RG-2, which prove production unchanged, matter most.
--
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/rig_destination_gate.test.sql
-- Runs in one transaction and ROLLS BACK.

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- Fixtures: one sending workspace, a thread with a stranger and a thread with
-- one of the rig's own numbers. Numbers are in the fictional 555-01xx range.
-- ===========================================================================
insert into auth.users (id, email, raw_user_meta_data)
values ('d1a70000-0000-4000-8000-000000000001', 'owner@rig-gate.test',
        '{"display_name":"Gate Owner"}'::jsonb);

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status, plan, current_period_start, current_period_end,
   overage_cap_multiplier)
values
  ('d1a70000-0000-4000-8000-000000000002', 'Gate Co',
   'd1a70000-0000-4000-8000-000000000001', 'US', '613', now(),
   'active', 'starter', now() - interval '1 day', now() + interval '29 days', 3.00);

insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country, number_e164)
values
  ('d1a70000-0000-4000-8000-000000000003', 'd1a70000-0000-4000-8000-000000000002',
   'active', 'rig_gate_test_1', 'US', '+16135550110');

do $$
begin
  perform public.thread_inbound_message(
    'd1a70000-0000-4000-8000-000000000002'::uuid,
    'd1a70000-0000-4000-8000-000000000003'::uuid,
    '+16135550142', 'Is Tuesday free?', 'tx-rig-gate-stranger');
  perform public.thread_inbound_message(
    'd1a70000-0000-4000-8000-000000000002'::uuid,
    'd1a70000-0000-4000-8000-000000000003'::uuid,
    '+16135550101', 'Robot calling in', 'tx-rig-gate-endpoint');
end $$;

-- The three writes, each answering 'sent', 'refused' or the error it raised
-- instead. A refusal must be the gate's own error and must leave no row.
create function pg_temp.try_text(p_from text, p_key text)
returns text
language plpgsql
as $$
declare
  v_conv uuid;
  res    jsonb;
begin
  select conv.id into v_conv
    from public.conversations conv
   where conv.company_id = 'd1a70000-0000-4000-8000-000000000002'
     and conv.contact_phone_e164 = p_from;
  if v_conv is null then
    raise exception 'fixture thread for % is missing', p_from;
  end if;
  begin
    res := public.gate_outbound_send(
      'd1a70000-0000-4000-8000-000000000002'::uuid, v_conv,
      'd1a70000-0000-4000-8000-000000000001'::uuid,
      'See you then', p_key, 1);
  exception when others then
    if sqlerrm like 'rig_destination_refused%' then
      return 'refused';
    end if;
    return 'error: ' || sqlerrm;
  end;
  if res -> 'message' is null then
    return 'error: ' || coalesce(res ->> 'error', 'no message');
  end if;
  return 'sent';
end $$;

create function pg_temp.try_claim(p_customer text, p_nonce text)
returns text
language plpgsql
as $$
declare
  v_claimed boolean;
begin
  begin
    v_claimed := public.api_claim_outbound_line(
      'd1a70000-0000-4000-8000-000000000002'::uuid,
      'd1a70000-0000-4000-8000-000000000003'::uuid,
      p_nonce, '+16135550110', p_customer, now() - interval '4 hours');
  exception when others then
    if sqlerrm like 'rig_destination_refused%' then
      return 'refused';
    end if;
    return 'error: ' || sqlerrm;
  end;
  -- The claim holds the line for 30 seconds; free it so the next case is
  -- judged on its destination rather than on a busy line.
  delete from public.outbound_call_authorizations where nonce = p_nonce;
  return case when v_claimed then 'sent' else 'error: line busy' end;
end $$;

create function pg_temp.try_capture(p_to text, p_action text default 'voicemail_greeting.capture_call')
returns text
language plpgsql
as $$
begin
  begin
    insert into public.audit_log
      (company_id, actor_user_id, action, target_type, after)
    values
      ('d1a70000-0000-4000-8000-000000000002',
       'd1a70000-0000-4000-8000-000000000001',
       p_action, 'voicemail_greeting',
       jsonb_build_object('name', 'Rig gate', 'to', p_to));
  exception when others then
    if sqlerrm like 'rig_destination_refused%' then
      return 'refused';
    end if;
    return 'error: ' || sqlerrm;
  end;
  return 'sent';
end $$;

-- ===========================================================================
-- RG-0. This suite proves production's behaviour, so it refuses to run where
-- loonext.deploy_env is already set, such as the rig's own database.
-- ===========================================================================
do $$
begin
  if current_setting('loonext.deploy_env', true) is not null
     and current_setting('loonext.deploy_env', true) is distinct from '' then
    raise exception 'RG-0 FAILED: loonext.deploy_env is % on this database; run '
      'this suite where it is unset, as it is in production',
      current_setting('loonext.deploy_env', true);
  end if;
  raise notice 'RG-0 PASSED: loonext.deploy_env is unset, as in production';
end $$;

-- ===========================================================================
-- RG-1. Production, setting unset: a stranger is texted, dialed and rung.
-- ===========================================================================
do $$
declare
  v text;
begin
  v := pg_temp.try_text('+16135550142', 'rg1-text');
  if v is distinct from 'sent' then
    raise exception 'RG-1 FAILED: production text to a customer answered %', v;
  end if;
  v := pg_temp.try_claim('+16135550142', 'rg1-claim');
  if v is distinct from 'sent' then
    raise exception 'RG-1 FAILED: production outbound claim to a customer answered %', v;
  end if;
  v := pg_temp.try_capture('+16135550142');
  if v is distinct from 'sent' then
    raise exception 'RG-1 FAILED: production greeting capture to an owner''s mobile answered %', v;
  end if;
  if public.rig_destination_refused('+16135550142') is distinct from false
     or public.rig_destination_refused(null) is distinct from false
     or public.rig_destination_refused('not a number') is distinct from false then
    raise exception 'RG-1 FAILED: rig_destination_refused refuses something with the setting unset';
  end if;
  if public.rig_database_posture() is distinct from '{"deploy_env": "", "endpoints": 0}'::jsonb then
    raise exception 'RG-1 FAILED: production''s posture read %', public.rig_database_posture();
  end if;
  raise notice 'RG-1 PASSED: with the setting unset, all three writes go to any number';
end $$;

-- ===========================================================================
-- RG-2. Production, setting explicitly `production`: identical.
-- ===========================================================================
set local loonext.deploy_env = 'production';
do $$
declare
  v text;
begin
  v := pg_temp.try_text('+16135550142', 'rg2-text');
  if v is distinct from 'sent' then
    raise exception 'RG-2 FAILED: production text to a customer answered %', v;
  end if;
  v := pg_temp.try_claim('+16135550142', 'rg2-claim');
  if v is distinct from 'sent' then
    raise exception 'RG-2 FAILED: production outbound claim answered %', v;
  end if;
  v := pg_temp.try_capture('+16135550142');
  if v is distinct from 'sent' then
    raise exception 'RG-2 FAILED: production greeting capture answered %', v;
  end if;
  raise notice 'RG-2 PASSED: deploy_env=production behaves as unset';
end $$;

-- A failed outbound text to the stranger, written while still "production",
-- for RG-5's retry.
insert into public.messages
  (company_id, conversation_id, direction, body, status, segments, sent_by_user_id)
select 'd1a70000-0000-4000-8000-000000000002', conv.id, 'outbound', 'Retry me',
       'failed', 1, 'd1a70000-0000-4000-8000-000000000001'
  from public.conversations conv
 where conv.company_id = 'd1a70000-0000-4000-8000-000000000002'
   and conv.contact_phone_e164 = '+16135550142';

-- ===========================================================================
-- RG-3. The rig: a stranger is refused at all three writes, and nothing is
-- written for any of them.
-- ===========================================================================
set local loonext.deploy_env = 'rig';
set local loonext.rig_endpoints = '+16135550101, +16135550110';
do $$
declare
  v       text;
  v_count int;
begin
  if public.rig_database_posture() is distinct from '{"deploy_env": "rig", "endpoints": 2}'::jsonb then
    raise exception 'RG-3 FAILED: the rig''s posture read %', public.rig_database_posture();
  end if;

  v := pg_temp.try_text('+16135550142', 'rg3-text');
  if v is distinct from 'refused' then
    raise exception 'RG-3 FAILED: rig text to a stranger answered %', v;
  end if;
  select count(*) into v_count from public.messages
   where company_id = 'd1a70000-0000-4000-8000-000000000002'
     and idempotency_key = 'rg3-text';
  if v_count is distinct from 0 then
    raise exception 'RG-3 FAILED: a refused rig text left % row(s)', v_count;
  end if;

  v := pg_temp.try_claim('+16135550142', 'rg3-claim');
  if v is distinct from 'refused' then
    raise exception 'RG-3 FAILED: rig outbound claim to a stranger answered %', v;
  end if;
  select count(*) into v_count from public.outbound_call_authorizations
   where nonce = 'rg3-claim';
  if v_count is distinct from 0 then
    raise exception 'RG-3 FAILED: a refused rig claim left a reservation';
  end if;

  v := pg_temp.try_capture('+16135550142');
  if v is distinct from 'refused' then
    raise exception 'RG-3 FAILED: rig greeting capture to a stranger answered %', v;
  end if;
  v := pg_temp.try_capture(null);
  if v is distinct from 'refused' then
    raise exception 'RG-3 FAILED: rig greeting capture with no destination answered %', v;
  end if;
  raise notice 'RG-3 PASSED: on the rig a stranger is refused at the text, the claim and the capture';
end $$;

-- ===========================================================================
-- RG-4. The rig: its own numbers still work, and the capture gate is about
-- the capture call only — another audit row naming a stranger is untouched.
-- ===========================================================================
do $$
declare
  v text;
begin
  v := pg_temp.try_text('+16135550101', 'rg4-text');
  if v is distinct from 'sent' then
    raise exception 'RG-4 FAILED: rig text to its own number answered %', v;
  end if;
  v := pg_temp.try_claim('+16135550101', 'rg4-claim');
  if v is distinct from 'sent' then
    raise exception 'RG-4 FAILED: rig outbound claim to its own number answered %', v;
  end if;
  v := pg_temp.try_capture('+16135550101');
  if v is distinct from 'sent' then
    raise exception 'RG-4 FAILED: rig greeting capture to its own number answered %', v;
  end if;
  v := pg_temp.try_capture('+16135550142', 'member.role_changed');
  if v is distinct from 'sent' then
    raise exception 'RG-4 FAILED: an unrelated audit row was refused (%)', v;
  end if;
  raise notice 'RG-4 PASSED: the rig''s own numbers pass, and only the capture claim is gated';
end $$;

-- ===========================================================================
-- RG-5. The rig: retrying a failed text is a send, and is gated like one.
-- ===========================================================================
do $$
declare
  v_refused boolean := false;
begin
  begin
    update public.messages set status = 'queued'
     where company_id = 'd1a70000-0000-4000-8000-000000000002'
       and body = 'Retry me';
  exception when others then
    if sqlerrm like 'rig_destination_refused%' then
      v_refused := true;
    else
      raise exception 'RG-5 FAILED: the retry raised something else: %', sqlerrm;
    end if;
  end;
  if v_refused is distinct from true then
    raise exception 'RG-5 FAILED: a failed text to a stranger was re-queued on the rig';
  end if;
  raise notice 'RG-5 PASSED: a retry to a stranger is refused on the rig';
end $$;

-- ===========================================================================
-- RG-6. The rig with no endpoint list refuses everything, its own numbers
-- included: a missing list must never read as "any number".
-- ===========================================================================
set local loonext.rig_endpoints = '';
do $$
declare
  v text;
begin
  v := pg_temp.try_text('+16135550101', 'rg6-text');
  if v is distinct from 'refused' then
    raise exception 'RG-6 FAILED: with no endpoint list a rig text answered %', v;
  end if;
  v := pg_temp.try_claim('+16135550101', 'rg6-claim');
  if v is distinct from 'refused' then
    raise exception 'RG-6 FAILED: with no endpoint list a rig claim answered %', v;
  end if;
  -- What the rig's start-up check reads to refuse this state.
  if public.rig_database_posture() is distinct from '{"deploy_env": "rig", "endpoints": 0}'::jsonb then
    raise exception 'RG-6 FAILED: an empty list''s posture read %', public.rig_database_posture();
  end if;
  raise notice 'RG-6 PASSED: an empty endpoint list refuses every destination';
end $$;

-- A typo in the list drops that entry and keeps the rest; it never widens.
set local loonext.rig_endpoints = '6135550101 +16135550110,,+1613555';
do $$
begin
  if public.rig_endpoint_numbers() is distinct from array['+16135550110'] then
    raise exception 'RG-6 FAILED: a list with typos parsed as %', public.rig_endpoint_numbers();
  end if;
  if public.rig_destination_refused('+16135550101') is distinct from true
     or public.rig_destination_refused('6135550101') is distinct from true
     or public.rig_destination_refused('+16135550110') is distinct from false then
    raise exception 'RG-6 FAILED: a list with typos gated the wrong numbers';
  end if;
  raise notice 'RG-6 PASSED: a typo in the endpoint list only removes that entry';
end $$;

-- ===========================================================================
-- RG-7. Break-proof: without the triggers the rig refusals vanish, so RG-3
-- through RG-6 are known to be the gate's doing. Dropped inside this
-- transaction only; the rollback restores them.
-- ===========================================================================
set local loonext.rig_endpoints = '+16135550101';
drop trigger rig_gate_outbound_message on public.messages;
drop trigger rig_gate_outbound_line on public.outbound_call_authorizations;
drop trigger rig_gate_greeting_capture on public.audit_log;
do $$
declare
  v text;
begin
  v := pg_temp.try_text('+16135550142', 'rg7-text');
  if v is distinct from 'sent' then
    raise exception 'RG-7 FAILED: without the trigger the stranger text still answered %, '
      'so RG-3 was refused by something other than the gate', v;
  end if;
  v := pg_temp.try_claim('+16135550142', 'rg7-claim');
  if v is distinct from 'sent' then
    raise exception 'RG-7 FAILED: without the trigger the stranger claim answered %', v;
  end if;
  v := pg_temp.try_capture('+16135550142');
  if v is distinct from 'sent' then
    raise exception 'RG-7 FAILED: without the trigger the stranger capture answered %', v;
  end if;
  raise notice 'RG-7 PASSED: the refusals come from the gate itself';
end $$;

-- ===========================================================================
-- RG-8. Nothing here is for a browser: the client roles can call none of the
-- gate's functions, and the API's role can read the posture.
-- ===========================================================================
do $$
declare
  v_fn      regprocedure;
  v_exposed text[] := array[]::text[];
begin
  foreach v_fn in array array[
    'public.rig_endpoint_numbers()'::regprocedure,
    'public.rig_destination_refused(text)'::regprocedure,
    'public.rig_database_posture()'::regprocedure,
    'public.rig_gate_outbound_message()'::regprocedure,
    'public.rig_gate_outbound_line()'::regprocedure,
    'public.rig_gate_greeting_capture()'::regprocedure]
  loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute') then
      v_exposed := v_exposed || v_fn::text;
    end if;
  end loop;
  if cardinality(v_exposed) is distinct from 0 then
    raise exception 'RG-8 FAILED: a client role can execute %', array_to_string(v_exposed, ', ');
  end if;
  if has_function_privilege('service_role', 'public.rig_database_posture()', 'execute')
     is distinct from true then
    raise exception 'RG-8 FAILED: service_role cannot read the posture, so the rig cannot check it';
  end if;
  raise notice 'RG-8 PASSED: the gate''s functions are closed to clients and the posture is open to the API';
end $$;

rollback;
