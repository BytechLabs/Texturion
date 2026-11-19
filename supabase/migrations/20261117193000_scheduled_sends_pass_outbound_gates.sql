alter table public.scheduled_messages add column next_attempt_at timestamptz;

drop function public.api_hold_scheduled_message(uuid, text, text);
drop function public.api_fail_scheduled_message(uuid, text, text);

create or replace function public.api_hold_scheduled_message(
  p_id         uuid,
  p_reason     text,
  p_reason_key text,
  p_not_before timestamptz default null,
  p_claimed_at timestamptz default null
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
     and (p_claimed_at is null or s.claimed_at = p_claimed_at)
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
         next_attempt_at = coalesce(p_not_before, now() +
           case p_reason_key
             when 'domain.scheduledHoldCustomerReplied' then interval '30 minutes'
             when 'domain.scheduledHoldOptOutUnresolved' then interval '15 minutes'
             when 'domain.scheduledHoldUsageCap' then interval '15 minutes'
             when 'domain.scheduledHoldRateLimit' then interval '5 minutes'
             when 'domain.scheduledHoldRegistrationPending' then interval '15 minutes'
             else interval '2 minutes'
           end),
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
  p_reason_key text,
  p_claimed_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.scheduled_messages;
begin
  update public.scheduled_messages s
     set status = case when p_reason_key = 'domain.scheduledHoldExpired'
                       then 'expired' else 'failed' end,
         held_reason = p_reason,
         held_reason_key = p_reason_key,
         claimed_at = null,
         updated_at = now()
   where s.id = p_id
     and s.status in ('pending', 'held')
     and (p_claimed_at is null or s.claimed_at = p_claimed_at)
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

create or replace function public.api_claim_due_scheduled_messages(
  p_now timestamptz,
  p_limit integer,
  p_lease_seconds integer default 300
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  with eligible as (
    select s.id,
           row_number() over (
             partition by s.company_id
             order by (s.status = 'held'), s.send_at, s.id
           ) as company_position
      from public.scheduled_messages s
     where s.status in ('pending', 'held')
       and s.send_at <= p_now
       and (s.next_attempt_at is null or s.next_attempt_at <= p_now)
       and (s.claimed_at is null
            or s.claimed_at < p_now - make_interval(secs => p_lease_seconds))
  ), due as (
    select s.id
      from public.scheduled_messages s
      join eligible e on e.id = s.id
     where e.company_position <= 20
       and s.status in ('pending', 'held')
       and s.send_at <= p_now
       and (s.next_attempt_at is null or s.next_attempt_at <= p_now)
       and (s.claimed_at is null
            or s.claimed_at < p_now - make_interval(secs => p_lease_seconds))
     order by (s.status = 'held'), e.company_position, s.send_at, s.id
     limit p_limit
     for update of s skip locked
  ), claimed as (
    update public.scheduled_messages s
       set claimed_at = p_now,
           updated_at = now()
      from due
     where s.id = due.id
    returning s.*
  )
  select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb) from claimed
$$;

drop function public.api_fire_scheduled_message(uuid, integer);

create or replace function public.api_fire_scheduled_message(
  p_id                uuid,
  p_segments_estimate integer,
  p_claimed_at        timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company         public.companies%rowtype;
  v_reason          text;
  v_hint_at         timestamptz;
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

  select * into v_company
    from public.companies co
   where co.id = v_probe.company_id
     and co.deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'gone');
  end if;

  if v_probe.origin = 'reminder' and v_probe.task_id is not null then
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
     and (p_claimed_at is null or (s.claimed_at = p_claimed_at and s.send_at <= v_now))
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
             next_attempt_at = v_now + interval '2 minutes',
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

  if exists (
    select 1
      from public.opt_outs o
      join public.conversations c
        on c.company_id = o.company_id and c.contact_phone_e164 = o.phone_e164
     where c.id = v_scheduled.conversation_id
       and c.company_id = v_scheduled.company_id
       and o.revoked_at is null
  ) then
    return public.api_fail_scheduled_message(
      p_id,
      'This customer opted out. Only they can opt in again.',
      'domain.scheduledHoldOptedOut'
    ) || jsonb_build_object('reason_key', 'recipient_opted_out');
  end if;

  select c.opt_out_hint_at into v_hint_at
    from public.conversations c
   where c.id = v_scheduled.conversation_id
     and c.company_id = v_scheduled.company_id;
  if v_hint_at is not null then
    return public.api_hold_scheduled_message(
      p_id,
      'Review the customer''s opt-out request before this text can send.',
      'domain.scheduledHoldOptOutUnresolved'
    ) || jsonb_build_object('reason_key', 'opt_out_unresolved');
  end if;

  v_reason := coalesce(
    public.company_send_block(v_company),
    public.outbound_spend_check(v_scheduled.company_id, p_segments_estimate)
  );
  if v_reason is not null then
    if v_reason not in ('usage_cap_reached', 'rate_limited', 'workspace_paused', 'subscription_inactive') then
      v_reason := 'service_unavailable';
    end if;
    return public.api_hold_scheduled_message(
      p_id,
      case v_reason
        when 'usage_cap_reached' then 'The workspace spending cap has been reached.'
        when 'rate_limited' then 'The workspace has reached its hourly texting limit.'
        when 'workspace_paused' then 'The workspace is paused.'
        when 'subscription_inactive' then 'Outbound texting requires an active subscription.'
        else 'Texting is temporarily unavailable.'
      end,
      case v_reason
        when 'usage_cap_reached' then 'domain.scheduledHoldUsageCap'
        when 'rate_limited' then 'domain.scheduledHoldRateLimit'
        when 'workspace_paused' then 'domain.scheduledHoldWorkspacePaused'
        when 'subscription_inactive' then 'domain.scheduledHoldSubscriptionInactive'
        else 'domain.scheduledHoldServiceUnavailable'
      end
    ) || jsonb_build_object('reason_key', v_reason);
  end if;

  insert into public.messages
    (company_id, conversation_id, direction, body, status, segments,
     sent_by_user_id, automated, automation)
  values
    (v_scheduled.company_id, v_scheduled.conversation_id, 'outbound',
     v_scheduled.body, 'queued', p_segments_estimate, v_scheduled.created_by,
     v_scheduled.origin <> 'human',
     case v_scheduled.origin
       when 'reminder' then 'reminder'
       when 'rating' then 'job_rating'
     end)
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

revoke execute on function public.api_fire_scheduled_message(uuid, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_fire_scheduled_message(uuid, integer, timestamptz)
  to service_role;

revoke execute on function public.api_hold_scheduled_message(uuid, text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_hold_scheduled_message(uuid, text, text, timestamptz, timestamptz)
  to service_role;

revoke execute on function public.api_fail_scheduled_message(uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_fail_scheduled_message(uuid, text, text, timestamptz)
  to service_role;
