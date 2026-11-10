-- Gapless per-topic broadcast sequence: assertion suite for
-- supabase/migrations/20261110180000_broadcasts_carry_a_gapless_topic_sequence.sql.
--
-- Clients detect a lost Realtime delivery by a hole in `seq`, so a hole the
-- server makes itself (a rolled-back send that still spent a number) would send
-- every client to refetch for nothing. This pins:
--   RS-1  consecutive sends on one topic number 1, 2, 3
--   RS-2  a rolled-back send leaves no gap
--   RS-3  two topics count independently
--   RS-4  the company-wide topic is sequenced too
--
-- One transaction, rolled back. Fixtures use a '7e' id prefix.

\set ON_ERROR_STOP on

begin;

delete from realtime.messages;

insert into auth.users (id, email) values
  ('7e000000-0000-4000-8000-00000000000a'::uuid, 'rs-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   subscription_status)
values
  ('7e000000-0000-4000-8000-0000000000c1'::uuid, 'Sequence Co',
   '7e000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), 'active');

create function pg_temp.seqs(p_topic text) returns bigint[]
language sql as $$
  select coalesce(array_agg((m.payload->>'seq')::bigint order by (m.payload->>'seq')::bigint), '{}')
    from realtime.messages m
   where m.topic = p_topic;
$$;

do $$
declare
  v_co  constant uuid := '7e000000-0000-4000-8000-0000000000c1';
  v_n1  constant uuid := '7e000000-0000-4000-8000-0000000000f1';
  v_t1  text := 'company:' || v_co || ':number:' || v_n1;
begin
  perform public.broadcast_number_scoped('{"a":1}'::jsonb, 'message.created', v_co, v_n1);
  perform public.broadcast_number_scoped('{"a":2}'::jsonb, 'message.created', v_co, v_n1);
  perform public.broadcast_number_scoped('{"a":3}'::jsonb, 'conversation.updated', v_co, v_n1);

  if pg_temp.seqs(v_t1) is distinct from array[1, 2, 3]::bigint[] then
    raise exception 'RS-1 FAILED: consecutive sends numbered %', pg_temp.seqs(v_t1);
  end if;
  if (select seq from public.realtime_topic_seq where topic = v_t1) is distinct from 3 then
    raise exception 'RS-1 FAILED: the counter row does not hold the last number sent';
  end if;
  if exists (select 1 from realtime.messages m
              where m.topic = v_t1 and m.payload->>'a' is null) then
    raise exception 'RS-1 FAILED: the original payload was lost';
  end if;
  raise notice 'RS-1 PASSED: consecutive sends number 1, 2, 3 and keep their payload';
end $$;

do $$
declare
  v_co  constant uuid := '7e000000-0000-4000-8000-0000000000c1';
  v_n1  constant uuid := '7e000000-0000-4000-8000-0000000000f1';
  v_t1  text := 'company:' || v_co || ':number:' || v_n1;
begin
  begin
    perform public.broadcast_number_scoped('{"a":4}'::jsonb, 'message.created', v_co, v_n1);
    raise exception 'write failed after its trigger fired';
  exception when raise_exception then
    null;
  end;

  perform public.broadcast_number_scoped('{"a":5}'::jsonb, 'message.created', v_co, v_n1);

  if pg_temp.seqs(v_t1) is distinct from array[1, 2, 3, 4]::bigint[] then
    raise exception 'RS-2 FAILED: after a rollback the topic numbered %', pg_temp.seqs(v_t1);
  end if;
  raise notice 'RS-2 PASSED: a rolled-back send leaves no gap';
end $$;

do $$
declare
  v_co  constant uuid := '7e000000-0000-4000-8000-0000000000c1';
  v_n1  constant uuid := '7e000000-0000-4000-8000-0000000000f1';
  v_n2  constant uuid := '7e000000-0000-4000-8000-0000000000f2';
  v_t1  text := 'company:' || v_co || ':number:' || v_n1;
  v_t2  text := 'company:' || v_co || ':number:' || v_n2;
begin
  perform public.broadcast_number_scoped('{}'::jsonb, 'message.created', v_co, v_n2);
  perform public.broadcast_number_scoped('{}'::jsonb, 'message.created', v_co, v_n2);

  if pg_temp.seqs(v_t2) is distinct from array[1, 2]::bigint[] then
    raise exception 'RS-3 FAILED: the second topic numbered %', pg_temp.seqs(v_t2);
  end if;
  if pg_temp.seqs(v_t1) is distinct from array[1, 2, 3, 4]::bigint[] then
    raise exception 'RS-3 FAILED: the first topic moved to %', pg_temp.seqs(v_t1);
  end if;
  raise notice 'RS-3 PASSED: two topics count independently';
end $$;

do $$
declare
  v_co constant uuid := '7e000000-0000-4000-8000-0000000000c1';
  v_tc text := 'company:' || v_co;
begin
  perform public.broadcast_number_scoped('{}'::jsonb, 'call.updated', v_co, null);
  perform public.realtime_send_sequenced(
    jsonb_build_object('company_id', v_co), 'access.changed', v_tc, v_co);

  if pg_temp.seqs(v_tc) is distinct from array[1, 2]::bigint[] then
    raise exception 'RS-4 FAILED: the company topic numbered %', pg_temp.seqs(v_tc);
  end if;
  raise notice 'RS-4 PASSED: the company topic is sequenced, including the null-number fallback';
end $$;

rollback;
