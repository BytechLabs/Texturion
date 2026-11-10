-- #722 phase 2, the scheduled_message machine (docs/STATE-MACHINES.md).
--
-- 1. The database refuses a status change the machine does not allow, whoever
--    writes it: pending and held are live, the other four are terminal.
--    packages/shared/src/state-machines/scheduled-message.ts is the same table,
--    and a test fails if the two differ.
-- 2. The hold paths return `entered`: true only when the row was not already
--    held for that reason. The owner is told on ENTRY, never on each re-claim,
--    which is the rule the 2026-11-10 push flood broke; it used to live in the
--    caller (alreadyHeldFor) where a new caller could forget it.

create or replace function public.scheduled_messages_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
       (old.status = 'pending' and new.status in ('held', 'sent', 'canceled', 'expired', 'failed'))
    or (old.status = 'held' and new.status in ('pending', 'sent', 'canceled', 'expired', 'failed'))
  ) then
    raise exception 'scheduled message % cannot go from % to %', old.id, old.status, new.status
      using errcode = 'P0001', hint = 'illegal_transition';
  end if;
  return new;
end $$;

drop trigger if exists scheduled_messages_transition_guard on public.scheduled_messages;
create trigger scheduled_messages_transition_guard
  before update of status on public.scheduled_messages
  for each row execute function public.scheduled_messages_transition_guard();

create or replace function public.api_hold_scheduled_message(
  p_id         uuid,
  p_reason     text,
  p_reason_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.scheduled_messages;
  v_entered boolean;
begin
  select * into v_row
    from public.scheduled_messages s
   where s.id = p_id
     and s.status in ('pending', 'held')
   for update;
  if not found then
    return jsonb_build_object('outcome', 'gone');
  end if;
  v_entered := v_row.status <> 'held' or v_row.held_reason_key is distinct from p_reason_key;

  update public.scheduled_messages s
     set status = 'held',
         held_reason = p_reason,
         held_reason_key = p_reason_key,
         held_at = coalesce(s.held_at, now()),
         claimed_at = null,
         updated_at = now()
   where s.id = p_id
  returning * into v_row;

  return jsonb_build_object('outcome', 'held',
                            'entered', v_entered,
                            'scheduled_message', to_jsonb(v_row));
end;
$$;

create or replace function public.api_fail_scheduled_message(
  p_id         uuid,
  p_reason     text,
  p_reason_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.scheduled_messages;
begin
  update public.scheduled_messages s
     set status = 'failed',
         held_reason = p_reason,
         held_reason_key = p_reason_key,
         claimed_at = null,
         updated_at = now()
   where s.id = p_id
     and s.status in ('pending', 'held')
  returning * into v_row;

  if not found then
    return jsonb_build_object('outcome', 'gone');
  end if;

  -- failed is terminal and only reachable from a live state, so every
  -- successful call enters it.
  return jsonb_build_object('outcome', 'failed',
                            'entered', true,
                            'scheduled_message', to_jsonb(v_row));
end;
$$;

create or replace function public.api_fire_scheduled_message(
  p_id                uuid,
  p_segments_estimate integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_probe           public.scheduled_messages%rowtype;
  v_scheduled       public.scheduled_messages%rowtype;
  v_message         public.messages%rowtype;
  v_task            public.tasks%rowtype;
  v_source_done_at  timestamptz;
  v_calendar_backed boolean := false;
  v_calendar_safe   boolean := true;
  v_now             timestamptz := now();
  v_hold_unverified boolean := true;
  -- #722: whether the hold below enters the state, read before the update.
  v_entered         boolean;
begin
  -- Identity probe only.  The authoritative row is locked after the calendar
  -- serialization rows so provider apply keeps connection->link->outbox->send
  -- ordering and cannot deadlock this transaction.
  select * into v_probe
    from public.scheduled_messages s
   where s.id = p_id and s.status in ('pending', 'held');
  if not found then
    return jsonb_build_object('outcome', 'gone');
  end if;

  if v_probe.origin = 'reminder' and v_probe.task_id is not null then
    -- Serializes OAuth completion/workspace closure with the no-link case.
    perform 1 from public.companies co
     where co.id = v_probe.company_id
     for update;

    -- Include the assigned member's connection even before its first link,
    -- plus every connection named by a mapping or live outbox intent.
    perform 1
      from public.calendar_connections c
     where c.company_id = v_probe.company_id
       and (
         c.user_id in (
           select a.user_id from public.task_assignees a
            where a.task_id = v_probe.task_id and a.company_id = v_probe.company_id
         )
         or exists (
           select 1 from public.task_calendar_links l
            where l.company_id = v_probe.company_id
              and l.task_id = v_probe.task_id
              and l.connection_id = c.id
              and l.link_state <> 'unlinked'
         )
         or exists (
           select 1 from public.calendar_outbox o
            where o.company_id = v_probe.company_id
              and o.task_id = v_probe.task_id
              and o.connection_id = c.id
              and o.state in ('queued', 'leased')
         )
       )
     order by c.id
     for update;
    perform 1
      from public.task_calendar_links l
     where l.company_id = v_probe.company_id
       and l.task_id = v_probe.task_id
       and l.link_state <> 'unlinked'
     order by l.id
     for update;
    select * into v_task
      from public.tasks t
     where t.id = v_probe.task_id and t.company_id = v_probe.company_id
     for update;
    if found then
      select m.done_at into v_source_done_at
        from public.messages m
       where m.id = v_task.message_id and m.company_id = v_probe.company_id
       for update;
    end if;
    perform 1
      from public.calendar_outbox o
     where o.company_id = v_probe.company_id
       and o.task_id = v_probe.task_id
       and o.state in ('queued', 'leased')
     order by o.id
     for update;
  end if;

  select * into v_scheduled
    from public.scheduled_messages s
   where s.id = p_id
     and s.status in ('pending', 'held')
   for update;
  if not found then
    return jsonb_build_object('outcome', 'gone');
  end if;

  if v_scheduled.origin = 'reminder' and v_scheduled.task_id is not null then
    if v_task.id is null
       or v_task.deleted_at is not null
       or v_task.reminders_off
       or v_task.due_at is null
       or coalesce(v_source_done_at, v_task.done_at) is not null then
      update public.scheduled_messages s
         set status = 'failed',
             held_reason = 'The job is no longer scheduled.',
             held_reason_key = 'job_no_longer_scheduled',
             claimed_at = null,
             updated_at = v_now
       where s.id = p_id
      returning * into v_scheduled;
      return jsonb_build_object(
        'outcome', 'failed',
        'reason_key', 'job_no_longer_scheduled',
        'scheduled_message', to_jsonb(v_scheduled)
      );
    end if;

    select co.hold_reminders_unverified_calendar into v_hold_unverified
      from public.companies co
     where co.id = v_scheduled.company_id;
    v_hold_unverified := coalesce(v_hold_unverified, true);

    v_calendar_backed := exists (
      select 1 from public.calendar_outbox o
       where o.company_id = v_scheduled.company_id
         and o.task_id = v_scheduled.task_id
         and o.state in ('queued', 'leased')
    ) or exists (
      select 1 from public.task_calendar_links l
       where l.company_id = v_scheduled.company_id
         and l.task_id = v_scheduled.task_id
         and l.link_state <> 'unlinked'
    );

    if v_calendar_backed then
      v_calendar_safe := exists (
        select 1 from public.companies co
         where co.id = v_scheduled.company_id and co.deleted_at is null
      )
      and not exists (
        select 1 from public.calendar_outbox o
         where o.company_id = v_scheduled.company_id
           and o.task_id = v_scheduled.task_id
           and o.state in ('queued', 'leased')
      )
      and not exists (
        select 1
          from public.task_calendar_links l
          left join public.calendar_connections c
            on c.id = l.connection_id and c.company_id = l.company_id
         where l.company_id = v_scheduled.company_id
           and l.task_id = v_scheduled.task_id
           and l.link_state <> 'unlinked'
           and (
             l.link_state <> 'active'
             or c.id is null
             or c.status <> 'active'
             or c.revoked_at is not null
             or c.last_verified_at is null
             or c.last_verified_at < v_now - interval '15 minutes'
             or (c.sync_due_at is not null and c.sync_due_at <= v_now)
             or c.pull_lease_owner is not null
           )
      );
    end if;

    if v_calendar_backed and not v_calendar_safe and v_hold_unverified then
      v_entered := v_scheduled.status <> 'held'
        or v_scheduled.held_reason_key is distinct from 'calendar_unverified';
      update public.scheduled_messages s
         set status = 'held',
             held_reason = 'Calendar verification is pending.',
             held_reason_key = 'calendar_unverified',
             held_at = coalesce(s.held_at, v_now),
             claimed_at = null,
             updated_at = v_now
       where s.id = p_id
      returning * into v_scheduled;
      return jsonb_build_object(
        'outcome', 'held',
        'reason_key', 'calendar_unverified',
        'entered', v_entered,
        'scheduled_message', to_jsonb(v_scheduled)
      );
    end if;
  end if;

  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id)
  values
    (v_scheduled.company_id, v_scheduled.conversation_id, 'outbound',
     v_scheduled.body, 'queued', p_segments_estimate, v_scheduled.created_by)
  returning * into v_message;

  update public.scheduled_messages s
     set status = 'sent',
         sent_message_id = v_message.id,
         held_reason = null,
         held_reason_key = null,
         updated_at = v_now
   where s.id = p_id;

  return jsonb_build_object(
    'outcome', 'fired', 'message', to_jsonb(v_message)
  );
end $$;

-- REVOKE BEFORE GRANT: a recreated function regains the default PUBLIC grant.
revoke execute on function public.api_hold_scheduled_message(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.api_hold_scheduled_message(uuid, text, text) to service_role;
revoke execute on function public.api_fail_scheduled_message(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.api_fail_scheduled_message(uuid, text, text) to service_role;
revoke execute on function public.api_fire_scheduled_message(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.api_fire_scheduled_message(uuid, integer) to service_role;
