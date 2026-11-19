create or replace function public.scheduled_messages_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
       (old.status = 'pending' and new.status in ('held', 'sent', 'canceled', 'expired', 'failed'))
    or (old.status = 'held' and new.status in ('pending', 'sent', 'canceled', 'expired', 'failed'))
    or (old.status = 'canceled' and new.status in ('pending', 'held')
        and old.canceled_by is not null and old.canceled_at is not null
        and old.canceled_at > now() - interval '5 minutes'
        and new.canceled_at is null and new.canceled_by is null)
  ) then
    raise exception 'scheduled message % cannot go from % to %', old.id, old.status, new.status
      using errcode = 'P0001', hint = 'illegal_transition';
  end if;
  return new;
end $$;

create function public.api_restore_scheduled_message(
  p_id uuid,
  p_company_id uuid,
  p_user_id uuid,
  p_canceled_at timestamptz
) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  v_row public.scheduled_messages;
begin
  perform 1 from public.companies where id = p_company_id for update;

  select * into v_row from public.scheduled_messages s
   where s.id = p_id and s.company_id = p_company_id and s.status = 'canceled'
     and s.canceled_by = p_user_id and s.canceled_at = p_canceled_at
     and s.canceled_at > now() - interval '5 minutes'
     and s.expires_at > now() and (s.send_at > now() or s.held_at is not null)
     and exists (select 1 from public.conversations c
                  where c.id = s.conversation_id and c.company_id = p_company_id and c.status <> 'closed')
   for update;
  if not found then
    return false;
  end if;

  if (select count(*) from public.scheduled_messages s
       where s.company_id = p_company_id and s.status in ('pending', 'held'))
       >= public.scheduled_messages_per_company_cap()
     or (select count(*) from public.scheduled_messages s
          where s.conversation_id = v_row.conversation_id and s.status in ('pending', 'held'))
       >= public.scheduled_messages_per_thread_cap() then
    return false;
  end if;

  update public.scheduled_messages
     set status = case when v_row.held_at is null then 'pending' else 'held' end,
         canceled_at = null, canceled_by = null, updated_at = now()
   where id = p_id;
  return true;
end;
$$;

revoke execute on function public.api_restore_scheduled_message(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_restore_scheduled_message(uuid, uuid, uuid, timestamptz)
  to service_role;

alter function public.state_transition_expected(text, text, text)
  rename to state_transition_expected_initial;

create function public.state_transition_expected(p_machine text, p_from text, p_to text)
returns boolean
language sql immutable set search_path = '' as $$
  select public.state_transition_expected_initial(p_machine, p_from, p_to) or exists (
    select 1 from (values
      ('scheduled_message', 'canceled', 'pending'),
      ('scheduled_message', 'canceled', 'held')
    ) e(machine, from_state, to_state)
    where e.machine = p_machine and e.from_state = p_from and e.to_state = p_to
  );
$$;

revoke execute on function public.state_transition_expected(text, text, text)
  from public, anon, authenticated;
