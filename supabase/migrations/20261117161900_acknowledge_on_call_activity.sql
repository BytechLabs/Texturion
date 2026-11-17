create function public.acknowledge_alerts_after_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.alert_escalations
     set acknowledged_at = new.created_at,
         acknowledged_by = new.sent_by_user_id,
         escalate_at = null
   where company_id = new.company_id
     and conversation_id = new.conversation_id
     and created_at <= new.created_at
     and acknowledged_at is null;
  return null;
end $$;

revoke execute on function public.acknowledge_alerts_after_message()
  from public, anon, authenticated;

create trigger acknowledge_alerts_after_message
  after insert on public.messages
  for each row
  when (new.direction = 'outbound' and new.sent_by_user_id is not null
    and not new.automated and new.status in ('queued', 'sent', 'delivered'))
  execute function public.acknowledge_alerts_after_message();

create function public.acknowledge_alerts_after_call()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := case when new.direction = 'outbound'
    then new.started_at else new.answered_at end;
begin
  update public.alert_escalations a
     set acknowledged_at = v_at,
         acknowledged_by = new.answered_by_user_id,
         escalate_at = null
   where a.company_id = new.company_id
     and a.created_at <= v_at
     and a.acknowledged_at is null
     and (a.conversation_id = new.conversation_id or (
       new.conversation_id is null and exists (
         select 1 from public.conversations t
          where t.id = a.conversation_id and t.company_id = new.company_id
            and t.phone_number_id = new.phone_number_id
            and t.contact_phone_e164 = new.caller_e164
       )
     ));
  return null;
end $$;

revoke execute on function public.acknowledge_alerts_after_call()
  from public, anon, authenticated;

create trigger acknowledge_alerts_after_call
  after insert or update of conversation_id, phone_number_id, caller_e164, state,
    answered_by_user_id, answered_at, customer_call_control_id on public.calls
  for each row
  when (new.answered_by_user_id is not null and (
    new.answered_at is not null or (new.direction = 'outbound' and (
      new.state = 'dialing' or (new.state = 'ended_missed' and new.customer_call_control_id is not null)
    ))
  ))
  execute function public.acknowledge_alerts_after_call();

alter table public.alert_escalations
  add column rearm_count smallint not null default 0 check (rearm_count between 0 and 3);

-- Recheck persisted activity so a delayed mirror or an older reply can't page the crew.
create or replace function public.api_claim_due_alerts(
  p_now timestamptz default now(),
  p_limit integer default 50
) returns setof public.alert_escalations
language sql
security definer
set search_path = ''
as $$
  with due as (
    select id, company_id, conversation_id, created_at
      from public.alert_escalations
     where escalate_at <= p_now and acknowledged_at is null
     order by escalate_at, id
     limit p_limit
     for update skip locked
  ), claimed as (
    update public.alert_escalations a
       set escalated_at = case when activity.occurred_at is null then p_now else a.escalated_at end,
           acknowledged_at = activity.occurred_at,
           acknowledged_by = activity.user_id,
           escalate_at = null
      from due d
      left join lateral (
        select m.created_at as occurred_at, m.sent_by_user_id as user_id
          from public.messages m
         where m.company_id = d.company_id and m.conversation_id = d.conversation_id
           and m.created_at between d.created_at and p_now
           and m.direction = 'outbound' and m.sent_by_user_id is not null
           and not m.automated and m.status in ('queued', 'sent', 'delivered')
        union all
        select case when c.direction = 'outbound' then c.started_at else c.answered_at end,
               c.answered_by_user_id
          from public.calls c
          join public.conversations t on t.id = d.conversation_id and t.company_id = d.company_id
         where c.company_id = d.company_id
           and (c.conversation_id = t.id or (c.conversation_id is null
             and c.phone_number_id = t.phone_number_id and c.caller_e164 = t.contact_phone_e164))
           and c.answered_by_user_id is not null
           and (c.answered_at is not null or (c.direction = 'outbound' and (
             c.state = 'dialing' or (c.state = 'ended_missed' and c.customer_call_control_id is not null)
           )))
           and (case when c.direction = 'outbound' then c.started_at else c.answered_at end)
                 between d.created_at and p_now
        order by occurred_at, user_id
        limit 1
      ) activity on true
     where a.id = d.id
     returning a.*
  )
  select * from claimed where acknowledged_at is null
$$;

create function public.api_rearm_alert(
  p_company_id uuid,
  p_alert_id uuid,
  p_claimed_at timestamptz
) returns boolean
language sql
security definer
set search_path = ''
as $$
  with rearmed as (
    update public.alert_escalations
       set escalate_at = greatest(now(), p_claimed_at) + interval '1 minute',
           escalated_at = null,
           rearm_count = rearm_count + 1
     where id = p_alert_id and company_id = p_company_id
       and escalated_at = p_claimed_at and escalate_at is null
       and acknowledged_at is null and rearm_count < 3
     returning 1
  )
  select exists (select 1 from rearmed)
$$;

revoke execute on function public.api_rearm_alert(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_rearm_alert(uuid, uuid, timestamptz) to service_role;
