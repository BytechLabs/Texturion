-- ===========================================================================
-- #725: every text a machine writes says so, and says which machine.
--
-- #388 added messages.automated and three writers never set it: the missed-
-- call text-back, the rating ask and a task's reminder each landed as if the
-- owner had typed them. A list nobody checks is how that happened, so this
-- file derives the writers from pg_proc and compares them with a roster.
-- ===========================================================================
begin;

-- AT-1. Every function that inserts into public.messages is either a path a
--       person or a customer drives (rostered here), or names its automation.
do $$
declare
  human text[] := array[
    -- A member's send: the person in sent_by_user_id wrote it.
    'gate_outbound_send',
    -- A customer's text arriving.
    'thread_inbound_message'
  ];
  unmarked text;
  stale text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into unmarked
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
     and pg_get_functiondef(p.oid) ~* 'insert\s+into\s+public\.messages\M'
     and p.proname <> all (human)
     and pg_get_functiondef(p.oid) !~* '\mautomation\M';
  if unmarked is not null then
    raise exception
      'AT-1 FAILED: these functions write texts without saying which '
      'automation sent them: %. Set automated and automation in the insert, or '
      'roster the function here as a path a person drives.', unmarked;
  end if;

  select string_agg(name, ', ') into stale
    from unnest(human) name
   where not exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = name
        and pg_get_functiondef(p.oid) ~* 'insert\s+into\s+public\.messages\M');
  if stale is not null then
    raise exception 'AT-1 FAILED: rostered as writers but no longer write texts: %', stale;
  end if;
  raise notice 'AT-1 PASSED: every automated writer names its automation';
end $$;

-- AT-2. The column holds only known automations, and only on automated texts.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'messages_automation_is_automated') then
    raise exception 'AT-2 FAILED: an automation can sit on a text marked human';
  end if;
  if has_function_privilege('authenticated',
       'public.claim_auto_reply(uuid, uuid, text, integer, integer, text)', 'execute') then
    raise exception 'AT-2 FAILED: a signed-in user can claim an auto-reply';
  end if;
  raise notice 'AT-2 PASSED: the column and the claim are locked down';
end $$;

-- AT-3. Historical missed-call texts are identified by the message id recorded
--       on the event, not by content or timing heuristics.
do $$
declare
  stale integer;
begin
  select count(*) into stale
    from public.conversation_events e
    join public.messages m on m.id::text = e.payload ->> 'message_id'
   where e.type = 'missed_call'
     and (not coalesce(m.automated, false)
          or m.automation is distinct from 'missed_call_text');
  if stale is distinct from 0 then
    raise exception 'AT-3 FAILED: % missed-call texts are still marked as human', stale;
  end if;
  raise notice 'AT-3 PASSED: every event-linked missed-call text is marked automated';
end $$;

-- AT-4. Every message writer checks outbound spend or has an explicit exception.
do $$
declare
  exempt regprocedure[] := array[
    -- Customer messages and tapbacks are inbound.
    'public.thread_inbound_message(uuid, uuid, text, text, text, text, integer, integer, text, text)'::regprocedure,
    'public.thread_inbound_message(uuid, uuid, text, text, text, text, integer, integer, jsonb)'::regprocedure,
    -- Interactive sends apply the matching spend checks inline (P0-3c).
    'public.gate_outbound_send(uuid, uuid, uuid, text, text, integer)'::regprocedure,
    -- Emergency acknowledgments use their own daily cap.
    'public.claim_emergency_ack(uuid, uuid, text, integer, integer, integer, boolean)'::regprocedure
  ];
  uncovered text;
  stale text;
begin
  with writers as (
    select p.oid, p.prosrc
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.prosrc ~* 'insert\s+into\s+public\.messages\M'
  )
  select (
    select string_agg(w.oid::regprocedure::text, ', ' order by w.oid::regprocedure::text)
      from writers w
     where w.oid <> all (exempt)
       and w.prosrc !~* 'public\.outbound_spend_check\s*\('
  ), (
    select string_agg(x::text, ', ' order by x::text)
      from unnest(exempt) x
     where not exists (select 1 from writers w where w.oid = x)
  ) into uncovered, stale;

  if uncovered is not null or stale is not null then
    raise exception 'AT-4: message writers without spend checks: %. Stale exceptions: %.',
      coalesce(uncovered, 'none'), coalesce(stale, 'none');
  end if;
end $$;

rollback;
